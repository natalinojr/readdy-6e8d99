// @vitest-environment node
// ifood-shipping/core.ts: regras do iFood Entrega (Sob Demanda). A loja de teste do iFood não gera
// eventos de entrega (FAQ do Portal do Desenvolvedor), então os eventos aqui seguem os exemplos da doc
// "Pedidos fora da plataforma iFood" / "Como funciona".
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import por caminho montado em tempo de execução: o tsc do app não passa a checar código Deno.
const CORE_PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/ifood-shipping/core.ts')).href;

/* eslint-disable @typescript-eslint/no-explicit-any */
let core: any;
beforeAll(async () => { core = await import(/* @vite-ignore */ CORE_PATH); });

const ev = (fullCode: string, metadata: any = null, createdAt = '2026-09-26T12:00:00Z') => ({ id: 'e-' + fullCode, fullCode, orderId: 'o1', createdAt, metadata });

describe('splitPhone', () => {
  it('separa DDD e número (com e sem 55)', () => {
    expect(core.splitPhone('41999998888')).toEqual({ areaCode: '41', number: '999998888' });
    expect(core.splitPhone('+55 (41) 99999-8888')).toEqual({ areaCode: '41', number: '999998888' });
    expect(core.splitPhone('4133334444')).toEqual({ areaCode: '41', number: '33334444' });
  });
  it('recusa telefone incompleto', () => {
    expect(core.splitPhone('99998888')).toBeNull();
    expect(core.splitPhone('')).toBeNull();
  });
});

describe('paymentFromNotes', () => {
  it('pago online / Pix → sem cobrança na entrega', () => {
    expect(core.paymentFromNotes('Pagamento: Dinheiro', true, 50).kind).toBe('paid');
    expect(core.paymentFromNotes('Pagamento: PIX pelo app', false, 50).kind).toBe('paid');
  });
  it('dinheiro com troco', () => {
    expect(core.paymentFromNotes('Pagamento: Dinheiro | Troco para R$ 100,00', false, 62.5)).toEqual({ kind: 'CASH', changeFor: 100 });
    expect(core.paymentFromNotes('Pagamento: Dinheiro | Troco para R$ 50,00', false, 62.5)).toEqual({ kind: 'CASH', changeFor: null });
  });
  it('cartão', () => {
    expect(core.paymentFromNotes('Pagamento: Cartão de Débito', false, 10).kind).toBe('DEBIT');
    expect(core.paymentFromNotes('Pagamento: Cartão de crédito', false, 10).kind).toBe('CREDIT');
  });
  it('desconhecido devolve o texto para a pessoa escolher', () => {
    expect(core.paymentFromNotes('Pagamento: Vale refeição', false, 10)).toEqual({ kind: 'unknown', label: 'vale refeicao' });
  });
});

describe('buildItems — soma tem que bater com total − taxa (senão PaymentTotalInvalid)', () => {
  const order = { id: 'ord', number: 'D0042', total_amount: 55, delivery_fee: 5 };
  it('itens que batem vão um a um', () => {
    const r = core.buildItems(order, [
      { id: 'i1', item_name: 'Burrito', item_price: 20, quantity: 2 },
      { id: 'i2', item_name: 'Nachos', item_price: 10, quantity: 1 },
    ]);
    expect(r.itemsTotal).toBe(50);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ quantity: 2, unitPrice: 20, price: 40, totalPrice: 40 });
  });
  it('com desconto (voucher) manda uma linha só com o valor do pedido', () => {
    const r = core.buildItems({ ...order, total_amount: 45 }, [
      { id: 'i1', item_name: 'Burrito', item_price: 20, quantity: 2 },
      { id: 'i2', item_name: 'Nachos', item_price: 10, quantity: 1 },
    ]);
    expect(r.items).toEqual([{ id: 'ord', name: 'Pedido #0042', quantity: 1, unitPrice: 40, price: 40, optionsPrice: 0, totalPrice: 40 }]);
    expect(r.itemsTotal + order.delivery_fee).toBe(45);
  });
  it('nome cortado em 50 caracteres', () => {
    const r = core.buildItems({ ...order, total_amount: 15 }, [{ id: 'i', item_name: 'X'.repeat(80), item_price: 10, quantity: 1 }]);
    expect(r.items[0].name).toHaveLength(50);
  });
});

