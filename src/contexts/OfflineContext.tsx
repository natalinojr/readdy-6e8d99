/**
 * OfflineContext.tsx — Provider global de estado offline
 *
 * Responsabilidades:
 * - Expor status de rede (isOnline)
 * - Manter contagem de pedidos pendentes
 * - Disparar sync automático ao reconectar
 * - Expor função de sync manual
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { syncPendingOrders, isSyncInProgress, type SyncSummary } from '@/lib/offlineSync';
import { countPendingOrders, cleanupSyncedOrders } from '@/lib/offlineDB';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OfflineContextValue {
  /** true quando sem conexão com o servidor */
  isOnline: boolean;
  /** true durante verificação de conectividade */
  isChecking: boolean;
  /** true durante sincronização de pedidos */
  isSyncing: boolean;
  /** Número de pedidos aguardando sync */
  pendingCount: number;
  /** Timestamp da última sincronização bem-sucedida */
  lastSyncAt: number | null;
  /** Resultado da última sincronização */
  lastSyncResult: SyncSummary | null;
  /** Dispara sync manual */
  syncNow: () => Promise<SyncSummary | null>;
  /** Atualiza contagem de pendentes (chamar após enfileirar pedido) */
  refreshPendingCount: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isOnline, isChecking } = useNetworkStatus();

  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<SyncSummary | null>(null);

  // Ref para evitar sync duplo
  const syncLockRef = useRef(false);
  // Ref para saber se estava offline antes
  const wasOfflineRef = useRef(!isOnline);

  const refreshPendingCount = useCallback(async () => {
    if (!user?.tenantId) return;
    try {
      const count = await countPendingOrders(user.tenantId);
      setPendingCount(count);
    } catch (e) {
      console.error('[OfflineContext] refreshPendingCount error:', e);
    }
  }, [user?.tenantId]);

  const syncNow = useCallback(async (): Promise<SyncSummary | null> => {
    if (!user?.tenantId || !isOnline || syncLockRef.current || isSyncInProgress()) {
      return null;
    }

    syncLockRef.current = true;
    setIsSyncing(true);

    try {
      const result = await syncPendingOrders(user.tenantId);
      setLastSyncResult(result);
      setLastSyncAt(Date.now());

      // Atualiza contagem após sync
      await refreshPendingCount();

      // Cleanup de pedidos antigos sincronizados
      await cleanupSyncedOrders();

      return result;
    } catch (e) {
      console.error('[OfflineContext] syncNow error:', e);
      return null;
    } finally {
      syncLockRef.current = false;
      setIsSyncing(false);
    }
  }, [user?.tenantId, isOnline, refreshPendingCount]);

  // Carrega contagem inicial
  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  // Sync automático ao reconectar
  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    wasOfflineRef.current = !isOnline;

    if (isOnline && wasOffline && pendingCount > 0) {
      // Pequeno delay para garantir que a conexão está estável
      const timer = setTimeout(() => {
        syncNow();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isOnline, pendingCount, syncNow]);

  // Polling de contagem a cada 10s (para detectar pedidos adicionados em outras abas)
  useEffect(() => {
    const interval = setInterval(() => {
      refreshPendingCount();
    }, 10000);
    return () => clearInterval(interval);
  }, [refreshPendingCount]);

  return (
    <OfflineContext.Provider value={{
      isOnline,
      isChecking,
      isSyncing,
      pendingCount,
      lastSyncAt,
      lastSyncResult,
      syncNow,
      refreshPendingCount,
    }}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be within OfflineProvider');
  return ctx;
}
