import { describe, it, expect } from 'vitest';
import { montarTrilha, type TrilhaDados, type TrCompra, type TrConta, type TrNota, type TrExtrato, type CasoTrilha } from '@/lib/trilhaDespesas';

const HOJE = '2026-09-29';
const vazio = (): TrilhaDados => ({ compras: [], contas: [], notas: [], extrato: [], caixa: [], pedidos: [] });
const compra = (o: Partial<TrCompra> = {}): TrCompra => ({
  id: 'p1', supplier: 'Copal', invoice_number: null, total_amount: 300, payment_method: 'boleto',
  payment_status: 'pending', purchase_date: '2026-09-10', delivery_confirmed_at: null, stock_applied_at: null,
  is_bonus: false, created_at: null, itens: 2, itens_estoque: 2, ...o,
});
const conta = (o: Partial<TrConta> = {}): TrConta => ({
  id: 'a1', description: 'Copal', supplier: 'Copal', category: 'CMV', dre_category_id: 'dre', amount: 300,
  paid_amount: null, due_date: '2026-10-10', paid_date: null, status: 'pending', installments: 1,
  installment_number: 1, parent_id: null, reference_id: 'p1', reference_type: 'purchase',
  payment_method: 'boleto', competence_month: null, created_at: null, ...o,
});
const nota = (o: Partial<TrNota> = {}): TrNota => ({
  id: 'n1', numero: 123, serie: '1', modelo: 55, emitente_nome: 'Copal', valor_total: 300,
  emitted_at: '2026-09-09T10:00:00-03:00', status: 'imported', import_type: 'purchase', purchase_id: 'p1',
  payable_ids: [], auto_imported: false, ...o,
});
const ext = (o: Partial<TrExtrato> = {}): TrExtrato => ({
  id: 'x1', transaction_date: '2026-09-15', amount: 300, description: 'PAGAMENTO', counterpart_name: 'Copal',
  status: 'matched', match_kind: 'payable', reconciled: true, bill_id: 'a1', juros_bill_id: null,
  purchase_id: null, source: 'inter', ...o,
});
const trilha = (d: TrilhaDados) => montarTrilha(d, '2026-09-01', '2026-09-30', HOJE);
const etapa = (c: CasoTrilha, id: string) => c.etapas.find((e) => e.id === id)!;

