// iFood Entrega (Sob Demanda) — cliente da Edge `ifood-shipping` (2026-09-26).
// Entregador do iFood para pedidos de delivery do próprio ERPOS. Doc: IFOOD-SHIPPING.md.
import { supabase } from '@/lib/supabase';

export interface IfoodShippingConfig {
  client_id: string | null;
  has_secret: boolean;
  system_app?: boolean;
  app_type: 'distributed' | 'centralized';
  homologation_mode: boolean;
  shipping_enabled: boolean;
  default_prep_min: number;
  shipping_merchant_id: string | null;
  shipping_merchant_name: string | null;
  user_code: string | null;
  verification_url: string | null;
  merchants: { id: string; name: string; outra_loja?: string | null }[]; // outra_loja: já é de outra loja do ERPOS (não liga aqui)
  authorized: boolean;
  last_poll_at: string | null;
  last_poll_error: string | null;
  poll_fail_count: number;
  order_enabled: boolean;
  order_mode: 'read_only' | 'operate' | 'funnel';
  order_auto_confirm: boolean;
  order_emit_nfce: boolean; // emitir NFC-e dos pedidos do iFood (funil; exige o fiscal da loja ligado)
  order_nfce_momento?: 'saida' | 'conclusao'; // quando a nota sai: pronto/saiu (recomendado) ou conclusão no iFood
  order_merchant_ids: string[];
}

export type ShippingStatus =
  | 'requested' | 'allocated' | 'going_to_origin' | 'arrived_origin' | 'in_transit'
  | 'cancel_requested' | 'concluded' | 'cancelled' | 'failed';

export interface IfoodShippingOrder {
  id: string;
  order_id: string;
  ifood_order_id: string | null;
  status: ShippingStatus;
  last_event: string | null;
  tracking_url: string | null;
  drop_code: string | null;
  pickup_code: string | null;
  safe_score: string | null;
  driver: { name?: string | null; phone?: string | null; vehicle?: string | null; photo?: string | null } | null;
  ifood_fee: number | null;
  merchant_fee: number | null;
  prep_min: number | null;
  address_change: Record<string, unknown> | null;
  address_change_deadline: string | null;
  cancel_reason: string | null;
  error: string | null;
  uncertain?: boolean;
  timeline: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export const SHIPPING_ATIVOS: ShippingStatus[] = ['requested', 'allocated', 'going_to_origin', 'arrived_origin', 'in_transit', 'cancel_requested'];

export const SHIPPING_LABEL: Record<ShippingStatus, string> = {
  requested: 'Procurando entregador',
  allocated: 'Entregador a caminho da loja',
  going_to_origin: 'Entregador a caminho da loja',
  arrived_origin: 'Entregador chegou na loja',
  in_transit: 'Saiu para entrega',
  cancel_requested: 'Cancelando…',
  concluded: 'Entregue',
  cancelled: 'Cancelada',
  failed: 'Sem entregador',
};

export interface IfoodQuote {
  id: string;
  expirationAt: string;
  distance: number;
  preparationTime?: number;
  quote: { grossValue: number; discount?: number; raise?: number; netValue: number };
  deliveryTime: { min: number; max: number };
  hasPaymentMethods?: boolean;
  paymentMethods?: { id: string; brand?: string; liability?: string; paymentType?: string; method: 'CREDIT' | 'DEBIT' | 'CASH' }[];
}

export interface PrepareResult {
  order: { id: string; number: string; status: string; total: number; delivery_fee: number; items_total: number; address_text: string };
  customer: { name: string; area_code: string; number: string };
  address: {
    street_name: string; street_number: string; complement: string; reference: string;
    neighborhood: string; city: string; state: string; postal_code: string; lat: number | null; lng: number | null;
  };
  payment: { kind: 'paid' | 'CASH' | 'CREDIT' | 'DEBIT' | 'unknown'; changeFor?: number | null; label?: string | null };
  prep_min: number;
  shipping: IfoodShippingOrder | null;
  ready: boolean;
}

const url = () => (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '') + '/functions/v1/ifood-shipping';

/** Chama a Edge. Erro de negócio volta como { success: false, error } (sem exceção). */
export async function ifoodShipping<T = Record<string, unknown>>(action: string, tenantId: string, extra: Record<string, unknown> = {}): Promise<{ success: boolean; error?: string } & T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? '';
  try {
    const res = await fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ action, tenant_id: tenantId, ...extra }),
    });
    const body = await res.json().catch(() => ({ success: false, error: `Erro ${res.status}` }));
    return body;
  } catch {
    return { success: false, error: 'Sem conexão com o servidor.' } as { success: boolean; error?: string } & T;
  }
}

