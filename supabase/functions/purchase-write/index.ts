import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isFinanceiroRole } from '../_shared/tenant-auth.ts';
import { cnpjDaCompra, ligarItem, vinculosMemorizados } from '../_shared/vinculos-memorizados.ts';
import { hojeBrasilia, statusPorVencimento, validarParcelas } from '../_shared/trilha-acoes.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers compartilhados entre create_purchase e update_purchase.
// Extraídos para um único lugar de propósito: duplicar essa lógica (cálculo
// de custo, resolução de fornecedor, entrada de estoque) foi a causa de mais
// de um bug nesta base — mantida em um só lugar, corrige nos dois de uma vez.
// ─────────────────────────────────────────────────────────────────────────

interface ComputedItem {
  tenant_id: string;
  ingredient_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  freight_allocated: number;
  unit_label: string | null;
  units_per_package: number;
  cost_center_id: string | null;
  dre_category_id: string | null;
  merchandise_category_id: string | null;
  discount_per_unit: number;
  final_unit_cost: number;
  cost_per_base_unit: number | null;
  notes: string | null;
  pack_count: number | null;
  pack_size: number | null;
  /** Código do produto no fornecedor (NF-e) e EAN: usados no recebimento para sugerir/memorizar o insumo */
  supplier_code: string | null;
  ean: string | null;
}

// Normalização dos itens: o total da compra é derivado dos itens (líquidos de
// desconto) + frete, para que cabeçalho e linhas nunca divirjam, independente
// da versão do front que chamou.
//
// Colunas são listadas explicitamente de propósito: o spread do payload
// deixava campos que não existem na tabela (ex.: catalog_id) chegarem ao
// insert e derrubarem a criação da compra inteira (PGRST204).
// Frete da compra rateado pelo valor de cada item (2026-09-30). Entra no custo do insumo e, pela DRE,
// no CMV/despesa do item. Se quem chamou já mandou o rateio fechando com o frete, ele vale; senão
// (ex.: compra lançada pela nota de entrada, que mandava 0 em todos) rateia aqui — antes o frete
// ficava só no cabeçalho e sumia da DRE.
//
// Acréscimos da nota (ICMS-ST, IPI, seguro, outras despesas — linha própria criada pelo fiscal-inbound)
// também são custo da mercadoria (dono, 2026-09-30): vão rateados junto com o frete no freight_allocated
// dos PRODUTOS, e a linha de acréscimos fica com freight_allocated = −valor dela (custo líquido 0). Assim
// Σ freight_allocated continua = frete, o total e a DRE não mudam, e todo cálculo de custo do insumo
// (total_price + freight_allocated) passa a incluir os impostos sem mexer em cada um.
const ehAcrescimoNota = (it: Record<string, unknown>) => String(it.description ?? '').startsWith('Acréscimos da nota');
const r2 = (v: number) => Math.round(v * 100) / 100;

// Linha de FRETE no meio dos itens (2026-09-30, dono: "o frete tem que ser diluído entre os produtos
// proporcionalmente ao valor de cada item" — notinha com "TAXA DE ENTREGA", print de compra online,
// digitação). A linha sai dos itens e soma no frete da compra, que o ratearFrete distribui no
// freight_allocated dos produtos: o total não muda e o custo de cada insumo passa a levar o frete.
// Só vale para linha sem insumo e sem categoria de despesa, e só se sobrar algum produto.
const RE_FRETE = /^\s*(fretes?|taxa\s+de\s+(entrega|envio)|tx\.?\s*(de\s+)?entrega|entrega|envio|custo\s+de\s+envio)\b/i;
const ehLinhaFrete = (it: Record<string, unknown>) =>
  RE_FRETE.test(String(it.description ?? '')) && !it.ingredient_id && !it.dre_category_id;
function absorverLinhasDeFrete(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  const arr = items as Array<Record<string, unknown>>;
  const fretes = arr.filter(ehLinhaFrete);
  if (fretes.length === 0 || fretes.length === arr.length) return 0;
  const valor = r2(fretes.reduce((acc, it) =>
    acc + r2(Number(it.quantity ?? 0) * Math.max(0, Number(it.unit_price ?? 0) - Number(it.discount_per_unit ?? 0))), 0));
  for (let i = arr.length - 1; i >= 0; i--) if (ehLinhaFrete(arr[i])) arr.splice(i, 1);
  return valor;
}
function ratearFrete(items: unknown, frete: number): void {
  const arr = (Array.isArray(items) ? items : []) as Array<Record<string, unknown>>;
  if (arr.length === 0) return;
  const fr = frete > 0 ? frete : 0;
  const bruto = (it: Record<string, unknown>) => Number(it.quantity ?? 0) * Math.max(0, Number(it.unit_price ?? 0) - Number(it.discount_per_unit ?? 0));
  let produtos = arr.filter((it) => !ehAcrescimoNota(it));
  let acrescimos = arr.filter(ehAcrescimoNota);
  if (produtos.length === 0 || produtos.reduce((s, it) => s + bruto(it), 0) <= 0) { produtos = arr; acrescimos = []; }
  const informado = arr.reduce((s, it) => s + Number(it.freight_allocated ?? 0), 0);
  const acrescimosOk = acrescimos.every((it) => Math.abs(Number(it.freight_allocated ?? 0) + r2(bruto(it))) <= 0.01);
  if (Math.abs(informado - fr) <= 0.01 && acrescimosOk) return;
  const totalAcrescimos = acrescimos.reduce((s, it) => s + r2(bruto(it)), 0);
  acrescimos.forEach((it) => { it.freight_allocated = -r2(bruto(it)); });
  const aRatear = r2(fr + totalAcrescimos);
  if (!(aRatear > 0)) { produtos.forEach((it) => { it.freight_allocated = 0; }); return; }
  const base = produtos.reduce((s, it) => s + bruto(it), 0);
  let acc = 0;
  produtos.forEach((it, i) => {
    const parte = i < produtos.length - 1
      ? r2(base > 0 ? aRatear * bruto(it) / base : aRatear / produtos.length)
      : r2(aRatear - acc);
    it.freight_allocated = parte;
    acc += parte;
  });
}

function computePurchaseItems(tenant_id: string, items: unknown): ComputedItem[] {
  return (Array.isArray(items) ? items : []).map((item: Record<string, unknown>) => {
    const quantity = Number(item.quantity ?? 0);
    const unitPrice = Number(item.unit_price ?? 0);
    const discountPerUnit = Number(item.discount_per_unit ?? 0);
    // Embalagem desdobrada: pack_count unidades × pack_size (conteúdo de cada
    // uma na unidade de ESTOQUE). Quando presente, é a fonte da conversão —
    // cx 12×1,5kg → 18 kg/cx. pack_size vazio = 1 (unidade já é a de estoque).
    const packCount = Number(item.pack_count ?? 0);
    const packSize = Number(item.pack_size ?? 0);
    const unitsPerPkg = packCount > 0
      ? packCount * (packSize > 0 ? packSize : 1)
      : Number(item.units_per_package ?? item.purchase_factor ?? 1) || 1;
    const freightAllocated = Number(item.freight_allocated ?? 0);

    // Preço unitário de compra já líquido do desconto por unidade
    const netUnitPrice = Math.max(0, unitPrice - discountPerUnit);
    const totalPrice = Math.round(quantity * netUnitPrice * 100) / 100;

    // VU final = custo de UMA unidade de compra (caixa/fardo) com frete rateado
    const finalUnitCost = quantity > 0 ? netUnitPrice + freightAllocated / quantity : netUnitPrice;

    // Custo por unidade de ESTOQUE (R$/kg, R$/un) — é o "R$/kg/unidade" da planilha
    const stockUnits = quantity * unitsPerPkg;
    const costPerBaseUnit = stockUnits > 0 ? (totalPrice + freightAllocated) / stockUnits : null;

    return {
      tenant_id,
      ingredient_id: item.ingredient_id ? String(item.ingredient_id) : null,
      description: String(item.description ?? ''),
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      freight_allocated: freightAllocated,
      unit_label: (item.unit_label ?? item.purchase_unit) ? String(item.unit_label ?? item.purchase_unit) : null,
      units_per_package: unitsPerPkg,
      cost_center_id: item.cost_center_id ? String(item.cost_center_id) : null,
      dre_category_id: item.dre_category_id ? String(item.dre_category_id) : null,
      merchandise_category_id: item.merchandise_category_id ? String(item.merchandise_category_id) : null,
      discount_per_unit: discountPerUnit,
      final_unit_cost: finalUnitCost,
      cost_per_base_unit: costPerBaseUnit,
      notes: item.notes ? String(item.notes) : null,
      pack_count: packCount > 0 ? packCount : null,
      pack_size: packCount > 0 ? (packSize > 0 ? packSize : 1) : null,
      supplier_code: item.supplier_code ? String(item.supplier_code).trim().slice(0, 60) : null,
      ean: item.ean && /^\d{8,14}$/.test(String(item.ean).replace(/\D/g, '')) ? String(item.ean).replace(/\D/g, '') : null,
    };
  });
}

