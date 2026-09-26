// @vitest-environment node
// ifood-shipping/order.ts: pedidos do iFood (módulo Order, modo só leitura) — status pelos eventos e
// leitura do detalhe (itens com complementos). Exemplos da doc "Detalhes de pedido" / "Eventos de pedido".
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ORDER_PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/ifood-shipping/order.ts')).href;

/* eslint-disable @typescript-eslint/no-explicit-any */
let m: any;
beforeAll(async () => { m = await import(/* @vite-ignore */ ORDER_PATH); });

const ev = (fullCode: string, metadata: any = null, createdAt = '2026-09-26T20:00:00Z') => ({ id: 'e-' + fullCode, fullCode, orderId: 'o1', createdAt, metadata });

describe('planOrderEvent — status do pedido', () => {
  it('pedido novo nasce com o status do 1º evento e pede o detalhe', () => {
    const p = m.planOrderEvent(null, ev('PLACED'));
    expect(p.upd.status).toBe('placed');
    expect(p.fetchDetails).toBe(true);
  });
  it('avança confirmado → preparo → pronto → despachado → concluído', () => {
    let o: any = { status: 'placed', timeline: {}, details_at: 'x' };
    for (const [code, st] of [['CONFIRMED', 'confirmed'], ['PREPARATION_STARTED', 'preparing'], ['READY_TO_PICKUP', 'ready'], ['DISPATCHED', 'dispatched'], ['CONCLUDED', 'concluded']] as const) {
      const p = m.planOrderEvent(o, ev(code));
      expect(p.upd.status).toBe(st);
      o = { ...o, ...p.upd };
    }
    expect(o.concluded_at).toBeTruthy();
  });
  it('código curto vale (CFM, DSP, CON, RTP)', () => {
    expect(m.orderEventName({ code: 'CFM' })).toBe('CONFIRMED');
    expect(m.orderEventName({ code: 'RTP' })).toBe('READY_TO_PICKUP');
    expect(m.orderEventName({ fullCode: 'ORDER_CONFIRMED' })).toBe('CONFIRMED');
  });
  it('evento atrasado não volta a fase', () => {
    const p = m.planOrderEvent({ status: 'dispatched', timeline: {}, details_at: 'x' }, ev('CONFIRMED'));
    expect(p.upd.status).toBeUndefined();
  });
  it('encerrado não reabre e não busca detalhe de novo', () => {
    const p = m.planOrderEvent({ status: 'cancelled', timeline: {}, details_at: 'x' }, ev('CONFIRMED'));
    expect(p.upd.status).toBeUndefined();
    expect(p.fetchDetails).toBe(false);
  });
  it('cancelado grava o motivo do iFood', () => {
    const p = m.planOrderEvent({ status: 'confirmed', timeline: {}, details_at: 'x' }, ev('CANCELLED', { cancelReasonDescription: 'Item indisponível' }));
    expect(p.upd.status).toBe('cancelled');
    expect(p.upd.cancel_reason).toBe('Item indisponível');
  });
  it('pedido alterado pelo cliente (ORDER_PATCHED) relê os itens', () => {
    expect(m.planOrderEvent({ status: 'confirmed', timeline: {}, details_at: 'x' }, ev('ORDER_PATCHED')).fetchDetails).toBe(true);
    expect(m.planOrderEvent({ status: 'confirmed', timeline: {}, details_at: 'x' }, ev('DISPATCHED')).fetchDetails).toBe(false);
  });
  it('disputa (Plataforma de negociação) fica registrada', () => {
    const p = m.planOrderEvent({ status: 'concluded', timeline: {}, details_at: 'x' }, ev('HANDSHAKE_DISPUTE', { dispute: { id: 'd1' } }));
    // pedido encerrado: só linha do tempo
    expect(p.upd.dispute).toBeUndefined();
    const q = m.planOrderEvent({ status: 'dispatched', timeline: {}, details_at: 'x' }, ev('HANDSHAKE_DISPUTE', { dispute: { id: 'd1' } }));
    expect(q.upd.dispute).toEqual({ id: 'd1' });
  });
});

describe('detalhe do pedido → linhas', () => {
  const d = {
    id: 'o1', displayId: 'XPTO', orderType: 'DELIVERY', orderTiming: 'IMMEDIATE', salesChannel: 'IFOOD', createdAt: '2026-09-26T20:00:00Z',
    delivery: { deliveredBy: 'IFOOD', pickupCode: '1234', observations: 'Deixar na portaria', deliveryAddress: { streetName: 'Rua X' } },
    customer: { name: 'João', documentNumber: '123', ordersCountOnMerchant: 3 },
    items: [{ index: 1, id: 'cat-1', uniqueId: 'u1', name: 'Burrito', quantity: 2, unitPrice: 20, optionsPrice: 4, totalPrice: 44, observations: 'sem cebola',
      options: [{ name: 'Guacamole', groupName: 'Extras', quantity: 1, unitPrice: 4, price: 4 }] }],
    total: { subTotal: 44, deliveryFee: 5, benefits: 10, additionalFees: 0, orderAmount: 39 },
    benefits: [{ value: 10, target: 'CART', sponsorshipValues: [{ name: 'IFOOD', value: 10 }, { name: 'MERCHANT', value: 0 }] }],
    payments: { prepaid: 39, pending: 0, methods: [{ value: 39, type: 'ONLINE', method: 'CREDIT', card: { brand: 'VISA' } }] },
  };
  it('colunas do pedido', () => {
    const r = m.orderRowFromDetails(d);
    expect(r).toMatchObject({ display_id: 'XPTO', delivered_by: 'IFOOD', pickup_code: '1234', customer_document: '123', customer_orders_count: 3, delivery_observations: 'Deixar na portaria' });
  });
  it('itens com complementos e observação', () => {
    const [i] = m.orderItemsFromDetails(d);
    expect(i).toMatchObject({ catalog_item_id: 'cat-1', name: 'Burrito', quantity: 2, total_price: 44, observations: 'sem cebola' });
    expect(i.options[0].name).toBe('Guacamole');
  });
  it('quem paga o cupom', () => {
    expect(m.benefitSponsors(d.benefits)).toEqual([{ value: 10, target: 'CART', sponsors: [{ name: 'IFOOD', value: 10 }] }]);
  });
});
