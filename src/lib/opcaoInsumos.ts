import type { InsumoDaOpcaoCardapio, OpcaoItem } from '@/types/cardapio';

// Opção do cardápio com vários insumos (2026-09-26). A lista `ingredientes` é a fonte da verdade; os campos
// antigos (ingredientId, consumptionQuantity…) guardam o primeiro, para quem ainda lê só eles (modelos de
// opções, exportação). Opção antiga ou vinda de modelo, sem lista, vira lista de um.

export function insumosDaOpcao(o: OpcaoItem): InsumoDaOpcaoCardapio[] {
  if (Array.isArray(o.ingredientes)) return o.ingredientes;
  if (!o.ingredientId) return [];
  return [{
    ingredientId: o.ingredientId,
    productionRecipeId: o.productionRecipeId ?? null,
    quantidade: o.consumptionQuantity,
    unidade: o.consumptionUnit || 'un',
    source: o.source ?? (o.productionRecipeId ? 'production' : 'ingredient'),
  }];
}

/** Alteração da opção com a lista nova, mantendo os campos antigos iguais ao primeiro insumo. */
export function comInsumos(lista: InsumoDaOpcaoCardapio[]): Partial<OpcaoItem> {
  const p = lista[0];
  return {
    ingredientes: lista,
    ingredientId: p?.ingredientId ?? null,
    productionRecipeId: p?.productionRecipeId ?? null,
    consumptionQuantity: p?.quantidade,
    consumptionUnit: p?.unidade,
    source: p?.source,
  };
}
