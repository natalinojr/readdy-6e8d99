import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { montarPedidos, resumir, culpaCancelamento, motivoCurto, montarOperacao, mediana, type EntryRow } from '@/lib/ifoodDashboard';

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
