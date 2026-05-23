import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { RPCSessionRow, RPCRevenueRow, RPCSessionOrderRow } from '@/types/rpc';

export interface SessionInfo {
  id: string;
  numero: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  operador: string | null;
  faturamento: number;
  num_pedidos: number;
}

export function useSessions(limit = 20) {
  const { user } = useAuth();
  // Começa com loading=true para evitar flash de "nenhuma sessão"
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (tenantId: string) => {
    setLoading(true);
    try {
      // Filtra EXPLICITAMENTE por tenant_id do usuário logado.
      // NÃO confiar apenas no RLS — as funções auth_tenant_id() e
      // get_user_tenant_id() retornam o ÚLTIMO tenant por created_at
      // quando o usuário tem múltiplos tenants, o que pode ser o errado.
      const { data: sessData, error } = await supabase
        .from('sessions')
        .select('id, number, status, opened_at, closed_at, opened_by, tenant_id, is_training')
        .eq('tenant_id', tenantId)
        .eq('is_training', false)
        .order('opened_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[useSessions] query error:', error.message, '| code:', error.code, '| tenant:', tenantId);
        setSessions([]);
        return;
      }

      console.log('[useSessions] loaded', sessData?.length ?? 0, 'sessions for tenant', tenantId);

      const sessRows = (sessData ?? []) as (RPCSessionRow & { opened_by?: string; number?: string })[];
      const sessionIds = sessRows.map((s) => s.id);

      // Busca nomes dos operadores separadamente — evita join que pode quebrar com RLS
      const operatorIds = [...new Set(sessRows.map((s) => s.opened_by).filter(Boolean))] as string[];
      const userNameMap = new Map<string, string>();
      if (operatorIds.length > 0) {
        const { data: usersData } = await supabase
          .from('users')
          .select('id, name')
          .in('id', operatorIds);
        for (const u of (usersData ?? []) as { id: string; name: string }[]) {
          userNameMap.set(u.id, u.name);
        }
      }

      // Busca faturamento de todos os pedidos das sessões em uma única query
      const { data: revenueData, error: revenueError } = await supabase
        .from('orders')
        .select('session_id, total_amount')
        .eq('tenant_id', tenantId)
        .in('session_id', sessionIds.length > 0 ? sessionIds : ['00000000-0000-0000-0000-000000000000'])
        .not('status', 'in', '(cancelled,draft)')
        .eq('is_training', false)
        .eq('is_draft', false);

      if (revenueError) {
        console.error('[useSessions] revenue error:', revenueError.message);
      }

      // Agrega localmente: count e sum por session_id
      const revenueMap = new Map<string, { total: number; count: number }>();
      for (const row of (revenueData ?? []) as RPCRevenueRow[]) {
        const sid = row.session_id;
        const prev = revenueMap.get(sid) ?? { total: 0, count: 0 };
        revenueMap.set(sid, {
          total: prev.total + Number(row.total_amount ?? 0),
          count: prev.count + 1,
        });
      }

      // Monta SessionInfo usando o número real do banco
      const sessionsWithRevenue: SessionInfo[] = sessRows.map((s) => {
        const rev = revenueMap.get(s.id) ?? { total: 0, count: 0 };
        const numero = s.number ? `#${s.number}` : `#${s.id.slice(0, 8).toUpperCase()}`;
        return {
          id: s.id,
          numero,
          status: s.status as 'open' | 'closed',
          opened_at: s.opened_at,
          closed_at: s.closed_at ?? null,
          operador: s.opened_by ? (userNameMap.get(s.opened_by) ?? null) : null,
          faturamento: rev.total,
          num_pedidos: rev.count,
        };
      });

      setSessions(sessionsWithRevenue);
    } catch (e) {
      console.error('[useSessions] unexpected error:', e);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (user?.tenantId) {
      load(user.tenantId);
    } else {
      // Sem tenant ainda — aguarda
      setLoading(true);
    }
  }, [user?.tenantId, load]);

  const reload = useCallback(() => {
    if (user?.tenantId) load(user.tenantId);
  }, [user?.tenantId, load]);

  return { sessions, loading, reload };
}

export function useSessionOrders(sessionId: string | null) {
  const { user } = useAuth();
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId || !sessionId) {
      setOrderIds([]);
      setDateRange(null);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, created_at')
        .eq('tenant_id', user.tenantId)
        .eq('session_id', sessionId)
        .not('status', 'in', '(cancelled,draft)')
        .eq('is_training', false)
        .eq('is_draft', false)
        .order('created_at');

      if (error) {
        console.error('[useSessionOrders] error:', error.message);
        setOrderIds([]);
        return;
      }

      const typed = (data ?? []) as RPCSessionOrderRow[];
      const ids = typed.map((o) => o.id);
      setOrderIds(ids);

      if (typed.length > 0) {
        setDateRange({
          from: typed[0].created_at,
          to: typed[typed.length - 1].created_at,
        });
      } else {
        setDateRange(null);
      }
    } catch (e) {
      console.error('[useSessionOrders] unexpected error:', e);
      setOrderIds([]);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, sessionId]);

  useEffect(() => { load(); }, [load]);

  return { orderIds, dateRange, loading };
}