describe('planEvent — ciclo da entrega', () => {
  it('fluxo feliz: alocado → coletou → entregue', () => {
    let s: any = { status: 'requested', timeline: {} };
    const p1 = core.planEvent(s, ev('ASSIGN_DRIVER', { workerName: 'João', workerPhone: '11999990000' }));
    expect(p1.upd.status).toBe('allocated');
    expect(p1.order).toBe('a_caminho_loja');
    expect(p1.upd.driver).toMatchObject({ name: 'João' });
    s = { ...s, ...p1.upd };
    const p2 = core.planEvent(s, ev('DELIVERY_IN_TRANSIT'));
    expect(p2.upd.status).toBe('in_transit');
    expect(p2.order).toBe('coletou');
    s = { ...s, ...p2.upd };
    const p3 = core.planEvent(s, ev('DELIVERY_CONCLUDED'));
    expect(p3.upd.status).toBe('concluded');
    expect(p3.order).toBe('entregou');
  });
  it('código curto (DSP/CON) vale como o nome completo', () => {
    expect(core.eventName({ code: 'DSP' })).toBe('DISPATCHED');
    expect(core.planEvent({ status: 'allocated' }, { code: 'CON' }).upd.status).toBe('concluded');
  });
  it('evento atrasado não reabre entrega encerrada', () => {
    const p = core.planEvent({ status: 'concluded', timeline: {} }, ev('ASSIGN_DRIVER'));
    expect(p.upd.status).toBeUndefined();
    expect(p.order).toBeUndefined();
    const c = core.planEvent({ status: 'cancelled', timeline: {} }, ev('DELIVERY_CONCLUDED'));
    expect(c.upd.status).toBeUndefined();
  });
  it('evento fora de ordem não rebaixa (ASSIGN depois de DISPATCHED)', () => {
    const p = core.planEvent({ status: 'in_transit', timeline: {} }, ev('ASSIGN_DRIVER'));
    expect(p.upd.status).toBeUndefined();
    expect(p.order).toBeUndefined();
  });
  it('sem entregador → libera o pedido com aviso para a loja', () => {
    const p = core.planEvent({ status: 'requested' }, ev('REQUEST_DRIVER_FAILED', { reason: 'UnavailableFleet' }));
    expect(p.upd.status).toBe('failed');
    expect(p.order).toBe('liberar');
    expect(p.note).toContain('UnavailableFleet');
  });
  it('cancelamento recusado volta ao status real', () => {
    const p = core.planEvent({ status: 'cancel_requested', timeline: { ASSIGN_DRIVER: 'x', DISPATCHED: 'y' } }, ev('CANCELLATION_REQUEST_FAILED'));
    expect(p.upd.status).toBe('in_transit');
  });
  it('código de entrega vem em metadata.CODE (DELIVERY_DROP_CODE_REQUESTED)', () => {
    expect(core.planEvent({ status: 'in_transit' }, ev('DELIVERY_DROP_CODE_REQUESTED', { CODE: '8888' })).upd.drop_code).toBe('8888');
  });
  it('troca de endereço: prazo de 15 min e limpa ao responder', () => {
    const p = core.planEvent({ status: 'allocated' }, ev('DELIVERY_ADDRESS_CHANGE_REQUESTED', { streetName: 'Rua das Flores' }, '2026-09-26T12:00:00Z'));
    expect(p.upd.address_change).toEqual({ streetName: 'Rua das Flores' });
    expect(p.upd.address_change_deadline).toBe('2026-09-26T12:15:00.000Z');
    expect(core.planEvent({ status: 'allocated' }, ev('DELIVERY_ADDRESS_CHANGE_DENIED')).upd.address_change).toBeNull();
  });
  it('PLACED pede confirmação', () => {
    expect(core.planEvent({ status: 'requested' }, ev('PLACED')).confirm).toBe(true);
  });
  it('linha do tempo guarda só a 1ª vez de cada evento', () => {
    const p = core.planEvent({ status: 'allocated', timeline: { ASSIGN_DRIVER: '2026-09-26T11:00:00.000Z' } }, ev('ASSIGN_DRIVER'));
    expect((p.upd.timeline as any).ASSIGN_DRIVER).toBe('2026-09-26T11:00:00.000Z');
  });
});

describe('parseEnderecoPedido — texto do delivery', () => {
  it('rua, número, complemento, bairro, cidade e referência', () => {
    expect(core.parseEnderecoPedido('Rua das Flores 123 (Apto 4) - Centro - Paranaguá (Ref: perto da praça)')).toEqual({
      street: 'Rua das Flores', number: '123', complement: 'Apto 4', neighborhood: 'Centro', city: 'Paranaguá', reference: 'perto da praça',
    });
  });
  it('sem complemento nem referência', () => {
    expect(core.parseEnderecoPedido('Ramal Bujari 200 - Bujari - Bujari')).toMatchObject({ street: 'Ramal Bujari', number: '200', neighborhood: 'Bujari', city: 'Bujari' });
  });
  it('vazio não quebra', () => {
    expect(core.parseEnderecoPedido(null)).toMatchObject({ street: '', number: '' });
  });
});

describe('cancelamento pelo iFood — motivo vem em CANCEL_CODE_DESCRIPTION', () => {
  it('grava o motivo e libera o pedido', () => {
    const p = core.planEvent({ status: 'cancel_requested' }, ev('CANCELLED', { CANCEL_CODE: '802', CANCEL_CODE_DESCRIPTION: 'O pedido está duplicado' }));
    expect(p.upd.status).toBe('cancelled');
    expect(p.upd.cancel_reason).toBe('O pedido está duplicado');
    expect(p.order).toBe('liberar');
  });
});
