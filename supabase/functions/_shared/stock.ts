// Baixa teórica de estoque por item vendido (ficha técnica, combos e opções/adicionais).
// Compartilhado por order-write (PDV/KDS), mesa-write (QR de mesa e fila do QR universal)
// e delivery-write. Idempotente por item: a baixa de um order_item só acontece uma vez
// (stock_movements theoretical_out com reason terminando em :<order_item_id>).
// Mudar aqui exige redeploy das TRÊS funções.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

function slog(level: "INFO" | "WARN" | "ERROR", action: string, message: string, ctx?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, fn: "stock", action, msg: message, ...(ctx ?? {}) };
  if (level === "ERROR") console.error(JSON.stringify(entry));
  else if (level === "WARN") console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

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

export function convertUnitQty(qty: number, from: string, to: string): number {
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

type IngRow = { ingredient_id: string; quantity: number; unit: string; ingredients: { unit: string } | null };
type IngPriceRow = { ingredient_id: string; quantity: number; unit: string; stock_unit: string; unit_price: number };
export type OrderItemOption = { option_id?: string | null; option_name?: string; group_name?: string; additional_price?: number };

async function buildOptionDeductions(admin: ReturnType<typeof createClient>, tenantId: string, options: OrderItemOption[], baseQty: number): Promise<Array<{ ingredient_id: string; quantity: number; unit: string }>> {
  const deductions: Array<{ ingredient_id: string; quantity: number; unit: string }> = [];
  if (!options || options.length === 0) return deductions;
  const validOptionIds = options.map((o) => o.option_id).filter((id): id is string => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (validOptionIds.length === 0) return deductions;
  const { data: optRows } = await admin.from("options").select("id, ingredient_id, production_recipe_id, consumption_quantity, consumption_unit").in("id", validOptionIds).eq("tenant_id", tenantId).not("ingredient_id", "is", null);
  const ingredientIds = [...new Set((optRows ?? []).map((r: Record<string, unknown>) => r.ingredient_id).filter((id): id is string => !!id))];
  let unitMap = new Map<string, string>();
  if (ingredientIds.length > 0) {
    const { data: ingRows } = await admin.from("ingredients").select("id, unit").in("id", ingredientIds).eq("tenant_id", tenantId);
    unitMap = new Map((ingRows ?? []).map((i: Record<string, unknown>) => [i.id as string, i.unit as string]));
  }
  for (const row of (optRows ?? []) as Array<{ id: string; ingredient_id: string | null; production_recipe_id: string | null; consumption_quantity: number | null; consumption_unit: string | null; }>) {
    let ingredientId = row.ingredient_id;
    let consumptionQty = Number(row.consumption_quantity ?? 1);
    // Baixa sempre na unidade do insumo (igual à ficha técnica): 30 g num insumo em kg → 0,03 kg.
    const ingUnit = unitMap.get(row.ingredient_id ?? "");
    const consUnit = row.consumption_unit && String(row.consumption_unit).trim() !== "" ? String(row.consumption_unit).trim() : null;
    let stockUnit = ingUnit ?? consUnit ?? "unit";
    if (ingUnit && consUnit) consumptionQty = convertUnitQty(consumptionQty, consUnit, ingUnit);
    if (!ingredientId && row.production_recipe_id) {
      const { data: recipeRow } = await admin.from("production_recipes").select("output_ingredient_id, output_quantity, unit").eq("id", row.production_recipe_id).eq("tenant_id", tenantId).maybeSingle();
      if (recipeRow?.output_ingredient_id) { ingredientId = recipeRow.output_ingredient_id as string; consumptionQty = Number(row.consumption_quantity ?? (recipeRow.output_quantity as number) ?? 1); stockUnit = (recipeRow.unit as string) ?? "unit"; }
    }
    if (!ingredientId) continue;
    deductions.push({ ingredient_id: ingredientId, quantity: consumptionQty * baseQty, unit: stockUnit });
  }
  return deductions;
}

export async function buildDeductions(admin: ReturnType<typeof createClient>, tenantId: string, itemId: string | null, comboId: string | null, baseQty: number, options?: OrderItemOption[]): Promise<Array<{ ingredient_id: string; quantity: number; unit: string; unit_price: number }>> {
  const deductionMap = new Map<string, { quantity: number; unit: string; unit_price: number }>();
  const ingredientIds = new Set<string>();

  function addDeduction(ingredientId: string, qty: number, unit: string, price: number) {
    ingredientIds.add(ingredientId);
    const existing = deductionMap.get(ingredientId);
    if (existing) {
      existing.quantity += qty;
    } else {
      deductionMap.set(ingredientId, { quantity: qty, unit, unit_price: price });
    }
  }

  if (itemId) {
    const { data: ingredients } = await admin.from("item_ingredients").select("ingredient_id, quantity, unit, ingredients!inner(unit, unit_price)").eq("item_id", itemId).eq("tenant_id", tenantId);
    for (const ing of (ingredients ?? []) as Array<{ ingredient_id: string; quantity: number | null; unit: string | null; ingredients: { unit: string | null; unit_price: number | null } | null }>) {
      const fichaQty = Number(ing.quantity ?? 0) * baseQty;
      const fichaUnit = ing.unit ?? "unit";
      const stockUnit = ing.ingredients?.unit ?? "unit";
      const price = Number(ing.ingredients?.unit_price ?? 0);
      addDeduction(ing.ingredient_id, convertUnitQty(fichaQty, fichaUnit, stockUnit), stockUnit, price);
    }
  }

  if (comboId) {
    const { data: comboIngredients } = await admin.from("combo_ingredients").select("ingredient_id, quantity, unit, ingredients!inner(unit, unit_price)").eq("combo_id", comboId).eq("tenant_id", tenantId).is("deleted_at", null);
    for (const ing of (comboIngredients ?? []) as Array<{ ingredient_id: string; quantity: number | null; unit: string | null; ingredients: { unit: string | null; unit_price: number | null } | null }>) {
      const fichaQty = Number(ing.quantity ?? 0) * baseQty;
      const fichaUnit = ing.unit ?? "unit";
      const stockUnit = ing.ingredients?.unit ?? "unit";
      const price = Number(ing.ingredients?.unit_price ?? 0);
      addDeduction(ing.ingredient_id, convertUnitQty(fichaQty, fichaUnit, stockUnit), stockUnit, price);
    }

    const { data: comboItems } = await admin.from("combo_items").select("item_id, quantity").eq("combo_id", comboId).eq("tenant_id", tenantId).is("deleted_at", null);
    for (const ci of (comboItems ?? [])) {
      if (!ci.item_id) continue;
      const { data: ingredients } = await admin.from("item_ingredients").select("ingredient_id, quantity, unit, ingredients!inner(unit, unit_price)").eq("item_id", ci.item_id).eq("tenant_id", tenantId);
      for (const ing of (ingredients ?? []) as Array<{ ingredient_id: string; quantity: number | null; unit: string | null; ingredients: { unit: string | null; unit_price: number | null } | null }>) {
        const fichaQty = Number(ing.quantity ?? 0) * (ci.quantity ?? 1) * baseQty;
        const fichaUnit = ing.unit ?? "unit";
        const stockUnit = ing.ingredients?.unit ?? "unit";
        const price = Number(ing.ingredients?.unit_price ?? 0);
        addDeduction(ing.ingredient_id, convertUnitQty(fichaQty, fichaUnit, stockUnit), stockUnit, price);
      }
    }
  }

  if (options && options.length > 0) {
    const optionDeductions = await buildOptionDeductions(admin, tenantId, options, baseQty);
    for (const od of optionDeductions) {
      ingredientIds.add(od.ingredient_id);
    }
    if (ingredientIds.size > 0) {
      const { data: ingPriceRows } = await admin.from("ingredients").select("id, unit_price").in("id", Array.from(ingredientIds)).eq("tenant_id", tenantId);
      const priceMap = new Map<string, number>((ingPriceRows ?? []).map((r: Record<string, unknown>) => [r.id as string, Number(r.unit_price ?? 0)]));
      for (const od of optionDeductions) {
        const price = priceMap.get(od.ingredient_id) ?? 0;
        addDeduction(od.ingredient_id, od.quantity, od.unit, price);
      }
    }
  }

  const result: Array<{ ingredient_id: string; quantity: number; unit: string; unit_price: number }> = [];
  for (const [id, d] of deductionMap.entries()) {
    result.push({ ingredient_id: id, quantity: d.quantity, unit: d.unit, unit_price: d.unit_price });
  }
  return result;
}

export async function deductStockForOrderItem(admin: ReturnType<typeof createClient>, tenantId: string, orderId: string, orderItemId: string, operatorId: string): Promise<void> {
  const { data: orderItem } = await admin.from("order_items").select("item_id, combo_id, quantity").eq("id", orderItemId).maybeSingle();
  if (!orderItem) return;
  const qty = orderItem.quantity ?? 1;
  const { data: optionRows } = await admin.from("order_item_options").select("option_id, option_name, group_name, additional_price").eq("order_item_id", orderItemId);
  const options: OrderItemOption[] = (optionRows ?? []).map((row) => ({ option_id: row.option_id as string | null, option_name: (row.option_name as string) ?? "", group_name: (row.group_name as string) ?? "", additional_price: (row.additional_price as number) ?? 0 }));
  const deductions = await buildDeductions(admin, tenantId, orderItem.item_id as string | null, orderItem.combo_id as string | null, qty, options);

  let totalCost = 0;
  for (const d of deductions) {
    totalCost += d.quantity * d.unit_price;
  }
  const unitCost = qty > 0 ? Math.round((totalCost / qty) * 10000) / 10000 : 0;

  if (unitCost > 0) {
    try {
      await admin.from("order_items").update({ unit_cost: unitCost }).eq("id", orderItemId);
      slog("INFO", "deductStockForOrderItem", "unit_cost snapshot gravado", { order_item_id: orderItemId, unit_cost: unitCost });
    } catch (costErr) {
      slog("WARN", "deductStockForOrderItem", "Falha ao gravar unit_cost (non-blocking)", { error: String(costErr), order_item_id: orderItemId });
    }
  }

  if (deductions.length === 0) return;
  const allMoves: Array<Record<string, unknown>> = [];
  const deltaMap = new Map<string, number>();
  for (const d of deductions) {
    const { data: existingMoves } = await admin.from("stock_movements").select("id").eq("order_id", orderId).eq("ingredient_id", d.ingredient_id).eq("type", "theoretical_out").ilike("reason", `%:${orderItemId}`).limit(1);
    if (existingMoves && existingMoves.length > 0) { continue; }
    allMoves.push({ tenant_id: tenantId, ingredient_id: d.ingredient_id, type: "theoretical_out", quantity: d.quantity, signed_quantity: -d.quantity, unit: d.unit, reason: `item_sale:${orderItem.item_id ?? orderItem.combo_id}:${orderItemId}`, order_id: orderId, operator_id: operatorId });
    deltaMap.set(d.ingredient_id, (deltaMap.get(d.ingredient_id) ?? 0) - d.quantity);
  }
  if (allMoves.length === 0) return;
  await admin.from("stock_movements").insert(allMoves);
  for (const [ingredientId, delta] of deltaMap.entries()) { await admin.rpc("fn_update_ingredient_stock", { p_ingredient_id: ingredientId, p_tenant_id: tenantId, p_delta: delta }); }
}

// Pedidos que nascem fora do order-write (QR de mesa, fila do QR universal, delivery público):
// itens "sem preparo" (skip_kds — ex.: refrigerante) nunca passam pelo KDS, então baixam aqui,
// quando o pedido vira pedido real. Itens de cozinha continuam baixando quando o KDS marca pronto
// (order-write). Rascunho (Pix pendente), treino e cancelado não baixam.
// Operador: sem usuário logado nesses canais — usa quem abriu o caixa do pedido (FK users, NOT NULL).
export async function deductStockForSkipKdsItems(
  // deno-lint-ignore no-explicit-any
  admin: any, tenantId: string, orderId: string, operatorId: string | null = null,
): Promise<void> {
  const { data: order } = await admin.from("orders").select("id, tenant_id, status, is_draft, is_training, session_id").eq("id", orderId).eq("tenant_id", tenantId).maybeSingle();
  if (!order) return;
  if (order.is_draft || order.status === "draft" || order.status === "cancelled" || order.is_training) return;
  const { data: items } = await admin.from("order_items").select("id").eq("order_id", orderId).eq("tenant_id", tenantId).eq("skip_kds", true).neq("status", "cancelled");
  if (!items || items.length === 0) return;
  let operator = operatorId;
  if (!operator && order.session_id) {
    const { data: sess } = await admin.from("sessions").select("opened_by").eq("id", order.session_id).eq("tenant_id", tenantId).maybeSingle();
    operator = (sess?.opened_by as string | null) ?? null;
  }
  if (!operator) { slog("WARN", "deductStockForSkipKdsItems", "sem operador (caixa sem opened_by) — baixa ignorada", { order_id: orderId }); return; }
  for (const it of items as Array<{ id: string }>) {
    try { await deductStockForOrderItem(admin, tenantId, orderId, it.id, operator); }
    catch (e) { slog("WARN", "deductStockForSkipKdsItems", "baixa de estoque falhou", { order_id: orderId, order_item_id: it.id, error: String(e) }); }
  }
}

// Mantém a isolate viva até a promessa terminar, sem segurar a resposta.
export function runStockInBackground(p: Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(p);
  else p.catch(() => {});
}
