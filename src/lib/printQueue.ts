/**
 * printQueue.ts — Fila de tickets de impressão offline
 *
 * Lógica:
 * - Quando imprimir, tenta enviar direto para o printHTML
 * - Se falhar (impressora offline), enfileira no IndexedDB
 * - Quando a rede/online volta, reprocessa a fila automaticamente
 * - Cada ticket tem status: pending | printing | printed | failed
 */

import { openDB } from './offlineDB';

export type PrintQueueStatus = 'pending' | 'printing' | 'printed' | 'failed';

export interface PrintQueueEntry {
  id: string;
  tenant_id: string;
  impressora_id: string;
  impressora_ip?: string;
  impressora_nome: string;
  station_key: string;
  station_label: string;
  paperStyle: '80mm' | '58mm';
  html: string;
  status: PrintQueueStatus;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  createdAt: number;
  printedAt: number | null;
}

// ── DB helpers (usando withDB para reconexão automática) ─────────────────────

function isConnectionClosingError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return (
      err.name === 'InvalidStateError' ||
      (err.message?.toLowerCase().includes('closing') ?? false)
    );
  }
  return false;
}

let dbPromiseLocal: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromiseLocal) {
    dbPromiseLocal = openDB().catch((err) => {
      dbPromiseLocal = null;
      throw err;
    });
    // Invalida singleton se a conexão fechar
    dbPromiseLocal.then((db) => {
      db.onclose = () => { dbPromiseLocal = null; };
    }).catch(() => {});
  }
  return dbPromiseLocal;
}

async function withDB<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    const db = await getDB();
    return await fn(db);
  } catch (err) {
    if (isConnectionClosingError(err)) {
      dbPromiseLocal = null;
      const db = await getDB();
      return fn(db);
    }
    throw err;
  }
}

function txGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function txPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function txGetAll<T>(db: IDBDatabase, store: string, indexName?: string, query?: IDBKeyRange): Promise<T[]> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const objStore = tx.objectStore(store);
      const source = indexName ? objStore.index(indexName) : objStore;
      const req = query ? source.getAll(query) : source.getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function txDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

// ── CRUD da fila ────────────────────────────────────────────────────────────

function generateQueueId(): string {
  return `print_${Date.now()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function enqueuePrint(
  entry: Omit<PrintQueueEntry, 'id' | 'status' | 'retryCount' | 'printedAt' | 'createdAt'>,
): Promise<PrintQueueEntry> {
  const full: PrintQueueEntry = {
    ...entry,
    id: generateQueueId(),
    status: 'pending',
    retryCount: 0,
    printedAt: null,
    createdAt: Date.now(),
  };
  await withDB((db) => txPut(db, 'print_queue', full));
  return full;
}

export async function getPrintEntry(id: string): Promise<PrintQueueEntry | undefined> {
  return withDB((db) => txGet<PrintQueueEntry>(db, 'print_queue', id));
}

export async function getPendingPrints(tenantId: string): Promise<PrintQueueEntry[]> {
  return withDB(async (db) => {
    const all = await txGetAll<PrintQueueEntry>(db, 'print_queue', 'status', IDBKeyRange.only('pending'));
    return all.filter((p) => p.tenant_id === tenantId).sort((a, b) => a.createdAt - b.createdAt);
  });
}

export async function getFailedPrints(tenantId: string): Promise<PrintQueueEntry[]> {
  return withDB(async (db) => {
    const all = await txGetAll<PrintQueueEntry>(db, 'print_queue', 'status', IDBKeyRange.only('failed'));
    return all.filter((p) => p.tenant_id === tenantId).sort((a, b) => a.createdAt - b.createdAt);
  });
}

export async function getAllPrintQueue(tenantId: string): Promise<PrintQueueEntry[]> {
  return withDB(async (db) => {
    const all = await txGetAll<PrintQueueEntry>(db, 'print_queue', 'tenant_id', IDBKeyRange.only(tenantId));
    return all.sort((a, b) => a.createdAt - b.createdAt);
  });
}

export async function updatePrintStatus(
  id: string,
  updates: Partial<Pick<PrintQueueEntry, 'status' | 'retryCount' | 'lastError' | 'printedAt'>>,
): Promise<void> {
  return withDB(async (db) => {
    const existing = await txGet<PrintQueueEntry>(db, 'print_queue', id);
    if (!existing) return;
    await txPut(db, 'print_queue', { ...existing, ...updates });
  });
}

export async function deletePrintEntry(id: string): Promise<void> {
  return withDB((db) => txDelete(db, 'print_queue', id));
}

export async function countPendingPrints(tenantId: string): Promise<number> {
  const pending = await getPendingPrints(tenantId);
  return pending.length;
}

// ── Teste de conectividade da impressora ────────────────────────────────────

export async function testPrinterOnline(_ip: string, _port = 9100): Promise<{ online: boolean; ms?: number }> {
  try {
    const res = await fetch('http://127.0.0.1:9876/health', {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json();
    if (data.status === 'ok') return { online: true };
  } catch {
    // agente não está rodando
  }
  return { online: false };
}

// ── Reprocessamento da fila ─────────────────────────────────────────────────

import { printHTML } from './printUtils';

export interface QueueProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export async function processPrintQueue(tenantId: string): Promise<QueueProcessResult> {
  const pending = await getPendingPrints(tenantId);
  const result: QueueProcessResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };

  if (pending.length === 0) return result;

  for (const entry of pending) {
    result.processed++;

    if (entry.impressora_ip) {
      const { online } = await testPrinterOnline(entry.impressora_ip);
      if (!online) {
        result.errors.push(`${entry.impressora_nome} ainda offline — ticket mantido na fila`);
        continue;
      }
    }

    await updatePrintStatus(entry.id, { status: 'printing' });
    try {
      printHTML(entry.html);
      await updatePrintStatus(entry.id, { status: 'printed', printedAt: Date.now() });
      result.succeeded++;
    } catch (e) {
      const err = e instanceof Error ? e.message : 'Erro desconhecido na impressão';
      const nextRetry = entry.retryCount + 1;
      if (nextRetry >= entry.maxRetries) {
        await updatePrintStatus(entry.id, { status: 'failed', retryCount: nextRetry, lastError: err });
      } else {
        await updatePrintStatus(entry.id, { status: 'pending', retryCount: nextRetry, lastError: err });
      }
      result.failed++;
      result.errors.push(`${entry.impressora_nome}: ${err}`);
    }
  }

  return result;
}

// ── Limpeza ─────────────────────────────────────────────────────────────────

export async function cleanupPrintQueue(): Promise<void> {
  return withDB(async (db) => {
    const all = await txGetAll<PrintQueueEntry>(db, 'print_queue');
    const now = Date.now();
    const printedCutoff = now - 7 * 24 * 60 * 60 * 1000;
    const failedCutoff = now - 30 * 24 * 60 * 60 * 1000;

    for (const entry of all) {
      if (entry.status === 'printed' && (entry.printedAt ?? 0) < printedCutoff) {
        await txDelete(db, 'print_queue', entry.id);
      } else if (entry.status === 'failed' && entry.createdAt < failedCutoff) {
        await txDelete(db, 'print_queue', entry.id);
      }
    }
  });
}