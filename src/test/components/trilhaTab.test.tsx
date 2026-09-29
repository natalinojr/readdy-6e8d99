// Financeiro › Trilha (2026-09-29): a aba junta nota, compra, estoque, conta, pagamento e extrato.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ rpc: vi.fn(), navigate: vi.fn(), invoke: vi.fn(), from: vi.fn(), email: 'outra@pessoa.com' }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from, functions: { invoke: h.invoke } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 't1', email: h.email } }) }));
vi.mock('@/components/feature/AssistenteChat', () => ({ ASSISTENTE_OWNER_EMAIL: 'dono@erpos.com' }));
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
  beforeEach(() => { h.rpc.mockReset(); h.navigate.mockReset(); h.invoke.mockReset(); h.from.mockReset(); h.email = 'outra@pessoa.com'; });

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

  it('sugestão do extrato: Confirmar chama a Conciliação e a tarefa vai para "Resolvido agora" com desfazer', async () => {
    const comSugestao = { ...dados, extrato: [{ ...dados.extrato[0], sugestao: 'Lançar como despesa: Tarifa Pix' }] };
    const semExtrato = { ...dados, extrato: [] };
    h.rpc.mockResolvedValueOnce({ data: comSugestao, error: null }).mockResolvedValue({ data: semExtrato, error: null });
    h.invoke.mockResolvedValue({ data: { success: true, results: [{ id: 'x1', ok: true, msg: 'ok' }] }, error: null });
    render(<TrilhaTab />);
    expect(await screen.findByText(/Lançar como despesa: Tarifa Pix/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('conciliacao-pagamentos', { body: { action: 'confirm', tenant_id: 't1', ids: ['x1'] } }));
    expect(await screen.findByText('desfazer')).toBeInTheDocument();
    expect(screen.getByText(/Confirmou: Lançar como despesa/)).toBeInTheDocument();
  });

  it('criar a conta a pagar: soma que não fecha bloqueia; fechando chama create_missing_bills', async () => {
    const semConta = { ...dados, contas: [], extrato: [] };
    h.rpc.mockResolvedValue({ data: semConta, error: null });
    h.invoke.mockResolvedValue({ data: { bill_ids: ['b1'] }, error: null });
    render(<TrilhaTab />);
    fireEvent.click(await screen.findByText('Criar a conta a pagar'));
    const campos = screen.getAllByRole('spinbutton');
    fireEvent.change(campos[1], { target: { value: '10' } });
    expect(screen.getByText(/não fecha com o total da compra/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar conta a pagar' })).toBeDisabled();
    fireEvent.change(campos[1], { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta a pagar' }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('purchase-write', expect.objectContaining({
      body: expect.objectContaining({ action: 'create_missing_bills', tenant_id: 't1', payload: expect.objectContaining({ purchase_id: 'p1', parcelas: [expect.objectContaining({ amount: 300 })] }) }),
    })));
  });

  it('dono: conta vencida sem boleto — pedir o boleto monta o link do WhatsApp', async () => {
    h.email = 'dono@erpos.com';
    h.rpc.mockResolvedValue({ data: dados, error: null });
    h.from.mockReturnValue({ select: () => ({ eq: () => ({ in: async () => ({ data: [{ id: 'a1', boleto_digitavel: null, boleto_barcode: null, boleto_pix_copia: null, boleto_origem: null }] }) }) }) });
    h.invoke.mockResolvedValue({ data: { success: true, data: { fornecedor: 'Copal', telefone: '(41) 99812-4471', email: null, pedido_em: '2026-09-29', pedidos: 1, mensagem: 'Oi, preciso do boleto' } }, error: null });
    render(<TrilhaTab />);
    expect(await screen.findByText('sem boleto nem Pix')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Pedir o boleto…'));
    fireEvent.click(screen.getByText('Preparar mensagem'));
    const link = await screen.findByText('Abrir no WhatsApp');
    expect(link.closest('a')).toHaveAttribute('href', 'https://wa.me/5541998124471?text=Oi%2C%20preciso%20do%20boleto');
    expect(h.invoke).toHaveBeenCalledWith('assistente-app', { body: { action: 'conta_pedir_boleto', bill_id: 'a1' } });
  });
});