// Conversão da unidade de COMPRA para a unidade do INSUMO (2026-09-13). Tela e nota sempre mandam
// units_per_package/pack_count; o assistente (cupom) não mandava, e o item entrava 1:1 — "4 un" de
// milho 170 g viravam 4 g no estoque. Sem conversão explícita, resolve pelo insumo: mesma unidade → 1;
// kg↔g e L↔ml → 1000; embalagem memorizada no insumo (purchase_unit + purchase_factor ≠ 1) quando a
// unidade bate. Não deu → o item fica SEM insumo (fora do estoque) e volta aviso: a conversão é
// informada na Classificação de itens, que também refaz as compras antigas (dono, 2026-09-24 — nunca 1:1
// por falta de informação: "1 un = 1 g" inflava o custo da grama).
const UNIT_ALIAS: Record<string, string> = {
  unit: 'un', un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un', pc: 'un', pca: 'un', 'pç': 'un',
  kg: 'kg', kgs: 'kg', quilo: 'kg', g: 'g', gr: 'g', grama: 'g', gramas: 'g', l: 'l', lt: 'l', litro: 'l', litros: 'l', ml: 'ml',
};
const normUnit = (u: unknown) => { const s = String(u ?? '').trim().toLowerCase().replace(/\.$/, ''); return UNIT_ALIAS[s] ?? s; };
const METRIC: Record<string, number> = { 'kg>g': 1000, 'g>kg': 0.001, 'l>ml': 1000, 'ml>l': 0.001 };

// deno-lint-ignore no-explicit-any
async function applyIngredientConversions(supabase: any, tenant_id: string, rawItems: unknown, computed: ComputedItem[]): Promise<string[]> {
  const raws = (Array.isArray(rawItems) ? rawItems : []) as Array<Record<string, unknown>>;
  const semConversao = (i: number) => {
    const r = raws[i];
    return !!r && r.pack_count == null && r.units_per_package == null && r.purchase_factor == null;
  };
  const ids = [...new Set(computed.filter((c, i) => c.ingredient_id && semConversao(i)).map((c) => c.ingredient_id as string))];
  if (ids.length === 0) return [];
  const { data: ings } = await supabase.from('ingredients').select('id, name, unit, purchase_unit, purchase_factor').eq('tenant_id', tenant_id).in('id', ids);
  // deno-lint-ignore no-explicit-any
  const byId = new Map((ings ?? []).map((g: any) => [String(g.id), g]));
  const avisos: string[] = [];
  computed.forEach((c, i) => {
    if (!c.ingredient_id || !semConversao(i)) return;
    // deno-lint-ignore no-explicit-any
    const ing: any = byId.get(c.ingredient_id);
    if (!ing) return;
    const de = normUnit(c.unit_label);
    const para = normUnit(ing.unit);
    const fatorInsumo = Number(ing.purchase_factor);
    let f: number | null = null;
    if (!de || de === para) f = 1;
    else if (METRIC[`${de}>${para}`]) f = METRIC[`${de}>${para}`];
    else if (fatorInsumo > 0 && fatorInsumo !== 1 && normUnit(ing.purchase_unit) === de) f = fatorInsumo;
    if (f == null) {
      avisos.push(`${c.description}: comprado em "${c.unit_label}" e o insumo "${ing.name}" é controlado em "${ing.unit}" — sem conversão, ficou sem insumo (fora do estoque). Informe quanto 1 ${c.unit_label} vale em ${ing.unit} na Classificação de itens.`);
      c.ingredient_id = null;
      c.cost_per_base_unit = null;
      return;
    }
    if (f !== 1) {
      c.units_per_package = f;
      const su = c.quantity * f;
      c.cost_per_base_unit = su > 0 ? (c.total_price + c.freight_allocated) / su : null;
    }
  });
  return avisos;
}

// Fornecedor por FK: resolve pelo nome dentro DESTE tenant e cria se não
// existir. Antes o vínculo era só o texto + um ilike solto, que falhava
// silenciosamente em nomes com espaço duplo/sobrando.
async function resolveOrCreateSupplier(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenant_id: string,
  supplierName: string,
): Promise<{ id: string } | null> {
  const name = supplierName.trim();
  if (!name) return null;

  const { data: sup } = await supabase
    .from('fin_suppliers').select('id')
    .eq('tenant_id', tenant_id).ilike('name', name).maybeSingle();
  if (sup) return sup;

  const { data: created, error } = await supabase
    .from('fin_suppliers')
    .insert({ tenant_id, name, is_active: true })
    .select('id').single();
  if (error) {
    console.error('[purchase-write] criar fornecedor:', error.message ?? error);
    return null;
  }
  return created;
}

// Categoria de mercadoria: se o front não mandou, herda a do insumo — estoque
// e compras compartilham a MESMA lista (fin_merchandise_categories). Muta
// computedItems no lugar.
// deno-lint-ignore no-explicit-any
async function inheritMerchandiseCategories(supabase: any, tenant_id: string, computedItems: ComputedItem[]) {
  const ingredientIds = computedItems
    .map((it) => it.ingredient_id)
    .filter((v): v is string => Boolean(v));
  if (ingredientIds.length === 0) return;

  const { data: ings } = await supabase
    .from('ingredients')
    .select('id, merchandise_category_id')
    .eq('tenant_id', tenant_id)
    .in('id', ingredientIds);
  const catByIngredient = new Map(
    // deno-lint-ignore no-explicit-any
    (ings ?? []).map((g: any) => [g.id as string, g.merchandise_category_id as string | null]),
  );
  for (const it of computedItems) {
    if (!it.merchandise_category_id && it.ingredient_id) {
      it.merchandise_category_id = catByIngredient.get(it.ingredient_id) ?? null;
    }
  }
}

// Entrada de estoque + atualização de preço/fornecedor do insumo, por item.
async function applyStockAndPricing(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenant_id: string,
  // deno-lint-ignore no-explicit-any
  purchase: any,
  computedItems: ComputedItem[],
  // deno-lint-ignore no-explicit-any
  user: any,
  supplierId: string | null,
) {
  // A ENTRADA NO ESTOQUE não acontece aqui: desde 2026-09-11 ela só é lançada na
  // confirmação do recebimento (applyStockEntry / purchase-confirm-delivery), e a
  // compra guarda quando isso ocorreu em fin_purchases.stock_applied_at.
  void user;
  for (const item of computedItems) {
    if (!item.ingredient_id) continue;

    const supplierPayload: Record<string, unknown> = {};
    if (purchase.supplier) supplierPayload.supplier = purchase.supplier;
    if (supplierId) supplierPayload.supplier_id = supplierId;
    // Memoriza a embalagem desta compra no insumo (ex.: 'cx' de 16) — o modal
    // de Nova Compra pré-preenche unidade e fator com isso na próxima vez.
    if (item.unit_label) {
      supplierPayload.purchase_unit = item.unit_label;
      supplierPayload.purchase_factor = item.units_per_package;
    }
    if (Object.keys(supplierPayload).length > 0) {
      await supabase.from('ingredients').update(supplierPayload).eq('id', item.ingredient_id).eq('tenant_id', tenant_id);
    }

    // Custo por UNIDADE DE ESTOQUE já calculado em computedItems
    // (= (total líquido + frete) / (qty x upp)), o "R$/kg" da planilha.
    const realUnitPrice = Number(item.cost_per_base_unit ?? 0) || Number(item.unit_price ?? 0);
    if (realUnitPrice > 0) {
      await supabase.rpc('fn_update_ingredient_price_from_purchase', {
        p_ingredient_id: item.ingredient_id, p_tenant_id: tenant_id,
        p_purchase_unit_price: realUnitPrice,
        p_purchase_date: purchase.purchase_date || new Date().toISOString().split('T')[0],
      });
    }
  }
}

