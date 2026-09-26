// iFood Entrega (Sob Demanda) — cliente da Edge `ifood-shipping` (2026-09-26).
// Entregador do iFood para pedidos de delivery do próprio ERPOS. Doc: IFOOD-SHIPPING.md.
import { supabase } from '@/lib/supabase';

export interface IfoodShippingConfig {
  client_id: string | null;
  has_secret: boolean;
  app_type: 'distributed' | 'centralized';
  homologation_mode: boolean;
  shipping_enabled: boolean;
  default_prep_min: number;
  shipping_merchant_id: string | null;
  shipping_merchant_name: string | null;
  user_code: string | null;
  verification_url: string | null;
  merchants: { id: string; name: string }[];
  authorized: boolean;
  last_poll_at: string | null;
  last_poll_error: string | null;
  poll_fail_count: number;
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
