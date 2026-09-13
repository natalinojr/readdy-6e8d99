/**
 * comprasDRE.ts
 *
 * REGRA DO CMV (decisão do dono, 2026-09-05):
 *   CMV da DRE = COMPRAS REALIZADAS no período.
 *   O CMV por ficha técnica (consumo do que foi vendido) é CMV *teórico* e
 *   NÃO entra na DRE — serve como comparativo/indicador de desvio.
 *
 * Este helper pega as compras de um período e separa o valor em dois destinos
 * MUTUAMENTE EXCLUSIVOS, para nunca repetir o P23 (mesmo item contado como
 * despesa E como CMV):
 *
 *   - item cuja categoria DRE é de um grupo de despesa (`expense` ou qualquer
 *     grupo customizado da loja) → despesa daquela categoria (é o caso de
 *     limpeza, embalagem, material de escritório);
 *   - todo o resto (sem categoria, ou categoria de custo) → CMV.
 *
 * `tax`/`revenue` ficam em CMV de propósito: a DRE não os soma em lugar nenhum,
 * então mandá-los para despesa faria o valor sumir do resultado. A regra está
 * em `isGrupoDespesa`, compartilhada com a UI que oferece os destinos.
 *
 * Valor do item = `total_price + freight_allocated` (custo real da linha).
 * Compra sem nenhum item lançado entra pelo `total_amount` dela, em CMV.
 */

import { supabase } from './supabase';
import { fetchAllRows } from './fetchAllRows';
import { isGrupoDespesa } from '@/hooks/useDreGroups';

export interface PurchaseRef {
  id: string;
  total_amount: number | string;
  /**
   * Fração da compra que cai no período (0..1). Regime de caixa: quanto dela foi
   * PAGO no mês ÷ total da compra. Sem o campo vale 1 (compra inteira).
   */
  peso?: number;
}

export interface ComprasDREBreakdown {
  /** Compras que são mercadoria — vira a linha CMV da DRE. */
  cmv: number;
  /** Compras classificadas como despesa operacional, por `dre_category_id`. */
  despesasPorCategoria: Record<string, number>;
  /** Tudo que foi comprado no período (cmv + despesas). Informativo. */
  total: number;
}

/** O `.in()` vira query string; lotes evitam URL gigante em meses cheios. */
const ID_CHUNK = 150;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface ItemRow {
  purchase_id: string;
  total_price: number | string | null;
  freight_allocated: number | string | null;
  dre_category_id: string | null;
}

export async function fetchComprasDRE(
  tenantId: string,
  purchases: PurchaseRef[],
): Promise<ComprasDREBreakdown> {
  const vazio: ComprasDREBreakdown = { cmv: 0, despesasPorCategoria: {}, total: 0 };
  if (!tenantId || purchases.length === 0) return vazio;

  const ids = purchases.map((p) => p.id).filter(Boolean);

  // Itens do período. Paginado (P30) e filtrado pelos ids das compras — antes a
  // DRE puxava TODOS os itens do tenant sem paginação e truncava em ~1000 linhas
  // sem erro, o que agora subnotificaria o próprio CMV.
  const items: ItemRow[] = [];
  let truncated = false;
  for (const part of chunk(ids, ID_CHUNK)) {
    const { rows, truncated: t, error } = await fetchAllRows<ItemRow>((from, to) =>
      supabase
        .from('fin_purchase_items')
        .select('purchase_id, total_price, freight_allocated, dre_category_id')
        .eq('tenant_id', tenantId)
        .in('purchase_id', part)
        .range(from, to),
    );
    if (error) {
      console.error('[comprasDRE] Erro ao buscar itens de compra:', error.message);
      continue;
    }
    truncated = truncated || t;
    items.push(...rows);
  }
  if (truncated) console.warn('[comprasDRE] Itens de compra truncados pelo teto de segurança.');

  // Só precisa saber QUAIS categorias são despesa; o resto cai em CMV.
  const { data: cats, error: catErr } = await supabase
    .from('fin_dre_categories')
    .select('id, group_type')
    .eq('tenant_id', tenantId);
  if (catErr) console.error('[comprasDRE] Erro ao buscar categorias DRE:', catErr.message);
  const despesaIds = new Set(
    (cats ?? []).filter((c) => isGrupoDespesa(c.group_type as string)).map((c) => c.id as string),
  );

  return splitComprasDRE(items, purchases, despesaIds);
}

/**
 * Parte pura da regra, separada para ser testável sem banco.
 *
 * Invariante: `cmv + Σ despesasPorCategoria === total`. Cada real comprado cai
 * em exatamente um destino, nunca nos dois (é o que impede o P23 de voltar).
 */