// Auto-cadastro de APRESENTAÇÕES no catálogo: cada compra com insumo +
// embalagem desdobrada (pack_count/pack_size) registra o SKU do fornecedor
// ("Requeijão — Fornecedor A (cx 12×1,5kg)") apontando para o insumo.
// Na próxima compra, escolher a apresentação preenche tudo de uma vez —
// o catálogo se constrói sozinho, sem cadastro manual.
async function upsertCatalogPresentations(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenant_id: string,
  // deno-lint-ignore no-explicit-any
  purchase: any,
  computedItems: ComputedItem[],
  supplierId: string | null,
) {
  if (!supplierId) return;
  for (const item of computedItems) {
    if (!item.ingredient_id || !item.pack_count || !(item.pack_count > 0)) continue;
    try {
      // Já existe apresentação idêntica (mesmo insumo, fornecedor e embalagem)?
      const { data: existing } = await supabase
        .from('fin_purchase_catalog')
        .select('id')
        .eq('tenant_id', tenant_id)
        .eq('ingredient_id', item.ingredient_id)
        .eq('supplier_id', supplierId)
        .eq('pack_count', item.pack_count)
        .eq('pack_size', item.pack_size ?? 1)
        .limit(1)
        .maybeSingle();
      if (existing) continue;

      const { data: ing } = await supabase
        .from('ingredients')
        .select('name, unit')
        .eq('id', item.ingredient_id)
        .eq('tenant_id', tenant_id)
        .maybeSingle();
      const stockUnit = ing?.unit ?? 'un';
      const sizeStr = String(item.pack_size ?? 1).replace('.', ',');
      const name = `${ing?.name ?? item.description} — ${purchase.supplier} (${item.unit_label ?? 'cx'} ${item.pack_count}×${sizeStr}${stockUnit})`;

      const { error: insErr } = await supabase.from('fin_purchase_catalog').insert({
        tenant_id,
        name,
        ingredient_id: item.ingredient_id,
        default_unit: stockUnit,
        purchase_unit: item.unit_label ?? 'cx',
        pack_count: item.pack_count,
        pack_size: item.pack_size ?? 1,
        default_supplier: purchase.supplier,
        supplier_id: supplierId,
        merchandise_category_id: item.merchandise_category_id ?? null,
        is_active: true,
      });
      if (insErr) console.error('[purchase-write] auto-apresentação:', insErr.message ?? insErr);
    } catch (e) {
      // Falha aqui nunca pode derrubar a compra — é conveniência, não contrato.
      console.error('[purchase-write] auto-apresentação exception:', String(e));
    }
  }
}

// Entrada no estoque da compra inteira — chamada na confirmação do recebimento.
// quantity vem em UNIDADES DE COMPRA (caixa/fardo); units_per_package converte
// para unidades de estoque ("qty x upp = total unid."). Se o recebimento ajustou a
// quantidade, vale a recebida.
async function applyStockEntry(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenant_id: string,
  // deno-lint-ignore no-explicit-any
  purchase: any,
  items: Array<Record<string, unknown>>,
  // deno-lint-ignore no-explicit-any
  user: any,
) {
  // Data do movimento = data do recebimento (compra lançada "já recebida em 21/09" e detalhada
  // depois entrava com a hora do clique — 2026-09-30). Se o insumo foi contado entre o recebimento e
  // agora, NÃO entra: a contagem já pôs a mercadoria (regra única fn_insumo_contado_entre).
  const recebidoEm = String(purchase.delivery_confirmed_at ?? purchase.stock_applied_at ?? '');
  const datar = !!recebidoEm && new Date(recebidoEm).getTime() < Date.now() - 60_000;
  const naoEntram: string[] = [];
  for (const item of items) {
    if (!item.ingredient_id) continue;
    const qty = item.received_quantity != null ? Number(item.received_quantity) : Number(item.quantity ?? 0);
    const upp = Number(item.units_per_package ?? 1) > 0 ? Number(item.units_per_package) : 1;
    const stockQty = qty * upp;
    if (!(stockQty > 0)) continue;
    if (datar && await contadoEntre(supabase, tenant_id, String(item.ingredient_id), recebidoEm)) {
      naoEntram.push(String(item.description ?? item.id));
      continue;
    }
    // Movimentacao via RPC (insere movimento + atualiza current_stock atomicamente)
    const { data: mvRes, error: mvErr } = await supabase.rpc('fn_add_stock_movement', {
      p_tenant_id: tenant_id, p_ingredient_id: item.ingredient_id,
      p_type: 'in', p_quantity: stockQty, p_unit: null,
      p_reason: `Compra: ${purchase.supplier} - NF ${purchase.invoice_number || 'S/N'}`,
      p_notes: null, p_order_id: null, p_operator_id: user.id, p_batch_id: null,
    });
    if (mvErr) console.error('[purchase-write] fn_add_stock_movement error:', mvErr.message ?? mvErr);
    // Liga o movimento à compra (permite corrigir a data do recebimento depois)
    else if (mvRes?.movement_id) {
      await supabase.from('stock_movements').update({ purchase_id: purchase.id, ...(datar ? { created_at: recebidoEm } : {}) })
        .eq('id', mvRes.movement_id).eq('tenant_id', tenant_id);
    }
  }
  return naoEntram;
}

// O insumo foi contado (inventário ou ajuste) entre `de` e agora? Regra única no banco.
async function contadoEntre(
  // deno-lint-ignore no-explicit-any
  supabase: any, tenant_id: string, ingredientId: string, de: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_insumo_contado_entre', {
    p_tenant: tenant_id, p_ingredient: ingredientId, p_de: de, p_ate: new Date().toISOString(),
  });
  if (error) throw new Error('Não foi possível conferir o inventário: ' + error.message);
  return !!data;
}

// Quanto entrou no estoque, por insumo, pelos movimentos desta compra. O movimento não guarda o id da
// compra, só o motivo com fornecedor + NF (os textos abaixo são os de todas as entradas de compra);
// conta só o que foi lançado depois da compra existir.
async function entradasDaCompra(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenant_id: string,
  // deno-lint-ignore no-explicit-any
  purchase: any,
  items: Array<Record<string, unknown>>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ings = [...new Set(items.map((i) => i.ingredient_id).filter(Boolean).map(String))];
  if (!ings.length) return out;
  const sup = String(purchase.supplier ?? '');
  const nf = purchase.invoice_number ? String(purchase.invoice_number) : '';
  const motivos = [
    `Compra: ${sup} - NF ${nf || 'S/N'}`,
    `Compra (entrada tardia): ${sup} - NF ${nf || 'S/N'}`,
    `Ajuste no recebimento: ${sup}${nf ? ` NF ${nf}` : ''}`,
    `Correção de conversão: ${sup} - NF ${nf || 'S/N'}`,
    `Ajuste por edição da compra: ${sup}${nf ? ` NF ${nf}` : ''}`,
  ].map((m) => m.slice(0, 250));
  // Movimento ligado à compra (purchase_id, desde 2026-09-28) conta mesmo datado antes da criação dela
  // (recebimento com data passada); os antigos, sem ligação, pelo motivo + data.
  const [porMotivo, porCompra] = await Promise.all([
    supabase.from('stock_movements')
      .select('id, ingredient_id, signed_quantity')
      .eq('tenant_id', tenant_id).in('ingredient_id', ings).in('reason', motivos)
      .gte('created_at', purchase.created_at),
    supabase.from('stock_movements')
      .select('id, ingredient_id, signed_quantity')
      .eq('tenant_id', tenant_id).eq('purchase_id', purchase.id),
  ]);
  const error = porMotivo.error ?? porCompra.error;
  if (error) { console.error('[purchase-write] entradasDaCompra:', error.message); return out; }
  const vistos = new Set<string>();
  for (const m of [...(porMotivo.data ?? []), ...(porCompra.data ?? [])] as Array<{ id: string; ingredient_id: string; signed_quantity: number | null }>) {
    if (vistos.has(m.id) || !ings.includes(m.ingredient_id)) continue;
    vistos.add(m.id);
    out.set(m.ingredient_id, (out.get(m.ingredient_id) ?? 0) + Number(m.signed_quantity ?? 0));
  }
  return out;
}

