// @vitest-environment node
// _shared/ifood-faturamento.ts — a conta do faturamento do iFood que o assistente (cron e brain) usa. Tem de dar o mesmo
// número da tela: confere contra src/lib/ifoodVendas.ts, ifoodDashboard.ts (montarPedidosApi) e diaLoja.ts
// (auditoria de números, 2026-10-10: assistente dizia R$ 143,53 onde a tela dizia R$ 300,88 por ler só o gross_bag).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}) } }));

import { faturamentoIfood as faturamentoFront } from '@/lib/ifoodVendas';
import { montarPedidosApi } from '@/lib/ifoodDashboard';
import { somarNosDias as somarFront, janelaDeBusca as janelaFront, diaDoPedido as diaFront, type JanelaSessao } from '@/lib/diaLoja';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import por caminho montado em tempo de execução (mesmo padrão de guias.test.ts): o tsc do app não resolve os
// imports com extensão .ts das Edge Functions.
const PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/_shared/ifood-faturamento.ts')).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edge: any = await import(/* @vite-ignore */ PATH);
const { faturamentoDaVendaApi, montarListaIfood, somarNosDias, janelaDeBusca, diaDoPedido, diaMais } = edge;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VendaApi = Record<string, any>; type EntradaIfood = Record<string, any>; type PedidoVivo = Record<string, any>;

const venda = (o: Partial<VendaApi> = {}): VendaApi => ({
  sale_id: 'a1', sale_created_at: '2026-10-08T22:10:00Z', current_status: 'CONCLUDED', gross_bag: 0, delivery_fee: 0,
  payment_methods: [{ method: 'PIX' }], billing_entries: [], benefits: null, logistica: 'MERCHANT', ...o,
});

// O que a tela calcula para o mesmo pedido da API (fetchIfoodVendas › complemento da API).
function daTela(s: VendaApi) {
  const [p] = montarPedidosApi([{ ...s, merchant_id: 'm1', events: null } as never]);
  if (!p) return null;
  const pe = p.promoLojaEntrega ?? 0;
  return {
    cancelado: p.cancelado,
    valor: faturamentoFront({ vendas: p.vendas, promoLojaItens: p.promoLoja - pe, promoLojaEntrega: pe, entregaIfood: p.logistica !== 'propria' }),
  };
}

const merchantBenefit = (valor: number, target = 'CART') => ({ benefits: [{ target, sponsorships: [{ name: 'IFOOD', value: 3 }, { name: 'MERCHANT', value: valor }] }] });

