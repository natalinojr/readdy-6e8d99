// Ficha técnica mudada depois das vendas → refaz a baixa teórica das vendas DESDE uma data escolhida
// (dono, 2026-09-25; vale para todas as lojas). Usa a mesma conta da venda (buildDeductions: ficha, combos
// que contêm o item e adicionais) e compara com o que já foi baixado para cada item vendido
// (theoretical_out com reason terminando em :<order_item_id>).
//  • a baixa daquela venda passa a ser a da ficha nova, na data da venda (reports por dia ficam certos);
//  • venda DEPOIS da última contagem do insumo → o saldo atual muda;
//  • venda ANTES da contagem → o saldo atual não muda (a contagem manda): a diferença entra como ajuste
//    de inventário no momento da contagem, e o estoque teórico dos dias entre a venda e a contagem fica certo.
// Só vendas já processadas (item pronto/entregue, ou que pula a cozinha); o resto ainda vai dar baixa sozinho.
// Idempotente: rodar de novo com a mesma ficha não muda nada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { buildDeductions, type OrderItemOption } from "./stock.ts";

type Sb = ReturnType<typeof createClient>;

export interface MudancaInsumo { ingredient_id: string; nome: string; unidade: string; diferenca: number; no_saldo: number; na_contagem: number }
export interface ResultadoFicha { vendas: number; vendas_alteradas: number; insumos: MudancaInsumo[]; aplicado: boolean }

