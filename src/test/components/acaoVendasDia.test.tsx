// Ação rápida "Vendas do dia": faturado por hora (hora de Brasília, soma = faturamento) e
// faturamento por categoria (itens dos pedidos pagos, pela categoria do cardápio).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  tabelas: {} as Record<string, (filtros: Array<[string, unknown]>) => { data: unknown; error: unknown }>,
  auth: { user: { id: 'u1', tenantId: 't1', loja: 'Vila Leste' } },
}));

// Cadeia do query builder: guarda os filtros e resolve no await.
function consulta(tabela: string) {
  const filtros: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'is', 'gte', 'lte', 'order', 'range', 'in']) {
    q[m] = (...args: unknown[]) => { filtros.push([m, args]); return q; };
  }
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(h.tabelas[tabela]?.(filtros) ?? { data: [], error: null }).then(ok);
  return q;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: h.rpc, from: (t: string) => consulta(t) },
  ensureFreshSession: vi.fn(),
  SUPABASE_URL: 'http://x',
  SUPABASE_ANON_KEY: 'k',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
// Permissões (botão "Abrir iFood no Financeiro"): fora do escopo deste teste.
vi.mock('@/components/feature/assistente/acoes/acesso', () => ({ useAcessoAcoes: () => ({ perfil: 'admin', pode: () => true, modulo: () => true, carregando: false }), rotaLiberada: () => false }));

import VendasDia from '@/components/feature/assistente/acoes/operacao/VendasDia';

const DIA = '2026-09-20';
const diaDoFiltro = (filtros: Array<[string, unknown]>) => String((filtros.find(([m]) => m === 'gte')![1] as unknown[])[1]).slice(0, 10);

describe('Ação rápida — Vendas do dia', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    h.rpc.mockImplementation((_n: string, p: { p_date_from: string }) => Promise.resolve({
      data: p.p_date_from.startsWith(DIA) ? { total_revenue: 350, total_orders: 3, avg_ticket: 116.67, top_items: [], by_payment: [], by_destination: [] } : { total_orders: 0 },
      error: null,
    }));
    h.tabelas = {
      // 12:30 e 12:50 em Brasília = 15:30Z / 15:50Z; 20:10 BRT = 23:10Z
      orders: (f) => ({
        data: diaDoFiltro(f) === DIA ? [
          { id: 'o1', created_at: `${DIA}T15:30:00Z`, total_amount: 100 },
          { id: 'o2', created_at: `${DIA}T15:50:00Z`, total_amount: 50 },
          { id: 'o3', created_at: `${DIA}T23:10:00Z`, total_amount: 200 },
        ] : [],
        error: null,
      }),
      order_items: () => ({
        data: [
          { item_price: 40, quantity: 2, menu_items: { menu_categories: { name: 'Burgers' } } },
          { item_price: 15, quantity: 3, menu_items: { menu_categories: { name: 'Bebidas' } } },
          { item_price: 10, quantity: 1, menu_items: null },
        ],
        error: null,
      }),
    };
  });

  it('mostra o gráfico por hora (pico às 20h, hora de Brasília) e as categorias', async () => {
    render(<VendasDia onFechar={() => {}} irPara={() => {}} />);
    fireEvent.click(await screen.findByText('Outra data'));
    const campo = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: DIA } });
    fireEvent.submit(campo.closest('form')!);

    expect(await screen.findByText('Faturado por hora')).toBeInTheDocument();
    // Começa no pico: 20h com R$ 200
    expect(screen.getByText(/20h ·/)).toBeInTheDocument();
    expect(screen.getAllByText(/^R\$\s200,00$/).length).toBeGreaterThan(0);
    // Eixo vai de 12h a 20h
    expect(screen.getByText('12h')).toBeInTheDocument();

    expect(screen.getByText('Por categoria (itens)')).toBeInTheDocument();
    expect(screen.getByText('Burgers')).toBeInTheDocument();
    expect(screen.getByText('Bebidas')).toBeInTheDocument();
    expect(screen.getByText('Sem categoria')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s80,00/)).toBeInTheDocument();
  });

  it('com iFood: destaque = ERPOS + iFood, detalhe de cada um e gráfico com a semana passada', async () => {
    const SEMANA = '2026-09-13';
    h.tabelas.fin_ifood_merchants = () => ({ data: [{ merchant_id: 'm1', name: 'Loja iFood', merchant_short: null }], error: null });
    h.tabelas.fin_ifood_sales = (f) => ({
      data: diaDoFiltro(f) === DIA
        ? [{ merchant_id: 'm1', sale_created_at: `${DIA}T23:30:00Z`, current_status: 'CONCLUDED', gross_bag: 90, delivery_fee: 10, sale_balance: 80, payment_methods: [], billing_entries: [] }]
        : diaDoFiltro(f) === SEMANA
          ? [{ merchant_id: 'm1', sale_created_at: `${SEMANA}T16:00:00Z`, current_status: 'CONCLUDED', gross_bag: 50, delivery_fee: 0, sale_balance: 40, payment_methods: [], billing_entries: [] }]
          : [],
      error: null,
    });
    render(<VendasDia onFechar={() => {}} irPara={() => {}} />);
    fireEvent.click(await screen.findByText('Outra data'));
    const campo = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: DIA } });
    fireEvent.submit(campo.closest('form')!);

    expect(await screen.findByText('Faturamento total')).toBeInTheDocument();
    expect(screen.getByText(/^R\$\s450,00$/)).toBeInTheDocument();
    expect(screen.getByText(/ERPOS R\$\s350,00 · iFood R\$\s100,00/)).toBeInTheDocument();
    // Gráfico soma os dois e sempre traz a linha da semana passada (lá só teve iFood)
    expect(screen.getByText('Faturado por hora (ERPOS + iFood)')).toBeInTheDocument();
    expect(screen.getAllByText(/dom passada/).length).toBeGreaterThan(0);
    h.tabelas.fin_ifood_merchants = () => ({ data: [], error: null });
    h.tabelas.fin_ifood_sales = () => ({ data: [], error: null });
  });
});
