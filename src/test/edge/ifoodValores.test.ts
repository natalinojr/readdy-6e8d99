// @vitest-environment node
// _shared/ifood-valores.ts (valor da venda do pedido do iFood) + fiscal-write/valores.ts › completarPagamentoIfood.
// IFOOD-PEDIDOS-FUNIL.md, etapa 5 (NFC-e). Caso real: pedido #1631 da Paranaguá (05/10/2026).
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VALORES = pathToFileURL(resolve(__dirname, '../../../supabase/functions/_shared/ifood-valores.ts')).href;
const FISCAL = pathToFileURL(resolve(__dirname, '../../../supabase/functions/fiscal-write/valores.ts')).href;
const FUNIL = pathToFileURL(resolve(__dirname, '../../../supabase/functions/ifood-shipping/funnel.ts')).href;
/* eslint-disable @typescript-eslint/no-explicit-any */
let v: any; let f: any; let fu: any;
beforeAll(async () => {
  v = await import(/* @vite-ignore */ VALORES);
  f = await import(/* @vite-ignore */ FISCAL);
  fu = await import(/* @vite-ignore */ FUNIL);
});

const sp = (merchant: number, ifood = 0, chain = 0, external = 0) => [
  { name: 'CHAIN', value: chain }, { name: 'IFOOD', value: ifood }, { name: 'EXTERNAL', value: external }, { name: 'MERCHANT', value: merchant },
];
// #1631 (Paranaguá, 05/10): item com 40% (5,20 iFood + 5,00 loja), entrega grátis 6,99 bancada pela loja, entregador iFood, Pix online.
const p1631 = {
  order_type: 'DELIVERY', delivered_by: 'IFOOD',
  total: { benefits: 17.19, subTotal: 31.49, deliveryFee: 6.99, orderAmount: 22.28, additionalFees: 0.99 },
  benefits: [
    { value: 10.2, target: 'ITEM', sponsorshipValues: sp(5, 5.2) },
    { value: 6.99, target: 'DELIVERY_FEE', sponsorshipValues: sp(6.99) },
  ],
  payments: { methods: [{ method: 'PIX', type: 'ONLINE', value: 22.28, prepaid: true }] },
};

describe('valorVendaIfood', () => {
  it('#1631: entregador do iFood → taxa e entrega grátis da loja fora; só o desconto da loja no item abate', () => {
    expect(v.valorVendaIfood(p1631)).toEqual({ subtotal: 31.49, taxaLoja: 0, descLoja: 5, valorVenda: 26.49 });
  });

  it('entrega pela loja: taxa entra e a entrega grátis bancada pela loja abate', () => {
    expect(v.valorVendaIfood({ ...p1631, delivered_by: 'MERCHANT' })).toEqual({ subtotal: 31.49, taxaLoja: 6.99, descLoja: 11.99, valorVenda: 26.49 });
  });

  it('cupom do iFood e da indústria não abatem; o da rede abate', () => {
    const r = v.valorVendaIfood({ order_type: 'DELIVERY', delivered_by: 'MERCHANT', total: { subTotal: 50, deliveryFee: 5 },
      benefits: [{ target: 'CART', sponsorshipValues: sp(0, 10, 3, 2) }] });
    expect(r).toEqual({ subtotal: 50, taxaLoja: 5, descLoja: 3, valorVenda: 52 });
  });

  it('retirada: sem taxa; nunca negativo', () => {
    expect(v.valorVendaIfood({ order_type: 'TAKEOUT', delivered_by: 'MERCHANT', total: { subTotal: 20, deliveryFee: 5 }, benefits: [{ target: 'CART', sponsorshipValues: sp(30) }] }))
      .toEqual({ subtotal: 20, taxaLoja: 0, descLoja: 30, valorVenda: 0 });
  });
});

describe('funil usa a mesma regra', () => {
  it('#1631 pago no app: total do pedido do ERPOS = 26,49 (antes abatia a entrega grátis e dava 19,50)', () => {
    const r = fu.montarPedidoErpos({ ...p1631, display_id: '1631', customer_name: 'Cliente' }, [{ idx: 1, name: 'Burrito', quantity: 1, unit_price: 31.49, options: [] }], [], new Map());
    expect(r.pago).toBe(true);
    expect(r.order).toMatchObject({ subtotal: 31.49, delivery_fee: 0, discount_amount: 5, total_amount: 26.49 });
  });
});

describe('completarPagamentoIfood', () => {
  it('pago no app: sem pagamento no caixa → tudo em 99 "iFood - online"', () => {
    expect(f.completarPagamentoIfood([], 26.49)).toEqual([{ code: '99', label: 'iFood - online', paid: 26.49, troco: 0 }]);
  });

  it('cobrado pela loja em dinheiro com cupom do iFood: dinheiro + diferença do iFood', () => {
    // venda 42,99; cliente pagou 32,99 (cupom de 10 do iFood) com troco de 50
    const r = f.completarPagamentoIfood([{ code: '01', label: 'Dinheiro', paid: 50, troco: 17.01 }], 42.99);
    expect(r).toEqual([{ code: '01', label: 'Dinheiro', paid: 50, troco: 17.01 }, { code: '99', label: 'iFood - online', paid: 10, troco: 0 }]);
  });

  it('já pago inteiro: não mexe', () => {
    const pg = [{ code: '03', label: 'Crédito', paid: 42.99, troco: 0 }];
    expect(f.completarPagamentoIfood(pg, 42.99)).toEqual(pg);
  });
});
