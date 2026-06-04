import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function log(level: "INFO" | "WARN" | "ERROR", action: string, message: string, ctx?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, fn: "order-write", action, msg: message, ...(ctx ?? {}) };
  if (level === "ERROR") console.error(JSON.stringify(entry));
  else if (level === "WARN") console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

const DEST_MAP: Record<string, string> = {
  hora: "immediate", mesa: "table", delivery: "delivery", nome: "name", senha: "password",
  table: "table", name: "name", immediate: "immediate", password: "password",
};
const ORIGIN_MAP: Record<string, string> = {
  caixa: "cashier", garcom: "waiter", mesa: "table", autoatendimento: "self_service", delivery: "delivery",
  cashier: "cashier", waiter: "waiter", table: "table", self_service: "self_service",
};
const STATUS_TO_DB: Record<string, string> = { novo: "new", preparo: "preparing", pronto: "ready", entregue: "delivered" };
const STATUS_RANK: Record<string, number> = { new: 0, preparing: 1, ready: 2, delivered: 3 };

const MASSA_UNITS = new Set(["kg", "g"]);
const VOLUME_UNITS = new Set(["l", "ml"]);
const UNIDADE_UNITS = new Set(["un", "unit", "units"]);

function normalizeUnitStr(u: string): string {
  const t = (u ?? "").toLowerCase().trim();
  if (t === "l") return "l";
  if (t === "grama" || t === "gramas" || t === "gram") return "g";
  if (t === "kilograma" || t === "kilogram" || t === "kilo") return "kg";
  if (t === "litro" || t === "litros" || t === "lt") return "l";
  if (t === "mililitro" || t === "mililitros") return "ml";
  if (t === "unidade" || t === "unidades") return "un";
  return t;
}

function convertUnitQty(qty: number, from: string, to: string): number {
  const f = normalizeUnitStr(from);
  const t = normalizeUnitStr(to);
  if (f === t) return qty;
  const isMassa = MASSA_UNITS.has(f) && MASSA_UNITS.has(t);
  const isVolume = VOLUME_UNITS.has(f) && VOLUME_UNITS.has(t);
  const isUnidade = UNIDADE_UNITS.has(f) && UNIDADE_UNITS.has(t);
  if (!isMassa && !isVolume && !isUnidade) return qty;
  if (isMassa) {
    let base = qty;
    if (f === "g") base = qty / 1000;
    if (t === "g") return base * 1000;
    return base;
  }
  if (isVolume) {
    let base = qty;
    if (f === "ml") base = qty / 1000;
    if (t === "ml") return base * 1000;
    return base;
  }
  return qty;
}

function calcLoyaltyTier(points: number): string {
  if (points >= 2000) return "vip";
  if (points >= 800) return "ouro";
  if (points >= 200) return "prata";
  return "bronze";
}

function deriveOrderStatus(items: { status: string; skip_kds: boolean }[]): string {
  if (items.length === 0) return "new";
  const kitchenItems = items.filter((i) => !i.skip_kds);
  const allItems = items;
  if (allItems.every((i) => i.status === "delivered")) return "delivered";
  if (kitchenItems.length === 0) {
    if (allItems.every((i) => i.status === "ready" || i.status === "delivered")) return "ready";
    return "new";
  }
  const kitchenStatuses = kitchenItems.map((i) => i.status);
  if (kitchenStatuses.every((s) => s === "ready" || s === "delivered")) return "ready";
  if (kitchenStatuses.some((s) => s === "preparing" || s === "ready")) return "preparing";
  return "new";
}

async function adminGetUser(supabaseUrl: string, serviceKey: string, userId: string): Promise<{ id: string; email?: string; user_metadata?: Record<string, unknown> } | null> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function timeToMinutes(t: string): number { const parts = t.split(":").map(Number); return (parts[0] ?? 0) * 60 + (parts[1] ?? 0); }
function nowTimeMinutes(): number { const now = new Date(); return now.getUTCHours() * 60 + now.getUTCMinutes(); }
function todayDayOfWeek(): number { return new Date().getUTCDay(); }
function todayDateStr(): string { return new Date().toISOString().split("T")[0]; }
function todayBrasiliaStr(): string {
  const now = new Date();
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return br.toISOString().split("T")[0];
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number, actionName: string, ctx?: Record<string, unknown>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) log("INFO", actionName, `Retry bem-sucedido na tentativa ${attempt}`, { ...ctx, attempt });
      return result;
    } catch (err) {
      lastErr = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      log("WARN", actionName, `Tentativa ${attempt}/${maxAttempts} falhou`, { ...ctx, attempt, error: errMsg });
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr;
}

interface OrderItemInput { item_id: string | null; category_id: string | null; quantity: number; unit_price: number; }
interface PromotionRuleRow {
  id: string; name: string; promo_type: string; target_item_id: string | null; target_category_id: string | null;
  free_item_id: string | null; discount_value: number | null; special_price: number | null; buy_quantity: number | null;
  get_quantity: number | null; min_order_amount: number | null; valid_from: string | null; valid_until: string | null;
  days_of_week: number[] | null; time_from: string | null; time_until: string | null; channels: Record<string, boolean>;
  max_uses_total: number | null; current_uses: number; coupon_code: string | null; priority: number; is_stackable: boolean;
}
interface AppliedPromotion {
  promotion_id: string; promotion_name: string; promo_type: string; discount_value: number;
  free_item_id?: string | null; free_item_quantity?: number; description: string;
}

