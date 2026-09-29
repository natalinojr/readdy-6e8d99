// Financeiro › Trilha (2026-09-29): a aba junta nota, compra, estoque, conta, pagamento e extrato.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({ rpc: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 't1' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));

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

  it('mostra os casos, filtra os que precisam de atenção e leva para a tela certa', async () => {
    h.rpc.mockResolvedValue({ data: dados, error: null });
    render(<TrilhaTab />);
    expect(await screen.findByText('Copal')).toBeInTheDocument();
    expect(screen.getByText('Fulano')).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith('fin_trilha_dados', expect.objectContaining({ p_tenant: 't1' }));

    // os dois precisam de atenção (conta vencida; saída do banco sem lançamento)
    fireEvent.click(screen.getByText('Precisam de atenção'));
    expect(screen.getByText('Copal')).toBeInTheDocument();

    // abre a trilha e resolve o pagamento vencido
    fireEvent.click(screen.getByText('Copal'));
    const botoes = screen.getAllByText('Resolver');
    expect(botoes.length).toBeGreaterThan(0);
    fireEvent.click(botoes[botoes.length - 1]);
    expect(h.navigate).toHaveBeenCalledWith(expect.stringContaining('/financeiro?tab=pagar&busca=Copal'));
  });

  it('mostra o erro do banco em vez de lista vazia', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'sem acesso a esta loja' } });
    render(<TrilhaTab />);
    expect(await screen.findByText(/sem acesso a esta loja/)).toBeInTheDocument();
  });
});
