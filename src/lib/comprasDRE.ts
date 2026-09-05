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
 *   - item cuja categoria DRE é do grupo `expense` → despesa daquela categoria
 *     (é o caso de limpeza, embalagem, material de escritório);
 *   - todo o resto (sem categoria, ou categoria de custo) → CMV.
 *
 * Só `expense` sai do CMV de propósito: os grupos `tax`/`revenue` não são
 * somados em lugar nenhum da DRE, então mandar um item para lá o faria sumir
 * do resultado.
 *
 * Valor do item = `total_price + freight_allocated` (custo real da linha).
 * Compra sem nenhum item lançado entra pelo `total_amount` dela, em CMV.
 */

import { supabase } from './supabase';
import { fetchAllRows } from './fetchAllRows';

export interface PurchaseRef {
  id: string;
  total_amount: number | string;
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
    (cats ?? []).filter((c) => c.group_type === 'expense').map((c) => c.id as string),
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

  const comItens = new Set<string>();
  for (const it of items) {
    comItens.add(it.purchase_id);
    const valor = Number(it.total_price ?? 0) + Number(it.freight_allocated ?? 0);
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
    const valor = Number(p.total_amount ?? 0);
    out.cmv += valor;
    out.total += valor;
  }

  return out;
}
