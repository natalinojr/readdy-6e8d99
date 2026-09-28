import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { montarPedidos, montarPedidosApi, resumir, culpaCancelamento, motivoCurto, montarOperacao, mediana, type EntryRow, type SaleFinRow } from '@/lib/ifoodDashboard';

const base = { import_id: 'imp1', impacto_repasse: true, metodo_pagamento: null, motivo: null };
const linha = (order: string, tipo: string, desc: string, valor: number, extra: Partial<EntryRow> = {}): EntryRow => ({
  ...base, order_id: order, order_created_at: '2026-09-19T23:30:00Z', tipo_lancamento: tipo, descricao: desc, valor, ...extra,
});

describe('montarPedidos / resumir', () => {
  it('divide o pedido como o Portal e calcula o líquido', () => {
    const rows = [
      linha('A', 'Entrada Financeira', 'Entrada Financeira', 90, { metodo_pagamento: 'Pix' }),
      linha('A', 'Subsídio', 'Promoção custeada pela loja', -10),
      linha('A', 'Subsídio', 'Promoção custeada pelo iFood', 5),
      linha('A', 'Retenção', 'Taxa entrega iFood', -8),
      linha('A', 'Cobrança', 'Comissão do iFood (entrega iFood)', -23),
      linha('A', 'Cobrança', 'Taxa de transação', -3),
    ];
    const [p] = montarPedidos(rows, { imp1: 'lojaX' });
    // vendas = 90 + 10 (promo loja somada de volta) + 5 − 8 = 97
    expect(p.vendas).toBeCloseTo(97);
    expect(p.promoLoja).toBeCloseTo(10);
    expect(p.promoIfood).toBeCloseTo(5);
    expect(p.comissao).toBeCloseTo(23);
    expect(p.transacao).toBeCloseTo(3);
    expect(p.liquido).toBeCloseTo(97 - 23 - 3 - 10);
    expect(p.logistica).toBe('ifood');
    expect(p.pagamento).toBe('Pix');
    expect(p.loja).toBe('lojaX');
    // 23:30Z = 20:30 em Brasília, sábado 19/09
    expect(p.dia).toBe('2026-09-19');
    expect(p.hora).toBe(20);
    expect(p.semana).toBe(6);
    const r = resumir([p]);
    expect(r.pedidos).toBe(1);
    expect(r.custoPct).toBeCloseTo(((23 + 3 + 10) / 97) * 100);
  });

  it('pedido que zera é cancelado e guarda o valor perdido e o motivo', () => {
    const rows = [
      linha('B', 'Entrada Financeira', 'Entrada Financeira', 50),
      linha('B', 'Entrada Financeira', 'Entrada Financeira', -50, { motivo: '501 - Problemas de sistema na loja' }),
      linha('C', 'Entrada Financeira', 'Entrada Financeira', 40),
      linha('C', 'Cobrança', 'Comissão do iFood (entrega própria da loja)', -5),
    ];
    const ps = montarPedidos(rows, {});
    const b = ps.find((p) => p.id === 'B')!;
    expect(b.cancelado).toBe(true);
    expect(b.bruto).toBe(50);
    expect(culpaCancelamento(b.motivo!)).toBe('loja');
    expect(ps.find((p) => p.id === 'C')!.logistica).toBe('propria');
    const r = resumir(ps);
    expect(r.pedidos).toBe(1);
    expect(r.cancelados).toBe(1);
    expect(r.valorCancelado).toBe(50);
  });

  it('sob demanda: cobrança do iFood e taxa de entrega paga pelo cliente (Entrada − cesta)', () => {
    const rows = [
      linha('D', 'Entrada Financeira', 'Entrada Financeira', 45.4, { cesta: '36.90' }),
      linha('D', 'Cobrança', 'Solicitação de entrega Sob Demanda Off', -12.99),
      linha('D', 'Cobrança', 'Taxa de serviço de entrega Sob Demanda Off', -1),
    ];
    const [p] = montarPedidos(rows, {});
    expect(p.logistica).toBe('sob_demanda');
    expect(p.entregaSobDemanda).toBeCloseTo(13.99);
    expect(p.entregaCliente).toBeCloseTo(8.5);
  });
});

