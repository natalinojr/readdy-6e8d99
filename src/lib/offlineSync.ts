/**
 * offlineSync.ts — Engine de sincronização de pedidos offline
 *
 * Responsabilidades:
 * 1. Pegar pedidos com status 'pending' do IndexedDB
 * 2. Enviar para o servidor via order-write
 * 3. Registrar pagamentos após sync do pedido
 * 4. Marcar como 'synced' ou 'failed' (após MAX_RETRIES)
 * 5. Evitar duplicação via idempotency key (localId)
 */

import {
  getPendingOrders,
  updateOfflineOrderStatus,
  appendSyncLog,
  type OfflineOrder,
} from './offlineDB';
import { invokeWithAuth } from './supabase';
import { buildOfflineCreateOrderBody } from './offlineOrderBody';

const MAX_RETRIES = 5;

// ── Tipos de resultado ────────────────────────────────────────────────────────

export interface SyncResult {
  localId: string;
  success: boolean;
  serverId?: string;
  serverNumber?: string;
  error?: string;
}

export interface SyncSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  results: SyncResult[];
}

// ── Sync de um único pedido ───────────────────────────────────────────────────

async function syncSingleOrder(order: OfflineOrder): Promise<SyncResult> {
  // Marca como 'syncing' para evitar tentativas paralelas
  await updateOfflineOrderStatus(order.localId, { status: 'syncing' });

  try {
    // ── 1. Criar pedido no servidor ──────────────────────────────────────
    // client_request_id é a idempotency key: o backend devolve o pedido já criado com o mesmo id.
    const { data, error } = await invokeWithAuth<{
      data?: { id?: string; number?: string };
      error?: string;
    }>('order-write', {
      // Payload original completo + mesmo client_request_id da tentativa online (idempotente, BUG-06)
      body: buildOfflineCreateOrderBody(order),
    });

    if (error) {
      throw new Error(error.message ?? String(error));
    }

    const serverId = data?.data?.id;
    const serverNumber = data?.data?.number;

    if (!serverId) {
      throw new Error('Servidor não retornou ID do pedido');
    }

    // ── 2. Registrar pagamentos (best effort) ────────────────────────────
    for (const payment of order.payments) {
      try {
        await invokeWithAuth('order-write', {
          body: {
            action: 'record_payment',
            order_id: serverId,
            tenant_id: order.tenant_id,
            cash_register_id: order.cash_register_id,
            payment_method_id: payment.payment_method_id,
            amount: payment.amount,
            change_amount: payment.change_amount,
          },
        });
      } catch (payErr) {
        // Pagamento falhou — não bloqueia o sync do pedido
        console.warn('[offlineSync] payment registration failed (non-blocking):', payErr);
      }
    }

    // ── 3. Marcar como sincronizado ──────────────────────────────────────
    await updateOfflineOrderStatus(order.localId, {
      status: 'synced',
      serverId,
      serverNumber: serverNumber ?? null,
      syncedAt: Date.now(),
      lastError: null,
    });

    await appendSyncLog({
      localId: order.localId,
      attempt: order.retryCount + 1,
      timestamp: Date.now(),
      success: true,
      error: null,
      serverId,
    });

    return { localId: order.localId, success: true, serverId, serverNumber };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const newRetryCount = order.retryCount + 1;
    const isFinalFailure = newRetryCount >= MAX_RETRIES;

    await updateOfflineOrderStatus(order.localId, {
      status: isFinalFailure ? 'failed' : 'pending',
      retryCount: newRetryCount,
      lastError: errMsg,
    });

    await appendSyncLog({
      localId: order.localId,
      attempt: newRetryCount,
      timestamp: Date.now(),
      success: false,
      error: errMsg,
      serverId: null,
    });

    return { localId: order.localId, success: false, error: errMsg };
  }
}

// ── Sync de todos os pedidos pendentes ────────────────────────────────────────

let syncInProgress = false;

/**
 * Sincroniza todos os pedidos pendentes de um tenant.
 * Executa sequencialmente para evitar race conditions.
 * Retorna um resumo com resultados individuais.
 */
export async function syncPendingOrders(tenantId: string): Promise<SyncSummary> {
  // Evita execuções paralelas
  if (syncInProgress) {
    return { attempted: 0, succeeded: 0, failed: 0, results: [] };
  }

  syncInProgress = true;

  try {
    const pending = await getPendingOrders(tenantId);

    if (pending.length === 0) {
      return { attempted: 0, succeeded: 0, failed: 0, results: [] };
    }

    console.log(`[offlineSync] Iniciando sync de ${pending.length} pedido(s) pendente(s)`);

    const results: SyncResult[] = [];

    // Sequencial — evita sobrecarga e race conditions
    for (const order of pending) {
      const result = await syncSingleOrder(order);
      results.push(result);

      // Pequena pausa entre pedidos para não sobrecarregar o servidor
      if (pending.indexOf(order) < pending.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`[offlineSync] Sync concluído: ${succeeded} ok, ${failed} falhou`);

    return {
      attempted: results.length,
      succeeded,
      failed,
      results,
    };
  } finally {
    syncInProgress = false;
  }
}

/** Verifica se há sync em andamento */
export function isSyncInProgress(): boolean {
  return syncInProgress;
}

// ── BUG 2.7 FIX: Auto-sync com listener online + polling ───────────────────────

type SyncCallback = (summary: SyncSummary) => void;

let autoSyncTenantId: string | null = null;
let autoSyncCallback: SyncCallback | null = null;
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;
let onlineListenerAttached = false;

/**
 * Inicia o auto-sync para um tenant.
 * - Escuta evento 'online' para sincronizar imediatamente ao reconectar
 * - Faz polling a cada 60s enquanto houver pendentes
 * - Chama `onSyncComplete` com o resumo após cada sync
 *
 * Seguro para chamar múltiplas vezes — substitui a instância anterior.
 */
export function startAutoSync(tenantId: string, onSyncComplete?: SyncCallback): void {
  stopAutoSync();

  autoSyncTenantId = tenantId;
  autoSyncCallback = onSyncComplete ?? null;

  const doSync = async () => {
    if (!autoSyncTenantId) return;
    if (!navigator.onLine) return;
    try {
      const summary = await syncPendingOrders(autoSyncTenantId);
      if (summary.attempted > 0 && autoSyncCallback) {
        autoSyncCallback(summary);
      }
    } catch (e) {
      console.warn('[offlineSync] autoSync error:', e);
    }
  };

  // Listener 'online': sincroniza imediatamente ao reconectar
  if (!onlineListenerAttached) {
    window.addEventListener('online', doSync);
    onlineListenerAttached = true;
  }

  // Polling: a cada 60s
  pollingIntervalId = setInterval(doSync, 60_000);

  // Tenta sincronizar imediatamente se já online e há pendentes
  if (navigator.onLine) {
    doSync();
  }
}

/**
 * Para o auto-sync e remove listeners.
 */
export function stopAutoSync(): void {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
  autoSyncTenantId = null;
  autoSyncCallback = null;
}
