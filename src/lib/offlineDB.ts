/**
 * offlineDB.ts — Camada IndexedDB para modo offline do ERPOS
 *
 * Stores:
 *  - offline_orders   : pedidos criados offline aguardando sync
 *  - menu_cache       : snapshot do cardápio (itens + categorias)
 *  - session_cache    : sessão e caixa ativos
 *  - sync_log         : log de tentativas de sincronização
 */

const DB_NAME = 'erpos_offline';
const DB_VERSION = 2;

// ── Store names ───────────────────────────────────────────────────────────────
export const STORE_ORDERS = 'offline_orders';
export const STORE_MENU = 'menu_cache';
export const STORE_SESSION = 'session_cache';
export const STORE_SYNC_LOG = 'sync_log';
export const STORE_PRINT_QUEUE = 'print_queue';

export { DB_NAME, DB_VERSION };

// ── Types ─────────────────────────────────────────────────────────────────────

export type OfflineOrderStatus =
  | 'pending'    // aguardando sync
  | 'syncing'    // tentativa em andamento
  | 'synced'     // sincronizado com sucesso
  | 'failed';    // falhou após N tentativas

export interface OfflineOrderItem {
  item_id: string | null;
  item_name: string;
  item_price: number;
  quantity: number;
  station_id: string | null;
  skip_kds: boolean;
  notes: string | null;
  options: Array<{
    option_id: string | null;
    option_name: string;
    group_name: string;
    additional_price: number;
  }>;
  observations: Array<{ text: string }>;
}

export interface OfflineOrder {
  /** ID temporário local — formato: offline_<timestamp>_<random> */
  localId: string;
  /** ID real do servidor após sync — null enquanto pendente */
  serverId: string | null;
  /** Número do pedido gerado localmente */
  localNumber: string;
  /** Número real do servidor após sync */
  serverNumber: string | null;
  status: OfflineOrderStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: number; // timestamp ms
  syncedAt: number | null;

  // Payload completo para reenvio
  session_id: string;
  tenant_id: string;
  origin: string;
  destination: string;
  destination_name: string | null;
  destination_phone: string | null;
  delivery_address: string | null;
  delivery_fee: number;
  items: OfflineOrderItem[];
  discount_amount: number;
  service_fee_amount: number;
  subtotal: number;
  total_amount: number;
  cash_register_id: string | null;
  is_training: boolean;

  // Pagamentos para registrar após sync do pedido
  payments: Array<{
    payment_method_id: string;
    amount: number;
    change_amount: number;
  }>;
}

export interface MenuCacheEntry {
  key: string; // 'menu_<tenantId>'
  tenantId: string;
  cachedAt: number;
  categories: unknown[];
  items: unknown[];
  combos: unknown[];
  globalObservations: unknown[];
  stations: unknown[];
}

export interface SessionCacheEntry {
  key: string; // 'session_<tenantId>'
  tenantId: string;
  cachedAt: number;
  session: unknown | null;
  cashRegister: unknown | null;
}

export interface SyncLogEntry {
  id: string;
  localId: string;
  attempt: number;
  timestamp: number;
  success: boolean;
  error: string | null;
  serverId: string | null;
}

// ── DB singleton ──────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function createDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_ORDERS)) {
        const store = db.createObjectStore(STORE_ORDERS, { keyPath: 'localId' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('tenant_id', 'tenant_id', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_MENU)) {
        db.createObjectStore(STORE_MENU, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE_SESSION)) {
        db.createObjectStore(STORE_SESSION, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE_SYNC_LOG)) {
        const logStore = db.createObjectStore(STORE_SYNC_LOG, { keyPath: 'id' });
        logStore.createIndex('localId', 'localId', { unique: false });
        logStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_PRINT_QUEUE)) {
        const pqStore = db.createObjectStore(STORE_PRINT_QUEUE, { keyPath: 'id' });
        pqStore.createIndex('status', 'status', { unique: false });
        pqStore.createIndex('createdAt', 'createdAt', { unique: false });
        pqStore.createIndex('tenant_id', 'tenant_id', { unique: false });
        pqStore.createIndex('impressora_id', 'impressora_id', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Quando a conexão fechar inesperadamente, invalidar o singleton
      db.onclose = () => {
        dbPromise = null;
      };
      db.onerror = () => {
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
}

export function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = createDB().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Detecta erros de conexão fechada e reabre o DB automaticamente */
function isConnectionClosingError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return (
      err.name === 'InvalidStateError' ||
      (err.message?.toLowerCase().includes('closing') ?? false)
    );
  }
  return false;
}

async function withDB<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    const db = await openDB();
    return await fn(db);
  } catch (err) {
    if (isConnectionClosingError(err)) {
      // Invalida singleton e tenta uma vez mais
      dbPromise = null;
      const db = await openDB();
      return fn(db);
    }
    throw err;
  }
}

// ── Generic helpers ───────────────────────────────────────────────────────────

function txGet<T>(db: IDBDatabase, store: string, key: string | number): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function txPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
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