/** Última entrega iFood de cada pedido (RLS: só da loja da pessoa). */
export async function fetchShippingByOrder(tenantId: string, orderIds: string[]): Promise<Record<string, IfoodShippingOrder>> {
  if (orderIds.length === 0) return {};
  const { data } = await supabase.from('ifood_shipping_orders')
    .select('id, order_id, ifood_order_id, status, last_event, tracking_url, drop_code, pickup_code, safe_score, driver, ifood_fee, merchant_fee, prep_min, address_change, address_change_deadline, cancel_reason, error, uncertain, timeline, created_at, updated_at')
    .eq('tenant_id', tenantId).in('order_id', orderIds)
    .order('created_at', { ascending: true });
  const out: Record<string, IfoodShippingOrder> = {};
  for (const r of (data ?? []) as IfoodShippingOrder[]) out[r.order_id] = r; // a mais recente fica
  return out;
}

export const fmtMin = (seg: number) => Math.round(seg / 60);

/** Entregas iFood em andamento da loja (para achar as de pedidos que saíram do quadro, ex.: cancelados). */
export async function fetchShippingAtivas(tenantId: string): Promise<IfoodShippingOrder[]> {
  const { data } = await supabase.from('ifood_shipping_orders')
    .select('id, order_id, ifood_order_id, status, last_event, tracking_url, drop_code, pickup_code, safe_score, driver, ifood_fee, merchant_fee, prep_min, address_change, address_change_deadline, cancel_reason, error, timeline, created_at, updated_at')
    .eq('tenant_id', tenantId).in('status', SHIPPING_ATIVOS);
  return (data ?? []) as IfoodShippingOrder[];
}

// ── Pedidos do iFood (módulo Order; modo só leitura por padrão) ──
export type IfoodOrderStatus = 'placed' | 'confirmed' | 'preparing' | 'ready' | 'dispatched' | 'concluded' | 'cancelled';
export const IFOOD_ORDER_LABEL: Record<IfoodOrderStatus, string> = {
  placed: 'Novo', confirmed: 'Confirmado', preparing: 'Em preparo', ready: 'Pronto',
  dispatched: 'Saiu', concluded: 'Concluído', cancelled: 'Cancelado',
};
export interface IfoodOrderOption { name: string; groupName?: string; quantity?: number; unitPrice?: number; price?: number; customization?: { name: string; quantity?: number }[] }
export interface IfoodOrderItem {
  id: string; idx: number | null; name: string; quantity: number; unit: string | null; unit_price: number | null;
  options_price: number | null; total_price: number | null; observations: string | null; external_code: string | null; options: IfoodOrderOption[];
}
export interface IfoodOrder {
  id: string; merchant_id: string; ifood_order_id: string; display_id: string | null; status: IfoodOrderStatus;
  order_type: string | null; order_timing: string | null; sales_channel: string | null; delivered_by: string | null; is_test: boolean;
  ordered_at: string | null; customer_name: string | null; customer_document: string | null; customer_orders_count: number | null;
  pickup_code: string | null; delivery_observations: string | null; address: Record<string, unknown> | null;
  total: { subTotal?: number; deliveryFee?: number; benefits?: number; additionalFees?: number; orderAmount?: number } | null;
  payments: { prepaid?: number; pending?: number; methods?: { value: number; type: string; method: string; card?: { brand?: string }; cash?: { changeFor?: number }; wallet?: { name?: string } }[] } | null;
  benefits: { value: number; target: string; sponsorshipValues?: { name: string; value: number }[] }[] | null;
  extra_info: string | null; schedule: Record<string, unknown> | null; dispute: Record<string, unknown> | null;
  cancel_reason: string | null; cancel_requested: boolean; last_event: string | null; timeline: Record<string, string>;
  created_at: string; updated_at: string;
  takeout?: { takeoutDateTime?: string } | null; dine_in?: { deliveryDateTime?: string } | null;
  /** Funil: pedido do ERPOS ligado (número/status) e por que ainda não entrou. */
  order_id?: string | null; funnel_error?: string | null;
  erpos?: { number: string | null; status: string; is_draft: boolean } | null;
  ifood_order_items?: IfoodOrderItem[];
}

