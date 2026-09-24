// Vínculo item → insumo memorizado (fiscal_inbound_item_links) aplicado no RECEBIMENTO (2026-09-24).
// Antes só a tela mandava as sugestões; quem confirmava sem mandar os insumos (assistente pelo
// WhatsApp → purchase-write confirm_delivery) recebia a compra e o estoque não entrava nos itens
// que já tinham vínculo memorizado. Usado por purchase-write e purchase-confirm-delivery.
// Ordem: fornecedor (CNPJ) + código do produto → EAN → Classificação de itens (supplier_key +
// item_key, cobre fornecedor sem CNPJ e item sem código; fn_item_memo_links). Descrição solta não.

// deno-lint-ignore no-explicit-any
type Sb = any;

/** CNPJ do fornecedor da compra: cadastro do fornecedor (id ou nome) → nota de entrada ligada. */
// deno-lint-ignore no-explicit-any
export async function cnpjDaCompra(supabase: Sb, tenantId: string, purchase: any): Promise<string> {
  const base = supabase.from('fin_suppliers').select('cnpj').eq('tenant_id', tenantId);
  const { data: sp } = await (purchase.supplier_id ? base.eq('id', purchase.supplier_id) : base.ilike('name', String(purchase.supplier ?? '').trim())).limit(1).maybeSingle();
  let cnpj = String(sp?.cnpj ?? '').replace(/\D/g, '');
  if (!cnpj) {
    const { data: fd } = await supabase.from('fiscal_inbound_documents').select('emitente_cnpj').eq('tenant_id', tenantId).eq('purchase_id', purchase.id).limit(1).maybeSingle();
    cnpj = String(fd?.emitente_cnpj ?? '').replace(/\D/g, '');
  }
  return cnpj;
}

/** Para cada item sem insumo, o vínculo memorizado (se houver e o insumo ainda existir). */
export async function vinculosMemorizados(
  supabase: Sb,
  tenantId: string,
  supplierCnpj: string,
  items: Array<Record<string, unknown>>,
  purchaseId: string,
): Promise<Map<string, { ingredient_id: string; units_per_package: number }>> {
  const out = new Map<string, { ingredient_id: string; units_per_package: number }>();
  const sem = items.filter((i) => !i.ingredient_id && !String(i.description ?? '').startsWith('Acréscimos da nota'));
  if (!sem.length) return out;
  const codes = [...new Set(sem.map((i) => String(i.supplier_code ?? '').trim()).filter(Boolean))];
  const eans = [...new Set(sem.map((i) => String(i.ean ?? '').trim()).filter(Boolean))];
  const [memoRes, eanRes, clsRes] = await Promise.all([
    supplierCnpj && codes.length
      ? supabase.from('fiscal_inbound_item_links').select('supplier_code, ingredient_id, units_per_package').eq('tenant_id', tenantId).eq('supplier_cnpj', supplierCnpj).in('supplier_code', codes)
      : Promise.resolve({ data: [] }),
    eans.length
      ? supabase.from('fiscal_inbound_item_links').select('ean, ingredient_id, units_per_package').eq('tenant_id', tenantId).in('ean', eans)
      : Promise.resolve({ data: [] }),
    supabase.rpc('fn_item_memo_links', { p_tenant: tenantId, p_purchase: purchaseId }),
  ]);
  // deno-lint-ignore no-explicit-any
  const byCode = new Map(((memoRes.data ?? []) as any[]).filter((l) => l.ingredient_id).map((l) => [String(l.supplier_code), l]));
  // deno-lint-ignore no-explicit-any
  const byEan = new Map(((eanRes.data ?? []) as any[]).filter((l) => l.ingredient_id).map((l) => [String(l.ean), l]));
  // deno-lint-ignore no-explicit-any
  const byCls = new Map(((clsRes?.data ?? []) as any[]).map((l) => [String(l.purchase_item_id), l]));
  if (clsRes?.error) console.error('[vinculos-memorizados] fn_item_memo_links:', clsRes.error.message);
  const wanted = [...new Set([...byCode.values(), ...byEan.values()].map((l) => String(l.ingredient_id)))];
  const { data: ings } = wanted.length
    ? await supabase.from('ingredients').select('id').eq('tenant_id', tenantId).is('deleted_at', null).in('id', wanted)
    : { data: [] };
  // deno-lint-ignore no-explicit-any
  const valid = new Set(((ings ?? []) as any[]).map((g) => String(g.id)));
  for (const it of sem) {
    const code = String(it.supplier_code ?? '').trim();
    const ean = String(it.ean ?? '').trim();
    const forte = [code && byCode.get(code), ean && byEan.get(ean)].find((l) => l && valid.has(String(l.ingredient_id)));
    // A classificação já confere insumo ativo e só volta com fator conhecido
    const l = forte || byCls.get(String(it.id)) || null;
    if (l) {
      out.set(String(it.id), { ingredient_id: String(l.ingredient_id), units_per_package: Number(l.units_per_package) > 0 ? Number(l.units_per_package) : 1 });
    }
  }
  return out;
}

/** Grava o vínculo no item da compra (só se ainda estiver sem insumo) e atualiza o objeto em memória. */
export async function ligarItem(
  supabase: Sb,
  tenantId: string,
  item: Record<string, unknown>,
  v: { ingredient_id: string; units_per_package: number },
): Promise<boolean> {
  const qty = Number(item.quantity ?? 0);
  const costBase = qty * v.units_per_package > 0
    ? (Number(item.total_price ?? 0) + Number(item.freight_allocated ?? 0)) / (qty * v.units_per_package)
    : null;
  const { data, error } = await supabase.from('fin_purchase_items')
    .update({ ingredient_id: v.ingredient_id, units_per_package: v.units_per_package, cost_per_base_unit: costBase })
    .eq('id', item.id as string).eq('tenant_id', tenantId).is('ingredient_id', null).select('id');
  if (error || !data?.length) return false;
  item.ingredient_id = v.ingredient_id;
  item.units_per_package = v.units_per_package;
  return true;
}
