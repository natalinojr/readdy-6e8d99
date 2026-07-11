import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates } from '@/lib/dateUtils';

export interface CategoryRevenue {
  category_name: string;
  total_qty: number;
  total_revenue: number;
}

export interface HourlyRevenue {
  hour: number;
  revenue: number;
  orders: number;
}

export interface VisaoGeralExtrasData {
  by_category: CategoryRevenue[];
  by_hour: HourlyRevenue[];
}

export function useVisaoGeralExtras(periodo: string) {
  const { user } = useAuth();
  const [data, setData] = useState<VisaoGeralExtrasData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Usa getPeriodDates para respeitar o período selecionado (Hoje, Ontem, 7 dias, etc.)
      // Retorna strings ISO com timezone Brasília já prontas para o Supabase
      const { from: fromTs, to: toTs } = getPeriodDates(periodo);

      const { data: orders, error: ordersErr } = await supabase
        .from('orders')
        .select('id, created_at, total_amount')
        .eq('tenant_id', user.tenantId)
        .not('status', 'in', '(cancelled,draft)')
        .eq('is_training', false)
        .eq('is_draft', false)
        .gte('created_at', fromTs)
        .lte('created_at', toTs);

      if (ordersErr) throw ordersErr;

      const orderIds = (orders ?? []).map((o) => o.id);

      // Vendas por hora
      const hourMap: Record<number, HourlyRevenue> = {};
      (orders ?? []).forEach((o) => {
        const h = new Date(o.created_at).getHours();
        if (!hourMap[h]) hourMap[h] = { hour: h, revenue: 0, orders: 0 };
        hourMap[h].revenue += Number(o.total_amount ?? 0);
        hourMap[h].orders += 1;
      });
      const byHour: HourlyRevenue[] = Array.from({ length: 24 }, (_, h) =>
        hourMap[h] ?? { hour: h, revenue: 0, orders: 0 }
      );

      // Vendas por categoria
      let byCategory: CategoryRevenue[] = [];
      if (orderIds.length > 0) {
        const { data: items, error: itemsErr } = await supabase
          .from('order_items')
          .select('item_name, item_price, quantity, item_id, menu_items!order_items_item_id_fkey(category_id, menu_categories(name))')
          .in('order_id', orderIds)
          .eq('tenant_id', user.tenantId)
          // Exclui itens cancelados: o pedido não é cancelado, mas um item dele pode ter sido.
          // Sem isso o faturamento por categoria diverge do líquido (total_amount já exclui cancelados).
          .neq('status', 'cancelled');

        if (itemsErr) {
          // Fallback sem join de categoria
          const { data: itemsFallback } = await supabase
            .from('order_items')
            .select('item_name, item_price, quantity')
            .in('order_id', orderIds)
            .eq('tenant_id', user.tenantId)
            .neq('status', 'cancelled');

          const catMap: Record<string, CategoryRevenue> = {};
          (itemsFallback ?? []).forEach((oi) => {
            const catName = 'Sem categoria';
            if (!catMap[catName]) catMap[catName] = { category_name: catName, total_qty: 0, total_revenue: 0 };
            catMap[catName].total_qty += oi.quantity ?? 1;
            catMap[catName].total_revenue += Number(oi.item_price ?? 0) * (oi.quantity ?? 1);
          });
          byCategory = Object.values(catMap).sort((a, b) => b.total_revenue - a.total_revenue);
        } else {
          const catMap: Record<string, CategoryRevenue> = {};
          (items ?? []).forEach((oi: any) => {
            const mi = oi.menu_items as { category_id: string; menu_categories: { name: string } | null } | null;
            const catName = mi?.menu_categories?.name ?? 'Sem categoria';
            if (!catMap[catName]) catMap[catName] = { category_name: catName, total_qty: 0, total_revenue: 0 };
            catMap[catName].total_qty += oi.quantity ?? 1;
            catMap[catName].total_revenue += Number(oi.item_price ?? 0) * (oi.quantity ?? 1);
          });
          byCategory = Object.values(catMap).sort((a, b) => b.total_revenue - a.total_revenue);
        }
      }

      setData({ by_category: byCategory, by_hour: byHour });
    } catch (e) {
      console.error('[useVisaoGeralExtras]', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}