export function splitComprasDRE(
  items: ItemRow[],
  purchases: PurchaseRef[],
  despesaIds: Set<string>,
): ComprasDREBreakdown {
  const out: ComprasDREBreakdown = { cmv: 0, despesasPorCategoria: {}, total: 0 };

  const pesoDe = new Map(purchases.map((p) => [p.id, p.peso ?? 1]));
  const comItens = new Set<string>();
  for (const it of items) {
    comItens.add(it.purchase_id);
    const valor = (Number(it.total_price ?? 0) + Number(it.freight_allocated ?? 0)) * (pesoDe.get(it.purchase_id) ?? 1);
    out.total += valor;
    const cat = it.dre_category_id;
    if (cat && despesaIds.has(cat)) {
      out.despesasPorCategoria[cat] = (out.despesasPorCategoria[cat] ?? 0) + valor;
    } else {
      out.cmv += valor;
    }
  }

  // Compra sem itens (lançamento só com o total) entra inteira como mercadoria.
  for (const p of purchases) {
    if (comItens.has(p.id)) continue;
    const valor = Number(p.total_amount ?? 0) * (p.peso ?? 1);
    out.cmv += valor;
    out.total += valor;
  }

  return out;
}

/**
 * Compras que entram no período, com o peso de cada uma.
 *
 * - Competência: compras com `purchase_date` no mês, pagas ou não (peso 1).
 * - Caixa: o que foi PAGO no mês, qualquer que seja a data da compra. Compra a
 *   prazo é paga pela conta a pagar gerada por ela (`reference_type='purchase'`),
 *   então vale o `paid_amount` das contas com `paid_date` no mês. Compra paga à
 *   vista (sem conta a pagar) entra inteira na data da compra.
 *
 * Antes o caixa usava "compras do mês que já estão pagas": a compra de agosto
 * paga em setembro não aparecia em setembro, e a de setembro ainda em aberto
 * também não — o CMV do caixa não batia com o que saiu do banco.
 */
export async function fetchComprasPeriodo(
  tenantId: string,
  start: string,
  end: string,
  mode: 'caixa' | 'competencia',
): Promise<PurchaseRef[]> {
  if (mode === 'competencia') {
    const { data, error } = await supabase
      .from('fin_purchases')
      .select('id, total_amount')
      .eq('tenant_id', tenantId)
      .gte('purchase_date', start)
      .lte('purchase_date', end);
    if (error) console.error('[comprasDRE] Compras (competência):', error.message);
    return (data ?? []) as PurchaseRef[];
  }

  const [apRes, diretasRes] = await Promise.all([
    supabase
      .from('fin_accounts_payable')
      .select('reference_id, paid_amount, amount, status')
      .eq('tenant_id', tenantId)
      .eq('reference_type', 'purchase')
      .in('status', ['paid', 'partial'])
      .gte('paid_date', start)
      .lte('paid_date', end),
    supabase
      .from('fin_purchases')
      .select('id, total_amount')
      .eq('tenant_id', tenantId)
      .eq('payment_status', 'paid')
      .gte('purchase_date', start)
      .lte('purchase_date', end),
  ]);
  if (apRes.error) console.error('[comprasDRE] Contas de compras pagas:', apRes.error.message);
  if (diretasRes.error) console.error('[comprasDRE] Compras à vista:', diretasRes.error.message);

  const pagoPorCompra: Record<string, number> = {};
  for (const ap of (apRes.data ?? []) as Array<Record<string, unknown>>) {
    const id = ap.reference_id as string | null;
    if (!id) continue;
    const pago = ap.status === 'partial' ? Number(ap.paid_amount ?? 0) : Number(ap.paid_amount ?? ap.amount ?? 0);
    pagoPorCompra[id] = (pagoPorCompra[id] ?? 0) + pago;
  }

  // Compra "à vista" = paga sem nenhuma conta a pagar ligada a ela.
  const diretas = (diretasRes.data ?? []) as PurchaseRef[];
  const idsDiretas = diretas.map((p) => p.id);
  const comConta = new Set<string>();
  for (const part of chunk(idsDiretas, ID_CHUNK)) {
    const { data } = await supabase
      .from('fin_accounts_payable')
      .select('reference_id')
      .eq('tenant_id', tenantId)
      .eq('reference_type', 'purchase')
      .in('reference_id', part);
    (data ?? []).forEach((r) => comConta.add(r.reference_id as string));
  }

  const out: PurchaseRef[] = diretas.filter((p) => !comConta.has(p.id)).map((p) => ({ ...p, peso: 1 }));

  const idsPagas = Object.keys(pagoPorCompra);
  for (const part of chunk(idsPagas, ID_CHUNK)) {
    const { data } = await supabase
      .from('fin_purchases')
      .select('id, total_amount')
      .eq('tenant_id', tenantId)
      .in('id', part);
    for (const p of (data ?? []) as PurchaseRef[]) {
      const total = Number(p.total_amount ?? 0);
      const pago = pagoPorCompra[p.id] ?? 0;
      // Conta a pagar com valor diferente da compra (juros, desconto): o peso
      // limita em 1 para o CMV não passar do que a compra vale.
      out.push({ ...p, peso: total > 0 ? Math.min(1, pago / total) : 1 });
    }
  }
  return out;
}