describe('cancelamento', () => {
  it('classifica pelo código', () => {
    expect(culpaCancelamento('902 - O pedido não foi confirmado pela loja')).toBe('loja');
    expect(culpaCancelamento('610 - Cliente não localizado')).toBe('cliente');
    expect(culpaCancelamento('406 - O pedido foi acidental')).toBe('ifood');
  });
  it('corta o laudo do atendimento', () => {
    expect(motivoCurto('412 - Cancelamento realizado pelo motivo de: O pedido veio com todos os itens errados Cliente considerado fraudulento? Não'))
      .toBe('412 - O pedido veio com todos os itens errados');
  });
});

describe('operação', () => {
  it('mede preparo e entrega pelos eventos', () => {
    const [o] = montarOperacao([{
      merchant_id: 'm', sale_created_at: '2026-09-25T22:00:00Z', current_status: 'CONCLUDED', events: [
        { fullCode: 'RECEIVED', createdAt: '2026-09-25T22:00:30Z' },
        { fullCode: 'CONFIRMED', createdAt: '2026-09-25T22:01:30Z' },
        { fullCode: 'DELIVERY_ARRIVED_AT_ORIGIN', createdAt: '2026-09-25T22:10:00Z' },
        { fullCode: 'READY_TO_DELIVER', createdAt: '2026-09-25T22:21:30Z' },
        { fullCode: 'DELIVERY_COLLECTED', createdAt: '2026-09-25T22:23:30Z' },
        { fullCode: 'DELIVERY_ARRIVED_AT_DESTINATION', createdAt: '2026-09-25T22:38:30Z' },
        { fullCode: 'DELIVERY_DROP_CODE_VALIDATION_SUCCESS', createdAt: '2026-09-25T22:40:00Z' },
      ],
    }]);
    expect(o.aceiteMin).toBe(1);
    expect(o.preparoMin).toBe(20);
    expect(o.entregadorEsperouMin).toBeCloseTo(11.5);
    expect(o.rotaMin).toBe(15);
    expect(o.totalMin).toBe(40);
    expect(mediana([3, null, 1, 2])).toBe(2);
  });
});

