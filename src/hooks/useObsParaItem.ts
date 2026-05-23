import { useMemo } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import type { Item } from '@/types/cardapio';

/**
 * Retorna a lista completa de observações disponíveis para um item no PDV,
 * mesclando as observações específicas do item + observações globais ativas
 * que não estão excluídas para este item ou sua categoria.
 *
 * As obs globais com excludedItemIds contendo o itemId são omitidas.
 * As obs globais com excludedCategoryIds contendo o categoriaId do item são omitidas.
 */
export function useObsParaItem(item: Item): string[] {
  const { obsGlobais } = useCardapio();

  return useMemo(() => {
    // Obs globais ativas, filtradas para este item
    const globaisFiltradas = obsGlobais
      .filter((og) => {
        if (!og.ativo) return false;
        if (og.excludedItemIds?.includes(item.id)) return false;
        if (og.excludedCategoryIds?.includes(item.categoriaId)) return false;
        return true;
      })
      .map((og) => og.texto);

    // Obs específicas do item (preset)
    const especificas = item.observacoesPadrao ?? [];

    // Mescla: específicas primeiro, depois globais (sem duplicatas)
    const todasSet = new Set<string>();
    const resultado: string[] = [];

    for (const obs of especificas) {
      if (!todasSet.has(obs)) {
        todasSet.add(obs);
        resultado.push(obs);
      }
    }

    for (const obs of globaisFiltradas) {
      if (!todasSet.has(obs)) {
        todasSet.add(obs);
        resultado.push(obs);
      }
    }

    return resultado;
  }, [item.id, item.categoriaId, item.observacoesPadrao, obsGlobais]);
}