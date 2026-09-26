import { describe, it, expect } from 'vitest';
import { ifoodTipoPedido, ifoodPodeDespachar } from '@/lib/ifoodShipping';

const base = { order_type: 'DELIVERY', order_timing: 'IMMEDIATE', delivered_by: 'IFOOD', sales_channel: 'IFOOD', schedule: null, takeout: null, dine_in: null };

describe('ifoodTipoPedido', () => {
  it('entrega pelo iFood e pela loja', () => {
    expect(ifoodTipoPedido(base)).toBe('Entregador iFood');
    expect(ifoodTipoPedido({ ...base, delivered_by: 'MERCHANT' })).toBe('Entrega própria');
  });
  it('consumo no local (pedido de teste FOOD_SELF_SERVICE) não vira entrega', () => {
    expect(ifoodTipoPedido({ ...base, order_type: 'DINE_IN', delivered_by: null, sales_channel: 'TOTEM' })).toBe('Consumo no local (totem)');
  });
  it('retirada com horário e agendado com janela', () => {
    expect(ifoodTipoPedido({ ...base, order_type: 'TAKEOUT', delivered_by: null, takeout: { takeoutDateTime: '2026-09-26T22:00:00Z' } })).toMatch(/^Retirada no balcão · retirar 26\/09/);
    const ag = ifoodTipoPedido({ ...base, order_timing: 'SCHEDULED', schedule: { deliveryDateTimeStart: '2026-09-27T15:00:00Z', deliveryDateTimeEnd: '2026-09-27T15:30:00Z' } });
    expect(ag).toMatch(/^Entregador iFood · agendado para 27\/09, \d\d:\d\d a \d\d:\d\d$/);
    expect(ifoodTipoPedido({ ...base, order_timing: 'SCHEDULED' })).toBe('Entregador iFood · agendado');
  });
});

describe('ifoodPodeDespachar', () => {
  it('só entrega feita pela loja', () => {
    expect(ifoodPodeDespachar({ order_type: 'DELIVERY', delivered_by: 'MERCHANT' })).toBe(true);
    expect(ifoodPodeDespachar({ order_type: 'DELIVERY', delivered_by: 'IFOOD' })).toBe(false);
    expect(ifoodPodeDespachar({ order_type: 'TAKEOUT', delivered_by: null })).toBe(false);
    expect(ifoodPodeDespachar({ order_type: 'DINE_IN', delivered_by: null })).toBe(false);
  });
});