// Estorna a entrada de estoque de uma lista de itens (usado ao excluir e ao
// editar uma compra cujo estoque JÁ entrou — stock_applied_at preenchido).
async function reverseStockForItems(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenant_id: string,
  items: Array<Record<string, unknown>>,
  // deno-lint-ignore no-explicit-any
  user: any,
  reason: string,
  // Exclusão: estorna só o que comprovadamente ENTROU por esta compra (2026-09-25). Item ligado a insumo
  // depois do recebimento nunca teve entrada, e o estorno tirava do estoque o que não estava lá
  // (Chilli com Carne −48 kg). Na edição não se passa: lá o estorno é compensado pela entrada nova.
  // deno-lint-ignore no-explicit-any
  soOQueEntrou?: any,
  // Data do recebimento: insumo contado depois dela não é estornado — a contagem já acertou o saldo
  // (estornar agora deixava o estoque abaixo do real; e no "Detalhar itens" a entrada nova também pula).
  recebidoEm?: string | null,
) {
  const entrouPorInsumo = soOQueEntrou ? await entradasDaCompra(supabase, tenant_id, soOQueEntrou, items) : null;
  for (const item of items) {
    if (!item.ingredient_id) continue;
    if (recebidoEm && await contadoEntre(supabase, tenant_id, String(item.ingredient_id), recebidoEm)) continue;
    if (soOQueEntrou && item.stock_skipped_at) continue; // marcado "Não entram": nunca entrou
    // Estorna o que de fato entrou: a quantidade recebida, quando o recebimento ajustou
    const purchaseQty = item.received_quantity != null ? Number(item.received_quantity) : Number(item.quantity ?? 0);
    const unitsPerPkg = Number(item.units_per_package ?? 1) > 0 ? Number(item.units_per_package) : 1;
    let stockQty = purchaseQty * unitsPerPkg;
    if (entrouPorInsumo) {
      const ing = String(item.ingredient_id);
      const saldo = entrouPorInsumo.get(ing) ?? 0;
      stockQty = Math.min(stockQty, saldo);
      entrouPorInsumo.set(ing, saldo - Math.max(stockQty, 0));
    }
    if (stockQty <= 0) continue;

    // Estorno via RPC. O tipo antigo 'out' nao existe no enum
    // stock_movement_type — o insert falhava silenciosamente e o
    // estorno ficava sem registro de movimento.
    const { data: mvRes, error: mvErr } = await supabase.rpc('fn_add_stock_movement', {
      p_tenant_id: tenant_id,
      p_ingredient_id: item.ingredient_id,
      p_type: 'manual_out',
      p_quantity: stockQty,
      p_unit: null,
      p_reason: reason,
      p_notes: null, p_order_id: null, p_operator_id: user.id, p_batch_id: null,
    });
    if (mvErr) console.error('[purchase-write] estorno fn_add_stock_movement error:', mvErr.message ?? mvErr);
    // Estorno ligado à compra: soma com sinal com as entradas dela (Alterar data / entradasDaCompra).
    // Data do estorno = data do recebimento, a mesma da entrada que ele desfaz (2026-10-08): com a hora do
    // clique, excluir/editar uma compra recebida dias antes deixava entrada em dobro naquele dia e uma saída
    // que ninguém fez hoje (Lapeana NF 336: +100 em 02/10, −100 em 08/10).
    else if (mvRes?.movement_id) {
      const purchaseId = soOQueEntrou?.id ?? item.purchase_id ?? null;
      const datar = !!recebidoEm && new Date(recebidoEm).getTime() < Date.now() - 60_000;
      if (purchaseId || datar) {
        await supabase.from('stock_movements').update({ ...(purchaseId ? { purchase_id: purchaseId } : {}), ...(datar ? { created_at: recebidoEm } : {}) })
          .eq('id', mvRes.movement_id).eq('tenant_id', tenant_id);
      }
    }
  }
}

interface InstallmentOpts {
  hasCustomInstallments: boolean;
  // deno-lint-ignore no-explicit-any
  customInstallments: any[];
  isLegacyInstallment: boolean;
  installmentCount?: number;
  installmentIntervalDays?: number;
}

// Parcelas com data e valor escolhidos (Nova Compra e, desde 2026-09-29, create_missing_bills da
// Trilha). Extraído do createBillsForPurchase sem mudar o formato: descrição "(i/n)", parent_id na
// 1ª, installments. Uma parcela só sai no formato da conta única (sem "(1/1)"). `hoje` (Brasília)
// só vem da Trilha: conta lançada depois do vencimento nasce 'overdue'; sem ele, 'pending' como antes.
async function insertInstallmentBills(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenant_id: string,
  // deno-lint-ignore no-explicit-any
  purchase: any,
  purchaseData: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
  parcelas: any[],
  hoje?: string,
  // Nova Compra sempre gravou "(i/n)" + installments, mesmo com 1 parcela; mantém igual.
  sempreParcelado = false,
): Promise<string[]> {
  const n = parcelas.length;
  const parc = n > 1 || sempreParcelado;
  const nf = `Compra - ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''}`;
  const ids: string[] = [];
  let parentId: string | null = null;
  for (let i = 0; i < n; i++) {
    const inst = parcelas[i];
    const { data: bill, error } = await supabase.from('fin_accounts_payable').insert({
      tenant_id, supplier: purchase.supplier,
      description: parc ? `${nf} (${i + 1}/${n})` : nf,
      category: 'Compras', cost_center_id: purchaseData.cost_center_id || null,
      bank_account_id: purchaseData.bank_account_id || null, amount: Number(inst.amount),
      due_date: inst.due_date, status: hoje ? statusPorVencimento(String(inst.due_date), hoje) : 'pending', is_recurring: false,
      ...(parc ? { installments: n, installment_number: i + 1, ...(parentId ? { parent_id: parentId } : {}) } : {}),
      notes: purchaseData.notes || null, reference_id: purchase.id, reference_type: 'purchase',
    }).select('id').single();
    if (error) throw error;
    ids.push(String(bill.id));
    if (i === 0) parentId = String(bill.id);
  }
  return ids;
}