describe('montarTrilha', () => {
  it('compra completa: nota → compra → estoque → conta → paga → extrato, tudo ok', () => {
    const d = vazio();
    d.compras = [compra({ stock_applied_at: '2026-09-11T12:00:00Z', delivery_confirmed_at: '2026-09-11T12:00:00Z', payment_status: 'paid' })];
    d.notas = [nota()];
    d.contas = [conta({ status: 'paid', paid_date: '2026-09-15', paid_amount: 300 })];
    d.extrato = [ext()];
    const cs = trilha(d);
    expect(cs).toHaveLength(1);
    expect(cs[0].tipo).toBe('compra');
    expect(cs[0].etapas.map((e) => e.estado)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(cs[0].situacao).toBe('ok');
  });

  it('conta vencida e mercadoria não recebida', () => {
    const d = vazio();
    d.compras = [compra()];
    d.contas = [conta({ due_date: '2026-09-20', status: 'overdue' })];
    const c = trilha(d)[0];
    expect(etapa(c, 'estoque').estado).toBe('pendente');
    expect(etapa(c, 'pagamento').estado).toBe('atrasado');
    expect(etapa(c, 'banco').estado).toBe('espera');
    expect(c.situacao).toBe('atencao');
    expect(etapa(c, 'pagamento').resumo).toBe('Venceu em 20/09 e não foi paga');
    expect(etapa(c, 'pagamento').falta).toBe('pagar — 9 dias de atraso');
    const v = c.tarefas.find((t) => t.grupo === 'vencidas')!;
    expect(v).toMatchObject({ urgente: true, etapas: ['pagamento', 'banco'], porque: 'Venceu há 9 dias.' });
    expect(c.tarefas.find((t) => t.grupo === 'estoque')!.urgente).toBe(false);
  });

  it('conta a pagar dentro do vencimento é "no prazo": não é tarefa nem trava o caso', () => {
    const d = vazio();
    d.compras = [compra({ stock_applied_at: '2026-09-11T12:00:00Z', delivery_confirmed_at: '2026-09-11T12:00:00Z' })];
    d.contas = [conta({ due_date: '2026-10-10' })];
    const c = trilha(d)[0];
    expect(etapa(c, 'pagamento').estado).toBe('prazo');
    expect(etapa(c, 'pagamento').resumo).toBe('Vence em 10/10');
    expect(c.tarefas).toHaveLength(0);
    expect(c.situacao).toBe('andamento');
  });

  it('despesa com category em texto mas sem dre_category_id vira tarefa classificar', () => {
    const d = vazio();
    d.contas = [conta({ reference_type: null, reference_id: null, category: 'Energia', dre_category_id: null, due_date: '2026-09-30' })];
    const c = trilha(d)[0];
    expect(etapa(c, 'lancamento').estado).toBe('pendente');
    expect(etapa(c, 'lancamento').falta).toBe('escolher a categoria do DRE');
    expect(c.tarefas.map((t) => t.grupo)).toContain('classificar');
  });

  it('conta da folha (hr_payroll) sem categoria do DRE não é para classificar', () => {
    const d = vazio();
    d.contas = [conta({ reference_type: 'hr_payroll', reference_id: null, category: null, dre_category_id: null, due_date: '2026-09-30' })];
    const c = trilha(d)[0];
    expect(etapa(c, 'lancamento').estado).toBe('ok');
    expect(c.tarefas.map((t) => t.grupo)).not.toContain('classificar');
  });

  it('nota não lançada gera tarefa notas (não urgente)', () => {
    const d = vazio();
    d.notas = [nota({ status: 'new', purchase_id: null })];
    const c = trilha(d)[0];
    expect(c.tarefas).toHaveLength(1);
    expect(c.tarefas[0]).toMatchObject({ grupo: 'notas', urgente: false, etapas: ['lancamento'] });
    expect(etapa(c, 'estoque').estado).toBe('espera');
  });

  it('compra a prazo sem conta gera tarefa sem_conta urgente', () => {
    const d = vazio();
    d.compras = [compra()];
    const c = trilha(d)[0];
    expect(c.tarefas.find((t) => t.grupo === 'sem_conta')).toMatchObject({ urgente: true, etapas: ['conta'] });
    expect(etapa(c, 'conta').falta).toContain('criar a conta a pagar');
  });

  it('compra a prazo sem conta a pagar é problema', () => {
    const d = vazio();
    d.compras = [compra()];
    const c = trilha(d)[0];
    expect(etapa(c, 'conta').estado).toBe('problema');
  });

  it('compra paga na hora (caixa) não precisa de conta', () => {
    const d = vazio();
    d.compras = [compra({ payment_status: 'paid', payment_method: 'Dinheiro', itens_estoque: 0 })];
    d.caixa = [{ id: 'c1', date: '2026-09-10', amount: 300, reference_id: 'p1' }];
    d.extrato = [ext({ id: 'outra', bill_id: null, status: 'ignored' })]; // loja com extrato
    const c = trilha(d)[0];
    expect(etapa(c, 'conta').estado).toBe('na');
    expect(etapa(c, 'pagamento').estado).toBe('ok');
    expect(etapa(c, 'banco').resumo).toBe('Não precisa: dinheiro não passa pelo banco');
    expect(etapa(c, 'estoque').estado).toBe('na');
    expect(c.situacao).toBe('ok');
  });

  it('recebida com item que tem vínculo mas não entrou: problema com atalho para a Classificação', () => {
    const d = vazio();
    const recebida = '2026-09-22T23:02:56Z';
    d.compras = [compra({ itens: 7, itens_estoque: 0, itens_sem_entrar: 7, delivery_confirmed_at: recebida, stock_applied_at: recebida })];
    const e = etapa(trilha(d)[0], 'estoque');
    expect(e.estado).toBe('problema');
    expect(e.resumo).toContain('7 itens que têm insumo não entraram');
    expect(e.atalho).toEqual({ tab: 'itens', param: 'filtro', valor: 'fora_estoque' });
    // sem vínculo nenhum continua "não precisa"
    d.compras = [compra({ itens: 7, itens_estoque: 0, itens_sem_entrar: 0, delivery_confirmed_at: recebida, stock_applied_at: recebida })];
    expect(etapa(trilha(d)[0], 'estoque').estado).toBe('na');
  });

  it('nota que chegou e ninguém lançou vira caso próprio', () => {
    const d = vazio();
    d.notas = [nota({ status: 'new', purchase_id: null })];
    const c = trilha(d)[0];
    expect(c.tipo).toBe('nota');
    expect(etapa(c, 'lancamento').estado).toBe('pendente');
  });

  it('saída do banco sem lançamento aparece como problema', () => {
    const d = vazio();
    d.extrato = [ext({ status: 'pending', bill_id: null, match_kind: null, reconciled: false })];
    const c = trilha(d)[0];
    expect(c.tipo).toBe('pagamento');
    expect(etapa(c, 'lancamento').estado).toBe('problema');
    expect(etapa(c, 'banco').estado).toBe('espera');
    expect(etapa(c, 'banco').falta).toBeUndefined();
    expect(c.tarefas.map((t) => t.grupo)).toEqual(['saida_banco']);
    expect(c.tarefas[0]).toMatchObject({ urgente: true, etapas: ['lancamento', 'banco'] });
  });

  it('despesa paga sem extrato ligado (loja com extrato) fica pendente no banco', () => {
    const d = vazio();
    d.contas = [conta({ id: 'a9', reference_type: null, reference_id: null, status: 'paid', paid_date: '2026-09-12', due_date: '2026-09-12' })];
    d.extrato = [ext({ id: 'x9', bill_id: null, status: 'ignored', transaction_date: '2026-09-01' })];
    const c = trilha(d).find((x) => x.tipo === 'despesa')!;
    expect(etapa(c, 'banco').estado).toBe('pendente');
    expect(etapa(c, 'estoque').estado).toBe('na');
  });

  it('parcelas da mesma despesa ficam juntas; juros vão junto do pagamento', () => {
    const d = vazio();
    d.contas = [
      conta({ id: 'a1', reference_type: null, reference_id: null, due_date: '2026-09-05', status: 'paid', paid_date: '2026-09-06' }),
      conta({ id: 'a2', reference_type: null, reference_id: null, parent_id: 'a1', due_date: '2026-10-05' }),
      conta({ id: 'j1', reference_type: 'conciliacao_juros', reference_id: 'x1', amount: 5, status: 'paid' }),
    ];
    d.extrato = [ext({ juros_bill_id: 'j1' })];
    const cs = trilha(d);
    expect(cs).toHaveLength(1);
    expect(cs[0].contas).toHaveLength(2);
    expect(cs[0].juros).toHaveLength(1);
    expect(etapa(cs[0], 'pagamento').resumo).toBe('1 de 2 parcelas pagas — a próxima vence em 05/10');
  });

  it('extrato conciliado com a conta ainda em aberto gera aviso', () => {
    const d = vazio();
    d.compras = [compra()];
    d.contas = [conta()];
    d.extrato = [ext()];
    const c = trilha(d)[0];
    expect(c.avisos.join()).toContain('conta ainda está em aberto');
    expect(c.situacao).toBe('atencao');
  });

  it('filtra pela data do caso', () => {
    const d = vazio();
    d.compras = [compra({ purchase_date: '2026-08-20' })];
    d.contas = [conta({ due_date: '2026-09-20' })];
    expect(trilha(d)).toHaveLength(0);
  });
});