export interface CompraLinha {
  id: string;
  purchaseId: string;
  data: string;
  fornecedor: string;
  nota: string | null;
  descricao: string;
  quantidade: number | null;
  unidade: string | null;
  categoria: string;
  valor: number;
  destino: 'cmv' | 'despesa';
  pago?: number;
}

/**
 * Linhas item a item das compras do período (drill-down do CMV). Mesmo split e
 * mesmo peso de `fetchComprasDRE`, então a soma das linhas `cmv` fecha com a
 * linha CMV da DRE. Categoria = a do item; se vazia, a do insumo vinculado.
 */
export async function fetchComprasLinhas(tenantId: string, purchases: PurchaseRef[]): Promise<CompraLinha[]> {
  if (!tenantId || purchases.length === 0) return [];
  const ids = purchases.map((p) => p.id);
  const pesoDe = new Map(purchases.map((p) => [p.id, p.peso ?? 1]));

  type Item = ItemRow & {
    id: string; description: string | null; quantity: number | null; unit_label: string | null;
    merchandise_category_id: string | null; ingredient_id: string | null;
  };
  const items: Item[] = [];
  const compras: Array<Record<string, unknown>> = [];
  for (const part of chunk(ids, ID_CHUNK)) {
    const [{ rows }, { data: ps }] = await Promise.all([
      fetchAllRows<Item>((from, to) =>
        supabase
          .from('fin_purchase_items')
          .select('id, purchase_id, description, quantity, unit_label, total_price, freight_allocated, dre_category_id, merchandise_category_id, ingredient_id')
          .eq('tenant_id', tenantId)
          .in('purchase_id', part)
          .range(from, to),
      ),
      supabase
        .from('fin_purchases')
        .select('id, supplier, invoice_number, purchase_date, total_amount')
        .eq('tenant_id', tenantId)
        .in('id', part),
    ]);
    items.push(...rows);
    compras.push(...((ps ?? []) as Array<Record<string, unknown>>));
  }

  const ingIds = [...new Set(items.map((i) => i.ingredient_id).filter(Boolean) as string[])];
  const [{ data: cats }, { data: mercs }, { data: ings }] = await Promise.all([
    supabase.from('fin_dre_categories').select('id, group_type').eq('tenant_id', tenantId),
    supabase.from('fin_merchandise_categories').select('id, name').eq('tenant_id', tenantId),
    ingIds.length
      ? supabase.from('ingredients').select('id, merchandise_category_id, category').in('id', ingIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);
  const despesaIds = new Set((cats ?? []).filter((c) => isGrupoDespesa(c.group_type as string)).map((c) => c.id as string));
  const mercNome = new Map((mercs ?? []).map((m) => [m.id as string, m.name as string]));
  const ingInfo = new Map((ings ?? []).map((g) => [g.id as string, g as Record<string, unknown>]));
  const compraDe = new Map(compras.map((c) => [c.id as string, c]));

  const categoriaDo = (it: Item): string => {
    if (it.merchandise_category_id && mercNome.get(it.merchandise_category_id)) return mercNome.get(it.merchandise_category_id)!;
    const ing = it.ingredient_id ? ingInfo.get(it.ingredient_id) : undefined;
    if (ing?.merchandise_category_id && mercNome.get(ing.merchandise_category_id as string)) return mercNome.get(ing.merchandise_category_id as string)!;
    if (ing?.category) return String(ing.category);
    return 'Sem categoria';
  };

  const out: CompraLinha[] = [];
  const comItens = new Set<string>();
  for (const it of items) {
    comItens.add(it.purchase_id);
    const c = compraDe.get(it.purchase_id) ?? {};
    const peso = pesoDe.get(it.purchase_id) ?? 1;
    out.push({
      id: it.id,
      purchaseId: it.purchase_id,
      data: String(c.purchase_date ?? ''),
      fornecedor: String(c.supplier ?? 'Fornecedor não informado'),
      nota: (c.invoice_number as string) ?? null,
      descricao: it.description || 'Item sem descrição',
      quantidade: it.quantity != null ? Number(it.quantity) : null,
      unidade: it.unit_label,
      categoria: categoriaDo(it),
      valor: (Number(it.total_price ?? 0) + Number(it.freight_allocated ?? 0)) * peso,
      destino: it.dre_category_id && despesaIds.has(it.dre_category_id) ? 'despesa' : 'cmv',
      pago: peso < 1 ? peso : undefined,
    });
  }
  for (const p of purchases) {
    if (comItens.has(p.id)) continue;
    const c = compraDe.get(p.id) ?? {};
    const peso = p.peso ?? 1;
    out.push({
      id: `compra-${p.id}`,
      purchaseId: p.id,
      data: String(c.purchase_date ?? ''),
      fornecedor: String(c.supplier ?? 'Fornecedor não informado'),
      nota: (c.invoice_number as string) ?? null,
      descricao: 'Compra sem itens lançados (valor total)',
      quantidade: null,
      unidade: null,
      categoria: 'Sem categoria',
      valor: Number(p.total_amount ?? 0) * peso,
      destino: 'cmv',
      pago: peso < 1 ? peso : undefined,
    });
  }
  return out;
}