// Gera as contas a pagar (ou o lançamento direto no caixa, se paga à vista)
// para uma compra já criada/atualizada.
async function createBillsForPurchase(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenant_id: string,
  // deno-lint-ignore no-explicit-any
  purchase: any,
  purchaseData: Record<string, unknown>,
  opts: InstallmentOpts,
) {
  const { hasCustomInstallments, customInstallments, isLegacyInstallment, installmentCount, installmentIntervalDays } = opts;

  // Bonificação: mercadoria sem custo — nada a pagar, nenhuma saída de caixa.
  if (purchaseData.is_bonus === true) return;

  if (hasCustomInstallments) {
    await insertInstallmentBills(supabase, tenant_id, purchase, purchaseData, customInstallments, undefined, true);
  } else if (isLegacyInstallment) {
    const numParcelas = Number(installmentCount);
    const intervalDays = Number(installmentIntervalDays ?? 30);
    const valorParcela = Math.round((Number(purchaseData.total_amount) / numParcelas) * 100) / 100;
    const baseDate = new Date((purchaseData.due_date || purchaseData.purchase_date) as string);
    const { data: parentBill, error: parentErr } = await supabase.from('fin_accounts_payable').insert({
      tenant_id, supplier: purchase.supplier,
      description: `Compra - ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''} (1/${numParcelas})`,
      category: 'Compras', cost_center_id: purchaseData.cost_center_id || null,
      bank_account_id: purchaseData.bank_account_id || null, amount: valorParcela,
      due_date: baseDate.toISOString().split('T')[0], status: 'pending', is_recurring: false,
      installments: numParcelas, installment_number: 1, notes: purchaseData.notes || null,
      reference_id: purchase.id, reference_type: 'purchase',
    }).select().single();
    if (parentErr) throw parentErr;
    for (let i = 2; i <= numParcelas; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + intervalDays * (i - 1));
      const { error: instErr } = await supabase.from('fin_accounts_payable').insert({
        tenant_id, supplier: purchase.supplier,
        description: `Compra - ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''} (${i}/${numParcelas})`,
        category: 'Compras', cost_center_id: purchaseData.cost_center_id || null,
        bank_account_id: purchaseData.bank_account_id || null,
        amount: i === numParcelas ? Number(purchaseData.total_amount) - valorParcela * (numParcelas - 1) : valorParcela,
        due_date: dueDate.toISOString().split('T')[0], status: 'pending', is_recurring: false,
        installments: numParcelas, installment_number: i, parent_id: parentBill.id,
        notes: purchaseData.notes || null, reference_id: purchase.id, reference_type: 'purchase',
      });
      if (instErr) throw instErr;
    }
  } else if (purchaseData.payment_status !== 'paid') {
    const defaultDueDate = purchaseData.due_date ?? (() => {
      const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0];
    })();
    const { error: billErr } = await supabase.from('fin_accounts_payable').insert({
      tenant_id, supplier: purchase.supplier,
      description: `Compra - ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''}`,
      category: 'Compras', cost_center_id: purchaseData.cost_center_id || null,
      bank_account_id: purchaseData.bank_account_id || null, amount: purchaseData.total_amount,
      due_date: defaultDueDate, status: 'pending', is_recurring: false,
      notes: purchaseData.notes || null, reference_id: purchase.id, reference_type: 'purchase',
    });
    if (billErr) throw billErr;
  } else if (purchaseData.payment_status === 'paid') {
    const { error: cfErr } = await supabase.from('fin_cash_flow').insert({
      tenant_id, type: 'expense', amount: purchaseData.total_amount,
      description: `Compra - ${purchase.supplier}`, category: 'Compras',
      cost_center_id: purchaseData.cost_center_id || null, origin: 'auto_purchase',
      reference_id: purchase.id, date: purchaseData.purchase_date,
    });
    if (cfErr) throw cfErr;
    if (purchaseData.bank_account_id) {
      await supabase.rpc('fn_bank_debit', {
        p_bank_account_id: purchaseData.bank_account_id, p_amount: purchaseData.total_amount,
        p_description: `Compra - ${purchase.supplier}`, p_reference_type: 'purchase',
        p_reference_id: purchase.id, p_transaction_date: purchaseData.purchase_date,
      });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Chamada interna: fiscal-inbound lançando sozinha a nota de entrada de um
    // fornecedor já conhecido (sem usuário logado). Header x-internal-key =
    // FISCAL_INTERNAL_KEY. Só pode CRIAR compra — nunca editar/excluir.
    const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
    const internal = internalKey.length >= 20 && (req.headers.get('x-internal-key') ?? '') === internalKey;

    // deno-lint-ignore no-explicit-any
    let user: any = null;
    if (!internal) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      const { data: authData } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      user = authData?.user ?? null;
      if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json();
    const { action, tenant_id, payload } = body;

    if (!tenant_id) return new Response(JSON.stringify({ error: 'tenant_id required' }), { status: 400, headers: corsHeaders });

    if (internal) {
      if (action !== 'create_purchase') {
        return new Response(JSON.stringify({ error: 'Chamada interna só pode criar compra' }), { status: 403, headers: corsHeaders });
      }
    } else {
      // Valida que o usuario pertence ao tenant informado (antes qualquer
      // usuario autenticado podia escrever em qualquer tenant via service role)
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id, role')
        .eq('user_id', user.id)
        .eq('tenant_id', tenant_id)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Usuario nao pertence ao tenant informado' }), { status: 403, headers: corsHeaders });
      }
      // Compras são admin, gerente ou o papel financeiro (spec modulo-financeiro-sem-pdv, 2026-09-20).
      // Antes qualquer membro da loja (ex.: operador de caixa) criava/excluía compra e conta a pagar
      // pela API. A chave interna (acima) segue igual.
      if (!isFinanceiroRole(membership.role)) {
        return new Response(JSON.stringify({ error: 'Sem permissão: compras são só para administrador ou supervisor da loja.' }), { status: 403, headers: corsHeaders });
      }
    }

    let result;

    switch (action) {
      case 'list_purchase_items': {
        const { ingredient_id } = payload;
        if (!ingredient_id) {
          return new Response(JSON.stringify({ error: 'ingredient_id required' }), { status: 400, headers: corsHeaders });
        }

        const { data: itemsData, error: itemsError } = await supabase
          .from('fin_purchase_items')
          .select('id, quantity, unit_price, total_price, purchase_id, unit_label, units_per_package, ingredient_id')
          .eq('ingredient_id', ingredient_id)
          .eq('tenant_id', tenant_id)
          .limit(50);

        if (itemsError) throw itemsError;
        if (!itemsData || itemsData.length === 0) {
          result = { data: [] };
          break;
        }

        const purchaseIds = [...new Set(itemsData.map((i) => i.purchase_id))];
        const { data: purchasesData } = await supabase
          .from('fin_purchases')
          .select('id, purchase_date, supplier')
          .in('id', purchaseIds)
          .eq('tenant_id', tenant_id)
          .order('purchase_date', { ascending: false });

        const purchasesMap = new Map(
          (purchasesData ?? []).map((p: { id: string; purchase_date: string; supplier: string }) => [p.id, p])
        );

        const rows = itemsData
          .map((item: Record<string, unknown>) => {
            const purchase = purchasesMap.get(item.purchase_id as string);
            if (!purchase) return null;
            return {
              id: item.id,
              purchase_date: purchase.purchase_date,
              supplier: purchase.supplier,
              quantity: Number(item.quantity),
              unit_price: Number(item.unit_price),
              total_price: Number(item.total_price),
              purchase_unit: item.unit_label,
              purchase_factor: item.units_per_package,
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime());

        result = { data: rows };
        break;
      }

      case 'list_purchase_prices': {
        const { ingredient_id } = payload;
        if (!ingredient_id) {
          return new Response(JSON.stringify({ error: 'ingredient_id required' }), { status: 400, headers: corsHeaders });
        }

        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const dateStr = threeMonthsAgo.toISOString().split('T')[0];

        const { data: itemsData, error: itemsError } = await supabase
          .from('fin_purchase_items')
          .select('id, unit_price, purchase_id')
          .eq('ingredient_id', ingredient_id)
          .eq('tenant_id', tenant_id)
          .limit(50);

        if (itemsError) throw itemsError;
        if (!itemsData || itemsData.length === 0) {
          result = { data: [] };
          break;
        }

        const purchaseIds = [...new Set(itemsData.map((i) => i.purchase_id))];
        const { data: purchasesData } = await supabase
          .from('fin_purchases')
          .select('id, purchase_date, supplier')
          .in('id', purchaseIds)
          .eq('tenant_id', tenant_id)
          .gte('purchase_date', dateStr)
          .order('purchase_date', { ascending: true });

        const purchasesMap = new Map(
          (purchasesData ?? []).map((p: { id: string; purchase_date: string; supplier: string }) => [p.id, p])
        );

        const rows = itemsData
          .map((item: Record<string, unknown>) => {
            const purchase = purchasesMap.get(item.purchase_id as string);
            if (!purchase) return null;
            return {
              date: purchase.purchase_date,
              price: Number(item.unit_price),
              supplier: purchase.supplier,
            };
          })
          .filter(Boolean);

        result = { data: rows };
        break;
      }

      case 'create_purchase': {
        const {
          items,
          installment_count,
          installment_interval_days,
          custom_installments,
          ...rawData
        } = payload;

        const purchaseData: Record<string, unknown> = { ...rawData };
        // Nunca confiar nessas chaves do body: quem escreve a compra, em que loja
        // e os carimbos de recebimento/pagamento são controlados pelo servidor.
        delete purchaseData.tenant_id;
        delete purchaseData.id;
        delete purchaseData.created_by;
        delete purchaseData.delivery_confirmed_at;
        delete purchaseData.stock_applied_at;
        if (!purchaseData.due_date) purchaseData.due_date = null;
        if (!purchaseData.cost_center_id) purchaseData.cost_center_id = null;
        if (!purchaseData.bank_account_id) purchaseData.bank_account_id = null;
        if (!purchaseData.invoice_number) purchaseData.invoice_number = null;
        if (!purchaseData.notes) purchaseData.notes = null;
        const freightAmount = r2(Number(purchaseData.freight_amount ?? 0) + absorverLinhasDeFrete(items));
        purchaseData.freight_amount = freightAmount;

        ratearFrete(items, freightAmount);
        const computedItems = computePurchaseItems(tenant_id, items);
        const avisosConversao = await applyIngredientConversions(supabase, tenant_id, items, computedItems);
        if (computedItems.length > 0) {
          const itemsSubtotal = computedItems.reduce((s, it) => s + Number(it.total_price ?? 0), 0);
          purchaseData.total_amount = Math.round((itemsSubtotal + freightAmount) * 100) / 100;
        }

        const supplierName = String(purchaseData.supplier ?? '').trim();
        purchaseData.supplier = supplierName;
        const supplierRecord = supplierName ? await resolveOrCreateSupplier(supabase, tenant_id, supplierName) : null;
        if (supplierRecord?.id) purchaseData.supplier_id = supplierRecord.id;

        await inheritMerchandiseCategories(supabase, tenant_id, computedItems);

        const hasCustomInstallments = Array.isArray(custom_installments) && custom_installments.length >= 2;
        const isLegacyInstallment = !hasCustomInstallments && installment_count && installment_count > 1;
        const isInstallment = hasCustomInstallments || isLegacyInstallment;
        const finalStatus = isInstallment ? 'partial' : purchaseData.payment_status;

        const { data: purchase, error: purchaseError } = await supabase
          .from('fin_purchases')
          .insert({ ...purchaseData, payment_status: finalStatus, tenant_id, created_by: user?.id ?? null })
          .select().single();

        if (purchaseError) throw purchaseError;

        // Criação "tudo ou nada" (2026-09-17): se itens ou contas a pagar falharem, apaga o que já
        // foi gravado desta compra (não sobra compra sem itens ou sem conta a pagar) e devolve 500.
        try {
          if (computedItems.length > 0) {
            const itemsToInsert = computedItems.map((it) => ({ ...it, purchase_id: purchase.id }));
            const { error: itemsError } = await supabase.from('fin_purchase_items').insert(itemsToInsert);
            if (itemsError) throw itemsError;

            await applyStockAndPricing(supabase, tenant_id, purchase, computedItems, user, supplierRecord?.id ?? null);
            await upsertCatalogPresentations(supabase, tenant_id, purchase, computedItems, supplierRecord?.id ?? null);
          }

          await createBillsForPurchase(supabase, tenant_id, purchase, purchaseData, {
            hasCustomInstallments,
            customInstallments: Array.isArray(custom_installments) ? custom_installments : [],
            isLegacyInstallment,
            installmentCount: installment_count,
            installmentIntervalDays: installment_interval_days,
          });
        } catch (createErr) {
          console.error('[purchase-write] create_purchase falhou, desfazendo a compra:', createErr);
          await supabase.from('fin_accounts_payable').delete().eq('reference_id', purchase.id).eq('tenant_id', tenant_id);
          await supabase.from('fin_cash_flow').delete().eq('reference_id', purchase.id).eq('tenant_id', tenant_id).eq('origin', 'auto_purchase');
          await supabase.from('fin_purchase_items').delete().eq('purchase_id', purchase.id).eq('tenant_id', tenant_id);
          await supabase.from('fin_purchases').delete().eq('id', purchase.id).eq('tenant_id', tenant_id);
          throw createErr;
        }

        result = { data: purchase, ...(avisosConversao.length ? { avisos_conversao: avisosConversao } : {}) };
        break;
      }

      case 'update_purchase': {
        const {
          id,
          items,
          installment_count,
          installment_interval_days,
          custom_installments,
          ...rawData
        } = payload;
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });

        const { data: existing, error: fetchErr } = await supabase
          .from('fin_purchases')
          .select('*, items:fin_purchase_items(*)')
          .eq('id', id).eq('tenant_id', tenant_id).maybeSingle();
        if (fetchErr) return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: corsHeaders });
        if (!existing) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });

        // Só é seguro reescrever estoque/contas quando NADA da compra original
        // já se moveu — nem entrega confirmada, nem pagamento registrado. Caso
        // contrário o usuário precisa excluir e lançar de novo (a exclusão já
        // sabe estornar estoque e contas em aberto corretamente).
        if (existing.delivery_confirmed_at) {
          return new Response(JSON.stringify({
            error: 'Recebimento já confirmado — não é possível editar. Exclua e lance novamente para corrigir.',
          }), { status: 409, headers: corsHeaders });
        }
        if (existing.payment_status === 'paid') {
          return new Response(JSON.stringify({
            error: 'Compra já paga (caixa e banco debitados) — não é possível editar. Exclua e lance novamente para corrigir.',
          }), { status: 409, headers: corsHeaders });
        }
        const { data: existingBills } = await supabase
          .from('fin_accounts_payable')
          .select('id, status, paid_amount')
          .eq('reference_id', id).eq('tenant_id', tenant_id);
        const hasPayment = (existingBills ?? []).some(
          (b: Record<string, unknown>) => b.status === 'paid' || Number(b.paid_amount ?? 0) > 0,
        );
        if (hasPayment) {
          return new Response(JSON.stringify({
            error: 'Já existe pagamento registrado nesta compra — não é possível editar. Exclua e lance novamente para corrigir.',
          }), { status: 409, headers: corsHeaders });
        }

        // Desfaz o efeito da versão antiga: estoque, contas a pagar e itens.
        // Nenhuma delas tem pagamento (guarda acima já garantiu isso).
        const oldItems = (existing.items ?? []) as Array<Record<string, unknown>>;
        // Só compras antigas (antes de 2026-09-11) têm estoque lançado sem recebimento
        // confirmado; nas novas o estoque ainda não entrou e não há o que estornar.
        if (existing.stock_applied_at) {
          await reverseStockForItems(
            supabase, tenant_id, oldItems, user,
            `Ajuste por edição da compra: ${existing.supplier}${existing.invoice_number ? ` NF ${existing.invoice_number}` : ''}`,
            undefined, existing.delivery_confirmed_at ?? existing.stock_applied_at,
          );
        }
        await supabase.from('fin_accounts_payable').delete().eq('reference_id', id).eq('tenant_id', tenant_id);
        await supabase.from('fin_cash_flow').delete().eq('reference_id', id).eq('tenant_id', tenant_id).eq('origin', 'auto_purchase');
        await supabase.from('fin_purchase_items').delete().eq('purchase_id', id).eq('tenant_id', tenant_id);

        // Recria com os dados novos — mesmo cálculo do create_purchase.
        const purchaseData: Record<string, unknown> = { ...rawData };
        // Nunca confiar nessas chaves do body: quem escreve a compra, em que loja
        // e os carimbos de recebimento/pagamento são controlados pelo servidor.
        delete purchaseData.tenant_id;
        delete purchaseData.id;
        delete purchaseData.created_by;
        delete purchaseData.delivery_confirmed_at;
        delete purchaseData.stock_applied_at;
        if (!purchaseData.due_date) purchaseData.due_date = null;
        if (!purchaseData.cost_center_id) purchaseData.cost_center_id = null;
        if (!purchaseData.bank_account_id) purchaseData.bank_account_id = null;
        if (!purchaseData.invoice_number) purchaseData.invoice_number = null;
        if (!purchaseData.notes) purchaseData.notes = null;
        const freightAmount = r2(Number(purchaseData.freight_amount ?? 0) + absorverLinhasDeFrete(items));
        purchaseData.freight_amount = freightAmount;

        ratearFrete(items, freightAmount);
        const computedItems = computePurchaseItems(tenant_id, items);
        const avisosConversao = await applyIngredientConversions(supabase, tenant_id, items, computedItems);
        if (computedItems.length > 0) {
          const itemsSubtotal = computedItems.reduce((s, it) => s + Number(it.total_price ?? 0), 0);
          purchaseData.total_amount = Math.round((itemsSubtotal + freightAmount) * 100) / 100;
        }

        const supplierName = String(purchaseData.supplier ?? '').trim();
        purchaseData.supplier = supplierName;
        const supplierRecord = supplierName ? await resolveOrCreateSupplier(supabase, tenant_id, supplierName) : null;
        if (supplierRecord?.id) purchaseData.supplier_id = supplierRecord.id;

        await inheritMerchandiseCategories(supabase, tenant_id, computedItems);

        const hasCustomInstallments = Array.isArray(custom_installments) && custom_installments.length >= 2;
        const isLegacyInstallment = !hasCustomInstallments && installment_count && installment_count > 1;
        const isInstallment = hasCustomInstallments || isLegacyInstallment;
        const finalStatus = isInstallment ? 'partial' : purchaseData.payment_status;

        const { data: updated, error: updateErr } = await supabase
          .from('fin_purchases')
          .update({ ...purchaseData, payment_status: finalStatus, delivery_confirmed_at: null, delivery_notes: null, stock_applied_at: null })
          .eq('id', id).eq('tenant_id', tenant_id)
          .select().single();
        if (updateErr) throw updateErr;

        if (computedItems.length > 0) {
          const itemsToInsert = computedItems.map((it) => ({ ...it, purchase_id: id }));
          const { error: itemsError } = await supabase.from('fin_purchase_items').insert(itemsToInsert);
          if (itemsError) throw itemsError;

          await applyStockAndPricing(supabase, tenant_id, updated, computedItems, user, supplierRecord?.id ?? null);
          await upsertCatalogPresentations(supabase, tenant_id, updated, computedItems, supplierRecord?.id ?? null);
        }

        await createBillsForPurchase(supabase, tenant_id, updated, purchaseData, {
          hasCustomInstallments,
          customInstallments: Array.isArray(custom_installments) ? custom_installments : [],
          isLegacyInstallment,
          installmentCount: installment_count,
          installmentIntervalDays: installment_interval_days,
        });

        result = { data: updated, ...(avisosConversao.length ? { avisos_conversao: avisosConversao } : {}) };
        break;
      }

      // Trocar só a forma de pagamento (2026-09-29): vale para qualquer compra — paga, recebida ou
      // com parcela baixada. É só o rótulo da compra; estoque, contas a pagar e caixa não mudam.
      case 'set_payment_method': {
        const { id, payment_method } = payload;
        const metodo = String(payment_method ?? '').trim();
        if (!id || !metodo) return new Response(JSON.stringify({ error: 'id e payment_method obrigatórios' }), { status: 400, headers: corsHeaders });
        const { data: updated, error: updErr } = await supabase
          .from('fin_purchases').update({ payment_method: metodo })
          .eq('id', id).eq('tenant_id', tenant_id)
          .select('id, payment_method').maybeSingle();
        if (updErr) throw updErr;
        if (!updated) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });
        result = { data: updated };
        break;
      }

      // Detalhar itens (2026-09-29): troca os itens de uma compra JÁ lançada — inclusive paga ou recebida —
      // sem mexer no valor. Caso típico: compra lançada pelo extrato como 1 item "Compra" e depois a nota
      // (foto/QR) ou a digitação diz o que veio. O total dos itens + frete tem que fechar com o da compra,
      // então contas a pagar, pagamento e caixa não mudam. Estoque: se a compra já entrou no estoque, sai
      // só o que comprovadamente entrou pelos itens antigos e entra o dos novos.
      case 'replace_items': {
        const { purchase_id, items, invoice_number } = payload ?? {};
        if (!purchase_id) return new Response(JSON.stringify({ error: 'purchase_id required' }), { status: 400, headers: corsHeaders });
        if (!Array.isArray(items) || items.length === 0) return new Response(JSON.stringify({ error: 'Informe ao menos um item' }), { status: 400, headers: corsHeaders });
        const { data: existing, error: fetchErr } = await supabase
          .from('fin_purchases').select('*, items:fin_purchase_items(*)')
          .eq('id', purchase_id).eq('tenant_id', tenant_id).maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!existing) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });

        // Frete da compra rateado pelo valor de cada item (entra no custo do insumo, como na Nova Compra);
        // linha "Frete" nos itens novos soma no frete da compra
        const freteDasLinhas = absorverLinhasDeFrete(items);
        const freight = r2(Number(existing.freight_amount ?? 0) + freteDasLinhas);
        (items as Array<Record<string, unknown>>).forEach((it) => { it.freight_allocated = 0; });
        ratearFrete(items, freight);
        const computedItems = computePurchaseItems(tenant_id, items);
        for (const it of computedItems) {
          if (!String(it.description ?? '').trim()) return new Response(JSON.stringify({ error: 'Todo item precisa de descrição' }), { status: 400, headers: corsHeaders });
          if (!(Number(it.quantity) > 0) || !(Number(it.total_price) > 0)) {
            return new Response(JSON.stringify({ error: `Quantidade e valor são obrigatórios em "${it.description}"` }), { status: 400, headers: corsHeaders });
          }
        }
        const ingIds = [...new Set(computedItems.map((it) => it.ingredient_id).filter(Boolean) as string[])];
        if (ingIds.length) {
          const { data: ings } = await supabase.from('ingredients').select('id').eq('tenant_id', tenant_id).is('deleted_at', null).in('id', ingIds);
          if ((ings ?? []).length !== ingIds.length) return new Response(JSON.stringify({ error: 'Insumo inválido para esta loja' }), { status: 400, headers: corsHeaders });
        }
        const avisosConversao = await applyIngredientConversions(supabase, tenant_id, items, computedItems);
        const soma = Math.round((computedItems.reduce((s, it) => s + Number(it.total_price ?? 0), 0) + freight) * 100) / 100;
        const total = Math.round(Number(existing.total_amount ?? 0) * 100) / 100;
        if (Math.abs(soma - total) > 0.01) {
          const brl = (v: number) => v.toFixed(2).replace('.', ',');
          return new Response(JSON.stringify({
            error: `Os itens${freight ? ' + frete' : ''} somam R$ ${brl(soma)} e a compra é R$ ${brl(total)}: ajuste até fechar (o valor pago não muda).`,
          }), { status: 409, headers: corsHeaders });
        }
        await inheritMerchandiseCategories(supabase, tenant_id, computedItems);

        const oldItems = (existing.items ?? []) as Array<Record<string, unknown>>;
        const rotulo = `${existing.supplier}${existing.invoice_number ? ` NF ${existing.invoice_number}` : ''}`;
        const jaNoEstoque = !!existing.stock_applied_at;
        if (jaNoEstoque) {
          // Só o que entrou por esta compra sai (mesma guarda da exclusão)
          await reverseStockForItems(supabase, tenant_id, oldItems, user, `Detalhamento dos itens da compra: ${rotulo}`, existing,
            existing.delivery_confirmed_at ?? existing.stock_applied_at);
        }
        await supabase.from('fin_purchase_items').delete().eq('purchase_id', purchase_id).eq('tenant_id', tenant_id);
        const { data: novos, error: itemsError } = await supabase.from('fin_purchase_items')
          .insert(computedItems.map((it) => ({ ...it, purchase_id }))).select('*');
        if (itemsError) throw itemsError;

        const nf = invoice_number ? String(invoice_number).trim().slice(0, 30) : '';
        let compra = existing;
        const mudaCab: Record<string, unknown> = {};
        if (nf && !existing.invoice_number) mudaCab.invoice_number = nf;
        if (freteDasLinhas > 0) mudaCab.freight_amount = freight;
        if (Object.keys(mudaCab).length) {
          const { data: updated } = await supabase.from('fin_purchases').update(mudaCab)
            .eq('id', purchase_id).eq('tenant_id', tenant_id).select().single();
          if (updated) compra = updated;
        }
        await applyStockAndPricing(supabase, tenant_id, compra, computedItems, user, existing.supplier_id ?? null);
        await upsertCatalogPresentations(supabase, tenant_id, compra, computedItems, existing.supplier_id ?? null);
        const naoEntram = jaNoEstoque ? await applyStockEntry(supabase, tenant_id, compra, (novos ?? []) as Array<Record<string, unknown>>, user) : [];

        result = {
          data: {
            purchase_id, itens: computedItems.length, estoque: jaNoEstoque ? 'ajustado' : 'entra no recebimento',
            ...(naoEntram.length ? { nao_entraram_por_contagem: naoEntram } : {}),
          },
          ...(avisosConversao.length ? { avisos_conversao: avisosConversao } : {}),
        };
        break;
      }

      // Conta que falta numa compra (Trilha versão D, 2026-09-29): compra a prazo lançada sem conta a
      // pagar (nota importada "paga", conta apagada por engano...). Só cria quando a compra claramente
      // não tem conta NEM saída de caixa: qualquer sinal de que já foi paga/lançada recusa.
      case 'create_missing_bills': {
        const { purchase_id, parcelas } = payload ?? {};
        if (!purchase_id) return new Response(JSON.stringify({ error: 'purchase_id required' }), { status: 400, headers: corsHeaders });
        const { data: compra, error: cErr } = await supabase.from('fin_purchases')
          .select('id, supplier, invoice_number, total_amount, payment_status, is_bonus, cost_center_id, bank_account_id, notes, delivery_confirmed_at')
          .eq('id', purchase_id).eq('tenant_id', tenant_id).maybeSingle();
        if (cErr) throw cErr;
        if (!compra) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });
        const recusa = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 409, headers: corsHeaders });
        if (compra.is_bonus) return recusa('Bonificação não tem conta a pagar.');
        if (compra.payment_status === 'paid') return recusa('A compra está como paga: não cria conta a pagar.');
        const { data: jaContas } = await supabase.from('fin_accounts_payable').select('id')
          .eq('tenant_id', tenant_id).eq('reference_type', 'purchase').eq('reference_id', purchase_id).neq('status', 'cancelled').limit(1);
        if (jaContas?.length) return recusa('Essa compra já tem conta a pagar. Atualize a tela.');
        const { data: caixa } = await supabase.from('fin_cash_flow').select('id')
          .eq('tenant_id', tenant_id).eq('origin', 'auto_purchase').eq('reference_id', purchase_id).limit(1);
        if (caixa?.length) return recusa('Essa compra foi lançada como paga à vista (saída de caixa): não cria conta a pagar.');
        const v = validarParcelas(parcelas, Number(compra.total_amount));
        if (!v.ok) return new Response(JSON.stringify({ error: v.erro }), { status: 400, headers: corsHeaders });

        const purchaseData = { cost_center_id: compra.cost_center_id, bank_account_id: compra.bank_account_id, notes: compra.notes };
        let billIds: string[];
        try {
          billIds = await insertInstallmentBills(supabase, tenant_id, compra, purchaseData, v.parcelas, hojeBrasilia());
        } catch (e) {
          // Tudo ou nada: acima foi conferido que a compra não tinha conta, então as que existem agora são daqui.
          await supabase.from('fin_accounts_payable').delete().eq('tenant_id', tenant_id).eq('reference_type', 'purchase')
            .eq('reference_id', purchase_id).in('status', ['pending', 'overdue']).is('paid_date', null);
          throw e;
        }
        // Mesmo estado que o create_purchase deixa: parcelado = 'partial', conta única = 'pending'.
        await supabase.from('fin_purchases').update({ payment_status: billIds.length > 1 ? 'partial' : 'pending' })
          .eq('id', purchase_id).eq('tenant_id', tenant_id).neq('payment_status', 'paid');
        // Mercadoria já recebida: as contas nascem com o recebimento marcado (igual ao confirm_delivery).
        if (compra.delivery_confirmed_at) {
          await supabase.from('fin_accounts_payable').update({ delivery_confirmed: true, delivery_confirmed_at: compra.delivery_confirmed_at })
            .in('id', billIds).eq('tenant_id', tenant_id);
        }
        console.log('[purchase-write] create_missing_bills', JSON.stringify({ tenant_id, purchase_id, n: billIds.length, user: user?.id }));
        result = { bill_ids: billIds };
        break;
      }

      // Desfazer do create_missing_bills: só apaga conta intocada (sem baixa, sem extrato, sem Inter).
      case 'delete_missing_bills': {
        const { purchase_id, bill_ids } = payload ?? {};
        const ids = Array.isArray(bill_ids) ? [...new Set(bill_ids.map(String))] : [];
        if (!purchase_id || ids.length === 0 || ids.length > 60) return new Response(JSON.stringify({ error: 'purchase_id e bill_ids obrigatórios' }), { status: 400, headers: corsHeaders });
        const recusa = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 409, headers: corsHeaders });
        const { data: contas, error: bErr } = await supabase.from('fin_accounts_payable')
          .select('id, status, paid_amount, paid_date, reference_type, reference_id').eq('tenant_id', tenant_id).in('id', ids);
        if (bErr) throw bErr;
        if ((contas ?? []).length !== ids.length) return recusa('Alguma dessas contas não existe mais. Atualize a tela.');
        for (const c of contas ?? []) {
          if (c.reference_type !== 'purchase' || String(c.reference_id) !== String(purchase_id)) return recusa('Essas contas não são dessa compra.');
          if (!['pending', 'overdue'].includes(String(c.status)) || Number(c.paid_amount ?? 0) > 0 || c.paid_date) return recusa('Uma das contas já teve pagamento: estorne pela tela de Contas a Pagar.');
        }
        // Extrato: conciliação confirmada recusa; sugestão ainda não confirmada é só limpa.
        const { data: ext1 } = await supabase.from('fin_bank_statement_imports').select('id, status, reconciled')
          .eq('tenant_id', tenant_id).in('match_ref_id', ids);
        const { data: ext2 } = await supabase.from('fin_bank_statement_imports').select('id')
          .eq('tenant_id', tenant_id).in('match_detail->confirmed->>bill_id', ids).limit(1);
        if (ext2?.length || (ext1 ?? []).some((r: Record<string, unknown>) => r.reconciled || r.status !== 'pending')) {
          return recusa('Uma das contas está ligada a um pagamento do extrato: desfaça na Conciliação.');
        }
        const { data: legado } = await supabase.from('fin_bank_statements').select('id').in('accounts_payable_id', ids).limit(1);
        if (legado?.length) return recusa('Uma das contas está conciliada no extrato antigo.');
        const { data: inter } = await supabase.from('fin_inter_payments').select('id, status').in('bill_id', ids)
          .in('status', ['draft', 'awaiting_pin', 'sending', 'sent', 'pending_approval', 'approved', 'scheduled']).limit(1);
        if (inter?.length) return recusa('Há pagamento do Inter preparado para uma dessas contas: cancele antes.');
        const { data: pedidos } = await supabase.from('fin_payment_requests').select('id').in('bill_id', ids).limit(1);
        if (pedidos?.length) return recusa('Uma dessas contas está ligada a um pedido de pagamento.');

        if ((ext1 ?? []).length) {
          await supabase.from('fin_bank_statement_imports').update({ match_kind: null, match_ref_id: null, match_confidence: null, match_detail: null })
            .eq('tenant_id', tenant_id).in('match_ref_id', ids).eq('match_kind', 'payable').eq('status', 'pending').eq('reconciled', false);
        }
        const { error: dErr } = await supabase.from('fin_accounts_payable').delete().eq('tenant_id', tenant_id).in('id', ids)
          .in('status', ['pending', 'overdue']).is('paid_date', null);
        if (dErr) throw dErr;
        // Sem conta nenhuma: a compra volta ao estado anterior à criação (parcelado → pendente).
        const { data: resto } = await supabase.from('fin_accounts_payable').select('id')
          .eq('tenant_id', tenant_id).eq('reference_type', 'purchase').eq('reference_id', purchase_id).neq('status', 'cancelled').limit(1);
        if (!resto?.length) {
          await supabase.from('fin_purchases').update({ payment_status: 'pending' }).eq('id', purchase_id).eq('tenant_id', tenant_id).eq('payment_status', 'partial');
        }
        console.log('[purchase-write] delete_missing_bills', JSON.stringify({ tenant_id, purchase_id, n: ids.length, user: user?.id }));
        result = { deleted: ids };
        break;
      }

      case 'confirm_delivery': {
        const { purchase_id, delivery_notes } = payload;
        if (!purchase_id) return new Response(JSON.stringify({ error: 'purchase_id required' }), { status: 400, headers: corsHeaders });

        const { data: purchase, error: purchaseErr } = await supabase
          .from('fin_purchases').select('*, items:fin_purchase_items(*)').eq('id', purchase_id).eq('tenant_id', tenant_id).single();
        if (purchaseErr || !purchase) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });
        if (purchase.delivery_confirmed_at) return new Response(JSON.stringify({ error: 'Recebimento já confirmado anteriormente' }), { status: 409, headers: corsHeaders });

        const confirmedAt = new Date().toISOString();
        // O estoque entra AQUI, no recebimento (a tela usa o purchase-confirm-delivery,
        // que faz o mesmo com ajuste de quantidades). Compra antiga que já teve a
        // entrada na criação (stock_applied_at preenchido) não repete.
        const stockNow = !purchase.stock_applied_at;
        // Trava atômica ANTES do estoque: de duas confirmações simultâneas, só uma passa.
        const { data: locked, error: lockErr } = await supabase.from('fin_purchases').update({
          delivery_confirmed_at: confirmedAt, delivery_registered_at: confirmedAt, delivery_notes: delivery_notes || null,
          ...(stockNow ? { stock_applied_at: confirmedAt } : {}),
        }).eq('id', purchase_id).eq('tenant_id', tenant_id).is('delivery_confirmed_at', null).select('id');
        if (lockErr) throw lockErr;
        if (!locked || locked.length === 0) return new Response(JSON.stringify({ error: 'Recebimento já confirmado' }), { status: 409, headers: corsHeaders });
        if (stockNow) {
          // Item sem insumo com vínculo memorizado (fornecedor + código / EAN) entra ligado —
          // sem isso, o recebimento pelo assistente deixava de fora itens já vinculados (2026-09-24)
          const its = (purchase.items ?? []) as Array<Record<string, unknown>>;
          const memo = await vinculosMemorizados(supabase, tenant_id, await cnpjDaCompra(supabase, tenant_id, purchase), its, purchase_id);
          for (const it of its) {
            const v = memo.get(String(it.id));
            if (v) await ligarItem(supabase, tenant_id, it, v);
          }
          await applyStockEntry(supabase, tenant_id, purchase, its, user);
        }

        await supabase.from('fin_accounts_payable').update({ delivery_confirmed: true, delivery_confirmed_at: confirmedAt })
          .eq('reference_id', purchase_id).eq('tenant_id', tenant_id).neq('status', 'paid');

        result = { data: { confirmed_at: confirmedAt, purchase_id } };
        break;
      }

      case 'delete_purchase': {
        const { id } = payload;
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });

        const { data: purchase, error: fetchErr } = await supabase
          .from('fin_purchases')
          .select('*, items:fin_purchase_items(*)')
          .eq('id', id)
          .eq('tenant_id', tenant_id)
          .maybeSingle();

        if (fetchErr) return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: corsHeaders });
        if (!purchase) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });

        // Conta já paga (total ou parcial) não pode sumir junto com a compra: estorne o pagamento antes.
        const { data: billsDel, error: billsDelErr } = await supabase
          .from('fin_accounts_payable').select('status, paid_amount')
          .eq('reference_id', id).eq('tenant_id', tenant_id);
        if (billsDelErr) return new Response(JSON.stringify({ error: billsDelErr.message }), { status: 500, headers: corsHeaders });
        if ((billsDel ?? []).some((b: Record<string, unknown>) => b.status === 'paid' || Number(b.paid_amount ?? 0) > 0)) {
          return new Response(JSON.stringify({
            error: 'Esta compra tem conta a pagar já paga (total ou parcial). Estorne o pagamento antes de excluir.',
          }), { status: 409, headers: corsHeaders });
        }

        const purchaseItems = (purchase.items ?? []) as Array<Record<string, unknown>>;
        // Só estorna se o estoque chegou a entrar (recebimento confirmado, ou compra antiga)
        if (purchase.stock_applied_at) {
          await reverseStockForItems(
            supabase, tenant_id, purchaseItems, user,
            `Estorno de compra excluída: ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''}`,
            purchase, purchase.delivery_confirmed_at ?? purchase.stock_applied_at,
          );
        }

        await supabase
          .from('fin_accounts_payable')
          .delete()
          .eq('reference_id', id)
          .eq('tenant_id', tenant_id);

        await supabase
          .from('fin_cash_flow')
          .delete()
          .eq('reference_id', id)
          .eq('tenant_id', tenant_id)
          .eq('origin', 'auto_purchase');

        await supabase
          .from('fin_purchase_items')
          .delete()
          .eq('purchase_id', id)
          .eq('tenant_id', tenant_id);

        const { error: deleteErr } = await supabase
          .from('fin_purchases')
          .delete()
          .eq('id', id)
          .eq('tenant_id', tenant_id);

        if (deleteErr) return new Response(JSON.stringify({ error: deleteErr.message }), { status: 500, headers: corsHeaders });

        result = { data: { deleted: true, id } };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: corsHeaders });
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[purchase-write] Error:', err);
    let errorMessage = String(err);
    let errorCode = '';
    if (err && typeof err === 'object') {
      if ('message' in err) errorMessage = String(err.message);
      if ('code' in err) errorCode = String(err.code);
      if ('details' in err) errorMessage += ` | Detalhes: ${String(err.details)}`;
      if ('hint' in err) errorMessage += ` | Dica: ${String(err.hint)}`;
    }
    return new Response(JSON.stringify({ error: errorMessage, code: errorCode }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
