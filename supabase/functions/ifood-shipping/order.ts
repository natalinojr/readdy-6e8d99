// Pedidos do iFood (módulo Order) — regras puras (sem Supabase nem rede). Testadas em
// src/test/edge/ifoodOrder.test.ts. Doc: IFOOD-MODULOS-HOMOLOGACAO.md.
// deno-lint-ignore-file no-explicit-any

import { eventName } from './core.ts';

// Códigos curtos que o iFood manda em `code` (o nome completo vem em `fullCode`).
const ORDER_ALIAS: Record<string, string> = {
  PRS: 'PREPARATION_STARTED', SPS: 'SEPARATION_STARTED', SPE: 'SEPARATION_ENDED', RTP: 'READY_TO_PICKUP',
  HSD: 'HANDSHAKE_DISPUTE', HSS: 'HANDSHAKE_SETTLEMENT',
};
export const orderEventName = (e: any) => {
  const n = eventName(e);
  return ORDER_ALIAS[n] ?? n.replace(/^ORDER_/, '');
};

export const ORDER_RANK: Record<string, number> = { placed: 0, confirmed: 1, preparing: 2, ready: 3, dispatched: 4, concluded: 5 };
export const ORDER_TERMINAL = ['concluded', 'cancelled'];

// Evento → status do pedido no ERPOS (null = não muda o status).
const STATUS_BY_EVENT: Record<string, string> = {
  PLACED: 'placed', CONFIRMED: 'confirmed',
  PREPARATION_STARTED: 'preparing', SEPARATION_STARTED: 'preparing',
  READY_TO_PICKUP: 'ready', SEPARATION_ENDED: 'ready',
  DISPATCHED: 'dispatched', COLLECTED: 'dispatched',
  CONCLUDED: 'concluded', CANCELLED: 'cancelled',
};

// Eventos que pedem (re)leitura do pedido completo (GET /orders/{id}).
export const NEEDS_DETAILS = new Set(['PLACED', 'CONFIRMED', 'ORDER_PATCHED', 'PATCHED', 'DELIVERY_ADDRESS_CHANGE']);

export interface OrderPlan { upd: Record<string, unknown>; fetchDetails: boolean }

/**
 * Efeito de um evento num pedido (`o` = linha atual de ifood_orders, ou null se ainda não existe).
 * Status só avança (evento atrasado não volta a fase); pedido encerrado não reabre.
 */
export function planOrderEvent(o: { status: string; timeline?: Record<string, string> | null; details_at?: string | null } | null, e: any): OrderPlan {
  const name = orderEventName(e);
  const at = e?.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString();
  const meta = e?.metadata ?? {};
  const tl = { ...(o?.timeline ?? {}) };
  if (!tl[name]) tl[name] = at;
  const upd: Record<string, unknown> = { last_event: name, timeline: tl };
  const cur = o?.status ?? 'placed';
  const fetchDetails = !o?.details_at || NEEDS_DETAILS.has(name);

  if (ORDER_TERMINAL.includes(cur)) return { upd, fetchDetails: false };

  const to = STATUS_BY_EVENT[name];
  if (to === 'cancelled') {
    upd.status = 'cancelled'; upd.cancelled_at = at; upd.cancel_requested = false;
    const motivo = meta.cancelReasonDescription ?? meta.CANCEL_CODE_DESCRIPTION ?? meta.reasonDescription ?? meta.reason ?? meta.cancellationReason ?? null;
    if (motivo) upd.cancel_reason = String(motivo).slice(0, 300);
  } else if (to && (ORDER_RANK[to] ?? -1) > (ORDER_RANK[cur] ?? -1)) {
    upd.status = to;
    if (to === 'concluded') upd.concluded_at = at;
  }
  if (!o) upd.status = upd.status ?? (to && to !== 'cancelled' ? to : 'placed');

  if (name === 'CANCELLATION_REQUESTED') upd.cancel_requested = true;
  if (name === 'CANCELLATION_REQUEST_FAILED') upd.cancel_requested = false;
  if (name === 'HANDSHAKE_DISPUTE') upd.dispute = meta.dispute ?? meta;
  if (name === 'HANDSHAKE_SETTLEMENT') upd.dispute = { ...(meta.dispute ?? meta), settled: true };
  return { upd, fetchDetails };
}

/** Detalhe do pedido (GET /order/v1.0/orders/{id}) → colunas de ifood_orders. */
export function orderRowFromDetails(d: any) {
  const delivery = d?.delivery ?? {};
  const customer = d?.customer ?? {};
  return {
    display_id: d?.displayId ?? null,
    order_type: d?.orderType ?? null,
    order_timing: d?.orderTiming ?? null,
    sales_channel: d?.salesChannel ?? null,
    delivered_by: delivery.deliveredBy ?? null,
    is_test: Boolean(d?.isTest ?? d?.test ?? false),
    ordered_at: d?.createdAt ?? null,
    customer_name: customer.name ?? null,
    customer_document: customer.documentNumber ?? null,
    customer_orders_count: customer.ordersCountOnMerchant ?? null,
    pickup_code: delivery.pickupCode ?? null,
    delivery_observations: delivery.observations ?? d?.takeout?.observations ?? null,
    address: delivery.deliveryAddress ?? null,
    // Para o pedido do ERPOS (IFOOD-PEDIDOS-FUNIL.md): mapa do Gestor/motoboy e acerto. 0,0 = pedido de teste sem posição.
    delivery_lat: Number(delivery.deliveryAddress?.coordinates?.latitude) || null,
    delivery_lng: Number(delivery.deliveryAddress?.coordinates?.longitude) || null,
    delivery_fee: d?.total?.deliveryFee != null ? Number(d.total.deliveryFee) : null,
    total: d?.total ?? null,
    payments: d?.payments ?? null,
    benefits: d?.benefits ?? null,
    extra_info: d?.extraInfo ?? null,
    schedule: d?.schedule ?? d?.scheduled ?? null,
    raw: d ?? null,
  };
}

/** Itens do detalhe → linhas de ifood_order_items (complementos ficam em `options`, como vieram). */
export function orderItemsFromDetails(d: any) {
  return (Array.isArray(d?.items) ? d.items : []).map((i: any, n: number) => ({
    idx: Number.isFinite(Number(i.index)) ? Number(i.index) : n,
    catalog_item_id: i.id ?? null,
    unique_id: i.uniqueId ?? null,
    external_code: i.externalCode ?? null,
    name: String(i.name ?? 'Item'),
    quantity: Number(i.quantity ?? 1),
    unit: i.unit ?? null,
    unit_price: i.unitPrice ?? null,
    options_price: i.optionsPrice ?? null,
    total_price: i.totalPrice ?? null,
    observations: i.observations ?? null,
    options: Array.isArray(i.options) ? i.options : [],
  }));
}

/** Quem paga o desconto (para a tela: "cupom de R$ 10 — pago pelo iFood"). */
export function benefitSponsors(benefits: any[] | null | undefined) {
  return (benefits ?? []).map((b) => ({
    value: Number(b?.value ?? 0),
    target: String(b?.target ?? ''),
    sponsors: (b?.sponsorshipValues ?? []).filter((s: any) => Number(s?.value ?? 0) > 0).map((s: any) => ({ name: String(s.name), value: Number(s.value) })),
  }));
}
