/**
 * offlineOrderBody.ts — monta o corpo de `create_order` para reenviar um pedido salvo offline.
 *
 * Lógica pura (sem IndexedDB/rede) para ser testável.
 *
 * Regras:
 * - Usa o payload original completo (`create_payload`) quando existir: nada do pedido online
 *   se perde no caminho offline (notes, customer_*, table_*, delivery_*, paid_pix_payment_id, cortesia...).
 * - `client_request_id` é o MESMO da tentativa online. Se a resposta se perdeu depois de o servidor
 *   gravar, o reenvio devolve o pedido já criado (idempotente) em vez de criar um segundo.
 * - Registros antigos (sem `create_payload`/`client_request_id`) caem nos campos legados e no localId.
 */
import type { OfflineOrder } from './offlineDB';

export function buildOfflineCreateOrderBody(order: OfflineOrder): Record<string, unknown> {
  const original = (order.create_payload ?? {}) as Record<string, unknown>;
  return {
    ...original,
    action: 'create_order',
    client_request_id: order.client_request_id || (original.client_request_id as string | undefined) || order.localId,
    session_id: order.session_id,
    tenant_id: order.tenant_id,
    origin: order.origin,
    destination: order.destination,
    destination_name: order.destination_name,
    destination_phone: order.destination_phone,
    delivery_address: order.delivery_address,
    delivery_fee: order.delivery_fee,
    items: order.items,
    discount_amount: order.discount_amount,
    service_fee_amount: order.service_fee_amount,
    subtotal: order.subtotal,
    total_amount: order.total_amount,
    cash_register_id: order.cash_register_id,
    is_training: order.is_training,
  };
}
