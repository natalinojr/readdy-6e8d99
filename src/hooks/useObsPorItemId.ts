import { useMemo } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import { useObsParaItem } from './useObsParaItem';

/**
 * Versão conveniente do useObsParaItem que aceita apenas o itemId.
 * Busca o Item no CardapioContext e delega para useObsParaItem.
 * Retorna [] se o item não for encontrado.
 */
export function useObsPorItemId(itemId: string): string[] {
  const { itensAtivos } = useCardapio();

  const item = useMemo(
    () => itensAtivos.find((i) => i.id === itemId) ?? null,
    [itensAtivos, itemId],
  );

  // Chama o hook principal; se item for null, passa um objeto mínimo para evitar crash
  const obsComItem = useObsParaItem(
    item ?? { id: itemId, categoriaId: '', observacoesPadrao: [], gruposOpcoes: [], promocoes: [], preco: 0, nome: '', ativo: true, fotoUrl: '', descricao: '', semPreparo: false } as Parameters<typeof useObsParaItem>[0],
  );

  return item ? obsComItem : [];
}