const hora = (iso?: unknown) => (typeof iso === 'string' && iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Como o pedido sai da loja, pelo `orderType` do iFood: DELIVERY (entregador do iFood ou da loja), TAKEOUT (retirada no
 * balcão), DINE_IN (consumo no local — pedido de teste FOOD_SELF_SERVICE vem assim, canal TOTEM) e INDOOR (salão).
 * Agendado mostra a janela de `schedule`.
 */
export function ifoodTipoPedido(p: Pick<IfoodOrder, 'order_type' | 'order_timing' | 'delivered_by' | 'sales_channel' | 'schedule' | 'takeout' | 'dine_in'>): string {
  const t = p.order_type;
  let s = t === 'TAKEOUT' ? 'Retirada no balcão'
    : t === 'DINE_IN' ? `Consumo no local${p.sales_channel === 'TOTEM' ? ' (totem)' : ''}`
    : t === 'INDOOR' ? 'No salão'
    : p.delivered_by === 'MERCHANT' ? 'Entrega própria' : 'Entregador iFood';
  if (p.order_timing === 'SCHEDULED') {
    const ini = hora(p.schedule?.deliveryDateTimeStart), fim = hora(p.schedule?.deliveryDateTimeEnd);
    s += ini ? ` · agendado para ${ini}${fim ? ` a ${fim.slice(-5)}` : ''}` : ' · agendado';
  } else if (t === 'TAKEOUT' && p.takeout?.takeoutDateTime) s += ` · retirar ${hora(p.takeout.takeoutDateTime)}`;
  return s;
}

/** "Despachar" só existe para entrega feita pela loja (retirada, consumo no local e entregador do iFood não despacham). */
export const ifoodPodeDespachar = (p: Pick<IfoodOrder, 'order_type' | 'delivered_by'>) =>
  p.order_type === 'DELIVERY' && p.delivered_by !== 'IFOOD';

/** Pedidos do iFood desde `desde` (ISO), com itens (RLS: só da loja da pessoa). */
export async function fetchIfoodOrders(tenantId: string, desde: string): Promise<IfoodOrder[]> {
  const { data } = await supabase.from('ifood_orders')
    .select('id, merchant_id, ifood_order_id, display_id, status, order_type, order_timing, sales_channel, delivered_by, is_test, ordered_at, customer_name, customer_document, customer_orders_count, pickup_code, delivery_observations, address, total, payments, benefits, extra_info, schedule, dispute, cancel_reason, cancel_requested, last_event, timeline, created_at, updated_at, takeout:raw->takeout, dine_in:raw->dineIn, order_id, funnel_error, erpos:orders!ifood_orders_order_id_fkey(number, status, is_draft), ifood_order_items(id, idx, name, quantity, unit, unit_price, options_price, total_price, observations, external_code, options)')
    .eq('tenant_id', tenantId).gte('created_at', desde).order('created_at', { ascending: false }).limit(300);
  return (data ?? []) as unknown as IfoodOrder[];
}
