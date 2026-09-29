// Financeiro › Trilha (2026-09-29): a aba junta nota, compra, estoque, conta, pagamento e extrato.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({ rpc: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 't1' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));
vi.mock('@/contexts/EstoqueContext', () => ({ useEstoque: () => ({ reloadInsumos: vi.fn(), reloadMovimentacoes: vi.fn() }) }));
vi.mock('@/pages/financeiro/components/conciliacao/LinhaExtratoModal', () => ({
  default: ({ linha }: { linha: { id: string } }) => <div>janela do extrato {linha.id}</div>,
}));
vi.mock('@/pages/financeiro/components/compras/DetalhePurchaseModal', () => ({ default: () => <div>janela da compra</div> }));
vi.mock('@/pages/financeiro/components/ContasPagarDREModal', () => ({ default: () => <div>janela da categoria</div> }));

import TrilhaTab from '@/pages/financeiro/components/TrilhaTab';

const mes = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
const dados = {
  compras: [{
    id: 'p1', supplier: 'Copal', invoice_number: null, total_amount: 300, payment_method: 'boleto', payment_status: 'pending',
    purchase_date: `${mes}-01`, delivery_confirmed_at: null, stock_applied_at: null, is_bonus: false, created_at: null, itens: 2, itens_estoque: 2,
  }],
  contas: [{
    id: 'a1', description: 'Copal NF 1', supplier: 'Copal', category: 'CMV', dre_category_id: 'd', amount: 300, paid_amount: null,
    due_date: '2020-01-01', paid_date: null, status: 'overdue', installments: 1, installment_number: 1, parent_id: null,
    reference_id: 'p1', reference_type: 'purchase', payment_method: 'boleto', competence_month: null, created_at: null,
  }],
  notas: [], caixa: [], pedidos: [],
  extrato: [{
    id: 'x1', transaction_date: `${mes}-01`, amount: 99, description: 'PIX ENVIADO', counterpart_name: 'Fulano', status: 'pending',
    match_kind: null, reconciled: false, bill_id: null, juros_bill_id: null, purchase_id: null, source: 'inter',
  }],
};

describe('TrilhaTab', () => {
  beforeEach(() => { h.rpc.mockReset(); h.navigate.mockReset(); });

  it('mostra as tarefas por grupo e leva para a tela certa', async () => {
    h.rpc.mockResolvedValue({ data: dados, error: null });
    render(<TrilhaTab />);
    expect((await screen.findAllByText('Copal')).length).toBeGreaterThan(0);
    expect(screen.getByText('Fulano')).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith('fin_trilha_dados', expect.objectContaining({ p_tenant: 't1' }));
    expect(screen.getAllByText('Pagar contas a pagar vencidas').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Abrir em Contas a pagar'));
    expect(h.navigate).toHaveBeenCalledWith(expect.stringContaining('/financeiro?tab=pagar&busca=Copal'));
  });

  it('saída sem lançamento: "Dizer o que foi" abre a linha do extrato ali mesmo, sem trocar de aba', async () => {
    h.rpc.mockResolvedValue({ data: dados, error: null });
    render(<TrilhaTab />);
    await screen.findByText('Fulano');
    fireEvent.click(screen.getByText('Dizer o que foi'));
    expect(screen.getByText('janela do extrato x1')).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('"ver fases" abre a linha de fases e a matriz mostra o caminho de cada despesa', async () => {
    h.rpc.mockResolvedValue({ data: dados, error: null });
    render(<TrilhaTab />);
    await screen.findByText('Fulano');
    fireEvent.click(screen.getAllByText('ver fases')[0]);
    expect(screen.getAllByText('Resolver aqui').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Matriz'));
    expect(screen.getByText('Todas as despesas do mês, fase a fase')).toBeInTheDocument();
  });

  it('mostra o erro do banco em vez de lista vazia', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'sem acesso a esta loja' } });
    render(<TrilhaTab />);
    expect(await screen.findByText(/sem acesso a esta loja/)).toBeInTheDocument();
  });
});