function isRuleActiveNow(rule: PromotionRuleRow): boolean {
  const today = todayDateStr();
  if (rule.valid_from && today < rule.valid_from) return false;
  if (rule.valid_until && today > rule.valid_until) return false;
  if (rule.days_of_week && rule.days_of_week.length > 0 && !rule.days_of_week.includes(todayDayOfWeek())) return false;
  if (rule.time_from || rule.time_until) {
    const nowMin = nowTimeMinutes();
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

function applyPromotions(rules: PromotionRuleRow[], orderItems: OrderItemInput[], channel: string, orderTotal: number, couponCode: string | null): AppliedPromotion[] {
  const results: AppliedPromotion[] = [];
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  let nonStackableApplied = false;
  for (const rule of sorted) {
    if (nonStackableApplied && !rule.is_stackable) continue;
    if (!isRuleActiveNow(rule)) continue;
    if (!isRuleValidForChannel(rule, channel)) continue;
    if (rule.coupon_code && (!couponCode || couponCode.trim().toLowerCase() !== rule.coupon_code.trim().toLowerCase())) continue;
    if (rule.min_order_amount != null && orderTotal < rule.min_order_amount) continue;
    let discountAmount = 0; let freeItemId: string | null = null; let freeItemQty = 0; let description = "";
    switch (rule.promo_type) {
      case "item_percent": { if (!rule.target_item_id || rule.discount_value == null) continue; const mi = orderItems.filter((i) => i.item_id === rule.target_item_id); if (!mi.length) continue; discountAmount = mi.reduce((s, i) => s + i.unit_price * i.quantity, 0) * (rule.discount_value / 100); description = `${rule.discount_value}% off em item`; break; }
      case "item_fixed": { if (!rule.target_item_id || rule.discount_value == null) continue; const mi = orderItems.filter((i) => i.item_id === rule.target_item_id); if (!mi.length) continue; discountAmount = rule.discount_value * mi.reduce((s, i) => s + i.quantity, 0); description = `R$${rule.discount_value.toFixed(2)} off por unidade`; break; }
      case "category_percent": { if (!rule.target_category_id || rule.discount_value == null) continue; const mi = orderItems.filter((i) => i.category_id === rule.target_category_id); if (!mi.length) continue; discountAmount = mi.reduce((s, i) => s + i.unit_price * i.quantity, 0) * (rule.discount_value / 100); description = `${rule.discount_value}% off na categoria`; break; }
      case "order_percent": { if (rule.discount_value == null) continue; discountAmount = orderTotal * (rule.discount_value / 100); description = `${rule.discount_value}% off no pedido`; break; }
      case "order_fixed": { if (rule.discount_value == null) continue; discountAmount = Math.min(rule.discount_value, orderTotal); description = `R$${rule.discount_value.toFixed(2)} off no pedido`; break; }
      case "buy_x_get_y": { if (!rule.target_item_id || !rule.free_item_id || !rule.buy_quantity || !rule.get_quantity) continue; const mi = orderItems.filter((i) => i.item_id === rule.target_item_id); const tq = mi.reduce((s, i) => s + i.quantity, 0); if (tq < rule.buy_quantity) continue; const sets = Math.floor(tq / rule.buy_quantity); freeItemId = rule.free_item_id; freeItemQty = sets * rule.get_quantity; discountAmount = (mi[0]?.unit_price ?? 0) * freeItemQty; description = `Compre ${rule.buy_quantity} ganhe ${rule.get_quantity}`; break; }
      case "combo_price": { if (!rule.target_item_id || rule.special_price == null) continue; const mi = orderItems.filter((i) => i.item_id === rule.target_item_id); if (!mi.length) continue; const tq = mi.reduce((s, i) => s + i.quantity, 0); discountAmount = mi.reduce((s, i) => s + i.unit_price * i.quantity, 0) - rule.special_price * tq; if (discountAmount <= 0) continue; description = `Preco especial R$${rule.special_price.toFixed(2)}`; break; }
      case "free_item": { if (!rule.free_item_id) continue; freeItemId = rule.free_item_id; freeItemQty = 1; description = `Item gratis a partir de R$${(rule.min_order_amount ?? 0).toFixed(2)}`; break; }
      default: continue;
    }
    if (discountAmount < 0) discountAmount = 0;
    results.push({ promotion_id: rule.id, promotion_name: rule.name, promo_type: rule.promo_type, discount_value: Math.round(discountAmount * 100) / 100, free_item_id: freeItemId, free_item_quantity: freeItemQty > 0 ? freeItemQty : undefined, description });
    if (!rule.is_stackable) nonStackableApplied = true;
  }
  return results;
}

type IngRow = { ingredient_id: string; quantity: number; unit: string; ingredients: { unit: string } | null };
type OrderItemOption = { option_id?: string | null; option_name?: string; group_name?: string; additional_price?: number };

async function buildOptionDeductions(admin: ReturnType<typeof createClient>, tenantId: string, options: OrderItemOption[], baseQty: number): Promise<Array<{ ingredient_id: string; quantity: number; unit: string }>> {
  const deductions: Array<{ ingredient_id: string; quantity: number; unit: string }> = [];
  if (!options || options.length === 0) return deductions;
  const validOptionIds = options.map((o) => o.option_id).filter((id): id is string => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (validOptionIds.length === 0) return deductions;
  const { data: optRows } = await admin.from("options").select("id, ingredient_id, production_recipe_id, consumption_quantity").in("id", validOptionIds).eq("tenant_id", tenantId).not("ingredient_id", "is", null);
  const ingredientIds = [...new Set((optRows ?? []).map((r: Record<string, unknown>) => r.ingredient_id).filter((id): id is string => !!id))];
  let unitMap = new Map<string, string>();
  if (ingredientIds.length > 0) {
    const { data: ingRows } = await admin.from("ingredients").select("id, unit").in("id", ingredientIds).eq("tenant_id", tenantId);
    unitMap = new Map((ingRows ?? []).map((i: Record<string, unknown>) => [i.id as string, i.unit as string]));
  }
  for (const row of (optRows ?? []) as Array<{ id: string; ingredient_id: string | null; production_recipe_id: string | null; consumption_quantity: number | null; }>) {
    let ingredientId = row.ingredient_id;
    let consumptionQty = Number(row.consumption_quantity ?? 1);
    let stockUnit = unitMap.get(row.ingredient_id ?? "") ?? "unit";
    if (!ingredientId && row.production_recipe_id) {
      const { data: recipeRow } = await admin.from("production_recipes").select("output_ingredient_id, output_quantity, unit").eq("id", row.production_recipe_id).eq("tenant_id", tenantId).maybeSingle();
      if (recipeRow?.output_ingredient_id) { ingredientId = recipeRow.output_ingredient_id as string; consumptionQty = Number(row.consumption_quantity ?? (recipeRow.output_quantity as number) ?? 1); stockUnit = (recipeRow.unit as string) ?? "unit"; }
    }
    if (!ingredientId) continue;
    deductions.push({ ingredient_id: ingredientId, quantity: consumptionQty * baseQty, unit: stockUnit });
  }
  return deductions;
}

async function buildDeductions(admin: ReturnType<typeof createClient>, tenantId: string, itemId: string | null, comboId: string | null, baseQty: number, options?: OrderItemOption[]): Promise<Array<{ ingredient_id: string; quantity: number; unit: string }>> {
  const deductions: Array<{ ingredient_id: string; quantity: number; unit: string }> = [];
  if (itemId) {
    const { data: ingredients } = await admin.from("item_ingredients").select("ingredient_id, quantity, unit, ingredients!inner(unit)").eq("item_id", itemId).eq("tenant_id", tenantId);
    for (const ing of (ingredients ?? []) as IngRow[]) { const fichaQty = Number(ing.quantity ?? 0) * baseQty; const fichaUnit = ing.unit ?? "unit"; const stockUnit = ing.ingredients?.unit ?? "unit"; deductions.push({ ingredient_id: ing.ingredient_id, quantity: convertUnitQty(fichaQty, fichaUnit, stockUnit), unit: stockUnit }); }
  } else if (comboId) {
    const { data: comboIngredients } = await admin.from("combo_ingredients").select("ingredient_id, quantity, unit, ingredients!inner(unit)").eq("combo_id", comboId).eq("tenant_id", tenantId);
    if (comboIngredients && comboIngredients.length > 0) {
      for (const ing of comboIngredients as IngRow[]) { const fichaQty = Number(ing.quantity ?? 0) * baseQty; const fichaUnit = ing.unit ?? "unit"; const stockUnit = ing.ingredients?.unit ?? "unit"; deductions.push({ ingredient_id: ing.ingredient_id, quantity: convertUnitQty(fichaQty, fichaUnit, stockUnit), unit: stockUnit }); }
    } else {
      const { data: comboItems } = await admin.from("combo_items").select("item_id, quantity").eq("combo_id", comboId).eq("tenant_id", tenantId).is("deleted_at", null);
      for (const ci of (comboItems ?? [])) {
        if (!ci.item_id) continue;
        const { data: ingredients } = await admin.from("item_ingredients").select("ingredient_id, quantity, unit, ingredients!inner(unit)").eq("item_id", ci.item_id).eq("tenant_id", tenantId);
        for (const ing of (ingredients ?? []) as IngRow[]) { const fichaQty = Number(ing.quantity ?? 0) * (ci.quantity ?? 1) * baseQty; const fichaUnit = ing.unit ?? "unit"; const stockUnit = ing.ingredients?.unit ?? "unit"; deductions.push({ ingredient_id: ing.ingredient_id, quantity: convertUnitQty(fichaQty, fichaUnit, stockUnit), unit: stockUnit }); }
      }
    }
  }
  if (options && options.length > 0) { const optionDeductions = await buildOptionDeductions(admin, tenantId, options, baseQty); for (const od of optionDeductions) { deductions.push(od); } }
  return deductions;
}

async function resolveEmptyOptionNames(admin: ReturnType<typeof createClient>, tenantId: string, items: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const allOptionIds = new Set<string>();
  for (const item of items) { for (const o of (item.options ?? []) as Array<Record<string, unknown>>) { if (isValidUuid(o.option_id) && (!o.option_name || String(o.option_name).trim() === "")) { allOptionIds.add(o.option_id as string); } } }
  if (allOptionIds.size === 0) return items;
  const { data: optRows } = await admin.from("options").select("id, name, ingredient_id, production_recipe_id, ingredients(name), production_recipes(name)").eq("tenant_id", tenantId).in("id", Array.from(allOptionIds));
  const nameMap = new Map<string, string>();
  for (const row of (optRows ?? []) as Array<{ id: string; name: string | null; ingredient_id: string | null; production_recipe_id: string | null; ingredients: { name: string } | null; production_recipes: { name: string } | null; }>) {
    let resolved = row.name ? String(row.name).trim() : "";
    if (!resolved && row.ingredients?.name) resolved = String(row.ingredients.name).trim();
    if (!resolved && row.production_recipes?.name) resolved = String(row.production_recipes.name).trim();
    if (resolved) nameMap.set(row.id, resolved);
  }
  return items.map((item) => ({ ...item, options: (item.options ?? []).map((o: Record<string, unknown>) => ({ ...o, option_name: (o.option_name && String(o.option_name).trim() !== "") ? o.option_name : (nameMap.get(o.option_id as string) ?? o.option_name ?? ""), })), }));
}

async function deductStockForOrderItem(admin: ReturnType<typeof createClient>, tenantId: string, orderId: string, orderItemId: string, operatorId: string): Promise<void> {
  const { data: orderItem } = await admin.from("order_items").select("item_id, combo_id, quantity").eq("id", orderItemId).maybeSingle();
  if (!orderItem) return;
  const qty = orderItem.quantity ?? 1;
  const { data: optionRows } = await admin.from("order_item_options").select("option_id, option_name, group_name, additional_price").eq("order_item_id", orderItemId);
  const options: OrderItemOption[] = (optionRows ?? []).map((row) => ({ option_id: row.option_id as string | null, option_name: (row.option_name as string) ?? "", group_name: (row.group_name as string) ?? "", additional_price: (row.additional_price as number) ?? 0 }));
  const deductions = await buildDeductions(admin, tenantId, orderItem.item_id as string | null, orderItem.combo_id as string | null, qty, options);
  if (deductions.length === 0) return;
  const allMoves: Array<Record<string, unknown>> = [];
  const deltaMap = new Map<string, number>();
  for (const d of deductions) {
    const { data: existingMoves } = await admin.from("stock_movements").select("id").eq("order_id", orderId).eq("ingredient_id", d.ingredient_id).eq("type", "theoretical_out").limit(1);
    if (existingMoves && existingMoves.length > 0) { continue; }
    allMoves.push({ tenant_id: tenantId, ingredient_id: d.ingredient_id, type: "theoretical_out", quantity: d.quantity, unit: d.unit, reason: `item_sale:${orderItem.item_id ?? orderItem.combo_id}:${orderItemId}`, order_id: orderId, operator_id: operatorId });
    deltaMap.set(d.ingredient_id, (deltaMap.get(d.ingredient_id) ?? 0) - d.quantity);
  }
  if (allMoves.length === 0) return;
  await admin.from("stock_movements").insert(allMoves);
  for (const [ingredientId, delta] of deltaMap.entries()) { await admin.rpc("fn_update_ingredient_stock", { p_ingredient_id: ingredientId, p_tenant_id: tenantId, p_delta: delta }); }
}

async function restockForOrderItem(admin: ReturnType<typeof createClient>, tenantId: string, orderId: string, orderItemId: string, operatorId: string): Promise<void> {
  const { data: orderItem } = await admin.from("order_items").select("item_id, combo_id, quantity").eq("id", orderItemId).maybeSingle();
  if (!orderItem) return;
  const qty = orderItem.quantity ?? 1;
  const { data: optionRows } = await admin.from("order_item_options").select("option_id, option_name, group_name, additional_price").eq("order_item_id", orderItemId);
  const options: OrderItemOption[] = (optionRows ?? []).map((row) => ({ option_id: row.option_id as string | null, option_name: (row.option_name as string) ?? "", group_name: (row.group_name as string) ?? "", additional_price: (row.additional_price as number) ?? 0 }));
  const restocks = await buildDeductions(admin, tenantId, orderItem.item_id as string | null, orderItem.combo_id as string | null, qty, options);
  if (restocks.length === 0) return;
  const allMoves: Array<Record<string, unknown>> = [];
  const deltaMap = new Map<string, number>();
  for (const r of restocks) {
    allMoves.push({ tenant_id: tenantId, ingredient_id: r.ingredient_id, type: "in", quantity: r.quantity, unit: r.unit, reason: `Estorno pedido #${orderId.slice(0, 8)}`, order_id: orderId, operator_id: operatorId });
    deltaMap.set(r.ingredient_id, (deltaMap.get(r.ingredient_id) ?? 0) + r.quantity);
  }
  await admin.from("stock_movements").insert(allMoves);
  for (const [ingredientId, delta] of deltaMap.entries()) { await admin.rpc("fn_update_ingredient_stock", { p_ingredient_id: ingredientId, p_tenant_id: tenantId, p_delta: delta }); }
}

const isValidUuid = (v: unknown): boolean => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function checkOrderLock(admin: ReturnType<typeof createClient>, orderId: string, jwtUserId: string): Promise<Response | null> {
  const { data: orderLock } = await admin.from('orders').select('is_editing, editing_by_user_id').eq('id', orderId).maybeSingle();
  if (orderLock?.is_editing && orderLock?.editing_by_user_id && orderLock?.editing_by_user_id !== jwtUserId) {
    return new Response(JSON.stringify({ error: 'Pedido bloqueado para edição. Aguarde o PDV concluir.', code: 'order_locked' }), { status: 423, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  return null;
}

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!supabaseUrl) { return new Response(JSON.stringify({ error: "Server misconfiguration" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
  const db = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } });
  void db;
  if (!serviceRoleKey || serviceRoleKey.length < 40) { return new Response(JSON.stringify({ error: "Server misconfiguration" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let jwtUserId: string;
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) { return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) { return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    jwtUserId = user.id;
  } catch (authErr) { log("ERROR", "auth", "Excecao na autenticacao JWT", { error: String(authErr) }); return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

  try {
    const body = await req.json();
    const { action } = body;
    const requestedTenantId: string | null = body.tenant_id ?? body.active_tenant_id ?? null;
    const isKDSAction = action === "update_order_item_status" || action === "update_unit_status" || action === "update_order_item_part_status";
    if (action === "create_order" && !requestedTenantId) { return new Response(JSON.stringify({ error: "tenant_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    let tenantId: string;
    if (isKDSAction && requestedTenantId) {
      const { data: tenantCheck, error: tenantCheckErr } = await admin.from("user_tenants").select("tenant_id").eq("user_id", jwtUserId).eq("tenant_id", requestedTenantId).maybeSingle();
      if (tenantCheckErr) { return new Response(JSON.stringify({ error: "Tenant validation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      if (!tenantCheck) {
        const { data: tenantExists } = await admin.from("tenants").select("id").eq("id", requestedTenantId).maybeSingle();
        if (!tenantExists) { return new Response(JSON.stringify({ error: "Invalid tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
        tenantId = requestedTenantId;
      } else { tenantId = tenantCheck.tenant_id; }
    } else {
      const { data: tenantRows, error: tenantErr } = await admin.from("user_tenants").select("tenant_id").eq("user_id", jwtUserId);
      if (tenantErr) { return new Response(JSON.stringify({ error: `Tenant lookup failed: ${tenantErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      if (!tenantRows || tenantRows.length === 0) { return new Response(JSON.stringify({ error: "User does not belong to any tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      if (requestedTenantId) {
        const match = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
        if (!match) { return new Response(JSON.stringify({ error: "User does not belong to the requested tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
        tenantId = match.tenant_id;
      } else if (tenantRows.length === 1) { tenantId = tenantRows[0].tenant_id; }
      else { return new Response(JSON.stringify({ error: "Multiple tenants found — tenant_id required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    }
    const effectiveUserId: string = jwtUserId;
    async function ensureUserExists(userId: string): Promise<void> {
      const { data: existingUser } = await admin.from("users").select("id").eq("id", userId).maybeSingle();
      if (!existingUser) {
        try {
          const authUser = await adminGetUser(supabaseUrl, serviceRoleKey, userId);
          if (authUser) {
            const name = (authUser.user_metadata?.name as string) || (authUser.user_metadata?.full_name as string) || authUser.email?.split("@")[0] || "Operador";
            const email = authUser.email || `user_${userId}@erpos.local`;
            await admin.from("users").upsert({ id: userId, name, email, is_active: true }, { onConflict: "id", ignoreDuplicates: true });
          }
        } catch (authErr) { log("WARN", "ensureUserExists", "Falha ao criar usuario", { userId, error: String(authErr) }); }
      }
    }

    if (action === "register_partial_refund") {
      const { order_id, refund_amount, refund_method, pix_key, authorized_by, reason } = body;
      if (!order_id || refund_amount == null || !refund_method) {
        return new Response(JSON.stringify({ error: "order_id, refund_amount e refund_method sao obrigatorios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: orderCheck } = await admin.from("orders").select("id, tenant_id").eq("id", order_id).maybeSingle();
      if (!orderCheck) { return new Response(JSON.stringify({ error: "Pedido nao encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const orderTenantId = orderCheck.tenant_id as string;
      const { data: tenantMembership } = await admin.from("user_tenants").select("tenant_id").eq("user_id", jwtUserId).eq("tenant_id", orderTenantId).maybeSingle();
      if (!tenantMembership) { return new Response(JSON.stringify({ error: "Acesso negado a este pedido" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      await ensureUserExists(effectiveUserId);
      const now = new Date().toISOString();
      const { data: refundRecord, error: refundErr } = await admin.from("refunds").insert({
        tenant_id: orderTenantId,
        order_id,
        refund_amount,
        reason_type: "other",
        notes: reason ?? "Ajuste de quantidade apos pagamento",
        refund_method,
        restock_items: false,
        requested_by: effectiveUserId,
        status: "processed",
        method: refund_method,
        pix_key: pix_key ?? null,
        type: "partial",
        authorized_by: authorized_by ?? null,
        refunded_by: effectiveUserId,
        refunded_at: now,
        approved_by: authorized_by ?? null,
        approved_at: now,
        processed_at: now,
      }).select("id").maybeSingle();
      if (refundErr) throw new Error(`register_partial_refund insert: ${refundErr.message}`);
      try {
        await admin.from("fin_cash_flow").insert({
          tenant_id: orderTenantId, type: "expense", amount: refund_amount,
          description: `Reembolso parcial pedido #${order_id.slice(0, 8)} (${refund_method})`,
          category: "Reembolsos", origin: "manual", reference_id: refundRecord?.id ?? null, date: todayBrasiliaStr(),
        });
      } catch (flowErr) { log("WARN", "register_partial_refund", "fin_cash_flow insert falhou (non-blocking)", { error: String(flowErr) }); }
      try {
        await admin.from("audit_log").insert({
          tenant_id: orderTenantId, user_id: effectiveUserId, action_type: "partial_refund_registered",
          entity_type: "order", entity_id: order_id,
          details: { refund_id: refundRecord?.id ?? null, refund_amount, refund_method, pix_key: pix_key ?? null, authorized_by: authorized_by ?? null, reason: reason ?? null },
        });
      } catch (auditErr) { log("WARN", "register_partial_refund", "audit_log insert falhou (non-blocking)", { error: String(auditErr) }); }
      return new Response(JSON.stringify({ ok: true, refund_id: refundRecord?.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "retry_order_items") {
      const { order_id, items } = body;
      if (!order_id || !Array.isArray(items) || items.length === 0) { return new Response(JSON.stringify({ error: "order_id and items are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const { data: orderCheck } = await admin.from("orders").select("id, tenant_id, number").eq("id", order_id).maybeSingle();
      if (!orderCheck) { return new Response(JSON.stringify({ error: "Pedido nao encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const orderTenantId = orderCheck.tenant_id as string;
      const { data: tenantMembership } = await admin.from("user_tenants").select("tenant_id").eq("user_id", jwtUserId).eq("tenant_id", orderTenantId).maybeSingle();
      if (!tenantMembership) { return new Response(JSON.stringify({ error: "Acesso negado a este pedido" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const effectiveTenantId = orderTenantId;
      const { count: existingCount } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", order_id).eq("tenant_id", effectiveTenantId);
      if ((existingCount ?? 0) >= items.length) { return new Response(JSON.stringify({ ok: true, inserted: existingCount ?? 0, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const itemsWithResolvedNames = await resolveEmptyOptionNames(admin, effectiveTenantId, items);
      const resolvedItems: Array<Record<string, unknown>> = [];
      for (const item of itemsWithResolvedNames) {
        let resolvedItemId: string | null = null;
        if (isValidUuid(item.item_id)) resolvedItemId = item.item_id;
        else if (item.item_id && item.item_id !== "null" && item.item_id !== null) { const { data: foundItem } = await admin.from("menu_items").select("id").eq("tenant_id", effectiveTenantId).ilike("name", item.item_name).maybeSingle(); if (foundItem?.id) resolvedItemId = foundItem.id; }
        const resolvedStationId = isValidUuid(item.station_id) ? item.station_id : null;
        const normalizedOptions = (item.options ?? []).map((o: Record<string, unknown>) => ({ option_id: isValidUuid(o.option_id) ? o.option_id : null, option_name: o.option_name ?? "", group_name: o.group_name ?? "", additional_price: o.additional_price ?? 0 }));
        const normalizedObservations = (item.observations ?? []).filter((o: Record<string, unknown>) => o.text && String(o.text).trim() !== "");
        resolvedItems.push({ item_id: resolvedItemId, combo_id: isValidUuid(item.combo_id) ? item.combo_id : null, item_name: item.item_name, item_price: item.item_price, quantity: item.quantity ?? 1, station_id: resolvedStationId, skip_kds: item.skip_kds ?? false, notes: item.notes ?? null, options: normalizedOptions, observations: normalizedObservations });
      }
      try { const { error: insertErr } = await admin.rpc("fn_create_order_items_bypass", { p_order_id: order_id, p_tenant_id: effectiveTenantId, p_items: resolvedItems }); if (insertErr) throw insertErr; }
      catch (itemsErr) { return new Response(JSON.stringify({ ok: false, inserted: 0, error: String(itemsErr) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const { count: afterCount } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", order_id).eq("tenant_id", effectiveTenantId);
      const newlyInserted = (afterCount ?? 0) - (existingCount ?? 0);
      try { const { data: allItems } = await admin.from("order_items").select("status, skip_kds").eq("order_id", order_id).neq("status", "cancelled"); if (allItems && allItems.length > 0) { const correctStatus = deriveOrderStatus(allItems as { status: string; skip_kds: boolean }[]); await admin.from("orders").update({ status: correctStatus, updated_at: new Date().toISOString() }).eq("id", order_id); } } catch { /* non-blocking */ }
      return new Response(JSON.stringify({ ok: newlyInserted > 0, inserted: afterCount ?? 0, newly_inserted: newlyInserted }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "apply_promotions") {
      const { channel, order_items, order_total, coupon_code } = body;
      if (!channel || !Array.isArray(order_items)) return new Response(JSON.stringify({ error: "channel and order_items are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: rules, error: rulesErr } = await admin.from("promotion_rules").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("priority", { ascending: true });
      if (rulesErr) throw rulesErr;
      const promotions = applyPromotions((rules ?? []) as PromotionRuleRow[], order_items as OrderItemInput[], channel, order_total ?? 0, coupon_code ?? null);
      const totalDiscount = promotions.reduce((s, p) => s + p.discount_value, 0);
      return new Response(JSON.stringify({ promotions, total_discount: Math.round(totalDiscount * 100) / 100 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "list_promotion_rules") {
      const { is_active } = body;
      let query = admin.from("promotion_rules").select("*").eq("tenant_id", tenantId).order("priority", { ascending: true });
      if (is_active !== undefined) query = query.eq("is_active", is_active);
      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create_promotion_rule") {
      const { name, description, promo_type, target_item_id, target_category_id, free_item_id, discount_value, special_price, buy_quantity, get_quantity, min_order_amount, valid_from, valid_until, days_of_week, time_from, time_until, channels, max_uses_total, max_uses_per_customer, coupon_code, priority, is_stackable } = body;
      if (!name || !promo_type) return new Response(JSON.stringify({ error: "name and promo_type are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      await ensureUserExists(effectiveUserId);
      const defaultChannels = { cashier: true, waiter: true, delivery: true, self_service: true, table_qr: true };
      const { data, error } = await admin.from("promotion_rules").insert({ tenant_id: tenantId, name, description: description ?? null, promo_type, target_item_id: target_item_id ?? null, target_category_id: target_category_id ?? null, free_item_id: free_item_id ?? null, discount_value: discount_value ?? null, special_price: special_price ?? null, buy_quantity: buy_quantity ?? null, get_quantity: get_quantity ?? null, min_order_amount: min_order_amount ?? null, valid_from: valid_from ?? null, valid_until: valid_until ?? null, days_of_week: days_of_week ?? null, time_from: time_from ?? null, time_until: time_until ?? null, channels: channels ? { ...defaultChannels, ...channels } : defaultChannels, max_uses_total: max_uses_total ?? null, max_uses_per_customer: max_uses_per_customer ?? null, coupon_code: coupon_code ?? null, priority: priority ?? 100, is_stackable: is_stackable ?? false, created_by: effectiveUserId }).select().maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_promotion_rule") {
      const { promotion_id, ...updates } = body;
      if (!promotion_id) return new Response(JSON.stringify({ error: "promotion_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const safeUpdates = { ...updates };
      delete safeUpdates.action; delete safeUpdates.active_tenant_id; delete safeUpdates.tenant_id; delete safeUpdates.created_by; delete safeUpdates.current_uses;
      const { data, error } = await admin.from("promotion_rules").update(safeUpdates).eq("id", promotion_id).eq("tenant_id", tenantId).select().maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete_promotion_rule") {
      const { promotion_id } = body;
      if (!promotion_id) return new Response(JSON.stringify({ error: "promotion_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { error } = await admin.from("promotion_rules").update({ is_active: false }).eq("id", promotion_id).eq("tenant_id", tenantId);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "open_cash_register") {
      const { session_id, opening_value } = body;
      if (!session_id) return new Response(JSON.stringify({ error: "session_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: sessionCheck } = await admin.from("sessions").select("id, tenant_id").eq("id", session_id).eq("tenant_id", tenantId).maybeSingle();
      if (!sessionCheck) { return new Response(JSON.stringify({ error: "session_id invalido para este tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      await ensureUserExists(effectiveUserId);
      const { data, error } = await admin.from("cash_registers").insert({ session_id, tenant_id: tenantId, operator_id: effectiveUserId, opening_value: opening_value ?? 0, opening_method: "total", status: "open" }).select("id, opening_value, opened_at, operator_id").single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "close_cash_register") {
      const { cash_register_id, closing_value, closing_notes } = body;
      if (!cash_register_id) return new Response(JSON.stringify({ error: "cash_register_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: crCheck } = await admin.from("cash_registers").select("id, tenant_id, opening_value").eq("id", cash_register_id).eq("tenant_id", tenantId).maybeSingle();
      if (!crCheck) { return new Response(JSON.stringify({ error: "cash_register_id invalido para este tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      let closingExpected: number = Number(crCheck.opening_value ?? 0);
      try {
        const { data: movements } = await admin.from("cash_movements").select("type, amount").eq("cash_register_id", cash_register_id);
        const netMovements = (movements ?? []).reduce((sum: number, m: { type: string; amount: number }) => { return sum + (m.type === "in" ? Number(m.amount) : -Number(m.amount)); }, 0);
        const { data: cashPayments } = await admin.from("payments").select("amount, payment_methods(type)").eq("cash_register_id", cash_register_id).eq("is_refunded", false);
        const cashTotal = (cashPayments ?? []).reduce((sum: number, p: { amount: number; payment_methods: { type: string } | null }) => { if (p.payment_methods?.type === "cash") return sum + Number(p.amount); return sum; }, 0);
        closingExpected = Number(crCheck.opening_value ?? 0) + netMovements + cashTotal;
      } catch { /* non-blocking */ }
      const closingActual = closing_value ?? 0;
      const closingDiff = Math.round((closingActual - closingExpected) * 100) / 100;
      const updatePayload: Record<string, unknown> = { status: "closed", closing_value_actual: closingActual, closing_value_expected: Math.round(closingExpected * 100) / 100, closing_difference: closingDiff, closed_at: new Date().toISOString() };
      if (closing_notes != null && typeof closing_notes === "string" && closing_notes.trim().length > 0) { updatePayload.closing_notes = closing_notes.trim(); }
      const { error } = await admin.from("cash_registers").update(updatePayload).eq("id", cash_register_id).eq("tenant_id", tenantId);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, closing_expected: closingExpected, closing_difference: closingDiff }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "add_cash_movement") {
      const { cash_register_id, type, amount, reason } = body;
      if (cash_register_id) {
        const { data: crCheck } = await admin.from("cash_registers").select("id, tenant_id").eq("id", cash_register_id).eq("tenant_id", tenantId).maybeSingle();
        if (!crCheck) { return new Response(JSON.stringify({ error: "cash_register_id invalido para este tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      }
      if (effectiveUserId) await ensureUserExists(effectiveUserId);
      const normalizedType = (type === "withdrawal" || type === "out") ? "out" : "in";
      const isOutflow = normalizedType === "out";
      const { data, error } = await admin.from("cash_movements").insert({ cash_register_id, tenant_id: tenantId, type: normalizedType, amount, reason, operator_id: effectiveUserId }).select("id, type, amount, reason, created_at").single();
      if (error) throw error;
      try { await admin.from("fin_cash_flow").insert({ tenant_id: tenantId, type: isOutflow ? "expense" : "income", amount, description: reason || (isOutflow ? "Sangria" : "Suprimento"), category: isOutflow ? "Sangria" : "Suprimento", origin: isOutflow ? "auto_sangria" : "auto_suprimento", reference_id: data?.id, date: todayBrasiliaStr() }); } catch { /* non-blocking */ }
      return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create_order") {
      const { session_id, destination, destination_name, destination_phone, delivery_address, delivery_fee, origin, items, discount_amount, service_fee_amount, subtotal, total_amount, is_training, table_number, customer_name, customer_cpf, customer_email, table_session_id } = body;
      const deliveryPlatform: string | null = (body.delivery_platform as string) ?? null;
      if (!session_id) { return new Response(JSON.stringify({ error: "session_id is required — pedido bloqueado sem sessao ativa" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      if (!Array.isArray(items) || items.length === 0) { return new Response(JSON.stringify({ error: "items array is required and must not be empty" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      if (subtotal != null && total_amount != null) {
        const expectedTotal = (Number(subtotal ?? 0)) - (Number(discount_amount ?? 0)) + (Number(service_fee_amount ?? 0));
        const diff = Math.abs(expectedTotal - Number(total_amount));
        if (diff > 0.01) { return new Response(JSON.stringify({ error: `Inconsistencia financeira: subtotal(${subtotal}) - desconto(${discount_amount ?? 0}) + taxa(${service_fee_amount ?? 0}) = ${expectedTotal.toFixed(2)}, mas total_amount enviado = ${total_amount}. Diferenca: ${diff.toFixed(2)}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      }
      const { data: sessionRow, error: sessionErr } = await admin.from("sessions").select("id, tenant_id, status").eq("id", session_id).maybeSingle();
      if (sessionErr) { log("WARN", "create_order", "Erro ao validar session_id", { error: sessionErr.message }); }
      else if (!sessionRow) { return new Response(JSON.stringify({ error: "session_id invalido — sessao nao encontrada" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      else if (sessionRow.tenant_id !== tenantId) { return new Response(JSON.stringify({ error: "session_id nao pertence ao tenant informado" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      await ensureUserExists(effectiveUserId);
      let customerId: string | null = null;
      if (destination_phone && destination_name) {
        try { const { data: custData } = await admin.rpc("upsert_customer", { p_tenant_id: tenantId, p_name: destination_name, p_phone: destination_phone }); if (custData) { customerId = custData as string; } } catch { /* non-blocking */ }
      }
      const numData = await withRetry(async () => { const { data, error } = await admin.rpc("fn_next_order_number", { p_session_id: session_id, p_tenant_id: tenantId }); if (error) throw error; return data; }, 3, "create_order:fn_next_order_number", { session_id, tenant_id: tenantId });
      const orderNumber = numData?.[0]?.number ?? `P${Date.now()}`;
      const mappedOrigin = ORIGIN_MAP[origin] ?? "cashier";
      const mappedDest = DEST_MAP[destination] ?? "immediate";
      const allSkipKds = Array.isArray(items) && items.length > 0 && items.every((i: Record<string, unknown>) => i.skip_kds === true);
      const isDeliveryOrigin = mappedOrigin === "delivery";
      let initialOrderStatus = "new";
      if (isDeliveryOrigin && allSkipKds) { initialOrderStatus = "delivered"; } else if (allSkipKds) { initialOrderStatus = "ready"; }
      let finalDestinationName: string | null = null;
      let finalTableNumber: number | null = null;
      if (mappedDest === "table") {
        const rawName = customer_name ?? destination_name ?? null;
        const isMesaFormat = rawName && /^Mesa\s+\d+$/i.test(String(rawName).trim());
        finalDestinationName = isMesaFormat ? null : rawName;
        if (table_number != null && table_number !== "" && table_number !== "null") finalTableNumber = Number(table_number);
        else if (isMesaFormat) { const match = String(rawName).match(/\d+/); finalTableNumber = match ? Number(match[0]) : null; }
      } else { finalDestinationName = destination_name ?? null; finalTableNumber = null; }
      const resolvedTableSessionId = isValidUuid(table_session_id) ? table_session_id : null;
      const orderResult = await withRetry(async () => {
        const { data, error } = await admin.rpc("fn_create_order_bypass", { order_data: { tenant_id: tenantId, session_id, number: orderNumber, status: initialOrderStatus, origin_type: mappedOrigin, destination_type: mappedDest, destination_name: finalDestinationName, destination_phone: destination_phone ?? null, delivery_address: delivery_address ?? null, delivery_fee: delivery_fee ?? 0, discount_amount: discount_amount ?? 0, service_fee_amount: service_fee_amount ?? 0, subtotal: subtotal ?? 0, total_amount: total_amount ?? 0, is_training: is_training ?? false, is_draft: false, origin_user_id: effectiveUserId, customer_id: customerId ?? null, table_number: finalTableNumber, customer_cpf: customer_cpf ?? null, customer_email: customer_email ?? null, table_session_id: resolvedTableSessionId } });
        if (error) throw error;
        return data;
      }, 3, "create_order:fn_create_order_bypass", { session_id, tenant_id: tenantId, origin: mappedOrigin });
      const orderId: string = orderResult?.id;
      if (!orderId) { return new Response(JSON.stringify({ error: "Order created but no ID returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      if (deliveryPlatform) { try { await admin.from("orders").update({ delivery_platform: deliveryPlatform }).eq("id", orderId); } catch { /* non-blocking */ } }
      const itemsWithResolvedNames = await resolveEmptyOptionNames(admin, tenantId, items);
      const resolvedItems: Array<Record<string, unknown>> = [];
      for (const item of itemsWithResolvedNames) {
        let resolvedItemId: string | null = null;
        if (isValidUuid(item.item_id)) resolvedItemId = item.item_id;
        else if (item.item_id && item.item_id !== "null" && item.item_id !== null) { const { data: foundItem } = await admin.from("menu_items").select("id").eq("tenant_id", tenantId).ilike("name", item.item_name).maybeSingle(); if (foundItem?.id) resolvedItemId = foundItem.id; }
        const resolvedStationId = isValidUuid(item.station_id) ? item.station_id : null;
        const rawObservations = (item.observations ?? []).filter((o: Record<string, unknown>) => o.text && String(o.text).trim() !== "");
        const notesText = item.notes ? String(item.notes).trim() : "";
        const seenTexts = new Set<string>(rawObservations.map((o: Record<string, unknown>) => String(o.text).trim()));
        const normalizedObservations: Array<Record<string, unknown>> = [...rawObservations];
        if (notesText && !seenTexts.has(notesText)) { normalizedObservations.push({ text: notesText, is_checked: false }); }
        resolvedItems.push({ item_id: resolvedItemId, combo_id: isValidUuid(item.combo_id) ? item.combo_id : null, item_name: item.item_name, item_price: item.item_price, quantity: item.quantity ?? 1, station_id: resolvedStationId, skip_kds: item.skip_kds ?? false, notes: item.notes ?? null, options: (item.options ?? []).map((o: Record<string, unknown>) => ({ option_id: isValidUuid(o.option_id) ? o.option_id : null, option_name: o.option_name ?? "", group_name: o.group_name ?? "", additional_price: o.additional_price ?? 0 })), observations: normalizedObservations });
      }
      if (resolvedItems.length > 0) {
        let itemsInsertedOk = false;
        try {
          await withRetry(async () => { const { error } = await admin.rpc("fn_create_order_items_bypass", { p_order_id: orderId, p_tenant_id: tenantId, p_items: resolvedItems }); if (error) throw error; }, 3, "create_order:fn_create_order_items_bypass", { order_id: orderId, tenant_id: tenantId, item_count: resolvedItems.length });
          itemsInsertedOk = true;
        } catch (itemsErr) {
          try { const { count: countAfterErr } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", orderId).eq("tenant_id", tenantId); if ((countAfterErr ?? 0) > 0) { itemsInsertedOk = true; } } catch { /* ignore */ }
        }
        if (!itemsInsertedOk) {
          let finalCount = 0;
          try { const { count } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", orderId).eq("tenant_id", tenantId); finalCount = count ?? 0; } catch { /* ignore */ }
          if (finalCount === 0) {
            try { await admin.from("orders").update({ status: "cancelled", cancel_reason: "Auto-cancelado: falha critica ao inserir itens", cancelled_at: new Date().toISOString(), cancelled_by: effectiveUserId }).eq("id", orderId); } catch { /* ignore */ }
            return new Response(JSON.stringify({ error: `Pedido ${orderNumber}: falha ao inserir itens apos 3 tentativas. Tente novamente.`, partial: false, cancelled: true }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          } else { itemsInsertedOk = true; }
        }
        if (itemsInsertedOk) {
          try {
            const nowTs = new Date().toISOString();
            await admin.from("orders").update({ status: initialOrderStatus, updated_at: nowTs }).eq("id", orderId);
            const skipKdsUpdate: Record<string, unknown> = { status: isDeliveryOrigin ? "delivered" : "ready" };
            if (!isDeliveryOrigin) { skipKdsUpdate.ready_at = nowTs; skipKdsUpdate.started_preparing_at = nowTs; } else { skipKdsUpdate.delivered_at = nowTs; skipKdsUpdate.ready_at = nowTs; skipKdsUpdate.started_preparing_at = nowTs; }
            await admin.from("order_items").update(skipKdsUpdate).eq("order_id", orderId).eq("tenant_id", tenantId).eq("skip_kds", true).neq("status", "cancelled");
            try {
              const { data: skipKdsItems } = await admin.from("order_items").select("id, quantity, tenant_id, station_id").eq("order_id", orderId).eq("tenant_id", tenantId).eq("skip_kds", true).neq("status", "cancelled");
              for (const item of (skipKdsItems ?? [])) {
                const qty = item.quantity ?? 1;
                const unitStatus = isDeliveryOrigin ? "delivered" : "ready";
                const unitInserts = Array.from({ length: qty }, (_, i) => ({ order_item_id: item.id, tenant_id: item.tenant_id ?? tenantId, unit_number: i + 1, station_id: item.station_id ?? null, operator_id: effectiveUserId, status: unitStatus, entered_kds_at: nowTs, started_preparing_at: nowTs, ready_at: nowTs, delivered_at: isDeliveryOrigin ? nowTs : null }));
                await admin.from("order_item_units").upsert(unitInserts, { onConflict: "order_item_id,unit_number", ignoreDuplicates: false });
              }
            } catch { /* non-blocking */ }
          } catch { /* non-blocking */ }
        }
        for (const item of resolvedItems) {
          if (item.skip_kds) {
            try {
              const { data: createdItems } = await admin.from("order_items").select("id").eq("order_id", orderId).eq("tenant_id", tenantId).eq("item_name", item.item_name).neq("status", "cancelled");
              if (createdItems && createdItems.length > 0) { for (const ci of createdItems) { await deductStockForOrderItem(admin, tenantId, orderId, ci.id, effectiveUserId); } }
            } catch { /* non-blocking */ }
          }
        }
      }
      return new Response(JSON.stringify({ data: { id: orderId, number: orderNumber } }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "mark_order_paid") {
      const { order_id } = body;
      if (!order_id) return new Response(JSON.stringify({ error: "order_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: orderCheck } = await admin.from("orders").select("id, tenant_id").eq("id", order_id).maybeSingle();
      if (!orderCheck) return new Response(JSON.stringify({ error: "Pedido nao encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const orderTenantId = orderCheck.tenant_id as string;
      const { data: paidTenantMembership } = await admin.from("user_tenants").select("tenant_id").eq("user_id", jwtUserId).eq("tenant_id", orderTenantId).maybeSingle();
      if (!paidTenantMembership) return new Response(JSON.stringify({ error: "Acesso negado" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const nowMark = new Date().toISOString();
      await admin.from("orders").update({ is_paid: true, paid_at: nowMark, updated_at: nowMark }).eq("id", order_id);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "apply_discount") {
      const { order_id, discount_type, discount_value, original_percent, coupon_code, promotion_id, requires_approval, approved_by, approved_at, approval_notes, reason, new_discount_amount, new_total_amount } = body;
      if (!order_id || !discount_type || discount_value == null) return new Response(JSON.stringify({ error: "order_id, discount_type e discount_value sao obrigatorios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (requires_approval && !approved_by) { return new Response(JSON.stringify({ error: "approved_by e obrigatorio quando requires_approval=true" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const { data: orderCheck } = await admin.from("orders").select("id, tenant_id").eq("id", order_id).maybeSingle();
      if (!orderCheck) { return new Response(JSON.stringify({ error: "Pedido nao encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const orderTenantCheck = orderCheck.tenant_id as string;
      const { data: discountTenantMembership } = await admin.from("user_tenants").select("tenant_id").eq("user_id", jwtUserId).eq("tenant_id", orderTenantCheck).maybeSingle();
      if (!discountTenantMembership) { return new Response(JSON.stringify({ error: "Acesso negado a este pedido" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const effectiveDiscountTenant = orderTenantCheck;
      await ensureUserExists(effectiveUserId);
      const DISCOUNT_TYPE_MAP: Record<string, string> = { fixed: "manual_value", percent: "manual_percent", manual: "manual_value" };
      const normalizedDiscountType = DISCOUNT_TYPE_MAP[discount_type] ?? discount_type;
      const { data: discountRecord, error: discountErr } = await admin.from("order_discounts").insert({ tenant_id: effectiveDiscountTenant, order_id, discount_type: normalizedDiscountType, discount_value, original_percent: original_percent ?? null, coupon_code: coupon_code ?? null, promotion_id: promotion_id ?? null, requires_approval: requires_approval ?? false, approved_by: approved_by ?? null, approved_at: approved_at ?? null, approval_notes: approval_notes ?? null, applied_by: effectiveUserId, reason: reason ?? null }).select("id").maybeSingle();
      if (discountErr) throw new Error(`apply_discount insert: ${discountErr.message}`);
      if (new_discount_amount != null) {
        const updatePayload: Record<string, unknown> = { discount_amount: new_discount_amount, updated_at: new Date().toISOString() };
        if (new_total_amount != null) updatePayload.total_amount = new_total_amount;
        if (approved_by) updatePayload.discount_authorized_by = approved_by;
        const { error: orderUpdateErr } = await admin.from("orders").update(updatePayload).eq("id", order_id);
        if (orderUpdateErr) throw new Error(`apply_discount order update: ${orderUpdateErr.message}`);
      }
      try { await admin.from("audit_log").insert({ tenant_id: effectiveDiscountTenant, user_id: effectiveUserId, action_type: "discount_applied", entity_type: "order", entity_id: order_id, details: { discount_id: discountRecord?.id ?? null, discount_type: normalizedDiscountType, discount_value, original_percent: original_percent ?? null, requires_approval: requires_approval ?? false, approved_by: approved_by ?? null, reason: reason ?? null, new_discount_amount: new_discount_amount ?? null, new_total_amount: new_total_amount ?? null } }); } catch { /* non-blocking */ }
      return new Response(JSON.stringify({ success: true, data: { id: discountRecord?.id } }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "deduct_combo_stock") {
      const { order_item_id, order_id } = body;
      if (!order_item_id || !order_id) return new Response(JSON.stringify({ error: "order_item_id e order_id sao obrigatorios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: orderCheck } = await admin.from("orders").select("id").eq("id", order_id).eq("tenant_id", tenantId).maybeSingle();
      if (!orderCheck) return new Response(JSON.stringify({ error: "order_id invalido para este tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      try { await deductStockForOrderItem(admin, tenantId, order_id, order_item_id, effectiveUserId); return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      catch (err) { return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    }

    if (action === "update_order_item_part_status") {
      const { order_item_part_id, order_item_id, order_id, new_status } = body;
      if (!order_item_part_id || !order_item_id || !order_id || !new_status) { return new Response(JSON.stringify({ error: "order_item_part_id, order_item_id, order_id e new_status sao obrigatorios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const lockResponse = await checkOrderLock(admin, order_id, jwtUserId);
      if (lockResponse) return lockResponse;
      const now = new Date().toISOString();
      const dbStatus = STATUS_TO_DB[new_status] ?? new_status;
      const updates: Record<string, unknown> = { status: dbStatus, updated_at: now };
      if (dbStatus === "preparing") updates.started_preparing_at = now;
      if (dbStatus === "ready") updates.ready_at = now;
      if (dbStatus === "delivered") { updates.delivered_at = now; updates.operator_id = effectiveUserId; }
      const { error: partErr } = await admin.from("order_item_parts").update(updates).eq("id", order_item_part_id).eq("order_item_id", order_item_id);
      if (partErr) throw partErr;
      const { data: allParts } = await admin.from("order_item_parts").select("status").eq("order_item_id", order_item_id);
      const allReady = allParts?.every((p: { status: string }) => p.status === "ready" || p.status === "delivered");
      const anyPreparing = allParts?.some((p: { status: string }) => p.status === "preparing" || p.status === "ready");
      const newItemStatus = allReady ? "ready" : anyPreparing ? "preparing" : "new";
      await admin.from("order_items").update({ status: newItemStatus, updated_at: now }).eq("id", order_item_id);
      const { data: allItems, error: allErr } = await admin.from("order_items").select("status, skip_kds").eq("order_id", order_id).neq("status", "cancelled");
      if (!allErr && allItems) { const newOrderStatus = deriveOrderStatus(allItems as { status: string; skip_kds: boolean }[]); await admin.from("orders").update({ status: newOrderStatus, updated_at: now }).eq("id", order_id); }
      return new Response(JSON.stringify({ ok: true, new_item_status: newItemStatus }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_order_item_status") {
      const { order_item_id, order_id, status } = body;
      if (!order_item_id || !order_id || !status) return new Response(JSON.stringify({ error: "order_item_id, order_id and status are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const lockResponse = await checkOrderLock(admin, order_id, jwtUserId);
      if (lockResponse) return lockResponse;
      const dbStatus = STATUS_TO_DB[status] ?? status;
      const now = new Date().toISOString();
      const { data: currentItem } = await admin.from("order_items").select("started_preparing_at, ready_at, entered_kds_at").eq("id", order_item_id).maybeSingle();
      const timestamps: Record<string, string> = {};
      if (dbStatus === "preparing") { timestamps.started_preparing_at = now; }
      if (dbStatus === "ready") { timestamps.ready_at = now; if (!currentItem?.started_preparing_at) { timestamps.started_preparing_at = currentItem?.entered_kds_at ?? now; } }
      if (dbStatus === "delivered") { timestamps.delivered_at = now; timestamps.delivered_by_user_id = effectiveUserId; if (!currentItem?.ready_at) { timestamps.ready_at = now; } if (!currentItem?.started_preparing_at) { timestamps.started_preparing_at = currentItem?.entered_kds_at ?? now; } }
      const { error: itemErr } = await admin.from("order_items").update({ status: dbStatus, operator_id: effectiveUserId, ...timestamps }).eq("id", order_item_id);
      if (itemErr) throw itemErr;
      if (dbStatus === "ready" || dbStatus === "delivered") { deductStockForOrderItem(admin, tenantId, order_id, order_item_id, effectiveUserId).catch(() => {}); }
      try {
        const { data: existingUnits } = await admin.from("order_item_units").select("id, status").eq("order_item_id", order_item_id);
        const newRank = STATUS_RANK[dbStatus] ?? 0;
        const unitUpdate: Record<string, unknown> = { status: dbStatus };
        if (dbStatus === "preparing") unitUpdate.started_preparing_at = now;
        if (dbStatus === "ready") unitUpdate.ready_at = now;
        if (dbStatus === "delivered") { unitUpdate.delivered_at = now; unitUpdate.delivered_by_user_id = effectiveUserId; }
        if (existingUnits && existingUnits.length > 0) {
          const unitsToUpdate = existingUnits.filter((u: { id: string; status: string }) => (STATUS_RANK[u.status] ?? 0) < newRank).map((u: { id: string }) => u.id);
          if (unitsToUpdate.length > 0) await admin.from("order_item_units").update(unitUpdate).in("id", unitsToUpdate);
        } else {
          const { data: itemData } = await admin.from("order_items").select("quantity, tenant_id, station_id").eq("id", order_item_id).maybeSingle();
          if (itemData && itemData.quantity >= 1) {
            const unitInserts = Array.from({ length: itemData.quantity }, (_, i) => { const base = { order_item_id, tenant_id: itemData.tenant_id ?? tenantId, unit_number: i + 1, station_id: itemData.station_id ?? null, operator_id: effectiveUserId, status: dbStatus, entered_kds_at: now }; if (dbStatus === "preparing") return { ...base, started_preparing_at: now }; if (dbStatus === "ready") return { ...base, started_preparing_at: now, ready_at: now }; if (dbStatus === "delivered") return { ...base, started_preparing_at: now, ready_at: now, delivered_at: now, delivered_by_user_id: effectiveUserId }; return base; });
            await admin.from("order_item_units").upsert(unitInserts, { onConflict: "order_item_id,unit_number", ignoreDuplicates: false });
          }
        }
      } catch { /* non-blocking */ }
      const { data: allItems, error: allErr } = await admin.from("order_items").select("status, skip_kds").eq("order_id", order_id).neq("status", "cancelled");
      if (!allErr && allItems) { const newOrderStatus = deriveOrderStatus(allItems as { status: string; skip_kds: boolean }[]); await admin.from("orders").update({ status: newOrderStatus, updated_at: now }).eq("id", order_id); }
      if (dbStatus === "delivered") { try { const { data: orderData } = await admin.from("orders").select("customer_id, total_amount").eq("id", order_id).maybeSingle(); if (orderData?.customer_id) await admin.rpc("fn_update_customer_spent", { p_customer_id: orderData.customer_id, p_amount: orderData.total_amount ?? 0 }).catch(() => {}); } catch { /* non-fatal */ } }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_unit_status") {
      const { order_item_id, order_id, unit_number, status } = body;
      if (!order_item_id || !order_id || unit_number == null || !status) return new Response(JSON.stringify({ error: "order_item_id, order_id, unit_number and status are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const lockResponse = await checkOrderLock(admin, order_id, jwtUserId);
      if (lockResponse) return lockResponse;
      const dbStatus = STATUS_TO_DB[status] ?? status;
      const now = new Date().toISOString();
      const { data: unitRow } = await admin.from("order_item_units").select("id, status").eq("order_item_id", order_item_id).eq("unit_number", unit_number).maybeSingle();
      const unitUpdate: Record<string, unknown> = { status: dbStatus };
      if (dbStatus === "preparing") unitUpdate.started_preparing_at = now;
      if (dbStatus === "ready") unitUpdate.ready_at = now;
      if (dbStatus === "delivered") { unitUpdate.delivered_at = now; unitUpdate.delivered_by_user_id = effectiveUserId; }
      if (unitRow?.id) {
        const currentRank = STATUS_RANK[unitRow.status] ?? 0;
        const newRank = STATUS_RANK[dbStatus] ?? 0;
        if (newRank > currentRank) { const { error: unitUpdateErr } = await admin.from("order_item_units").update(unitUpdate).eq("id", unitRow.id); if (unitUpdateErr) throw unitUpdateErr; }
      } else {
        const { data: itemRow } = await admin.from("order_items").select("tenant_id, station_id").eq("id", order_item_id).maybeSingle();
        await admin.from("order_item_units").insert({ order_item_id, tenant_id: itemRow?.tenant_id ?? tenantId, unit_number, station_id: itemRow?.station_id ?? null, operator_id: effectiveUserId, entered_kds_at: now, ...unitUpdate });
      }
      const { data: allUnits } = await admin.from("order_item_units").select("status").eq("order_item_id", order_item_id);
      const { data: itemData } = await admin.from("order_items").select("quantity, status, skip_kds").eq("id", order_item_id).maybeSingle();
      const itemQty = itemData?.quantity ?? 1;
      const allUnitsDelivered = allUnits && allUnits.length >= itemQty && allUnits.every((u: { status: string }) => u.status === "delivered");
      const allUnitsReady = allUnits && allUnits.length >= itemQty && allUnits.every((u: { status: string }) => u.status === "ready" || u.status === "delivered");
      let newItemStatus = itemData?.status ?? "new";
      if (allUnitsDelivered) { newItemStatus = "delivered"; deductStockForOrderItem(admin, tenantId, order_id, order_item_id, effectiveUserId).catch(() => {}); }
      else if (allUnitsReady && newItemStatus !== "ready" && newItemStatus !== "delivered") { newItemStatus = "ready"; deductStockForOrderItem(admin, tenantId, order_id, order_item_id, effectiveUserId).catch(() => {}); }
      else if (allUnits && allUnits.length > 0) {
        const unitStatuses = allUnits.map((u: { status: string }) => u.status);
        if (unitStatuses.every((s: string) => s === "ready" || s === "delivered")) newItemStatus = "ready";
        else if (unitStatuses.some((s: string) => s === "preparing" || s === "ready")) newItemStatus = "preparing";
        else newItemStatus = "new";
      } else if (dbStatus === "preparing" && newItemStatus === "new") newItemStatus = "preparing";
      if (newItemStatus !== itemData?.status) { const itemTimestamps: Record<string, string> = {}; if (newItemStatus === "preparing") itemTimestamps.started_preparing_at = now; if (newItemStatus === "ready") itemTimestamps.ready_at = now; if (newItemStatus === "delivered") { itemTimestamps.delivered_at = now; itemTimestamps.delivered_by_user_id = effectiveUserId; } await admin.from("order_items").update({ status: newItemStatus, operator_id: effectiveUserId, ...itemTimestamps }).eq("id", order_item_id); }
      const { data: allItems2, error: allErr2 } = await admin.from("order_items").select("status, skip_kds").eq("order_id", order_id).neq("status", "cancelled");
      if (!allErr2 && allItems2) { const newOrderStatus = deriveOrderStatus(allItems2 as { status: string; skip_kds: boolean }[]); await admin.from("orders").update({ status: newOrderStatus, updated_at: now }).eq("id", order_id); }
      return new Response(JSON.stringify({ ok: true, unit_number, status: dbStatus, delivered_by: effectiveUserId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "cancel_order") {
      const { order_id, reason, reason_type, notes, refund_amount, refund_method, restock_items } = body;
      const now = new Date().toISOString();
      if (!order_id) return new Response(JSON.stringify({ error: "order_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: orderCheck } = await admin.from("orders").select("id, tenant_id").eq("id", order_id).eq("tenant_id", tenantId).maybeSingle();
      if (!orderCheck) { return new Response(JSON.stringify({ error: "order_id invalido para este tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const { error } = await admin.from("orders").update({ status: "cancelled", cancel_reason: reason ?? notes ?? null, cancelled_by: effectiveUserId, cancelled_at: now }).eq("id", order_id).eq("tenant_id", tenantId);
      if (error) throw error;
      await admin.from("order_items").update({ status: "cancelled" }).eq("order_id", order_id).in("status", ["new", "preparing", "ready"]);
      if (reason_type && refund_amount != null && refund_method) {
        try {
          await ensureUserExists(effectiveUserId);
          const { data: payment } = await admin.from("payments").select("id, amount").eq("order_id", order_id).eq("tenant_id", tenantId).eq("is_refunded", false).maybeSingle();
          const { data: refundRecord, error: refundErr } = await admin.from("refunds").insert({ tenant_id: tenantId, order_id, payment_id: payment?.id ?? null, refund_amount, reason_type, notes: notes ?? null, refund_method, restock_items: restock_items ?? false, requested_by: effectiveUserId, status: "pending" }).select("id").maybeSingle();
          if (refundErr) throw new Error(`refund insert: ${refundErr.message}`);
          if (restock_items) {
            try { const { data: orderItems } = await admin.from("order_items").select("id, item_id, combo_id, quantity").eq("order_id", order_id).eq("tenant_id", tenantId); if (orderItems && orderItems.length > 0) for (const oi of orderItems) await restockForOrderItem(admin, tenantId, order_id, oi.id, effectiveUserId); } catch { /* non-blocking */ }
          }
          try { await admin.from("audit_log").insert({ tenant_id: tenantId, user_id: effectiveUserId, action_type: "order_refunded", entity_type: "order", entity_id: order_id, details: { refund_id: refundRecord?.id ?? null, reason_type, refund_amount, refund_method, restock_items: restock_items ?? false, payment_id: payment?.id ?? null } }); } catch { /* non-blocking */ }
        } catch { /* non-blocking */ }
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "process_refund") {
      const { refund_id, approve, rejection_reason } = body;
      if (!refund_id) return new Response(JSON.stringify({ error: "refund_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      await ensureUserExists(effectiveUserId);
      const now = new Date().toISOString();
      const { data: refund, error: fetchErr } = await admin.from("refunds").select("id, tenant_id, order_id, payment_id, refund_amount, refund_method, status, reason_type").eq("id", refund_id).eq("tenant_id", tenantId).maybeSingle();
      if (fetchErr || !refund) return new Response(JSON.stringify({ error: "Refund not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (refund.status === "processed" || refund.status === "rejected") return new Response(JSON.stringify({ error: `Refund already ${refund.status}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!approve) { const { error: rejectErr } = await admin.from("refunds").update({ status: "rejected", approved_by: effectiveUserId, approved_at: now, notes: rejection_reason ?? null }).eq("id", refund_id).eq("tenant_id", tenantId); if (rejectErr) throw rejectErr; return new Response(JSON.stringify({ ok: true, status: "rejected" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const { error: approveErr } = await admin.from("refunds").update({ status: "processed", approved_by: effectiveUserId, approved_at: now, processed_at: now }).eq("id", refund_id).eq("tenant_id", tenantId);
      if (approveErr) throw approveErr;
      if (refund.payment_id) await admin.from("payments").update({ is_refunded: true }).eq("id", refund.payment_id).catch(() => {});
      try { await admin.from("fin_cash_flow").insert({ tenant_id: tenantId, type: "expense", amount: refund.refund_amount, description: `Estorno pedido #${refund.order_id.slice(0, 8)} (${refund.refund_method})`, category: "Estornos", origin: "manual", reference_id: refund_id, date: todayBrasiliaStr() }); } catch { /* non-blocking */ }
      try { await admin.from("audit_log").insert({ tenant_id: tenantId, user_id: effectiveUserId, action_type: "refund_processed", entity_type: "refund", entity_id: refund_id, details: { order_id: refund.order_id, refund_amount: refund.refund_amount, refund_method: refund.refund_method, approved_by: effectiveUserId } }); } catch { /* non-blocking */ }
      return new Response(JSON.stringify({ ok: true, status: "processed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "record_payment") {
      const { order_id, cash_register_id, payment_method_id, amount, change_amount, operator_name, paid_by_pdv, payment_group_id } = body;
      if (!payment_method_id) { return new Response(JSON.stringify({ data: null, skipped: true, reason: "missing_payment_method_id" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      let orderTotalAmount = 0;
      if (order_id) {
        const { data: orderCheck } = await admin.from("orders").select("id, tenant_id, status, total_amount").eq("id", order_id).maybeSingle();
        if (orderCheck) {
          const orderTenantId = orderCheck.tenant_id as string;
          const { data: paymentTenantMembership } = await admin.from("user_tenants").select("tenant_id").eq("user_id", jwtUserId).eq("tenant_id", orderTenantId).maybeSingle();
          if (!paymentTenantMembership) { return new Response(JSON.stringify({ error: "Acesso negado a este pedido" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
          if (orderCheck.status === "cancelled") { return new Response(JSON.stringify({ error: "Nao e possivel registrar pagamento em pedido cancelado", skipped: true }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
          orderTotalAmount = Number(orderCheck.total_amount ?? 0);
        }
      }
      const paymentTenantId = tenantId;
      let effectiveCashRegisterId = cash_register_id ?? null;
      if (!effectiveCashRegisterId && order_id) {
        try { const { data: orderRow } = await admin.from("orders").select("session_id").eq("id", order_id).maybeSingle(); if (orderRow?.session_id) { const { data: crRow } = await admin.from("cash_registers").select("id").eq("session_id", orderRow.session_id).eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle(); effectiveCashRegisterId = crRow?.id ?? null; } } catch { /* non-blocking */ }
      }
      const { data: paymentId, error: payErr } = await admin.rpc("fn_record_payment_bypass", { p_order_id: order_id, p_tenant_id: paymentTenantId, p_cash_register_id: effectiveCashRegisterId, p_payment_method_id: payment_method_id, p_amount: amount, p_change_amount: change_amount ?? 0, p_operator_name: operator_name ?? null, p_origin_type: paid_by_pdv ?? null, p_payment_group_id: payment_group_id ?? null });
      if (payErr) throw payErr;
      if (order_id) {
        try {
          const { data: allPayments } = await admin.from("payments").select("amount").eq("order_id", order_id).eq("is_refunded", false);
          const totalPaid = (allPayments ?? []).reduce((sum: number, p: { amount: number }) => sum + Number(p.amount), 0) + Number(amount);
          if (orderTotalAmount > 0 && totalPaid >= orderTotalAmount) {
            const paidAt = new Date().toISOString();
            const orderUpdate: Record<string, unknown> = { is_paid: true, paid_at: paidAt, updated_at: paidAt };
            if (paid_by_pdv) orderUpdate.paid_by_pdv = paid_by_pdv;
            await admin.from("orders").update(orderUpdate).eq("id", order_id);
          } else if (orderTotalAmount === 0) {
            const paidAt = new Date().toISOString();
            const orderUpdate: Record<string, unknown> = { is_paid: true, paid_at: paidAt, updated_at: paidAt };
            if (paid_by_pdv) orderUpdate.paid_by_pdv = paid_by_pdv;
            await admin.from("orders").update(orderUpdate).eq("id", order_id);
          }
        } catch { /* non-blocking */ }
      }
      try {
        const { data: orderData } = await admin.from("orders").select("customer_id, total_amount, number").eq("id", order_id).maybeSingle();
        if (orderData?.customer_id) {
          const customerId = orderData.customer_id as string; const orderAmount = Number(orderData.total_amount ?? 0);
          const { data: customerData } = await admin.from("customers").select("total_spent, visit_count, loyalty_points").eq("id", customerId).maybeSingle();
          const prevSpent = Number(customerData?.total_spent ?? 0); const prevVisits = Number(customerData?.visit_count ?? 0); const prevPoints = Number(customerData?.loyalty_points ?? 0);
          const newSpent = prevSpent + orderAmount; const newVisits = prevVisits + 1; const newAvgTicket = newVisits > 0 ? newSpent / newVisits : orderAmount;
          const pointsEarned = Math.floor(orderAmount); const newPoints = prevPoints + pointsEarned; const newTier = calcLoyaltyTier(newPoints);
          await admin.from("customers").update({ total_spent: newSpent, visit_count: newVisits, average_ticket: newAvgTicket, last_visit_at: new Date().toISOString(), loyalty_points: newPoints, loyalty_tier: newTier }).eq("id", customerId);
          if (pointsEarned > 0) await admin.from("loyalty_transactions").insert({ tenant_id: paymentTenantId, customer_id: customerId, transaction_type: "earned", points: pointsEarned, balance_after: newPoints, order_id, notes: `Compra #${orderData.number ?? order_id.slice(0, 8)}`, created_by: effectiveUserId }).catch(() => {});
        }
      } catch { /* non-blocking */ }
      try {
        const { data: orderData2 } = await admin.from("orders").select("number").eq("id", order_id).maybeSingle();
        const { data: pmData } = await admin.from("payment_methods").select("days_to_receive, name, type, fee_percentage").eq("id", payment_method_id).maybeSingle();
        const daysToReceive = Number(pmData?.days_to_receive ?? 0);
        const todayBR = todayBrasiliaStr();
        const orderNumber = orderData2?.number ?? order_id.slice(0, 8); const paymentDesc = `Venda ${orderNumber} (${pmData?.name ?? "Pagamento"})`;
        if (daysToReceive === 0) {
          const paymentIdStr = paymentId ? String(paymentId) : null;
          if (paymentIdStr) {
            const { data: existingFlow } = await admin.from("fin_cash_flow").select("id").eq("tenant_id", paymentTenantId).eq("reference_id", paymentIdStr).eq("origin", "auto_sale").maybeSingle();
            const saleAmount = orderTotalAmount > 0 ? orderTotalAmount : amount;
            if (!existingFlow) { await admin.from("fin_cash_flow").insert({ tenant_id: paymentTenantId, type: "income", amount: saleAmount, description: paymentDesc, category: "Vendas", origin: "auto_sale", reference_id: paymentIdStr, date: todayBR }); }
            const { data: routing } = await admin.from("fin_income_routing").select("bank_account_id").eq("tenant_id", paymentTenantId).eq("source_type", "payment_method").eq("source_id", payment_method_id).eq("is_active", true).maybeSingle();
            if (routing?.bank_account_id) { await admin.rpc("fn_bank_credit", { p_bank_account_id: routing.bank_account_id, p_amount: saleAmount, p_description: paymentDesc, p_reference_type: "sale", p_reference_id: order_id, p_transaction_date: todayBR }).catch(() => {}); }
            const feePercent = Number(pmData?.fee_percentage ?? 0);
            if (feePercent > 0) {
              const feeAmount = Math.round((saleAmount * feePercent / 100) * 100) / 100;
              if (feeAmount > 0) {
                const feeDesc = `Taxa maquininha — ${pmData?.name ?? "Cartao"} (${feePercent}%) — Venda ${orderNumber}`;
                const { data: existingFee } = await admin.from("fin_cash_flow").select("id").eq("tenant_id", paymentTenantId).eq("reference_id", paymentIdStr).eq("origin", "auto_card_fee").maybeSingle();
                if (!existingFee) { await admin.from("fin_cash_flow").insert({ tenant_id: paymentTenantId, type: "expense", amount: feeAmount, description: feeDesc, category: "Taxas de Cartao", origin: "auto_card_fee", reference_id: paymentIdStr, date: todayBR }); }
              }
            }
          } else { await admin.from("fin_cash_flow").insert({ tenant_id: paymentTenantId, type: "income", amount: orderTotalAmount > 0 ? orderTotalAmount : amount, description: `${paymentDesc} (sem ref)`, category: "Vendas", origin: "auto_sale", reference_id: null, date: todayBR }); }
        } else {
          const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + daysToReceive); const dueDateStr = dueDate.toISOString().split("T")[0];
          const { error: installErr } = await admin.from("fin_receivable_installments").insert({ tenant_id: paymentTenantId, order_id, installment_number: 1, total_installments: 1, amount, due_date: dueDateStr, status: "pending", payment_method_name: pmData?.name ?? null, order_number: orderNumber });
          if (installErr) { await admin.from("fin_cash_flow").insert({ tenant_id: paymentTenantId, type: "income", amount, description: `${paymentDesc} — fallback`, category: "Vendas", origin: "auto_sale", reference_id: String(paymentId ?? order_id), date: todayBR }); }
        }
      } catch { try { await admin.from("fin_cash_flow").insert({ tenant_id: tenantId, type: "income", amount, description: `Venda #${order_id.slice(0, 8)}`, category: "Vendas", origin: "auto_sale", reference_id: String(paymentId ?? order_id), date: todayBrasiliaStr() }); } catch { /* ignore */ } }
      return new Response(JSON.stringify({ data: { id: paymentId } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "toggle_obs_check") {
      const { order_item_id, observation_text, observation_index, checked, checked_by_name } = body;
      if (!order_item_id || observation_text == null || observation_index == null) { return new Response(JSON.stringify({ error: "order_item_id, observation_text e observation_index sao obrigatorios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const { data: itemCheck } = await admin.from("order_items").select("id, tenant_id").eq("id", order_item_id).maybeSingle();
      if (!itemCheck) { return new Response(JSON.stringify({ error: "order_item_id nao encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      if (checked) {
        const { error: upsertErr } = await admin.from("order_item_observation_checks").upsert({ tenant_id: tenantId, order_item_id, observation_text, observation_index: Number(observation_index), checked_at: new Date().toISOString(), checked_by_user_id: effectiveUserId, checked_by_name: checked_by_name ?? null }, { onConflict: "order_item_id,observation_index" });
        if (upsertErr) throw upsertErr;
      } else {
        const { error: delErr } = await admin.from("order_item_observation_checks").delete().eq("order_item_id", order_item_id).eq("observation_index", Number(observation_index));
        if (delErr) throw delErr;
      }
      return new Response(JSON.stringify({ ok: true, checked }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_order_item") {
      const { order_id, order_item_id, quantity, notes, observations, options, finish_edit } = body;
      if (!order_id || !order_item_id) { return new Response(JSON.stringify({ error: "order_id and order_item_id are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const { data: orderCheck } = await admin.from("orders").select("id, tenant_id, status, subtotal, discount_amount, service_fee_amount, total_amount, is_paid").eq("id", order_id).maybeSingle();
      if (!orderCheck) { return new Response(JSON.stringify({ error: "Pedido nao encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const orderTenantId = orderCheck.tenant_id as string;
      const { data: tenantMembership } = await admin.from("user_tenants").select("tenant_id").eq("user_id", jwtUserId).eq("tenant_id", orderTenantId).maybeSingle();
      if (!tenantMembership) { return new Response(JSON.stringify({ error: "Acesso negado a este pedido" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const now = new Date().toISOString();
      const itemUpdate: Record<string, unknown> = {};
      if (quantity != null && typeof quantity === "number" && quantity > 0) { itemUpdate.quantity = quantity; }
      if (notes !== undefined) { itemUpdate.notes = notes || null; }
      if (options && Array.isArray(options)) { const normalizedOptions = options.map((o: Record<string, unknown>) => ({ option_id: isValidUuid(o.option_id) ? o.option_id : null, option_name: o.option_name ?? "", group_name: o.group_name ?? "", additional_price: o.additional_price ?? 0 })); itemUpdate.options = normalizedOptions; }
      if (Object.keys(itemUpdate).length > 0) {
        const { error: itemErr } = await admin.from("order_items").update(itemUpdate).eq("id", order_item_id).eq("order_id", order_id);
        if (itemErr) { return new Response(JSON.stringify({ error: `Erro ao atualizar item: ${itemErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      }
      if (body.observations !== undefined) {
        const { error: delObsErr } = await admin.from("order_item_observations").delete().eq("order_item_id", order_item_id);
        if (delObsErr) { log("WARN", "update_order_item", "Erro ao deletar observacoes antigas", { error: delObsErr.message }); }
        if (Array.isArray(observations) && observations.length > 0) {
          const normalizedObservations = (observations as Array<Record<string, unknown>>).filter((o) => o.text && String(o.text).trim() !== "").map((o) => ({ order_item_id, tenant_id: orderTenantId, text: String(o.text).trim(), is_checked: o.is_checked ?? false }));
          const { error: obsErr } = await admin.from("order_item_observations").insert(normalizedObservations);
          if (obsErr) { return new Response(JSON.stringify({ error: `Erro ao salvar observacao: ${obsErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
        }
      }
      if (quantity != null && typeof quantity === "number" && quantity > 0) {
        const { data: allItems } = await admin.from("order_items").select("item_price, quantity").eq("order_id", order_id).neq("status", "cancelled");
        const newSubtotal = (allItems ?? []).reduce((sum: number, i: { item_price: number | null; quantity: number }) => sum + (Number(i.item_price ?? 0) * i.quantity), 0);
        const discount = Number(orderCheck.discount_amount ?? 0);
        const serviceFee = Number(orderCheck.service_fee_amount ?? 0);
        const newTotal = Math.max(0, newSubtotal - discount + serviceFee);
        await admin.from("orders").update({ subtotal: newSubtotal, total_amount: newTotal, updated_at: now }).eq("id", order_id);
      }
      try { const { data: allItemsStatus } = await admin.from("order_items").select("status, skip_kds").eq("order_id", order_id).neq("status", "cancelled"); if (allItemsStatus && allItemsStatus.length > 0) { const newOrderStatus = deriveOrderStatus(allItemsStatus as { status: string; skip_kds: boolean }[]); await admin.from("orders").update({ status: newOrderStatus, updated_at: now }).eq("id", order_id); } } catch { /* non-blocking */ }
      if (finish_edit === true) {
        await admin.from("orders").update({ is_editing: false, editing_by_user_id: null, editing_started_at: null, updated_at: now }).eq("id", order_id);
        try {
          const { data: updatedOrder } = await admin.from("orders").select(`*, order_items (*, order_item_units(*), order_item_parts(*))`).eq("id", order_id).single();
          await admin.realtime.channel(`order-updates-${tenantId}`).send({ type: 'broadcast', event: 'order_edit_finished', payload: { order_id: order_id, order: updatedOrder, updated_at: now } });
        } catch { /* non-blocking */ }
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "upsert_division_customers") {
      const { table_session_id, customers } = body;
      if (!table_session_id || !Array.isArray(customers)) return new Response(JSON.stringify({ error: "table_session_id and customers are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const now = new Date().toISOString();
      const rows: Array<Record<string, unknown>> = [];
      for (const c of customers) {
        const { data: existingCust } = await admin.from("customers").select("id").eq("tenant_id", tenantId).eq("name", c.name).maybeSingle();
        let custId: string;
        if (existingCust?.id) { custId = existingCust.id; }
        else { const { data: newCust } = await admin.from("customers").insert({ tenant_id: tenantId, name: c.name, phone: "", is_active: true }).select("id").maybeSingle(); custId = newCust?.id ?? ""; }
        if (custId) { rows.push({ tenant_id: tenantId, table_session_id, customer_id: custId, joined_at: now, is_approved: c.status === "paid" || c.status === "confirmed" }); }
      }
      if (rows.length > 0) {
        const { data, error } = await admin.from("table_session_customers").insert(rows).select();
        if (error) throw error;
        return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_division_customers") {
      const { table_session_id } = body;
      if (!table_session_id) return new Response(JSON.stringify({ error: "table_session_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await admin.from("table_session_customers").select("*, customers(name)").eq("table_session_id", table_session_id).eq("tenant_id", tenantId).order("joined_at", { ascending: true });
      if (error) throw error;
      return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_division_customer_payment") {
      const { table_session_id, customer_name, status } = body;
      if (!table_session_id || !customer_name) return new Response(JSON.stringify({ error: "table_session_id and customer_name are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const now = new Date().toISOString();
      const { data: custData } = await admin.from("customers").select("id").eq("tenant_id", tenantId).eq("name", customer_name).maybeSingle();
      if (!custData?.id) return new Response(JSON.stringify({ error: "Cliente nao encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await admin.from("table_session_customers").update({ is_approved: status === "paid" || status === "confirmed", joined_at: now }).eq("table_session_id", table_session_id).eq("tenant_id", tenantId).eq("customer_id", custData.id).select().maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : typeof err === "object" ? JSON.stringify(err) : String(err);
    log("ERROR", "unhandled", "Excecao nao tratada no order-write", { error: errMsg });
    return new Response(JSON.stringify({ error: errMsg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
