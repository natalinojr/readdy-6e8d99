import { useCallback, useRef } from 'react';
import { useKDS } from '@/contexts/KDSContext';

/**
 * Hook para gerenciar o lock de edição de pedido.
 * 
 * Ao abrir um modal de edição de pedido, chama startOrderEditRemote para
 * bloquear o KDS/Gestor imediatamente via Realtime.
 * Ao fechar (salvar ou cancelar), chama finishOrderEditRemote para liberar.
 * 
 * Usage:
 *   const { lockOrder, unlockOrder } = useOrderEditLock();
 *   // ao abrir modal:
 *   const canEdit = await lockOrder(orderId);
 *   // ao fechar modal:
 *   await unlockOrder(orderId, wasModified, 'Item editado: ...');
 */
export function useOrderEditLock() {
  const { startOrderEditRemote, finishOrderEditRemote } = useKDS();
  const lockedOrderIds = useRef<Set<string>>(new Set());

  const lockOrder = useCallback(async (orderId: string): Promise<{ ok: boolean; lockedBy?: string; error?: string }> => {
    const result = await startOrderEditRemote(orderId);
    if (result.ok) {
      lockedOrderIds.current.add(orderId);
    }
    return result;
  }, [startOrderEditRemote]);

  const unlockOrder = useCallback(async (
    orderId: string,
    wasModified?: boolean,
    modificationsSummary?: string,
  ): Promise<void> => {
    // Só faz unlock se esse hook foi quem deu lock
    if (!lockedOrderIds.current.has(orderId)) return;
    lockedOrderIds.current.delete(orderId);
    await finishOrderEditRemote(orderId, wasModified, modificationsSummary);
  }, [finishOrderEditRemote]);

  const unlockAll = useCallback(async (): Promise<void> => {
    const ids = Array.from(lockedOrderIds.current);
    lockedOrderIds.current.clear();
    await Promise.all(ids.map((id) => finishOrderEditRemote(id, false)));
  }, [finishOrderEditRemote]);

  return { lockOrder, unlockOrder, unlockAll };
}