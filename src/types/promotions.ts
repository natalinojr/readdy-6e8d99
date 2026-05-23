export type PromoType =
  | 'item_percent'       // X% de desconto em item específico
  | 'item_fixed'         // R$X de desconto em item específico
  | 'category_percent'   // X% em todos itens de uma categoria
  | 'order_percent'      // X% no pedido inteiro
  | 'order_fixed'        // R$X no pedido inteiro
  | 'buy_x_get_y'        // compre X ganhe Y
  | 'combo_price'        // combo com preço especial
  | 'free_item';         // item grátis a partir de certo valor

/** Canais onde a promoção é válida */
export interface PromotionChannels {
  cashier: boolean;
  waiter: boolean;
  delivery: boolean;
  self_service: boolean;
  table_qr: boolean;
}

export type PromotionChannel = keyof PromotionChannels;

export interface PromotionRule {
  id: string;
  tenant_id: string;

  name: string;
  description: string | null;
  is_active: boolean;

  promo_type: PromoType;

  // Alvo
  target_item_id: string | null;
  target_category_id: string | null;
  free_item_id: string | null;

  // Valor
  discount_value: number | null;
  special_price: number | null;

  // Condições buy_x_get_y
  buy_quantity: number | null;
  get_quantity: number | null;
  min_order_amount: number | null;

  // Restrições de tempo
  valid_from: string | null;   // ISO date "YYYY-MM-DD"
  valid_until: string | null;  // ISO date "YYYY-MM-DD"
  /** 0=Dom, 1=Seg, ..., 6=Sab. null = todos os dias */
  days_of_week: number[] | null;
  time_from: string | null;    // "HH:MM:SS"
  time_until: string | null;   // "HH:MM:SS"

  // Restrições de canal
  channels: PromotionChannels;

  // Limites de uso
  max_uses_total: number | null;
  max_uses_per_customer: number | null;
  current_uses: number;

  // Cupom
  coupon_code: string | null;

  // Prioridade (menor = maior prioridade)
  priority: number;

  // Acumulável
  is_stackable: boolean;

  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Resultado do motor de promoções ──────────────────────────────────────────

export interface AppliedPromotion {
  promotion_id: string;
  promotion_name: string;
  promo_type: PromoType;
  discount_value: number;
  /** Item grátis adicionado (free_item / buy_x_get_y) */
  free_item_id?: string | null;
  free_item_quantity?: number;
  /** Descrição legível para exibir ao operador */
  description: string;
}

// ── Payloads para a action apply_promotions ───────────────────────────────────

export interface OrderItemForPromotion {
  item_id: string | null;
  category_id: string | null;
  quantity: number;
  unit_price: number;
}

export interface ApplyPromotionsPayload {
  action: 'apply_promotions';
  active_tenant_id?: string;
  /** Canal de origem do pedido */
  channel: PromotionChannel;
  /** Itens do pedido */
  order_items: OrderItemForPromotion[];
  /** Valor total do pedido (para min_order_amount) */
  order_total: number;
  /** Cupom digitado pelo cliente (opcional) */
  coupon_code?: string | null;
  /** ID do cliente (para max_uses_per_customer) */
  customer_id?: string | null;
}

// ── Payloads CRUD de promoções ────────────────────────────────────────────────

export interface CreatePromotionRulePayload {
  action: 'create_promotion_rule';
  active_tenant_id?: string;
  name: string;
  description?: string | null;
  promo_type: PromoType;
  target_item_id?: string | null;
  target_category_id?: string | null;
  free_item_id?: string | null;
  discount_value?: number | null;
  special_price?: number | null;
  buy_quantity?: number | null;
  get_quantity?: number | null;
  min_order_amount?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  days_of_week?: number[] | null;
  time_from?: string | null;
  time_until?: string | null;
  channels?: Partial<PromotionChannels>;
  max_uses_total?: number | null;
  max_uses_per_customer?: number | null;
  coupon_code?: string | null;
  priority?: number;
  is_stackable?: boolean;
}

export interface UpdatePromotionRulePayload extends Partial<CreatePromotionRulePayload> {
  action: 'update_promotion_rule';
  promotion_id: string;
}

export interface DeletePromotionRulePayload {
  action: 'delete_promotion_rule';
  promotion_id: string;
  active_tenant_id?: string;
}

export interface ListPromotionRulesPayload {
  action: 'list_promotion_rules';
  active_tenant_id?: string;
  is_active?: boolean;
}