function txDelete(db: IDBDatabase, store: string, key: string | number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Offline Orders API ────────────────────────────────────────────────────────

/** Gera um ID local único para pedidos offline */
export function generateLocalOrderId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `offline_${ts}_${rand}`;
}

/** Gera número de pedido local (visível para o operador) */
export function generateLocalOrderNumber(seq: number): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const aa = String(now.getFullYear()).slice(2);
  return `P${dd}${mm}${aa}${String(seq).padStart(4, '0')}-OFF`;
}

export async function saveOfflineOrder(order: OfflineOrder): Promise<void> {
  return withDB((db) => txPut(db, STORE_ORDERS, order));
}

export async function getOfflineOrder(localId: string): Promise<OfflineOrder | undefined> {
  return withDB((db) => txGet<OfflineOrder>(db, STORE_ORDERS, localId));
}

export async function getPendingOrders(tenantId: string): Promise<OfflineOrder[]> {
  return withDB(async (db) => {
    const all = await txGetAll<OfflineOrder>(db, STORE_ORDERS, 'status', IDBKeyRange.only('pending'));
    return all.filter((o) => o.tenant_id === tenantId).sort((a, b) => a.createdAt - b.createdAt);
  });
}

export async function getFailedOrders(tenantId: string): Promise<OfflineOrder[]> {
  return withDB(async (db) => {
    const all = await txGetAll<OfflineOrder>(db, STORE_ORDERS, 'status', IDBKeyRange.only('failed'));
    return all.filter((o) => o.tenant_id === tenantId).sort((a, b) => a.createdAt - b.createdAt);
  });
}

export async function getAllOfflineOrders(tenantId: string): Promise<OfflineOrder[]> {
  return withDB(async (db) => {
    const all = await txGetAll<OfflineOrder>(db, STORE_ORDERS, 'tenant_id', IDBKeyRange.only(tenantId));
    return all.sort((a, b) => a.createdAt - b.createdAt);
  });
}

export async function updateOfflineOrderStatus(
  localId: string,
  updates: Partial<Pick<OfflineOrder, 'status' | 'serverId' | 'serverNumber' | 'retryCount' | 'lastError' | 'syncedAt'>>,
): Promise<void> {
  return withDB(async (db) => {
    const existing = await txGet<OfflineOrder>(db, STORE_ORDERS, localId);
    if (!existing) return;
    await txPut(db, STORE_ORDERS, { ...existing, ...updates });
  });
}

export async function deleteOfflineOrder(localId: string): Promise<void> {
  return withDB((db) => txDelete(db, STORE_ORDERS, localId));
}

export async function countPendingOrders(tenantId: string): Promise<number> {
  const pending = await getPendingOrders(tenantId);
  return pending.length;
}

// ── Menu Cache API ────────────────────────────────────────────────────────────

const MENU_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function saveMenuCache(tenantId: string, data: Omit<MenuCacheEntry, 'key' | 'tenantId' | 'cachedAt'>): Promise<void> {
  const entry: MenuCacheEntry = {
    key: `menu_${tenantId}`,
    tenantId,
    cachedAt: Date.now(),
    ...data,
  };
  return withDB((db) => txPut(db, STORE_MENU, entry));
}

export async function getMenuCache(tenantId: string): Promise<MenuCacheEntry | null> {
  return withDB(async (db) => {
    const entry = await txGet<MenuCacheEntry>(db, STORE_MENU, `menu_${tenantId}`);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > MENU_CACHE_TTL_MS) return null;
    return entry;
  });
}

// ── Session Cache API ─────────────────────────────────────────────────────────

export async function saveSessionCache(tenantId: string, session: unknown, cashRegister: unknown): Promise<void> {
  const entry: SessionCacheEntry = {
    key: `session_${tenantId}`,
    tenantId,
    cachedAt: Date.now(),
    session,
    cashRegister,
  };
  return withDB((db) => txPut(db, STORE_SESSION, entry));
}

export async function getSessionCache(tenantId: string): Promise<SessionCacheEntry | null> {
  return withDB(async (db) => {
    const entry = await txGet<SessionCacheEntry>(db, STORE_SESSION, `session_${tenantId}`);
    return entry ?? null;
  });
}

// ── Sync Log API ──────────────────────────────────────────────────────────────

export async function appendSyncLog(entry: Omit<SyncLogEntry, 'id'>): Promise<void> {
  const logEntry: SyncLogEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...entry,
  };
  return withDB((db) => txPut(db, STORE_SYNC_LOG, logEntry));
}

export async function getSyncLogs(localId: string): Promise<SyncLogEntry[]> {
  return withDB((db) =>
    txGetAll<SyncLogEntry>(db, STORE_SYNC_LOG, 'localId', IDBKeyRange.only(localId)),
  );
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/** Remove pedidos sincronizados com mais de 7 dias */
export async function cleanupSyncedOrders(): Promise<void> {
  return withDB(async (db) => {
    const synced = await txGetAll<OfflineOrder>(db, STORE_ORDERS, 'status', IDBKeyRange.only('synced'));
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const order of synced) {
      if ((order.syncedAt ?? 0) < cutoff) {
        await txDelete(db, STORE_ORDERS, order.localId);
      }
    }
  });
}
