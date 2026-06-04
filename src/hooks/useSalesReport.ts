import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates } from '@/lib/dateUtils';

export interface SalesReportData {
  total_revenue: number;
  total_orders: number;
  avg_ticket: number;
  orders_by_day: Array<{ day: string; orders: number; revenue: number }>;
  top_items: Array<{ item_name: string; total_qty: number; total_revenue: number; category_name?: string; avg_price?: number }>;
  by_destination: Array<{ destination: string; orders: number; revenue: number }>;
  by_payment: Array<{ payment_method: string; payment_type: string; total: number; count: number }>;
}

export interface SalesReportBySessionData extends SalesReportData {
  session_id: string;
  opened_at: string;
}

export function useSalesReport(periodo: string) {
  const { user } = useAuth();
  const [data, setData] = useState<SalesReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRealData, setHasRealData] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { from, to } = getPeriodDates(periodo);
      const { data: result, error } = await supabase.rpc('fn_get_sales_report', {
        p_tenant_id: user.tenantId,
        p_date_from: from,
        p_date_to: to,
        p_session_id: null,
      });
      if (error) throw error;
      const report = result as SalesReportData;
      setData(report);
      setHasRealData((report?.total_orders ?? 0) > 0);
    } catch (e) {
      console.error('[useSalesReport] error:', e);
      setData(null);
      setHasRealData(false);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, hasRealData, reload: load };
}

export function useSalesReportBySession(sessionId: string | null) {
  const { user } = useAuth();
  const [data, setData] = useState<SalesReportBySessionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRealData, setHasRealData] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId || !sessionId) {
      setData(null);
      setHasRealData(false);
      return;
    }
    setLoading(true);
    try {
      // Usa a RPC SECURITY DEFINER para bypassar RLS e obter dados agregados
      const { data: result, error } = await supabase.rpc('fn_get_sales_report', {
        p_tenant_id: user.tenantId,
        p_date_from: '1970-01-01',
        p_date_to: '2099-12-31',
        p_session_id: sessionId,
      });

      if (error) {
        console.error('[useSalesReportBySession] RPC error:', error);
        throw error;
      }

      const report = (result ?? {}) as SalesReportData;

      // Info da sessão
      const { data: sessInfo } = await supabase
        .from('sessions')
        .select('opened_at')
        .eq('id', sessionId)
        .maybeSingle();

      setData({
        session_id: sessionId,
        opened_at: sessInfo?.opened_at ?? new Date().toISOString(),
        total_revenue: report.total_revenue ?? 0,
        total_orders: report.total_orders ?? 0,
        avg_ticket: report.avg_ticket ?? 0,
        orders_by_day: report.orders_by_day ?? [],
        top_items: report.top_items ?? [],
        by_destination: report.by_destination ?? [],
        by_payment: report.by_payment ?? [],
      });
      setHasRealData((report?.total_orders ?? 0) > 0);
    } catch (e) {
      console.error('[useSalesReportBySession]', e);
      setData(null);
      setHasRealData(false);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, sessionId]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, hasRealData, reload: load };
}