describe('faturamentoDaVendaApi = o pedido da API como a tela monta', () => {
  const casos: Record<string, VendaApi> = {
    'gross_bag zerado pela API, mas com ORDER_PAYMENT (o caso de Paranaguá 08/10)': venda({
      gross_bag: 0, billing_entries: [{ name: 'ORDER_PAYMENT', value: 58 }, { name: 'ORDER_COMMISSION', value: -9 }, { name: 'PAYMENT_TRANSACTION_FEE', value: -1 }],
    }),
    'cupom pago pela loja sai das vendas': venda({
      billing_entries: [{ name: 'ORDER_PAYMENT', value: 44.9 }, { name: 'IFOOD_SUBSIDY', value: 4.98 }], benefits: merchantBenefit(5),
    }),
    'pedido aberto, entregador do iFood: a entrega não é da loja': venda({
      gross_bag: 50, delivery_fee: 8, logistica: 'IFOOD_LOGISTICS',
    }),
    'pedido aberto, a loja entrega: a entrega entra': venda({ gross_bag: 50, delivery_fee: 8, logistica: 'MERCHANT' }),
    'pago direto à loja (dinheiro/EXTERNAL) sem ORDER_PAYMENT': venda({ gross_bag: 30, payment_methods: [{ method: 'CASH', liability: 'MERCHANT' }] }),
    'entrega grátis paga pela loja com entregador do iFood não abate': venda({
      billing_entries: [{ name: 'ORDER_PAYMENT', value: 41.79 }, { name: 'DELIVERY_FEE_IFOOD', value: -6.99 }], benefits: merchantBenefit(6.99, 'DELIVERY_FEE'),
    }),
    'entrega grátis paga pela loja com a loja entregando abate': venda({
      billing_entries: [{ name: 'ORDER_PAYMENT', value: 48 }], benefits: merchantBenefit(8, 'DELIVERY_FEE'),
    }),
    'entrega sob demanda é do iFood': venda({
      billing_entries: [{ name: 'ORDER_PAYMENT', value: 48 }, { name: 'DELIVERY_REQUEST', value: -7 }], benefits: merchantBenefit(8, 'DELIVERY_FEE'),
    }),
    'cancelado': venda({ current_status: 'CANCELLED', gross_bag: 20 }),
    'cancelado sem lançamento nenhum': venda({ current_status: 'CANCELLED', gross_bag: 0 }),
    'sem valor nenhum ainda (a API espera a conciliação)': venda({ gross_bag: 0, delivery_fee: 0 }),
  };
  for (const [nome, s] of Object.entries(casos)) {
    it(nome, () => {
      const esperado = daTela(s);
      const obtido = faturamentoDaVendaApi(s);
      if (!esperado) { expect(obtido).toBeNull(); return; }
      expect(obtido).not.toBeNull();
      expect(obtido!.cancelado).toBe(esperado.cancelado);
      expect(obtido!.valor).toBeCloseTo(esperado.valor, 2);
    });
  }

  it('o caso de Paranaguá: sem ORDER_PAYMENT e gross_bag 0 não vira R$ 0 — sobra para o pedido ao vivo', () => {
    expect(faturamentoDaVendaApi(venda({ gross_bag: 0 }))).toBeNull();
    const lista = montarListaIfood([], [venda({ gross_bag: 0 })], [{
      ifood_order_id: 'a1', ordered_at: '2026-10-08T22:10:00Z', status: 'delivered', delivered_by: 'IFOOD', order_type: 'DELIVERY',
      total: { subTotal: 49.9, deliveryFee: 10.99 }, benefits: [{ target: 'CART', sponsorshipValues: [{ name: 'IFOOD', value: 4.98 }, { name: 'MERCHANT', value: 5 }] }],
    }]);
    expect(lista.total).toBeCloseTo(44.9, 2);
    expect(lista.pedidos).toBe(1);
  });
});

describe('montarListaIfood: conciliação → API → ao vivo, sem contar o mesmo pedido duas vezes', () => {
  const e = (order_id: string, tipo: string, desc: string, valor: number, impacto = true): EntradaIfood =>
    ({ order_id, order_created_at: '2026-10-08T20:00:00Z', tipo_lancamento: tipo, descricao: desc, valor, impacto_repasse: impacto });
  // pedido real b2556953: vendas do Portal 46,90 − cupom da loja 5 = 41,90
  const conciliado: EntradaIfood[] = [
    e('c1', 'Cobrança', 'Taxa de transação', -1.09), e('c1', 'Cobrança', 'Comissão do iFood', -8.8),
    e('c1', 'Entrada Financeira', 'Entrada Financeira', 31.48), e('c1', 'Retenção', 'Taxa de serviço iFood cobrada do cliente', -0.99),
    e('c1', 'Retenção', 'Taxa entrega iFood', -6.99), e('c1', 'Subsídio', 'Promoção custeada pelo iFood', 11.41),
    e('c1', 'Subsídio', 'Promoção custeada pela loja no delivery', -6.99, false), e('c1', 'Subsídio', 'Promoção custeada pela loja', -5, false),
  ];
  const vivo = (id: string, o: Partial<PedidoVivo> = {}): PedidoVivo => ({
    ifood_order_id: id, ordered_at: '2026-10-08T23:00:00Z', status: 'delivered', delivered_by: 'MERCHANT', order_type: 'DELIVERY',
    total: { subTotal: 30, deliveryFee: 5 }, benefits: [], ...o,
  });

  it('soma cada pedido uma vez, pela fonte mais confiável', () => {
    const r = montarListaIfood(
      conciliado,
      [
        venda({ sale_id: 'c1', billing_entries: [{ name: 'ORDER_PAYMENT', value: 999 }] }), // já está na conciliação: ignora
        venda({ sale_id: 'a1', billing_entries: [{ name: 'ORDER_PAYMENT', value: 58 }] }), // só na API: 58
        venda({ sale_id: 'a2', gross_bag: 0 }), // API sem valor: cai no ao vivo (35 = 30 + entrega da loja 5)
        venda({ sale_id: 'a3', current_status: 'CANCELLED', gross_bag: 20 }), // cancelado na API: o ao vivo não ressuscita
        venda({ sale_id: 'a4', billing_entries: [{ name: 'ORDER_PAYMENT', value: 12 }] }), // já na conciliação com outra data
      ],
      [vivo('c1'), vivo('a1'), vivo('a2'), vivo('a3'), vivo('v9', { total: { subTotal: 20, deliveryFee: 0 } }), vivo('v8', { status: 'cancelled' })],
      new Set(['a4']),
    );
    // 41,90 (conciliação) + 58 (API) + 35 (ao vivo a2) + 20 (ao vivo v9)
    expect(r.total).toBeCloseTo(41.9 + 58 + 35 + 20, 2);
    expect(r.pedidos).toBe(4);
    expect(r.pedidosAoVivo).toBe(3);
  });

  it('conciliação (b2556953): vendas do Portal 46,90 − cupom da loja 5 = 41,90', () => {
    const r = montarListaIfood(conciliado, [], []);
    expect(r.total).toBeCloseTo(41.9, 2);
  });

  it('pedido cancelado (entra e sai no mesmo dia) fica zero e não conta como pedido', () => {
    const r = montarListaIfood([e('z1', 'Entrada Financeira', 'Entrada Financeira', 20), e('z1', 'Entrada Financeira', 'Cancelamento', -20)], [], []);
    expect(r.total).toBe(0);
    expect(r.pedidos).toBe(0);
  });
});