// Pedido real (loja EP, 24/09/2026) que está nas duas fontes: a API tem que fechar igual à conciliação.
describe('complemento pela API de Vendas', () => {
  const venda: SaleFinRow = {
    sale_id: 'P1', merchant_id: 'lojaX', sale_created_at: '2026-09-24T23:10:00Z', current_status: 'CONCLUDED',
    gross_bag: 45.79, delivery_fee: 6.99, payment_methods: [{ method: 'PIX' }],
    billing_entries: [
      { name: 'ORDER_COMMISSION', value: -8.57 }, { name: 'SERVICE_FEE', value: -0.99 }, { name: 'IFOOD_SUBSIDY', value: 5.37 },
      { name: 'PAYMENT_TRANSACTION_FEE', value: -1.06 }, { name: 'ORDER_PAYMENT', value: 36.42 }, { name: 'DELIVERY_FEE_IFOOD', value: -6.99 },
    ],
    benefits: { benefits: [
      { target: 'ITEM', sponsorships: [{ name: 'IFOOD', value: 5.37 }, { name: 'EXTERNAL', value: 0 }, { name: 'MERCHANT', value: 4.99 }, { name: 'CHAIN', value: 0 }] },
      { target: 'DELIVERY_FEE', sponsorships: [{ name: 'IFOOD', value: 0 }, { name: 'MERCHANT', value: 6.99 }] },
    ] },
    events: [],
  };
  const conciliacao = [
    linha('P1', 'Retenção', 'Taxa entrega iFood', -6.99),
    linha('P1', 'Subsídio', 'Promoção custeada pela loja no delivery', -6.99, { impacto_repasse: false }),
    linha('P1', 'Entrada Financeira', 'Entrada Financeira', 36.42, { metodo_pagamento: 'Pix' }),
    linha('P1', 'Subsídio', 'Promoção custeada pelo iFood', 5.37),
    linha('P1', 'Cobrança', 'Comissão do iFood', -8.57),
    linha('P1', 'Subsídio', 'Promoção custeada pela loja', -4.99, { impacto_repasse: false }),
    linha('P1', 'Retenção', 'Taxa de serviço iFood cobrada do cliente', -0.99),
    linha('P1', 'Cobrança', 'Taxa de transação', -1.06),
  ];

  it('fecha igual à conciliação do mesmo pedido', () => {
    const [api] = montarPedidosApi([venda]);
    const [conc] = montarPedidos(conciliacao, { imp1: 'lojaX' });
    for (const k of ['vendas', 'comissao', 'transacao', 'promoLoja', 'promoIfood', 'liquido', 'outrosServicos', 'ajustes'] as const) {
      expect(api[k]).toBeCloseTo(conc[k]);
    }
    expect(api.vendas).toBeCloseTo(45.79); // itens do pedido
    expect(api.loja).toBe('lojaX');
    expect(api.pagamento).toBe('Pix');
    expect(api.logistica).toBe(conc.logistica);
    expect(api.cancelado).toBe(false);
  });

  it('cancelado: zera a venda, guarda o valor perdido, o ressarcimento e o motivo', () => {
    const [p] = montarPedidosApi([{
      ...venda, sale_id: 'C1', current_status: 'CANCELLED', gross_bag: 146.9, delivery_fee: 8.99, benefits: null,
      billing_entries: [{ name: 'ORDER_PAYMENT', value: 0 }, { name: 'ORDER_COMMISSION', value: 0 }, { name: 'STORE_REFUND', value: 108.41 }],
      events: [{ metadata: null }, { metadata: { cancelCode: 601 } }],
    }]);
    expect(p.cancelado).toBe(true);
    expect(p.vendas).toBe(0);
    expect(p.bruto).toBeCloseTo(155.89);
    expect(p.ajustes).toBeCloseTo(108.41);
    expect(p.liquido).toBeCloseTo(108.41);
    expect(p.motivo).toBe('601 - Problemas no veículo');
    expect(culpaCancelamento(p.motivo!)).toBe('cliente');
    expect(resumir([p])).toMatchObject({ pedidos: 0, cancelados: 1 });
  });

  it('pago direto à loja (EXTERNAL): vendas = itens + entrega, fora do repasse', () => {
    const [p] = montarPedidosApi([{
      ...venda, sale_id: 'E1', gross_bag: 79.99, delivery_fee: 8.5, benefits: null,
      payment_methods: [{ method: 'EXTERNAL', liability: 'MERCHANT' }], billing_entries: [{ name: 'DELIVERY_REQUEST', value: -13.99 }],
    }]);
    expect(p.vendas).toBeCloseTo(88.49);
    expect(p.entregaSobDemanda).toBeCloseTo(13.99);
    expect(p.liquido).toBeCloseTo(88.49 - 13.99);
    expect(p.pagamento).toBe('Pagamento externo');
  });

  it('sem nenhum valor na API ainda: fica de fora até a conciliação', () => {
    expect(montarPedidosApi([{ ...venda, sale_id: 'Z1', gross_bag: 0, delivery_fee: 0, billing_entries: [], benefits: null }])).toHaveLength(0);
  });

  it('cancelado sem nenhum lançamento ainda aparece', () => {
    const [p] = montarPedidosApi([{ ...venda, sale_id: 'C2', current_status: 'CANCELLED', billing_entries: [], benefits: null, events: [] }]);
    expect(p.cancelado).toBe(true);
    expect(p.liquido).toBe(0);
  });
});
