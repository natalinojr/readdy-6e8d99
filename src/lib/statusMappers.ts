/**
 * statusMappers.ts
 * Central source of truth for all order/item status conversions.
 *
 * DB values (orders.status / order_items.status):
 *   'new' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
 *
 * KDS frontend (KDSPedidoStatus / KDSItemStatus):
 *   'novo' | 'preparo' | 'pronto' | 'em_rota' | 'entregue'
 *
 * PDV UI (PedidoStatus used in PedidoRecente):
 *   'aberto' | 'pronto' | 'entregue' | 'cancelado'
 */

import type { KDSItemStatus, KDSPedidoStatus } from '@/types/kds';
import type { PedidoStatus } from '@/types/pdv';

// ── DB → KDS ──────────────────────────────────────────────────────────────────

/** Maps DB item status string to KDS frontend enum */
export function dbItemStatusToKds(dbStatus: string): KDSItemStatus {
  switch (dbStatus) {
    case 'new':       return 'novo';
    case 'preparing': return 'preparo';
    case 'ready':     return 'pronto';
    case 'delivered': return 'entregue';
    default:          return 'novo';
  }
}

/** Maps DB order status string to KDS frontend enum */
export function dbOrderStatusToKds(dbStatus: string): KDSPedidoStatus {
  switch (dbStatus) {
    case 'new':       return 'novo';
    case 'preparing': return 'preparo';
    case 'ready':     return 'pronto';
    case 'delivered': return 'entregue';
    case 'cancelled': return 'novo'; // cancelled is handled via isCancelled flag
    default:          return 'novo';
  }
}

// ── KDS → DB ──────────────────────────────────────────────────────────────────

/** Maps KDS item status to DB string */
export function kdsItemStatusToDb(kdsStatus: KDSItemStatus): string {
  switch (kdsStatus) {
    case 'novo':     return 'new';
    case 'preparo':  return 'preparing';
    case 'pronto':   return 'ready';
    case 'entregue': return 'delivered';
    default:         return 'new';
  }
}

// ── KDS → PDV UI ──────────────────────────────────────────────────────────────

/**
 * Maps KDSPedidoStatus to PDV UI PedidoStatus (used in PedidoRecente).
 * Does NOT re-derive from items — consumes the already-computed KDS status directly.
 *
 * Rules:
 *   - 'novo'    → 'aberto'   (waiting for kitchen)
 *   - 'preparo' → 'aberto'   (in preparation — still "open" from cashier perspective)
 *   - 'pronto'  → 'pronto'   (ready to deliver)
 *   - 'em_rota' → 'entregue' (on the way / already out)
 *   - 'entregue'→ 'entregue' (delivered)
 */
export function kdsStatusToPdvStatus(
  kdsStatus: KDSPedidoStatus,
  isCancelled: boolean,
): PedidoStatus {
  if (isCancelled) return 'cancelado';
  switch (kdsStatus) {
    case 'pronto':   return 'pronto';
    case 'entregue':
    case 'em_rota':  return 'entregue';
    case 'novo':
    case 'preparo':
    default:         return 'aberto';
  }
}

// ── Display labels ────────────────────────────────────────────────────────────

/**
 * Human-readable label for KDSPedidoStatus.
 * Canonical labels used across ALL screens:
 *   novo     → "Aguardando"
 *   preparo  → "Em preparo"
 *   pronto   → "Pronto"
 *   entregue → "Entregue"
 */
export function kdsStatusLabel(kdsStatus: KDSPedidoStatus): string {
  switch (kdsStatus) {
    case 'novo':     return 'Na Fila';
    case 'preparo':  return 'Em preparo';
    case 'pronto':   return 'Pronto';
    case 'em_rota':  return 'Em rota';
    case 'entregue': return 'Entregue';
    default:         return 'Na Fila';
  }
}

/**
 * Human-readable label for KDSItemStatus.
 */
export function kdsItemLabel(kdsStatus: KDSItemStatus): string {
  switch (kdsStatus) {
    case 'novo':     return 'Na Fila';
    case 'preparo':  return 'Em preparo';
    case 'pronto':   return 'Pronto';
    case 'entregue': return 'Entregue';
    default:         return 'Na Fila';
  }
}

/**
 * Human-readable label for PDV UI PedidoStatus.
 * Used in PedidosRecentesPanel badges.
 */
export function pdvStatusLabel(status: PedidoStatus, kdsStatus?: KDSPedidoStatus): string {
  if (status === 'cancelado') return 'Cancelado';
  if (status === 'entregue')  return 'Entregue';
  if (status === 'pronto')    return 'Pronto';
  // 'aberto' — differentiate between "Aguardando" and "Em preparo" using KDS status
  if (kdsStatus === 'preparo') return 'Em preparo';
  return 'Na Fila';
}

/**
 * Tailwind CSS classes for status badge in PDV UI.
 */
export function pdvStatusBadgeCls(status: PedidoStatus, kdsStatus?: KDSPedidoStatus): string {
  if (status === 'cancelado') return 'bg-red-100 text-red-600 border-red-200';
  if (status === 'entregue')  return 'bg-zinc-100 text-zinc-500 border-zinc-200';
  if (status === 'pronto')    return 'bg-green-100 text-green-700 border-green-200';
  if (kdsStatus === 'preparo') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-zinc-100 text-zinc-500 border-zinc-200';
}

// ── Status rank (for merge/priority logic) ───────────────────────────────────

const KDS_ITEM_RANK: Record<KDSItemStatus, number> = {
  novo: 0, preparo: 1, pronto: 2, entregue: 3,
};

const KDS_ORDER_RANK: Record<KDSPedidoStatus, number> = {
  novo: 0, preparo: 1, pronto: 2, em_rota: 3, entregue: 4,
};

export function kdsItemRank(s: KDSItemStatus): number {
  return KDS_ITEM_RANK[s] ?? 0;
}

export function kdsOrderRank(s: KDSPedidoStatus): number {
  return KDS_ORDER_RANK[s] ?? 0;
}

// ── Order number formatting ───────────────────────────────────────────────────

/**
 * BUG 3.1 FIX: Formata o número do pedido de forma padronizada em TODAS as telas.
 * Prioridade: numeroCodigo (ex: P060426001) > numero padStart(4) > '?'
 *
 * Uso: formatOrderNumber(pedido.numeroStr, pedido.numero)
 */
export function formatOrderNumber(numeroStr?: string | null, numero?: number | null): string {
  if (numeroStr && numeroStr.trim() !== '') return `#${numeroStr}`;
  if (numero != null && !isNaN(numero)) return `#${String(numero).padStart(4, '0')}`;
  return '#????';
}

/**
 * Formata apenas o sufixo numérico seq do número do pedido (sem o #).
 * Ex: "P060426001" → "P060426001" | undefined → "0042"
 */
export function formatOrderNumberRaw(numeroStr?: string | null, numero?: number | null): string {
  if (numeroStr && numeroStr.trim() !== '') return numeroStr;
  if (numero != null && !isNaN(numero)) return String(numero).padStart(4, '0');
  return '????';
}