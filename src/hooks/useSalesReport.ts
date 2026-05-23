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
      // Busca todos os pedidos da sessão (excluindo treino e rascunho)
      const { data: orders, error: ordersErr } = await supabase
        .from('orders')
        .select('id, total_amount, created_at, origin_type')
        .eq('tenant_id', user.tenantId)
        .eq('session_id', sessionId)
        .not('status', 'in', '(cancelled,draft)')
        .eq('is_training', false)
        .eq('is_draft', false)
        .order('created_at');

      if (ordersErr) throw ordersErr;

      const ordersList = orders ?? [];
      const orderIds = ordersList.map((o) => o.id);
      // Faturamento = soma dos total_amount dos pedidos (valor da VENDA)
      const total_revenue = ordersList.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
      const total_orders = ordersList.length;
      const avg_ticket = total_orders > 0 ? total_revenue / total_orders : 0;

      // Vendas por dia dentro da sessão — usa fuso Brasília para agrupar corretamente
      const dayMap: Record<string, { orders: number; revenue: number }> = {};
      ordersList.forEach((o) => {
        // Converte para data local de Brasília (evita bug de UTC adiantando 1 dia)
        const day = new Date(o.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        if (!dayMap[day]) dayMap[day] = { orders: 0, revenue: 0 };
        dayMap[day].orders += 1;
        dayMap[day].revenue += Number(o.total_amount ?? 0);
      });
      const orders_by_day = Object.entries(dayMap).map(([day, v]) => ({ day, ...v }));

      let top_items: SalesReportData['top_items'] = [];
      let by_payment: SalesReportData['by_payment'] = [];
      let by_destination: SalesReportData['by_destination'] = [];

      if (orderIds.length > 0) {
        // Busca itens via client direto (RLS ok para order_items)
        const itemsRes = await supabase
          .from('order_items')
          .select('item_name, item_price, quantity, item_id')
          .in('order_id', orderIds);

        // Top itens
        const itemMap: Record<string, { total_qty: number; total_revenue: number }> = {};
        (itemsRes.data ?? []).forEach((oi) => {
          const key = oi.item_name ?? 'Item';
          if (!itemMap[key]) itemMap[key] = { total_qty: 0, total_revenue: 0 };
          itemMap[key].total_qty += oi.quantity ?? 1;
          itemMap[key].total_revenue += Number(oi.item_price ?? 0) * (oi.quantity ?? 1);
        });
        top_items = Object.entries(itemMap)
          .map(([item_name, v]) => ({ item_name, ...v }))
          .sort((a, b) => b.total_qty - a.total_qty)
          .slice(0, 10);

        // Busca pagamentos via Edge Function (contorna RLS conflitante da tabela payments)
        try {
          const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('session-payments', {
            body: { session_id: sessionId, tenant_id: user.tenantId },
          });

          if (edgeErr) throw edgeErr;

          const edgePayments: Array<{ id: string; amount: string | number; payment_method_id: string | null; order_id: string }> =
            edgeData?.payments ?? [];
          const edgePMs: Array<{ id: string; name: string; type: string }> = edgeData?.payment_methods ?? [];
          const edgeOrderTotals: Array<{ order_id: string; total_amount: number }> = edgeData?.order_totals ?? [];

          // Lookup de métodos de pagamento
          const pmLookup = new Map<string, { name: string; type: string }>();
          edgePMs.forEach((pm) => pmLookup.set(pm.id, { name: pm.name, type: pm.type }));

          // Mapa de total_amount por order_id
          const orderTotalMap = new Map<string, number>();
          edgeOrderTotals.forEach((o) => orderTotalMap.set(o.order_id, Number(o.total_amount ?? 0)));
          // fallback: também usa os pedidos já buscados
          ordersList.forEach((o) => {
            if (!orderTotalMap.has(o.id)) orderTotalMap.set(o.id, Number(o.total_amount ?? 0));
          });

          // Agrupa pagamentos por forma
          const pmMap: Record<string, { total: number; count: number; type: string }> = {};
          edgePayments.forEach((p) => {
            const pm = p.payment_method_id ? pmLookup.get(p.payment_method_id) : null;
            const name = pm?.name ?? 'Outros';
            const type = pm?.type ?? 'other';
            const orderTotal = orderTotalMap.get(p.order_id) ?? Number(p.amount ?? 0);
            const isCash = type === 'cash' || name.toLowerCase().includes('dinheiro') || name.toLowerCase().includes('espécie');
            const valorEfetivo = isCash ? Math.min(Number(p.amount ?? 0), orderTotal) : Number(p.amount ?? 0);
            if (!pmMap[name]) pmMap[name] = { total: 0, count: 0, type };
            pmMap[name].total += valorEfetivo;
            pmMap[name].count += 1;
          });
          by_payment = Object.entries(pmMap).map(([payment_method, v]) => ({
            payment_method,
            payment_type: v.type,
            total: v.total,
            count: v.count,
          }));

          console.log('[useSalesReportBySession] edge payments:', edgePayments.length, 'by_payment:', by_payment);
        } catch (payErr) {
          console.error('[useSalesReportBySession] erro ao buscar pagamentos via edge:', payErr);
          // by_payment fica vazio — UI mostra o fallback de "sem pagamentos registrados"
        }

        // Origem — usa total_amount do pedido
        const destMap: Record<string, { orders: number; revenue: number }> = {};
        ordersList.forEach((o) => {
          const dest = o.origin_type ?? 'cashier';
          if (!destMap[dest]) destMap[dest] = { orders: 0, revenue: 0 };
          destMap[dest].orders += 1;
          destMap[dest].revenue += Number(o.total_amount ?? 0);
        });
        by_destination = Object.entries(destMap).map(([destination, v]) => ({ destination, ...v }));
      }

      // Info da sessão
      const { data: sessInfo } = await supabase
        .from('sessions')
        .select('opened_at')
        .eq('id', sessionId)
        .maybeSingle();

      setData({
        session_id: sessionId,
        opened_at: sessInfo?.opened_at ?? new Date().toISOString(),
        total_revenue,
        total_orders,
        avg_ticket,
        orders_by_day,
        top_items,
        by_destination,
        by_payment,
      });
      setHasRealData(total_orders > 0);
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
