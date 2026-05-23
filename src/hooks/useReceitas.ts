import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ──────────────────────────────────────────────────────────────────
export type ReceitaSource = 'order' | 'manual';
export type ReceitaStatus = 'received' | 'pending';

export interface ReceitaItem {
  id: string;
  source: ReceitaSource;
  description: string;
  category: string;
  amount: number;
  date: string;
  status: ReceitaStatus;
  payment_method?: string;
  origin_detail?: string; // ex: "Mesa 3", "Delivery", "PDV"
  reference_id?: string;
  notes?: string;
  created_at: string;
}

export interface ReceitasSummary {
  total: number;
  fromOrders: number;
  fromManual: number;
  byCategory: { category: string; total: number; count: number }[];
  bySource: { source: ReceitaSource; total: number; count: number }[];
  byMonth: { month: string; total: number }[];
  dailyTrend: { date: string; amount: number }[];
}

export interface ReceitasFilters {
  startDate: string;
  endDate: string;
  categories: string[];
  sources: ReceitaSource[];
  search: string;
  minAmount?: number;
  maxAmount?: number;
}

export const SOURCE_LABELS_R: Record<ReceitaSource, string> = {
  order: 'Vendas (Pedidos)',
  manual: 'Lançamento Manual',
};

export const SOURCE_COLORS_R: Record<ReceitaSource, string> = {
  order: '#10b981',
  manual: '#f59e0b',
};

