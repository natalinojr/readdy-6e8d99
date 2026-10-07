import { describe, it, expect } from 'vitest';
import { contaProvavel, montarSituacao, ultimoPixPorConta, valorDoTexto, type ContaBruta } from '@/lib/situacaoConta';
import { semOJaPago } from '@/pages/hoje/useSituacaoHoje';
import type { ItemHoje, PendHoje } from '@/pages/hoje/organizar';

const HOJE = '2026-10-07';
const conta = (x: Partial<ContaBruta> = {}): ContaBruta => ({
  id: 'b1', tenant_id: 't1', supplier: 'BEEMAX DISTRIBUIDORA', description: 'Compra - BEEMAX NF 841', amount: 595.9, paid_amount: null,
  status: 'pending', due_date: HOJE, paid_date: null, created_at: '2026-09-24', reference_type: 'purchase', reference_id: 'c1',
  payment_method: 'boleto', delivery_confirmed: false, is_recurring: false, boleto_digitavel: '3419', boleto_barcode: null,
  boleto_pix_copia: null, boleto_origem: 'whatsapp', ...x,
});
const textos = (s: ReturnType<typeof montarSituacao>) => s.etapas.map((e) => e.texto);

describe('montarSituacao', () => {
  it('compra pela nota, entregue, com boleto e pagamento preparado', () => {
    const s = montarSituacao(conta(), { id: 'c1', invoice_number: '841', payment_method: 'boleto', payment_status: null, delivery_confirmed_at: '2026-09-25T10:00:00Z', delivery_registered_at: null, is_bonus: false },
      { id: 'p1', bill_id: 'b1', status: 'draft', created_at: '2026-10-07T11:00:00Z', replaced_by: null }, HOJE);
    expect(textos(s)).toEqual(['Nota fiscal 841', 'Mercadoria chegou 25/09', 'Boleto no sistema (WhatsApp)', 'Pagamento preparado — falta tocar em Pagar']);
    expect(s.paga).toBe(false);
    expect(s.noInter).toBe(false);
  });

  it('compra sem boleto, sem entrega, vencida', () => {
    const s = montarSituacao(conta({ boleto_digitavel: null, boleto_origem: null, due_date: '2026-10-06' }),
      { id: 'c1', invoice_number: '264', payment_method: 'boleto', payment_status: null, delivery_confirmed_at: null, delivery_registered_at: null, is_bonus: false }, null, HOJE);
    expect(textos(s)).toEqual(['Nota fiscal 264', 'Entrega não confirmada', 'Falta o boleto', 'Não paga — venceu 06/10']);
    expect(s.etapas[3].tom).toBe('ruim');
  });

  it('paga: sem etapa de boleto, com a data', () => {
    const s = montarSituacao(conta({ status: 'paid', paid_date: '2026-10-05', paid_amount: 595.9 }), null, null, HOJE);
    expect(s.paga).toBe(true);
    expect(textos(s)).toContain('Pago 05/10');
    expect(s.etapas.some((e) => e.id === 'boleto')).toBe(false);
  });

  it('conta fixa por e-mail e conta do extrato', () => {
    expect(textos(montarSituacao(conta({ reference_type: null, reference_id: null, boleto_origem: 'email', due_date: '2026-10-10' }), null, null, HOJE))[0]).toBe('Boleto chegou por e-mail');
    expect(textos(montarSituacao(conta({ reference_type: 'conciliacao_extrato', status: 'paid', paid_date: HOJE }), null, null, HOJE))[0]).toBe('Veio do extrato do banco');
  });

  it('Pix no Inter marca noInter', () => {
    const s = montarSituacao(conta(), null, { id: 'p', bill_id: 'b1', status: 'pending_approval', created_at: HOJE, replaced_by: null }, HOJE);
    expect(s.noInter).toBe(true);
  });
});

