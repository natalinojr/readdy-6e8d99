/**
 * Testes de lógica de promoções extraída do order-write Edge Function.
 * Cobre: applyPromotions, isRuleActiveNow, isRuleValidForChannel
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Tipos e lógica extraída ──────────────────────────────────────────────────

interface OrderItemInput {
  item_id: string | null;
  category_id: string | null;
  quantity: number;
  unit_price: number;
}

interface PromotionRuleRow {
  id: string;
  name: string;
  promo_type: string;
  target_item_id: string | null;
  target_category_id: string | null;
  free_item_id: string | null;
  discount_value: number | null;
  special_price: number | null;
  buy_quantity: number | null;
  get_quantity: number | null;
  min_order_amount: number | null;
  valid_from: string | null;
  valid_until: string | null;
  days_of_week: number[] | null;
  time_from: string | null;
  time_until: string | null;
  channels: Record<string, boolean>;
  max_uses_total: number | null;
  current_uses: number;
  coupon_code: string | null;
  priority: number;
  is_stackable: boolean;
}

interface AppliedPromotion {
  promotion_id: string;
  promotion_name: string;
  promo_type: string;
  discount_value: number;
  free_item_id?: string | null;
  free_item_quantity?: number;
  description: string;
}

function timeToMinutes(t: string): number {
  const parts = t.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function isRuleActiveNow(rule: PromotionRuleRow, nowDate: Date): boolean {
  const today = nowDate.toISOString().split("T")[0];
  if (rule.valid_from && today < rule.valid_from) return false;
  if (rule.valid_until && today > rule.valid_until) return false;
  if (rule.days_of_week && rule.days_of_week.length > 0) {
    if (!rule.days_of_week.includes(nowDate.getUTCDay())) return false;
  }
  if (rule.time_from || rule.time_until) {
    const nowMin = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
    if (rule.time_from && nowMin < timeToMinutes(rule.time_from)) return false;
    if (rule.time_until && nowMin > timeToMinutes(rule.time_until)) return false;
  }
  if (rule.max_uses_total != null && rule.current_uses >= rule.max_uses_total) return false;
  return true;
}

function isRuleValidForChannel(rule: PromotionRuleRow, channel: string): boolean {
  if (!rule.channels) return true;
  return rule.channels[channel] === true;
}

function applyPromotions(
  rules: PromotionRuleRow[],
  orderItems: OrderItemInput[],
  channel: string,
  orderTotal: number,
  couponCode: string | null,
  nowDate: Date = new Date(),
): AppliedPromotion[] {
  const results: AppliedPromotion[] = [];
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  let nonStackableApplied = false;

  for (const rule of sorted) {
    if (nonStackableApplied && !rule.is_stackable) continue;
    if (!isRuleActiveNow(rule, nowDate)) continue;
    if (!isRuleValidForChannel(rule, channel)) continue;
    if (rule.coupon_code) {
      if (!couponCode || couponCode.trim().toLowerCase() !== rule.coupon_code.trim().toLowerCase()) continue;
    }
    if (rule.min_order_amount != null && orderTotal < rule.min_order_amount) continue;

    let discountAmount = 0;
    let freeItemId: string | null = null;
    let freeItemQty = 0;
    let description = "";

    switch (rule.promo_type) {
      case "item_percent": {
        if (!rule.target_item_id || rule.discount_value == null) continue;
        const matchItems = orderItems.filter((i) => i.item_id === rule.target_item_id);
        if (matchItems.length === 0) continue;
        const subtotal = matchItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
        discountAmount = subtotal * (rule.discount_value / 100);
        description = `${rule.discount_value}% off em item`;
        break;
      }
      case "order_percent": {
        if (rule.discount_value == null) continue;
        discountAmount = orderTotal * (rule.discount_value / 100);
        description = `${rule.discount_value}% off no pedido`;
        break;
      }
      case "order_fixed": {
        if (rule.discount_value == null) continue;
        discountAmount = Math.min(rule.discount_value, orderTotal);
        description = `R$${rule.discount_value.toFixed(2)} off no pedido`;
        break;
      }
      case "buy_x_get_y": {
        if (!rule.target_item_id || !rule.free_item_id || !rule.buy_quantity || !rule.get_quantity) continue;
        const matchItems = orderItems.filter((i) => i.item_id === rule.target_item_id);
        const totalQty = matchItems.reduce((s, i) => s + i.quantity, 0);
        if (totalQty < rule.buy_quantity) continue;
        const sets = Math.floor(totalQty / rule.buy_quantity);
        freeItemId = rule.free_item_id;
        freeItemQty = sets * rule.get_quantity;
        const unitPrice = matchItems[0]?.unit_price ?? 0;
        discountAmount = unitPrice * freeItemQty;
        description = `Compre ${rule.buy_quantity} ganhe ${rule.get_quantity}`;
        break;
      }
      default:
        continue;
    }

    if (discountAmount < 0) discountAmount = 0;

    results.push({
      promotion_id: rule.id,
      promotion_name: rule.name,
      promo_type: rule.promo_type,
      discount_value: Math.round(discountAmount * 100) / 100,
      free_item_id: freeItemId,
      free_item_quantity: freeItemQty > 0 ? freeItemQty : undefined,
      description,
    });

    if (!rule.is_stackable) {
      nonStackableApplied = true;
    }
  }

  return results;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXED_DATE = new Date("2025-03-31T14:00:00.000Z"); // Segunda-feira, 14h UTC

function makeRule(overrides: Partial<PromotionRuleRow> = {}): PromotionRuleRow {
  return {
    id: "promo-1",
    name: "Promoção Teste",
    promo_type: "order_percent",
    target_item_id: null,
    target_category_id: null,
    free_item_id: null,
    discount_value: 10,
    special_price: null,
    buy_quantity: null,
    get_quantity: null,
    min_order_amount: null,
    valid_from: null,
    valid_until: null,
    days_of_week: null,
    time_from: null,
    time_until: null,
    channels: { cashier: true, waiter: true, delivery: true, self_service: true, table_qr: true },
    max_uses_total: null,
    current_uses: 0,
    coupon_code: null,
    priority: 100,
    is_stackable: true,
    ...overrides,
  };
}

const ITEMS: OrderItemInput[] = [
  { item_id: "item-1", category_id: "cat-1", quantity: 2, unit_price: 25.0 },
  { item_id: "item-2", category_id: "cat-1", quantity: 1, unit_price: 15.0 },
];

// ─── isRuleActiveNow ──────────────────────────────────────────────────────────

describe("isRuleActiveNow", () => {
  it("regra sem restrições → sempre ativa", () => {
    const rule = makeRule();
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(true);
  });

  it("valid_from no futuro → inativa", () => {
    const rule = makeRule({ valid_from: "2025-12-01" });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(false);
  });

  it("valid_until no passado → inativa", () => {
    const rule = makeRule({ valid_until: "2025-01-01" });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(false);
  });

  it("valid_from e valid_until englobando hoje → ativa", () => {
    const rule = makeRule({ valid_from: "2025-01-01", valid_until: "2025-12-31" });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(true);
  });

  it("dias_semana não inclui hoje → inativa", () => {
    // FIXED_DATE é segunda (1), testamos com [0] = domingo
    const rule = makeRule({ days_of_week: [0] });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(false);
  });

  it("dias_semana inclui hoje → ativa", () => {
    // FIXED_DATE é segunda (1)
    const rule = makeRule({ days_of_week: [1] });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(true);
  });

  it("max_uses_total atingido → inativa", () => {
    const rule = makeRule({ max_uses_total: 5, current_uses: 5 });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(false);
  });

  it("max_uses_total não atingido → ativa", () => {
    const rule = makeRule({ max_uses_total: 5, current_uses: 4 });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(true);
  });

  it("time_from no futuro → inativa", () => {
    // FIXED_DATE é 14:00 UTC, time_from = 15:00
    const rule = makeRule({ time_from: "15:00" });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(false);
  });

  it("time_until no passado → inativa", () => {
    // FIXED_DATE é 14:00 UTC, time_until = 13:00
    const rule = makeRule({ time_until: "13:00" });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(false);
  });

  it("dentro do horário → ativa", () => {
    const rule = makeRule({ time_from: "12:00", time_until: "16:00" });
    expect(isRuleActiveNow(rule, FIXED_DATE)).toBe(true);
  });
});

// ─── isRuleValidForChannel ────────────────────────────────────────────────────

describe("isRuleValidForChannel", () => {
  it("canal habilitado → válido", () => {
    const rule = makeRule({ channels: { cashier: true } });
    expect(isRuleValidForChannel(rule, "cashier")).toBe(true);
  });

  it("canal desabilitado → inválido", () => {
    const rule = makeRule({ channels: { cashier: false } });
    expect(isRuleValidForChannel(rule, "cashier")).toBe(false);
  });

  it("canal não listado → inválido", () => {
    const rule = makeRule({ channels: { cashier: true } });
    expect(isRuleValidForChannel(rule, "delivery")).toBe(false);
  });

  it("channels null → sempre válido", () => {
    const rule = makeRule({ channels: null as unknown as Record<string, boolean> });
    expect(isRuleValidForChannel(rule, "cashier")).toBe(true);
  });
});

// ─── applyPromotions ──────────────────────────────────────────────────────────

describe("applyPromotions", () => {
  it("sem regras → sem promoções", () => {
    const result = applyPromotions([], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(0);
  });

  it("order_percent: 10% de desconto no total", () => {
    const rule = makeRule({ promo_type: "order_percent", discount_value: 10 });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(1);
    expect(result[0].discount_value).toBe(6.5); // 10% de 65
  });

  it("order_fixed: desconto fixo de R$10", () => {
    const rule = makeRule({ promo_type: "order_fixed", discount_value: 10 });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result[0].discount_value).toBe(10);
  });

  it("order_fixed: não desconta mais que o total", () => {
    const rule = makeRule({ promo_type: "order_fixed", discount_value: 100 });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result[0].discount_value).toBe(65); // limitado ao total
  });

  it("item_percent: 20% de desconto no item específico", () => {
    const rule = makeRule({
      promo_type: "item_percent",
      target_item_id: "item-1",
      discount_value: 20,
    });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    // item-1: 2 × R$25 = R$50, 20% = R$10
    expect(result[0].discount_value).toBe(10);
  });

  it("item_percent: item não encontrado → sem desconto", () => {
    const rule = makeRule({
      promo_type: "item_percent",
      target_item_id: "item-nao-existe",
      discount_value: 20,
    });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(0);
  });

  it("buy_x_get_y: compre 2 ganhe 1", () => {
    const rule = makeRule({
      promo_type: "buy_x_get_y",
      target_item_id: "item-1",
      free_item_id: "item-1",
      buy_quantity: 2,
      get_quantity: 1,
    });
    // item-1 tem qty=2, então 1 set → 1 item grátis (R$25)
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(1);
    expect(result[0].free_item_id).toBe("item-1");
    expect(result[0].free_item_quantity).toBe(1);
    expect(result[0].discount_value).toBe(25);
  });

  it("buy_x_get_y: quantidade insuficiente → sem promoção", () => {
    const rule = makeRule({
      promo_type: "buy_x_get_y",
      target_item_id: "item-1",
      free_item_id: "item-1",
      buy_quantity: 5, // precisa de 5, tem só 2
      get_quantity: 1,
    });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(0);
  });

  it("coupon_code: aplica com código correto", () => {
    const rule = makeRule({ coupon_code: "DESCONTO10", promo_type: "order_percent", discount_value: 10 });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, "DESCONTO10", FIXED_DATE);
    expect(result).toHaveLength(1);
  });

  it("coupon_code: não aplica com código errado", () => {
    const rule = makeRule({ coupon_code: "DESCONTO10", promo_type: "order_percent", discount_value: 10 });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, "ERRADO", FIXED_DATE);
    expect(result).toHaveLength(0);
  });

  it("coupon_code: case insensitive", () => {
    const rule = makeRule({ coupon_code: "DESCONTO10", promo_type: "order_percent", discount_value: 10 });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, "desconto10", FIXED_DATE);
    expect(result).toHaveLength(1);
  });

  it("min_order_amount: não aplica se total abaixo do mínimo", () => {
    const rule = makeRule({ min_order_amount: 100, promo_type: "order_percent", discount_value: 10 });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(0);
  });

  it("min_order_amount: aplica se total acima do mínimo", () => {
    const rule = makeRule({ min_order_amount: 50, promo_type: "order_percent", discount_value: 10 });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(1);
  });

  it("is_stackable=false: segunda promoção não-stackable é ignorada", () => {
    const rule1 = makeRule({ id: "p1", priority: 1, is_stackable: false, promo_type: "order_percent", discount_value: 10 });
    const rule2 = makeRule({ id: "p2", priority: 2, is_stackable: false, promo_type: "order_fixed", discount_value: 5 });
    const result = applyPromotions([rule1, rule2], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(1);
    expect(result[0].promotion_id).toBe("p1");
  });

  it("is_stackable=true: múltiplas promoções se acumulam", () => {
    const rule1 = makeRule({ id: "p1", priority: 1, is_stackable: true, promo_type: "order_percent", discount_value: 10 });
    const rule2 = makeRule({ id: "p2", priority: 2, is_stackable: true, promo_type: "order_fixed", discount_value: 5 });
    const result = applyPromotions([rule1, rule2], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(2);
  });

  it("canal inválido → promoção não aplicada", () => {
    const rule = makeRule({ channels: { cashier: true } });
    const result = applyPromotions([rule], ITEMS, "delivery", 65, null, FIXED_DATE);
    expect(result).toHaveLength(0);
  });

  it("regra inativa (data expirada) → não aplicada", () => {
    const rule = makeRule({ valid_until: "2024-01-01" });
    const result = applyPromotions([rule], ITEMS, "cashier", 65, null, FIXED_DATE);
    expect(result).toHaveLength(0);
  });

  it("discount_value nunca é negativo", () => {
    const rule = makeRule({ promo_type: "order_percent", discount_value: 10 });
    const result = applyPromotions([rule], ITEMS, "cashier", 0, null, FIXED_DATE);
    if (result.length > 0) {
      expect(result[0].discount_value).toBeGreaterThanOrEqual(0);
    }
  });
});
