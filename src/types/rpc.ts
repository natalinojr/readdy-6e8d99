/**
 * Interfaces para linhas retornadas por queries diretas e RPCs do Supabase.
 * Centraliza tipagem de retornos brutos antes de serem mapeados para tipos de domínio.
 */

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface RPCSessionRow {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  users?: { name: string } | null;
}

export interface RPCRevenueRow {
  session_id: string;
  total_amount: number | string | null;
}

export interface RPCSessionOrderRow {
  id: string;
  created_at: string;
}

// ── Clientes / Retenção ───────────────────────────────────────────────────────

export interface RPCCustomerOrderRow {
  customer_id: string;
  created_at: string;
}

export interface RPCCustomerOrderPreviousRow {
  customer_id: string;
}

// ── Orders History ────────────────────────────────────────────────────────────

export interface RPCOrderRow {
  id: string;
  number: string | null;
  status: string | null;
  subtotal: number | string | null;
  discount_amount: number | string | null;
  service_fee_amount: number | string | null;
  tip_amount: number | string | null;
  total_amount: number | string | null;
  origin_type: string | null;
  destination_type: string | null;
  destination_name: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  table_number: number | null;
  created_at: string;
  updated_at: string;
  origin_user_id: string | null;
  is_training: boolean;
  is_draft: boolean;
  order_items: RPCOrderItemRow[];
  payments: RPCPaymentRow[];
  order_discounts?: RPCOrderDiscountRow[];
}

export interface RPCOrderItemRow {
  id: string;
  item_id: string | null;
  combo_id: string | null;
  item_name: string | null;
  item_price: number | string | null;
  quantity: number | null;
  status: string | null;
  notes: string | null;
  station_id: string | null;
  operator_id: string | null;
  delivered_by_user_id: string | null;
  entered_kds_at: string | null;
  started_preparing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  skip_kds: boolean;
  order_item_options: RPCOrderItemOptionRow[];
  order_item_observations: RPCOrderItemObservationRow[];
  order_item_units: RPCOrderItemUnitRow[];
}

export interface RPCOrderItemOptionRow {
  option_name: string;
  group_name: string;
  additional_price?: number | null;
}

export interface RPCOrderItemObservationRow {
  text: string;
  is_checked?: boolean;
}

export interface RPCOrderItemUnitRow {
  id: string;
  unit_number: number;
  status: string | null;
  operator_id: string | null;
  delivered_by_user_id: string | null;
  started_preparing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  entered_kds_at: string | null;
}

export interface RPCPaymentRow {
  id: string;
  amount: number | string | null;
  is_refunded: boolean | null;
  payment_method_id: string | null;
  voucher_id: string | null;
  payment_methods?: { name: string } | null;
}

export interface RPCOrderDiscountRow {
  id: string;
  discount_type: string;
  discount_value: number | string | null;
  original_percent: number | string | null;
  coupon_code: string | null;
  promotion_id: string | null;
  reason: string | null;
  applied_by: string | null;
  created_at: string;
}

// ── Users / Stations ──────────────────────────────────────────────────────────

export interface RPCUserRow {
  id: string;
  name: string;
}

export interface RPCStationRow {
  id: string;
  name: string;
}

// ── Vouchers ──────────────────────────────────────────────────────────────────

export interface RPCVoucherRow {
  id: string;
  code: string;
  voucher_type: string;
  current_balance: number | string | null;
  original_amount: number | string | null;
  status: string;
  expires_at: string | null;
  customer_name: string | null;
}

// ── Reservations ──────────────────────────────────────────────────────────────

export interface RPCReservationRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  reservation_date: string;
  reservation_time: string;
  duration_minutes: number;
  status: string;
  table_id: string | null;
  table_session_id: string | null;
  notes: string | null;
  occasion: string | null;
  created_at: string;
  tables?: { id: string; number: number; area: string | null; capacity: number } | null;
}

// ── Promotion Rules ───────────────────────────────────────────────────────────

export interface RPCPromotionRuleRow {
  id: string;
  name: string;
  promo_type: string;
  is_active: boolean;
  discount_value: number | string | null;
  special_price: number | string | null;
  valid_from: string | null;
  valid_until: string | null;
  days_of_week: number[] | null;
  time_from: string | null;
  time_until: string | null;
  channels: Record<string, boolean>;
  priority: number;
  is_stackable: boolean;
  current_uses: number;
  max_uses_total: number | null;
  coupon_code: string | null;
}