const EPS = 1e-9;
const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function reaplicarFicha(admin: Sb, tenantId: string, itemId: string, desdeIso: string, operatorId: string, aplicar: boolean): Promise<ResultadoFicha> {
  // 1) vendas do item (direto ou dentro de combo) desde a data
  const { data: combos } = await admin.from("combo_items").select("combo_id").eq("tenant_id", tenantId).eq("item_id", itemId).is("deleted_at", null);
  const comboIds = [...new Set(((combos ?? []) as Array<{ combo_id: string }>).map((c) => c.combo_id))];
  const filtroItem = comboIds.length ? `item_id.eq.${itemId},combo_id.in.(${comboIds.join(",")})` : `item_id.eq.${itemId}`;

  type OI = { id: string; order_id: string; item_id: string | null; combo_id: string | null; quantity: number | null; status: string | null; skip_kds: boolean | null; created_at: string; ready_at: string | null; delivered_at: string | null };
  const ois: OI[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("order_items")
      .select("id, order_id, item_id, combo_id, quantity, status, skip_kds, created_at, ready_at, delivered_at")
      .eq("tenant_id", tenantId).gte("created_at", desdeIso).or(filtroItem)
      .order("created_at").range(from, from + 999);
    if (error) throw new Error(`order_items: ${error.message}`);
    ois.push(...((data ?? []) as OI[]));
    if (!data || data.length < 1000) break;
  }
  const processados = ois.filter((o) => o.status !== "cancelled" && (o.status === "ready" || o.status === "delivered" || o.skip_kds));

  // pedidos válidos (não cancelado, não rascunho, não treinamento)
  const orderIds = [...new Set(processados.map((o) => o.order_id))];
  const validos = new Set<string>();
  for (const part of chunk(orderIds, 300)) {
    const { data } = await admin.from("orders").select("id, status, is_training, is_draft").in("id", part).eq("tenant_id", tenantId);
    for (const o of (data ?? []) as Array<{ id: string; status: string; is_training: boolean | null; is_draft: boolean | null }>) {
      if (o.status !== "cancelled" && o.status !== "draft" && !o.is_training && !o.is_draft) validos.add(o.id);
    }
  }
  const vendas = processados.filter((o) => validos.has(o.order_id));
  if (!vendas.length) return { vendas: 0, vendas_alteradas: 0, insumos: [], aplicado: aplicar };

  // 2) adicionais de cada venda
  const opcoes = new Map<string, OrderItemOption[]>();
  for (const part of chunk(vendas.map((v) => v.id), 300)) {
    const { data } = await admin.from("order_item_options").select("order_item_id, option_id, option_name, group_name, additional_price").in("order_item_id", part);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const k = String(r.order_item_id);
      const l = opcoes.get(k) ?? [];
      l.push({ option_id: r.option_id as string | null, option_name: String(r.option_name ?? ""), group_name: String(r.group_name ?? ""), additional_price: Number(r.additional_price ?? 0) });
      opcoes.set(k, l);
    }
  }

  // 3) baixa que a ficha de HOJE faria (por unidade vendida; é proporcional à quantidade)
  const cacheAlvo = new Map<string, Array<{ ingredient_id: string; quantity: number; unit: string }>>();
  const alvoPorUnidade = async (v: OI) => {
    const ops = opcoes.get(v.id) ?? [];
    const key = `${v.item_id ?? ""}|${v.combo_id ?? ""}|${ops.map((o) => `${o.option_id}:${o.option_name}`).sort().join(",")}`;
    if (!cacheAlvo.has(key)) cacheAlvo.set(key, await buildDeductions(admin, tenantId, v.item_id, v.combo_id, 1, ops));
    return cacheAlvo.get(key)!;
  };

  // 4) o que já foi baixado para cada venda
  type Mov = { id: string; ingredient_id: string; quantity: number; unit: string | null; reason: string; order_id: string };
  const jaBaixado = new Map<string, Mov[]>(); // order_item_id → movimentos
  for (const part of chunk(orderIds.filter((id) => validos.has(id)), 200)) {
    const { data, error } = await admin.from("stock_movements").select("id, ingredient_id, quantity, unit, reason, order_id")
      .eq("tenant_id", tenantId).eq("type", "theoretical_out").in("order_id", part);
    if (error) throw new Error(`stock_movements: ${error.message}`);
    for (const m of (data ?? []) as Mov[]) {
      const oiId = String(m.reason ?? "").split(":").pop() ?? "";
      const l = jaBaixado.get(oiId) ?? [];
      l.push(m);
      jaBaixado.set(oiId, l);
    }
  }

  // 5) diferenças
  type Op = { venda: OI; ingredient_id: string; unidade: string; alvo: number; movs: Mov[]; diff: number };
  const ops: Op[] = [];
  for (const v of vendas) {
    const qtd = Number(v.quantity ?? 1) || 1;
    const alvo = new Map<string, { q: number; unit: string }>();
    for (const d of await alvoPorUnidade(v)) {
      const cur = alvo.get(d.ingredient_id);
      alvo.set(d.ingredient_id, { q: (cur?.q ?? 0) + d.quantity * qtd, unit: d.unit });
    }
    const movs = jaBaixado.get(v.id) ?? [];
    const porIng = new Map<string, Mov[]>();
    for (const m of movs) porIng.set(m.ingredient_id, [...(porIng.get(m.ingredient_id) ?? []), m]);
    for (const ing of new Set([...alvo.keys(), ...porIng.keys()])) {
      const ms = porIng.get(ing) ?? [];
      const atual = ms.reduce((s, m) => s + Number(m.quantity ?? 0), 0);
      const q = alvo.get(ing)?.q ?? 0;
      if (Math.abs(q - atual) > EPS) ops.push({ venda: v, ingredient_id: ing, unidade: alvo.get(ing)?.unit ?? ms[0]?.unit ?? "unit", alvo: q, movs: ms, diff: q - atual });
    }
  }
  if (!ops.length) return { vendas: vendas.length, vendas_alteradas: 0, insumos: [], aplicado: aplicar };

  // 6) última contagem de cada insumo afetado (ajuste de inventário = contagem ou inventário confirmado)
  const ings = [...new Set(ops.map((o) => o.ingredient_id))];
  const ultimaContagem = new Map<string, string>();
  const nomes = new Map<string, { nome: string; unidade: string }>();
  for (const part of chunk(ings, 200)) {
    const { data: adj } = await admin.from("stock_movements").select("ingredient_id, created_at")
      .eq("tenant_id", tenantId).eq("type", "inventory_adjustment").in("ingredient_id", part).order("created_at", { ascending: false });
    for (const a of (adj ?? []) as Array<{ ingredient_id: string; created_at: string }>) {
      if (!ultimaContagem.has(a.ingredient_id)) ultimaContagem.set(a.ingredient_id, a.created_at);
    }
    const { data: gs } = await admin.from("ingredients").select("id, name, unit").in("id", part).eq("tenant_id", tenantId);
    for (const g of (gs ?? []) as Array<{ id: string; name: string; unit: string }>) nomes.set(g.id, { nome: g.name, unidade: g.unit });
  }

  const quandoVendeu = (v: OI) => v.delivered_at ?? v.ready_at ?? v.created_at;
  const resumo = new Map<string, MudancaInsumo>();
  const noSaldo = new Map<string, number>();       // delta assinado no saldo atual
  const naContagem = new Map<string, number>();    // compensação na última contagem (signed)
  for (const o of ops) {
    const signedDelta = -o.diff; // mais consumo → saldo menor
    const cont = ultimaContagem.get(o.ingredient_id);
    const antesDaContagem = !!cont && new Date(quandoVendeu(o.venda)) <= new Date(cont);
    const r = resumo.get(o.ingredient_id) ?? { ingredient_id: o.ingredient_id, nome: nomes.get(o.ingredient_id)?.nome ?? "?", unidade: nomes.get(o.ingredient_id)?.unidade ?? o.unidade, diferenca: 0, no_saldo: 0, na_contagem: 0 };
    r.diferenca += o.diff;
    if (antesDaContagem) { r.na_contagem += o.diff; naContagem.set(o.ingredient_id, (naContagem.get(o.ingredient_id) ?? 0) - signedDelta); }
    else { r.no_saldo += o.diff; noSaldo.set(o.ingredient_id, (noSaldo.get(o.ingredient_id) ?? 0) + signedDelta); }
    resumo.set(o.ingredient_id, r);
  }
  const resultado: ResultadoFicha = {
    vendas: vendas.length,
    vendas_alteradas: new Set(ops.map((o) => o.venda.id)).size,
    insumos: [...resumo.values()].sort((a, b) => a.nome.localeCompare(b.nome)),
    aplicado: false,
  };
  if (!aplicar) return resultado;

  // 7) grava: a baixa de cada venda vira a da ficha nova, na data da venda
  const nota = `Correção de ficha técnica (vendas desde ${desdeIso.slice(0, 10)})`;
  const inserir: Array<Record<string, unknown>> = [];
  const apagar: string[] = [];
  for (const o of ops) {
    if (o.movs.length) {
      const [primeiro, ...resto] = o.movs;
      apagar.push(...resto.map((m) => m.id));
      if (o.alvo > EPS) {
        const { error } = await admin.from("stock_movements").update({ quantity: o.alvo, signed_quantity: -o.alvo, notes: nota }).eq("id", primeiro.id).eq("tenant_id", tenantId);
        if (error) throw new Error(`atualizar baixa: ${error.message}`);
      } else apagar.push(primeiro.id);
    } else if (o.alvo > EPS) {
      inserir.push({
        tenant_id: tenantId, ingredient_id: o.ingredient_id, type: "theoretical_out", quantity: o.alvo, signed_quantity: -o.alvo,
        unit: o.unidade, reason: `item_sale:${o.venda.item_id ?? o.venda.combo_id}:${o.venda.id}`, order_id: o.venda.order_id,
        operator_id: operatorId, notes: nota, created_at: quandoVendeu(o.venda),
      });
    }
  }
  for (const [ing, signed] of naContagem.entries()) {
    if (Math.abs(signed) <= EPS) continue;
    inserir.push({
      tenant_id: tenantId, ingredient_id: ing, type: "inventory_adjustment", quantity: Math.abs(signed), signed_quantity: signed,
      unit: nomes.get(ing)?.unidade ?? null, reason: "Ajuste de Inventario (correção de ficha técnica)", operator_id: operatorId,
      notes: `${nota}: a contagem já tinha acertado o saldo; a diferença das vendas antes dela entra aqui`, created_at: ultimaContagem.get(ing),
    });
  }
  for (const part of chunk(apagar, 200)) {
    const { error } = await admin.from("stock_movements").delete().in("id", part).eq("tenant_id", tenantId);
    if (error) throw new Error(`apagar baixa: ${error.message}`);
  }
  for (const part of chunk(inserir, 200)) {
    const { error } = await admin.from("stock_movements").insert(part);
    if (error) throw new Error(`inserir baixa: ${error.message}`);
  }
  for (const [ing, delta] of noSaldo.entries()) {
    if (Math.abs(delta) <= EPS) continue;
    const { error } = await admin.rpc("fn_update_ingredient_stock", { p_ingredient_id: ing, p_tenant_id: tenantId, p_delta: delta });
    if (error) throw new Error(`saldo: ${error.message}`);
  }
  resultado.aplicado = true;
  return resultado;
}
