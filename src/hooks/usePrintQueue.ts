/**
 * usePrintQueue.ts — Hook para gerenciar a fila de impressão offline
 *
 * Expõe:
 * - pendingCount: quantos tickets na fila
 * - isProcessing: se está reprocessando agora
 * - lastResult: resultado da última tentativa
 * - enqueueTicket: adiciona ticket à fila
 * - printNow: tenta imprimir direto ou enfileira se offline
 * - processQueue: reprocessa fila manualmente
 * - retryFailed: tenta reimprimir tickets que falharam
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  enqueuePrint,
  processPrintQueue,
  getPendingPrints,
  getFailedPrints,
  updatePrintStatus,
  countPendingPrints,
  testPrinterOnline,
  cleanupPrintQueue,
  type PrintQueueEntry,
  type QueueProcessResult,
} from '@/lib/printQueue';
import { printHTML } from '@/lib/printUtils';
import { useNetworkStatus } from './useNetworkStatus';
import { useToast } from '@/contexts/ToastContext';

interface PrintTicketPayload {
  tenant_id: string;
  impressora_id: string;
  impressora_ip?: string;
  impressora_nome: string;
  station_key: string;
  station_label: string;
  paperStyle: '80mm' | '58mm';
  html: string;
}

export interface UsePrintQueueReturn {
  pendingCount: number;
  failedCount: number;
  isProcessing: boolean;
  lastResult: QueueProcessResult | null;
  enqueueTicket: (payload: PrintTicketPayload) => Promise<PrintQueueEntry>;
  printNow: (payload: PrintTicketPayload) => Promise<{ success: boolean; enqueued: boolean; error?: string }>;
  processQueue: () => Promise<QueueProcessResult | null>;
  retryFailed: () => Promise<QueueProcessResult | null>;
  refreshCounts: () => Promise<void>;
}

const MAX_RETRIES = 5;
const POLL_INTERVAL_MS = 15000; // poll a cada 15s

export function usePrintQueue(tenantId: string): UsePrintQueueReturn {
  const { isOnline } = useNetworkStatus();
  const { success: toastSuccess, error: toastError } = useToast();

  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<QueueProcessResult | null>(null);

  const processingLock = useRef(false);
  const wasOffline = useRef(!isOnline);

  const refreshCounts = useCallback(async () => {
    try {
      const [pending, failed] = await Promise.all([
        countPendingPrints(tenantId),
        getFailedPrints(tenantId).then((f) => f.length),
      ]);
      setPendingCount(pending);
      setFailedCount(failed);
    } catch (e) {
      console.error('[usePrintQueue] refreshCounts error:', e);
    }
  }, [tenantId]);

  // Carrega contagem inicial
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  // Polling de contagem
  useEffect(() => {
    const interval = setInterval(() => {
      refreshCounts();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshCounts]);

  // Auto-retry quando volta online
  useEffect(() => {
    const wasOff = wasOffline.current;
    wasOffline.current = !isOnline;

    if (isOnline && wasOff && pendingCount > 0) {
      const timer = setTimeout(() => {
        processQueue();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, pendingCount]);

  const enqueueTicket = useCallback(
    async (payload: PrintTicketPayload): Promise<PrintQueueEntry> => {
      const entry = await enqueuePrint({
        ...payload,
        maxRetries: MAX_RETRIES,
      });
      await refreshCounts();
      toastError('Impressora offline', `Ticket enfileirado para ${payload.impressora_nome}. Será reenviado quando voltar.`);
      return entry;
    },
    [refreshCounts, toastError],
  );

  /**
   * Tenta imprimir direto. Se falhar (offline), enfileira automaticamente.
   */
  const printNow = useCallback(
    async (payload: PrintTicketPayload): Promise<{ success: boolean; enqueued: boolean; error?: string }> => {
      // Se não tem IP ou está offline no browser, enfileira
      if (!isOnline || !payload.impressora_ip) {
        await enqueueTicket(payload);
        return { success: false, enqueued: true };
      }

      // Testa conectividade da impressora via ping
      const { online } = await testPrinterOnline(payload.impressora_ip);
      if (!online) {
        await enqueueTicket(payload);
        return { success: false, enqueued: true };
      }

      // Imprime direto
      try {
        printHTML(payload.html);
        return { success: true, enqueued: false };
      } catch (e) {
        const err = e instanceof Error ? e.message : 'Erro na impressão';
        await enqueueTicket(payload);
        return { success: false, enqueued: true, error: err };
      }
    },
    [isOnline, enqueueTicket],
  );

  const processQueue = useCallback(async (): Promise<QueueProcessResult | null> => {
    if (processingLock.current) return null;
    processingLock.current = true;
    setIsProcessing(true);

    try {
      const result = await processPrintQueue(tenantId);
      setLastResult(result);
      await refreshCounts();

      if (result.succeeded > 0) {
        toastSuccess(
          `${result.succeeded} ticket(s) impresso(s)`,
          result.processed > result.succeeded
            ? `${result.processed - result.succeeded} ainda na fila`
            : 'Fila processada com sucesso',
        );
      }

      // Cleanup de tickets antigos
      await cleanupPrintQueue();

      return result;
    } catch (e) {
      console.error('[usePrintQueue] processQueue error:', e);
      return null;
    } finally {
      processingLock.current = false;
      setIsProcessing(false);
    }
  }, [tenantId, refreshCounts, toastSuccess]);

  const retryFailed = useCallback(async (): Promise<QueueProcessResult | null> => {
    const failed = await getFailedPrints(tenantId);
    if (failed.length === 0) return null;

    // Reset status para pending
    for (const entry of failed) {
      await updatePrintStatus(entry.id, { status: 'pending', retryCount: 0, lastError: null });
    }

    return processQueue();
  }, [tenantId, processQueue]);

  return {
    pendingCount,
    failedCount,
    isProcessing,
    lastResult,
    enqueueTicket,
    printNow,
    processQueue,
    retryFailed,
    refreshCounts,
  };
}
