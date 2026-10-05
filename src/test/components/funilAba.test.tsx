import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FunilAba from '../../pages/clientes/abas/FunilAba';
import type { Aniversariante } from '../../pages/clientes/aniversarioMensagem';

// Aba Funil inteira (Quem chamar + Ofertas em acordeão) com o servidor simulado por ação.
const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  invokeWithAuth: (...args: unknown[]) => invoke(...args),
}));
vi.mock('@/components/base/Dialogos', () => ({ avisar: vi.fn(), confirmar: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 't1', loja: 'Loja Teste' } }) }));

const CFG = {
  enabled: true, discount_type: 'percent', discount_value: 15, min_order_amount: 0,
  validity_days: 15, only_opt_in: false, message: null,
};

const STAGES = ['carrinho_abandonado', 'nunca_comprou', 'primeira_compra', 'recorrente', 'fiel', 'vip', 'em_risco', 'perdido'] as const;
const LABEL: Record<string, string> = {
  carrinho_abandonado: 'Carrinho abandonado', nunca_comprou: 'Cadastrou, nunca pediu', primeira_compra: 'Comprou 1 vez',
  recorrente: 'Recorrente', fiel: 'Fiel', vip: 'VIP', em_risco: 'Em risco', perdido: 'Perdido',
};
const regra = (stage: string, p: Record<string, unknown> = {}) => ({
  id: 'r-' + stage, stage, enabled: false, auto_send: false, delay_hours: 0, voucher_type: 'nenhum', voucher_value: 0,
  validade_dias: 7, mensagem: 'Oi, {nome}!', cooldown_days: 30, ...p,
});
const RULES = STAGES.map((s) => {
  if (s === 'carrinho_abandonado') return regra(s, { enabled: true, voucher_type: 'percentual', voucher_value: 10, validade_dias: 3 });
  if (s === 'em_risco') return regra(s, { enabled: true, auto_send: true, voucher_type: 'valor', voucher_value: 15, validade_dias: 7 });
  return regra(s);
});
const ANIV: Aniversariante[] = [
  { customer_id: 'a1', nome: 'Ana Hoje', phone: '41988887777', phone_fmt: '(41) 98888-7777', opt_out: false, dias_ate: 0, data_aniversario: '05/10', proximo_aniversario: '2026-10-05', voucher: null },
  {
    customer_id: 'a2', nome: 'Bia Sexta', phone: '41977776666', phone_fmt: '(41) 97777-6666', opt_out: false, dias_ate: 4, data_aniversario: '09/10', proximo_aniversario: '2026-10-09',
    voucher: { code: 'BD-Q1W2-E3R4', claim_token: 't', voucher_type: 'discount', discount_type: 'percent', discount_value: 15, original_amount: 15, min_order_amount: null, expires_at: '2099-01-01T00:00:00Z' },
  },
];
const acoes: string[] = [];

function servidor(extra: Record<string, unknown> = {}) {
  invoke.mockImplementation(async (fn: string, op: { body: { action: string } }) => {
    acoes.push(fn + ':' + op.body.action);
    if (fn === 'voucher-write') return { data: { data: CFG }, error: null };
    switch (op.body.action) {
      case 'overview':
        return {
          data: {
            stages: STAGES.map((s) => ({ stage: s, label: LABEL[s], desc: 'desc ' + s, clientes: s === 'em_risco' ? 2 : 0, gasto: 0, enviados: 0, converteu: 0 })),
            rules: RULES,
            settings: { max_msgs_por_semana: 1, hora_inicio: 0, hora_fim: 0, desconto_max_percent: 25, max_auto_por_dia: 30, auto_so_optin: true },
            criteria: { carrinho_horas: 72, perdido_dias: 90, risco_multiplicador: 1.5, risco_min_dias: 21, ciclo_padrao_dias: 30, fiel_min_pedidos: 6, vip_min_pedidos: 6, vip_percentil: 0.9, vip_min_gasto: 0 },
            criteria_padrao: {}, aniversariantes: 2, aniversariantes_com_voucher: 1, ...extra,
          },
          error: null,
        };
      case 'list_stage': return { data: { clientes: [] }, error: null };
      case 'list_aniversariantes': return { data: { clientes: ANIV, total: 2 }, error: null };
      case 'templates_status':
        return { data: { modelos: [{ name: 'crm_oferta_cupom', status: 'APPROVED', rejected_reason: null }, { name: 'crm_contato', status: 'APPROVED', rejected_reason: null }], pode_enviar: false }, error: null };
      default: return { data: {}, error: null };
    }
  });
}
const renderAba = (podeVoucher = true) => render(<FunilAba onEnviarVoucher={() => {}} podeVoucher={podeVoucher} />);

