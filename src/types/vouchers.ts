// Voucher types
export type VoucherType = 'gift_card' | 'discount' | 'free_item' | 'cashback';

export type VoucherStatus = 'active' | 'depleted' | 'expired' | 'cancelled';

export type VoucherDiscountType = 'fixed' | 'percent';

export type VoucherTransactionType =
  | 'issued'
  | 'redeemed'
  | 'refunded'
  | 'expired'
  | 'cancelled';

export interface Voucher {
  id: string;
  tenant_id: string;

  /** Código único do voucher dentro do tenant */
  code: string;

  voucher_type: VoucherType;

  /** Valor original emitido */
  original_amount: number;
  /** Saldo atual disponível */
  current_balance: number;

  /** Apenas para voucher_type = 'discount' */
  discount_type: VoucherDiscountType | null;
  discount_value: number | null;

  /** Apenas para voucher_type = 'free_item' */
  free_item_id: string | null;

  issued_at: string;
  expires_at: string | null;

  status: VoucherStatus;

  /** Destinatário (opcional) */
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;

  /** Quem emitiu */
  issued_by: string | null;
  /** Pedido que originou o voucher (cashback, etc.) */
  order_id: string | null;

  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoucherTransaction {
  id: string;
  tenant_id: string;
  voucher_id: string;
  order_id: string | null;

  transaction_type: VoucherTransactionType;

  /** Valor desta transação (positivo = crédito, negativo = débito) */
  amount: number;
  /** Saldo do voucher após esta transação */
  balance_after: number;

  processed_by: string | null;
  created_at: string;
}

// ── Payloads para a Edge Function voucher-write ───────────────────────────────

export interface IssueVoucherPayload {
  action: 'issue_voucher';
  active_tenant_id?: string;
  voucher_type: VoucherType;
  original_amount: number;
  /** Código personalizado (opcional — gerado automaticamente se omitido) */
  code?: string;
  discount_type?: VoucherDiscountType | null;
  discount_value?: number | null;
  free_item_id?: string | null;
  expires_at?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  notes?: string | null;
  /** Pedido que originou (cashback) */
  order_id?: string | null;
}

export interface ValidateVoucherPayload {
  action: 'validate_voucher';
  active_tenant_id?: string;
  code: string;
  /** Valor do pedido (para verificar se o voucher cobre) */
  order_amount?: number;
}

export interface ValidateVoucherResult {
  valid: boolean;
  voucher: Voucher | null;
  /** Valor máximo que pode ser descontado neste pedido */
  applicable_amount: number;
  reason?: string;
}

export interface RedeemVoucherPayload {
  action: 'redeem_voucher';
  active_tenant_id?: string;
  code: string;
  /** Valor a ser descontado/usado */
  amount: number;
  order_id?: string | null;
}

export interface RedeemVoucherResult {
  ok: boolean;
  voucher_id: string;
  amount_redeemed: number;
  balance_after: number;
  transaction_id: string;
}

export interface CancelVoucherPayload {
  action: 'cancel_voucher';
  active_tenant_id?: string;
  voucher_id: string;
  reason?: string | null;
}

export interface ListVouchersPayload {
  action: 'list_vouchers';
  active_tenant_id?: string;
  status?: VoucherStatus;
  customer_id?: string;
  voucher_type?: VoucherType;
}

export interface GetVoucherTransactionsPayload {
  action: 'get_voucher_transactions';
  active_tenant_id?: string;
  voucher_id: string;
}
