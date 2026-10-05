// Financeiro › Painel › Vazamentos do mês (2026-10-05): o cartão soma só o que tem regra e deixa o resto de fora da soma.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ rpc: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 'par' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));

import VazamentosCard from '@/pages/financeiro/components/VazamentosCard';

const vazio = { total: 0, n: 0, itens: [] };
const parana = {
  tenant_id: 'par', nome: 'El Patron Paranaguá', de: '2026-09-01', ate: '2026-10-05', mes_anterior: { de: '2026-08-01', ate: '2026-08-31' },
  juros: { total: 282.29, n: 13, itens: [{ id: 'j1', fornecedor: 'COPAL ALIMENTOS - PARANA', valor: 15.51, pago_em: '2026-09-30', venceu_em: '2026-09-29', dias_atraso: 1 }] },
  insumos: { total: 846.63, n: 19, itens: [{ nome: 'Tomate', unidade: 'kg', preco_ant: 4.2679, preco_atual: 8.1703, qtd: 77.175, valor: 301.17 }] },
  pratos: {
    total: 90, n: 1, meta: 35, pratos_com_ficha: 41, pratos_sem_ficha: 43,
    itens: [{ nome: 'Coca-cola zero 600 ml', qtd: 16, receita: 192, custo: 119.66, cmv_pct: 62.3, a_mais: 52.46 }],
    ficha_suspeita: [{ nome: 'Nachos 4 Quesos', qtd: 3, receita: 114, custo: 365.94, cmv_pct: 321 }],
  },
  perdas: vazio, pix: vazio,
  caixa: { fechamentos: 18, com_diferenca: 14, itens: [{ dia: '2026-10-03', diferenca: -160, motivo: 'Teste junior' }] },
  vencidas: { n: 4, valor: 2450.34 },
};
const vila = {
  ...parana, tenant_id: 'vila', nome: 'Vila Leste & El Patron',
  juros: vazio, insumos: vazio, perdas: vazio, caixa: { fechamentos: 0, com_diferenca: 0, itens: [] }, vencidas: { n: 6, valor: 1597.1 },
  pix: { total: 155.8, n: 3, itens: [{ numero: 'P0310260002', dia: '2026-10-04', valor: 25.9, motivo: 'Pix pelo app não pago até o fechamento do caixa' }] },
  pratos: { total: 0, n: 0, meta: 35, pratos_com_ficha: 0, pratos_sem_ficha: 33, itens: [], ficha_suspeita: [] },
};

function responder(lojas: Array<{ tenant_id: string; nome: string; oculta: boolean }>) {
  h.rpc.mockImplementation((fn: string, args: { p_tenant?: string }) => {
    if (fn === 'fn_vazamentos_lojas') return Promise.resolve({ data: lojas, error: null });
    if (fn === 'fn_vazamentos_mes') return Promise.resolve({ data: args.p_tenant === 'vila' ? vila : parana, error: null });
    return Promise.resolve({ data: null, error: { message: 'rpc?' } });
  });
}
const texto = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');

describe('VazamentosCard', () => {
  beforeEach(() => { h.rpc.mockReset(); h.navigate.mockReset(); });

  it('soma só as linhas com regra; pratos acima da meta, caixa, vencidas e ficha suspeita ficam fora', async () => {
    responder([{ tenant_id: 'par', nome: 'El Patron Paranaguá', oculta: false }]);
    render(<VazamentosCard onIrAba={vi.fn()} versao={0} />);
    await screen.findByText(/Juros e multa em 13 contas pagas atrasadas/);
    // 282,29 + 846,63 = 1.128,92 → R$ 1.129. Fora: os R$ 90 do prato acima da meta (o custo da ficha já tem a alta do
    // insumo — somar contaria o mesmo real duas vezes), os R$ 365,94 da ficha suspeita, as vencidas e o caixa.
    expect(texto(screen.getByText(/que dava para evitar/).parentElement as HTMLElement)).toContain('R$ 1.129');
    expect(screen.getByText(/Coca-cola zero 600 ml vende com CMV 62%/)).toBeInTheDocument();
    expect(screen.getByText(/Diferença de caixa em 14 de 18 fechamentos/)).toBeInTheDocument();
    expect(screen.getAllByText('não soma').length).toBeGreaterThanOrEqual(3); // pratos + caixa + contas vencidas
    expect(screen.getByText(/Conferir a ficha/)).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith('fn_vazamentos_mes', expect.objectContaining({ p_tenant: 'par', p_de: expect.stringMatching(/-01$/), p_meta_cmv: 35 }));
  });

  it('cada linha abre a folha com a lista que a explica e o total que bate com o cartão', async () => {
    responder([{ tenant_id: 'par', nome: 'El Patron Paranaguá', oculta: false }]);
    render(<VazamentosCard onIrAba={vi.fn()} versao={0} />);
    await screen.findByText(/Juros e multa em 13 contas/);
    fireEvent.click(screen.getAllByText('Ver os 13')[0]);
    expect(await screen.findByText('COPAL ALIMENTOS - PARANA')).toBeInTheDocument();
    expect(texto(screen.getByText('Total que bate com o cartão').parentElement as HTMLElement)).toContain('282,29');
  });

  it('com mais de uma loja: chips, e "Somar as lojas" mostra de qual loja é cada linha; loja sem ficha avisa', async () => {
    responder([{ tenant_id: 'par', nome: 'El Patron Paranaguá', oculta: false }, { tenant_id: 'vila', nome: 'Vila Leste & El Patron', oculta: false }]);
    render(<VazamentosCard onIrAba={vi.fn()} versao={0} />);
    await screen.findByText(/Juros e multa em 13 contas/);
    fireEvent.click(screen.getByText('Somar as lojas'));
    await waitFor(() => expect(screen.getByText(/Pix do delivery: 3 pedidos não pagos \(o cliente pode ter pedido de novo\)/)).toBeInTheDocument());
    expect(screen.getByText(/Nenhum prato vendido tem ficha técnica/)).toBeInTheDocument();
    expect(screen.getByText(/Somando as lojas/)).toBeInTheDocument();
    // Pix não pago é "a conferir": a soma das duas lojas continua R$ 1.129 (só Paranaguá tem juros e insumos).
    expect(texto(screen.getByText(/que dava para evitar/).parentElement as HTMLElement)).toContain('R$ 1.129');
  });

  it('sem nenhuma loja do Financeiro, o cartão não aparece', async () => {
    responder([]);
    const { container } = render(<VazamentosCard onIrAba={vi.fn()} versao={0} />);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('fn_vazamentos_lojas'));
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });
});
