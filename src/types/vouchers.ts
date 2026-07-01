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
  /** Início da vigência (null = imediato) */
  valid_from: string | null;
  expires_at: string | null;

  status: VoucherStatus;

  /** Token do link público de ativação (/voucher/:token) — null se não gerado */
  claim_token: string | null;
  /** Quando o cliente abriu o link pela 1ª vez ("acionado") */
  claimed_at: string | null;
  /** Quantas vezes o link foi aberto */
  claim_count: number;
  /** Limite de usos (discount/free_item) */
  max_uses: number;
  /** Quantas vezes já foi resgatado */
  use_count: number;
  /** Pedido mínimo próprio do voucher (null = sem mínimo) */
  min_order_amount: number | null;

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
  /** Início da vigência (null = imediato) */
  valid_from?: string | null;
  /** Limite de usos (default 1) */
  max_uses?: number;
  /** Pedido mínimo próprio do voucher */
  min_order_amount?: number | null;
  /** Gera claim_token para link público de ativação */
  generate_claim_link?: boolean;
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
  /** Presente quando reason === 'below_min_order' */
  min_order_amount?: number;
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

// ── Página pública /voucher/:token (Edge Function voucher-claim) ──────────────

/** Payload público retornado pela voucher-claim — sem ids internos/tenant */
export interface VoucherClaimPublic {
  code: string;
  voucher_type: VoucherType;
  discount_type: VoucherDiscountType | null;
  discount_value: number | null;
  original_amount: number;
  current_balance: number;
  valid_from: string | null;
  expires_at: string | null;
  min_order_amount: number | null;
  status: VoucherStatus;
  not_yet_valid: boolean;
  claimed_at: string | null;
  use_count: number;
  max_uses: number;
  customer_name: string | null;
  notes: string | null;
  store: {
    name: string;
    /** Slug da loja — usado para montar o link do delivery (/{slug}-delivery) */
    slug: string | null;
    logo_url: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
  } | null;
}
