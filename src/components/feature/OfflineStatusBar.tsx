/**
 * OfflineStatusBar.tsx — Banner de status offline para o PDV
 *
 * Exibe:
 * - Modo offline (sem conexão)
 * - Pedidos pendentes de sync
 * - Progresso de sincronização
 * - Confirmação de sync concluído
 */

import { useState, useEffect } from 'react';
import { useOffline } from '@/contexts/OfflineContext';

interface Props {
  /** Classe CSS adicional para posicionamento */
  className?: string;
}

export default function OfflineStatusBar({ className = '' }: Props) {
  const { isOnline, isChecking, isSyncing, pendingCount, lastSyncAt, lastSyncResult, syncNow } = useOffline();
  const [showSyncSuccess, setShowSyncSuccess] = useState(false);
  const [prevSyncAt, setPrevSyncAt] = useState<number | null>(null);

  // Mostra mensagem de sucesso por 4s após sync
  useEffect(() => {
    if (lastSyncAt && lastSyncAt !== prevSyncAt && lastSyncResult && lastSyncResult.succeeded > 0) {
      setPrevSyncAt(lastSyncAt);
      setShowSyncSuccess(true);
      const timer = setTimeout(() => setShowSyncSuccess(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [lastSyncAt, lastSyncResult, prevSyncAt]);

  // Não exibe nada quando online e sem pendentes e sem mensagem de sucesso
  if (isOnline && pendingCount === 0 && !showSyncSuccess && !isSyncing) {
    return null;
  }

  // ── Modo offline ──────────────────────────────────────────────────────────
  if (!isOnline) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 bg-red-600 text-white text-xs font-semibold ${className}`}>
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          <i className="ri-wifi-off-line text-sm" />
        </div>
        <span className="flex-1">
          Modo offline — pedidos salvos localmente
          {pendingCount > 0 && (
            <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {pendingCount} pendente{pendingCount !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        {isChecking && (
          <div className="w-3 h-3 border border-white/50 border-t-white rounded-full animate-spin flex-shrink-0" />
        )}
      </div>
    );
  }

  // ── Sincronizando ─────────────────────────────────────────────────────────
  if (isSyncing) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 bg-amber-500 text-white text-xs font-semibold ${className}`}>
        <div className="w-3 h-3 border border-white/50 border-t-white rounded-full animate-spin flex-shrink-0" />
        <span className="flex-1">
          Sincronizando {pendingCount} pedido{pendingCount !== 1 ? 's' : ''} offline...
        </span>
      </div>
    );
  }

  // ── Pedidos pendentes (online mas ainda não sincronizou) ──────────────────
  if (pendingCount > 0) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 bg-amber-500 text-white text-xs font-semibold ${className}`}>
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          <i className="ri-upload-cloud-2-line text-sm" />
        </div>
        <span className="flex-1">
          {pendingCount} pedido{pendingCount !== 1 ? 's' : ''} aguardando sincronização
        </span>
        <button
          onClick={() => syncNow()}
          className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap"
        >
          <i className="ri-refresh-line text-xs" />
          Sincronizar agora
        </button>
      </div>
    );
  }

  // ── Sync concluído ────────────────────────────────────────────────────────
  if (showSyncSuccess && lastSyncResult) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white text-xs font-semibold ${className}`}>
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          <i className="ri-checkbox-circle-line text-sm" />
        </div>
        <span>
          {lastSyncResult.succeeded} pedido{lastSyncResult.succeeded !== 1 ? 's' : ''} sincronizado{lastSyncResult.succeeded !== 1 ? 's' : ''} com sucesso
          {lastSyncResult.failed > 0 && (
            <span className="ml-1 text-red-200">
              · {lastSyncResult.failed} falhou
            </span>
          )}
        </span>
      </div>
    );
  }

  return null;
}