describe('ultimoPixPorConta', () => {
  it('ignora o substituído e pega o mais novo', () => {
    const m = ultimoPixPorConta([
      { id: 'a', bill_id: 'b', status: 'expired', created_at: '2026-10-01', replaced_by: 'c' },
      { id: 'c', bill_id: 'b', status: 'draft', created_at: '2026-10-02', replaced_by: null },
      { id: 'd', bill_id: 'b', status: 'failed', created_at: '2026-09-30', replaced_by: null },
    ]);
    expect(m.get('b')?.id).toBe('c');
  });
});

describe('achar a conta do pedido do grupo', () => {
  const texto = 'Não consegui preparar sozinho: É um Pix de R$ 1.140,00 para Costa e Montenegro (4 caixas de tortilla)';
  it('lê o valor', () => {
    expect(valorDoTexto(texto)).toBe(1140);
    expect(valorDoTexto('R$1140,00')).toBe(1140);
    expect(valorDoTexto('sem valor')).toBeNull();
  });
  it('mesmo valor e fornecedor no texto; com duas candidatas não chuta', () => {
    const a = { supplier: 'COSTA E MONTENEGRO COM IMP E EX LTD', description: 'Compra NF 15213', amount: 1140 };
    const b = { supplier: 'OUTRO FORNECEDOR', description: null, amount: 1140 };
    expect(contaProvavel([a, b], 1140, texto)).toBe(a);
    expect(contaProvavel([a, { ...a }], 1140, texto)).toBeNull();
    expect(contaProvavel([b], 1140, texto)).toBeNull();
  });
});

describe('semOJaPago', () => {
  const pend = (x: Partial<PendHoje>): PendHoje => ({
    id: 'p', tenantId: 't1', loja: 'L', kind: 'boleto_faltando', ref: null, titulo: 'x', detalhe: null, rota: null,
    urgencia: 'normal', acaoRequerida: true, status: 'aberta', criadaEm: HOJE, payload: { bill_id: 'b1', valor: 10 }, ...x,
  });
  const item = (p: PendHoje, x: Partial<ItemHoje> = {}): ItemHoje => ({
    chave: p.id, tipo: 'pendencia', bloco: 'agora', tenantId: 't1', loja: 'L', kind: p.kind, titulo: p.titulo, detalhe: null,
    valor: 10, prazo: null, ordem: '', urgente: false, criadaEm: HOJE, principal: p, juntas: [], ...x,
  });
  const paga = montarSituacao(conta({ id: 'b1', status: 'paid', paid_date: HOJE }), null, null, HOJE);
  const aberta = montarSituacao(conta({ id: 'b2' }), null, null, HOJE);

  it('tira o cartão cuja conta já foi paga', () => {
    const i = item(pend({}));
    expect(semOJaPago([i], new Map([[i.chave, [paga]]]))).toEqual([]);
    expect(semOJaPago([i], new Map())).toEqual([i]);
  });
  it('não tira o pedido do grupo nem conta com Pix no Inter', () => {
    const g = item(pend({ id: 'g', kind: 'pagamento_grupo' }));
    expect(semOJaPago([g], new Map([['g', [paga]]]))).toHaveLength(1);
    const p = item(pend({ id: 'pp', kind: 'pagamento_pendente' }));
    expect(semOJaPago([p], new Map([['pp', [{ ...paga, noInter: true }]]]))).toHaveLength(1);
  });
  it('tira só as contas pagas de dentro do cartão do fornecedor', () => {
    const j1 = pend({ id: 'j1', payload: { bill_id: 'b1', valor: 10 } });
    const j2 = pend({ id: 'j2', payload: { bill_id: 'b2', valor: 5 } });
    const g = item(j1, { chave: 'grupo', tipo: 'boletos_fornecedor', juntas: [j1, j2], fornecedor: 'OESA', valor: 15 });
    const [r] = semOJaPago([g], new Map([['grupo', [paga, aberta]]]));
    expect(r.juntas.map((j) => j.id)).toEqual(['j2']);
    expect(r.valor).toBe(5);
    expect(semOJaPago([g], new Map([['grupo', [paga, { ...aberta, paga: true }]]]))).toEqual([]);
  });
});
