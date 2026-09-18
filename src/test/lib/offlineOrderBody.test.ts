import { describe, it, expect } from 'vitest';
import { buildOfflineCreateOrderBody } from '@/lib/offlineOrderBody';
import type { OfflineOrder } from '@/lib/offlineDB';

function baseOrder(over: Partial<OfflineOrder> = {}): OfflineOrder {
  return {
    localId: '11111111-1111-4111-8111-111111111111',
    serverId: null, localNumber: 'P0001-OFF', serverNumber: null,
    status: 'pending', retryCount: 0, lastError: null, createdAt: 0, syncedAt: null,
    session_id: 's1', tenant_id: 't1', origin: 'self_service', destination: 'counter',
    destination_name: 'Ana', destination_phone: null, delivery_address: null, delivery_fee: 0,
    items: [], discount_amount: 0, service_fee_amount: 0, subtotal: 10, total_amount: 10,
    cash_register_id: null, is_training: false, payments: [],
    ...over,
  };
}

describe('buildOfflineCreateOrderBody', () => {
  it('reusa o client_request_id da tentativa online e preserva campos do payload original', () => {
    const crid = '22222222-2222-4222-8222-222222222222';
    const body = buildOfflineCreateOrderBody(baseOrder({
      client_request_id: crid,
      create_payload: {
        client_request_id: crid, notes: 'sem cebola', customer_cpf: '123', table_number: 5,
        paid_pix_payment_id: 'pix1', is_cortesia: false, delivery_lat: -25.5,
      },
    }));
    expect(body.action).toBe('create_order');
    expect(body.client_request_id).toBe(crid);
    expect(body.notes).toBe('sem cebola');
    expect(body.customer_cpf).toBe('123');
    expect(body.table_number).toBe(5);
    expect(body.paid_pix_payment_id).toBe('pix1');
    expect(body.delivery_lat).toBe(-25.5);
    expect(body.tenant_id).toBe('t1');
  });

  it('registro antigo sem payload cai no localId', () => {
    const body = buildOfflineCreateOrderBody(baseOrder());
    expect(body.client_request_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.notes).toBeUndefined();
  });
});
