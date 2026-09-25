import { supabase } from '@/lib/supabase';
import { custoLinhaFicha, qtdFichaNoEstoque } from '@/lib/unitConversion';

/**
 * Insumos que as OPÇÕES escolhidas (complementos/adicionais) usaram em cada item vendido, por 1 unidade
 * do item (dono, 2026-09-25). O preço do adicional já entra no item_price da venda; sem isto o custo
 * ficava de fora e o CMV% saía menor. Mesma regra da baixa de estoque (_shared/stock.ts
 * buildOptionDeductions): opção ligada a insumo, ou a produção (insumo que a produção gera); quantidade
 * padrão 1 e unidade padrão = a do insumo; preço atual do insumo.
 */
export interface InsumoDaOpcao { ingredient_id: string; qtd: number; unidade: string; custo: number }

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Opções escolhidas nos itens vendidos no período (pela data do item vendido), em páginas de 1000 —
 * não depende de passar milhares de ids na URL. Quem chama procura pelo id do item vendido.
 */
export async function insumosDasOpcoesNoPeriodo(tenantId: string, deIso: string, ateIso: string): Promise<Map<string, InsumoDaOpcao[]>> {
  const escolhidas: Array<{ order_item_id: string; option_id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('order_item_options')
      .select('order_item_id, option_id, order_items!inner(created_at)')
      .eq('tenant_id', tenantId).not('option_id', 'is', null)
      .gte('order_items.created_at', deIso).lte('order_items.created_at', ateIso)
      .order('id').range(from, from + 999);
    if (error) { console.error('[custoOpcoes]', error.message); break; }
    escolhidas.push(...((data ?? []) as Array<{ order_item_id: string; option_id: string }>));
    if (!data || data.length < 1000) break;
  }
  return resolver(tenantId, escolhidas);
}

export async function insumosDasOpcoes(tenantId: string, orderItemIds: string[]): Promise<Map<string, InsumoDaOpcao[]>> {
  const ids = [...new Set(orderItemIds.filter(Boolean))];
  const escolhidas: Array<{ order_item_id: string; option_id: string }> = [];
  for (const part of chunk(ids, 150)) {
    const { data } = await supabase.from('order_item_options').select('order_item_id, option_id').in('order_item_id', part).not('option_id', 'is', null);
    escolhidas.push(...((data ?? []) as Array<{ order_item_id: string; option_id: string }>));
  }
  return resolver(tenantId, escolhidas);
}

async function resolver(tenantId: string, escolhidas: Array<{ order_item_id: string; option_id: string }>): Promise<Map<string, InsumoDaOpcao[]>> {
  const out = new Map<string, InsumoDaOpcao[]>();
  if (!escolhidas.length) return out;

  type Opt = { id: string; ingredient_id: string | null; production_recipe_id: string | null; consumption_quantity: number | null; consumption_unit: string | null };
  const opts = new Map<string, Opt>();
  for (const part of chunk([...new Set(escolhidas.map((e) => e.option_id))], 150)) {
    const { data } = await supabase.from('options').select('id, ingredient_id, production_recipe_id, consumption_quantity, consumption_unit').in('id', part).eq('tenant_id', tenantId);
    for (const o of (data ?? []) as Opt[]) if (o.ingredient_id || o.production_recipe_id) opts.set(o.id, o);
  }
  if (!opts.size) return out;

  // opção ligada só à produção → insumo que a produção gera
  const receitas = [...new Set([...opts.values()].filter((o) => !o.ingredient_id && o.production_recipe_id).map((o) => o.production_recipe_id!))];
  const saidaDaReceita = new Map<string, string>();
  if (receitas.length) {
    const { data } = await supabase.from('production_recipes').select('id, output_ingredient_id').in('id', receitas).eq('tenant_id', tenantId);
    for (const r of (data ?? []) as Array<{ id: string; output_ingredient_id: string | null }>) if (r.output_ingredient_id) saidaDaReceita.set(r.id, r.output_ingredient_id);
  }
  const insumoDa = (o: Opt) => o.ingredient_id ?? (o.production_recipe_id ? saidaDaReceita.get(o.production_recipe_id) ?? null : null);

  const ings = new Map<string, { unit: string; unit_price: number }>();
  for (const part of chunk([...new Set([...opts.values()].map(insumoDa).filter((x): x is string => !!x))], 150)) {
    const { data } = await supabase.from('ingredients').select('id, unit, unit_price').in('id', part).eq('tenant_id', tenantId);
    for (const g of (data ?? []) as Array<{ id: string; unit: string; unit_price: number | null }>) ings.set(g.id, { unit: g.unit, unit_price: Number(g.unit_price ?? 0) });
  }

  for (const e of escolhidas) {
    const o = opts.get(e.option_id);
    if (!o) continue;
    const ingId = insumoDa(o);
    const ing = ingId ? ings.get(ingId) : undefined;
    if (!ingId || !ing) continue;
    const q = Number(o.consumption_quantity ?? 1) || 1;
    const u = o.consumption_unit && o.consumption_unit.trim() ? o.consumption_unit.trim() : ing.unit;
    const l = out.get(e.order_item_id) ?? [];
    l.push({ ingredient_id: ingId, qtd: qtdFichaNoEstoque(q, u, ing.unit), unidade: ing.unit, custo: custoLinhaFicha(q, u, ing.unit, ing.unit_price) });
    out.set(e.order_item_id, l);
  }
  return out;
}

/** Custo das opções de cada item vendido no período (por 1 unidade do item). */
export async function custoOpcoesNoPeriodo(tenantId: string, deIso: string, ateIso: string): Promise<Map<string, number>> {
  const det = await insumosDasOpcoesNoPeriodo(tenantId, deIso, ateIso);
  const out = new Map<string, number>();
  for (const [k, l] of det) out.set(k, l.reduce((s, x) => s + x.custo, 0));
  return out;
}