beforeEach(() => {
  invoke.mockReset();
  acoes.length = 0;
  // jsdom não tem scrollIntoView (a tela rola até a lista no celular).
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('FunilAba (Quem chamar + Ofertas em acordeão)', () => {
  it('Quem chamar: cartão Aniversariantes primeiro, com o selo do voucher; toque abre a lista', async () => {
    servidor();
    renderAba();
    const cartao = await screen.findByRole('button', { name: /Aniversariantes/ });
    expect(cartao).toHaveTextContent('2');
    expect(cartao).toHaveTextContent('Voucher de aniversário pronto');
    expect(cartao).toHaveTextContent('Fazem aniversário nos próximos 7 dias');
    // é o primeiro cartão da fila "Precisam de atenção"
    expect(cartao.parentElement!.firstElementChild).toBe(cartao);
    // a sub-aba mudou de nome
    expect(screen.getByRole('button', { name: /Quem chamar/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Funil$/ })).toBeNull();

    fireEvent.click(cartao);
    expect(await screen.findByText('Ana Hoje')).toBeInTheDocument();
    expect(screen.getByText('Bia Sexta')).toBeInTheDocument();
    expect(screen.getByText('sexta, 09/10')).toBeInTheDocument();
    expect(screen.getByText(/BD-Q1W2-E3R4/)).toBeInTheDocument();
    expect(acoes).toContain('crm-funnel:list_aniversariantes');
  });

  it('sem o campo no overview (servidor antigo) ou com falha: o cartão não aparece', async () => {
    servidor({ aniversariantes: null, aniversariantes_com_voucher: null });
    renderAba();
    await screen.findAllByText('Em risco');
    expect(screen.queryByRole('button', { name: /Aniversariantes/ })).toBeNull();
  });

  it('Ofertas: acordeão com Aniversário primeiro, resumos e selos, uma linha aberta por vez', async () => {
    servidor();
    renderAba();
    fireEvent.click(await screen.findByRole('button', { name: /Ofertas/ }));
    // Aniversário é a primeira linha e já resume a config carregada
    expect(await screen.findByText('15% por 15 dias · gera sozinho às 9h')).toBeInTheDocument();
    const aniversario = screen.getByRole('button', { name: /Aniversário/ });
    expect(aniversario).toHaveTextContent('Automático');
    // estágios: resumo curto + selo
    const carrinho = screen.getByRole('button', { name: /Carrinho abandonado/ });
    // Aniversário vem antes de todos os estágios
    expect(aniversario.compareDocumentPosition(carrinho) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(carrinho).toHaveTextContent('10% por 3 dias');
    expect(carrinho).toHaveTextContent('Sugerindo');
    const risco = screen.getByRole('button', { name: /Em risco/ });
    expect(risco).toHaveTextContent('R$ 15 por 7 dias');
    expect(risco).toHaveTextContent('Automático');
    expect(screen.getByRole('button', { name: /Fiel/ })).toHaveTextContent('só mensagem');
    expect(screen.getByRole('button', { name: /Fiel/ })).toHaveTextContent('Desligado');
    // painel do automático recolhido, com resumo
    expect(screen.getByText(/ligado em 1 estágio/)).toBeInTheDocument();

    // abre um estágio: aparece o editor que já existia
    fireEvent.click(carrinho);
    expect(screen.getByText('Mensagem')).toBeInTheDocument();
    expect(screen.getByText('Oferta ligada')).toBeInTheDocument();
    // abrir outro fecha o primeiro
    fireEvent.click(risco);
    expect(screen.getByRole('button', { name: /Carrinho abandonado/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Em risco/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('Mensagem')).toHaveLength(1);
  });

  it('Ofertas sem acesso a Vouchers: Aniversário só mostra o aviso e não chama o voucher-write', async () => {
    servidor();
    renderAba(false);
    fireEvent.click(await screen.findByRole('button', { name: /Ofertas/ }));
    expect(await screen.findByText('Só quem tem acesso a Vouchers configura')).toBeInTheDocument();
    expect(acoes.filter((a) => a.startsWith('voucher-write'))).toHaveLength(0);
  });
});