describe('dia da loja: igual a src/lib/diaLoja.ts', () => {
  // Vila Leste em 04/10: sessão de sábado (03/10) fechou 00:16 de domingo; a de domingo abriu 17:25 e segue aberta.
  const janelas: JanelaSessao[] = [
    { dia: '2026-10-03', ini: '2026-10-03T21:00:00-03:00', fim: '2026-10-04T00:16:00-03:00' },
    { dia: '2026-10-04', ini: '2026-10-04T17:25:00-03:00', fim: null },
  ];
  const lista = [
    { at: '2026-10-04T00:10:00-03:00', valor: 30, aoVivo: false }, // madrugada, sessão de sábado ainda aberta: dia 03
    { at: '2026-10-04T13:00:00-03:00', valor: 50, aoVivo: false }, // fora de sessão: pela data, dia 04
    { at: '2026-10-04T19:40:00-03:00', valor: 70, aoVivo: true },
    { at: '2026-10-05T01:30:00-03:00', valor: 90, aoVivo: false }, // sessão de domingo ainda aberta: dia 04
  ];

  it('cada pedido cai no mesmo dia que a tela', () => {
    for (const p of lista) expect(diaDoPedido(new Date(p.at), janelas)).toBe(diaFront(new Date(p.at), janelas));
  });
  it('soma do dia e com corte batem com a tela', () => {
    const corte = new Date('2026-10-04T19:00:00-03:00');
    for (const [d1, d2, c] of [['2026-10-04', '2026-10-04', null], ['2026-10-03', '2026-10-04', null], ['2026-10-04', '2026-10-04', corte]] as const) {
      const a = somarNosDias(lista, janelas, d1, d2, c);
      const b = somarFront(lista, janelas, d1, d2, c);
      expect(a.total).toBeCloseTo(b.total, 2);
      expect(a.pedidos).toBe(b.pedidos);
      expect(a.porDia).toEqual(b.porDia);
    }
  });
  it('janela de busca vai até o fim da última sessão do dia', () => {
    expect(janelaDeBusca('2026-10-03', '2026-10-03', janelas)).toEqual(janelaFront('2026-10-03', '2026-10-03', janelas));
    const agora = new Date('2026-10-05T02:00:00-03:00');
    expect(janelaDeBusca('2026-10-04', '2026-10-04', janelas, null, agora)).toEqual(janelaFront('2026-10-04', '2026-10-04', janelas, null, agora));
  });
  it('diaMais atravessa mês e ano', () => {
    expect(diaMais('2026-10-01', -1)).toBe('2026-09-30');
    expect(diaMais('2026-12-31', 1)).toBe('2027-01-01');
  });
});