export const ORIGIN_LABELS: Record<string, string> = {
  mesa: 'Mesa',
  delivery: 'Delivery',
  pdv: 'PDV / Caixa',
  kiosk: 'Totem',
  garcom: 'Garçom',
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useReceitas(filters: ReceitasFilters) {
  const { user } = useAuth();
  const [items, setItems] = useState<ReceitaItem[]>([]);
  const [summary, setSummary] = useState<ReceitasSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReceitas = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);

    const { startDate, endDate, categories, sources, search, minAmount, maxAmount } = filters;
    const startISO = startDate + 'T00:00:00';
    const endISO = endDate + 'T23:59:59';

    const [ordersRes, manualRes] = await Promise.all([
      // Pedidos entregues (fonte única de verdade: status = 'delivered')
      supabase
        .from('orders')
        .select('id, number, total_amount, is_paid, paid_at, created_at, origin_type, destination_type, table_number, waiter_name, status, payment_method')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'delivered')
        .eq('is_training', false)
        .neq('status', 'cancelled')
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .order('created_at', { ascending: false }),

      // Receitas manuais no fin_cash_flow
      supabase
        .from('fin_cash_flow')
        .select('id, description, amount, date, category, origin, payment_method_id, notes, created_at')
        .eq('tenant_id', user.tenantId)
        .eq('type', 'income')
        .eq('origin', 'manual')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false }),
    ]);

    const allItems: ReceitaItem[] = [];

    // Pedidos pagos
    (ordersRes.data ?? []).forEach(o => {
      const paidDate = o.paid_at ? o.paid_at.slice(0, 10) : o.created_at.slice(0, 10);
      const originType = (o.origin_type as string) || 'pdv';
      const destType = (o.destination_type as string) || '';

      let originDetail = ORIGIN_LABELS[originType] ?? originType;
      if (destType === 'table' && o.table_number) originDetail = `Mesa ${o.table_number}`;
      else if (destType === 'delivery') originDetail = 'Delivery';

      allItems.push({
        id: `order_${o.id}`,
        source: 'order',
        description: `Pedido #${o.number || o.id.slice(0, 8)}`,
        category: destType === 'delivery' ? 'Delivery' : destType === 'table' ? 'Salão' : 'PDV / Caixa',
        amount: Number(o.total_amount),
        date: paidDate,
        status: 'received',
        origin_detail: originDetail,
        reference_id: o.id,
        notes: o.waiter_name ? `Operador: ${o.waiter_name}` : undefined,
        created_at: o.created_at,
      });
    });

    // Receitas manuais
    (manualRes.data ?? []).forEach(c => {
      allItems.push({
        id: `manual_${c.id}`,
        source: 'manual',
        description: c.description || 'Receita manual',
        category: c.category || 'Outros',
        amount: Number(c.amount),
        date: c.date,
        status: 'received',
        reference_id: c.id,
        notes: c.notes,
        created_at: c.created_at,
      });
    });

    // Aplicar filtros
    let filtered = allItems;

    if (categories.length > 0) {
      filtered = filtered.filter(r => categories.includes(r.category));
    }
    if (sources.length > 0) {
      filtered = filtered.filter(r => sources.includes(r.source));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.description.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        (r.origin_detail?.toLowerCase().includes(q) ?? false) ||
        (r.notes?.toLowerCase().includes(q) ?? false)
      );
    }
    if (minAmount !== undefined) {
      filtered = filtered.filter(r => r.amount >= minAmount);
    }
    if (maxAmount !== undefined) {
      filtered = filtered.filter(r => r.amount <= maxAmount);
    }

    // Ordenar por data decrescente
    filtered.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

    // Calcular resumo
    const byCategoryMap: Record<string, { total: number; count: number }> = {};
    const bySourceMap: Record<string, { total: number; count: number }> = {};
    const byMonthMap: Record<string, number> = {};
    const dailyMap: Record<string, number> = {};

    filtered.forEach(r => {
      if (!byCategoryMap[r.category]) byCategoryMap[r.category] = { total: 0, count: 0 };
      byCategoryMap[r.category].total += r.amount;
      byCategoryMap[r.category].count += 1;

      if (!bySourceMap[r.source]) bySourceMap[r.source] = { total: 0, count: 0 };
      bySourceMap[r.source].total += r.amount;
      bySourceMap[r.source].count += 1;

      const month = r.date.slice(0, 7);
      byMonthMap[month] = (byMonthMap[month] ?? 0) + r.amount;

      dailyMap[r.date] = (dailyMap[r.date] ?? 0) + r.amount;
    });

    const byCategory = Object.entries(byCategoryMap)
      .map(([category, { total, count }]) => ({ category, total, count }))
      .sort((a, b) => b.total - a.total);

    const bySource = Object.entries(bySourceMap)
      .map(([source, { total, count }]) => ({ source: source as ReceitaSource, total, count }))
      .sort((a, b) => b.total - a.total);

    const byMonth = Object.entries(byMonthMap)
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const dailyTrend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));

    const fromOrders = filtered.filter(r => r.source === 'order').reduce((s, r) => s + r.amount, 0);
    const fromManual = filtered.filter(r => r.source === 'manual').reduce((s, r) => s + r.amount, 0);

    setItems(filtered);
    setSummary({
      total: filtered.reduce((s, r) => s + r.amount, 0),
      fromOrders,
      fromManual,
      byCategory,
      bySource,
      byMonth,
      dailyTrend,
    });
    setLoading(false);
  }, [user?.tenantId, filters]);

  useEffect(() => { fetchReceitas(); }, [fetchReceitas]);

  return { items, summary, loading, refresh: fetchReceitas };
}

// ─── Hook para inserir receita manual ────────────────────────────────────────
export function useInsertReceitaManual() {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const insert = useCallback(async (data: {
    description: string;
    amount: number;
    date: string;
    category: string;
    notes?: string;
  }) => {
    if (!user?.tenantId) return { error: 'Sem tenant' };
    setSaving(true);
    try {
      const { error } = await supabase.from('fin_cash_flow').insert({
        tenant_id: user.tenantId,
        type: 'income',
        origin: 'manual',
        description: data.description,
        amount: data.amount,
        date: data.date,
        category: data.category,
        notes: data.notes || null,
      });
      return { error: error?.message ?? null };
    } finally {
      setSaving(false);
    }
  }, [user?.tenantId]);

  return { insert, saving };
}
