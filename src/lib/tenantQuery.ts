/**
 * tenantQuery.ts
 * Helpers para queries Supabase com filtros de tenant padronizados.
 * Centraliza os filtros mais comuns para evitar repetição e erros.
 */
import { supabase } from '@/lib/supabase';

/** Filtros padrão para pedidos válidos (não cancelados, não treino, não rascunho) */
export const VALID_ORDER_FILTERS = {
  notStatus: '(cancelled,draft)',
  isTraining: false,
  isDraft: false,
} as const;

/**
 * Aplica filtros padrão de pedido válido a uma query de orders.
 * Uso: applyValidOrderFilters(supabase.from('orders').select(...))
 */
export function applyValidOrderFilters<T>(
  query: T & {
    not: (col: string, op: string, val: string) => T;
    eq: (col: string, val: unknown) => T;
  }
): T {
  return query
    .not('status', 'in', VALID_ORDER_FILTERS.notStatus)
    .eq('is_training', VALID_ORDER_FILTERS.isTraining)
    .eq('is_draft', VALID_ORDER_FILTERS.isDraft);
}

/**
 * Busca pedidos válidos de um tenant em um período.
 * Retorna query builder pronta para adicionar .select() e outros filtros.
 */
export function tenantOrdersQuery(tenantId: string, from: string, to: string) {
  return supabase
    .from('orders')
    .select('id, total_amount, created_at, origin_type, status')
    .eq('tenant_id', tenantId)
    .not('status', 'in', VALID_ORDER_FILTERS.notStatus)
    .eq('is_training', false)
    .eq('is_draft', false)
    .gte('created_at', from)
    .lt('created_at', to);
}

/**
 * Busca order_items de uma lista de order_ids com filtro de tenant.
 */
export function tenantOrderItemsQuery(tenantId: string, orderIds: string[]) {
  return supabase
    .from('order_items')
    .select('item_name, item_price, quantity, item_id, order_id')
    .in('order_id', orderIds)
    .eq('tenant_id', tenantId);
}

/**
 * Busca payments não estornados de uma lista de order_ids.
 */
export function tenantPaymentsQuery(orderIds: string[]) {
  return supabase
    .from('payments')
    .select('amount, payment_method_id, order_id, payment_methods(name, type)')
    .in('order_id', orderIds)
    .eq('is_refunded', false);
}
