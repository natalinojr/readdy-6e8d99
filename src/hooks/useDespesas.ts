import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ──────────────────────────────────────────────────────────────────
export type DespesaStatus = 'paid' | 'pending' | 'overdue';
export type DespesaSource = 'bill' | 'purchase' | 'payroll' | 'cashflow' | 'anticipation';

export interface DespesaItem {
  id: string;
  source: DespesaSource;
  description: string;
  category: string;
  amount: number;
  date: string;
  status: DespesaStatus;
  payment_method?: string;
  supplier?: string;
  reference_id?: string;
  notes?: string;
  created_at: string;
}

export interface DespesasSummary {
  total: number;
  paid: number;
  pending: number;
  overdue: number;
  byCategory: { category: string; total: number; count: number }[];
  bySource: { source: DespesaSource; total: number; count: number }[];
  byMonth: { month: string; total: number; paid: number; pending: number }[];
  dailyTrend: { date: string; amount: number }[];
}

export interface DespesasFilters {
  startDate: string;
  endDate: string;
  categories: string[];
  sources: DespesaSource[];
  statuses: DespesaStatus[];
  search: string;
  minAmount?: number;
  maxAmount?: number;
}

// ─── Source labels ────────────────────────────────────────────────────────────
export const SOURCE_LABELS: Record<DespesaSource, string> = {
  bill: 'Contas a Pagar',
  purchase: 'Compras',
  payroll: 'Folha de Pagamento',
  cashflow: 'Fluxo de Caixa',
  anticipation: 'Antecipação',
};

export const SOURCE_COLORS: Record<DespesaSource, string> = {
  bill: '#f59e0b',
  purchase: '#10b981',
  payroll: '#6366f1',
  cashflow: '#ef4444',
  anticipation: '#8b5cf6',
};

export const STATUS_LABELS: Record<DespesaStatus, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  overdue: 'Vencido',
};

export const STATUS_COLORS: Record<DespesaStatus, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-600',
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useDespesas(filters: DespesasFilters) {
  const { user } = useAuth();
  const [items, setItems] = useState<DespesaItem[]>([]);
  const [summary, setSummary] = useState<DespesasSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDespesas = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);

    const { startDate, endDate, categories, sources, statuses, search, minAmount, maxAmount } = filters;
    const endDateTime = endDate + 'T23:59:59';

    // Busca paralela de todas as fontes
    const [billsRes, purchasesRes, payrollRes, cashflowRes, anticipationRes] = await Promise.all([
      // Contas a pagar (pagas, pendentes, vencidas)
      supabase
        .from('fin_accounts_payable')
        .select('id, description, category, amount, paid_amount, due_date, paid_date, status, payment_method, supplier, notes, created_at')
        .eq('tenant_id', user.tenantId)
        .gte('due_date', startDate)
        .lte('due_date', endDate),

      // Compras
      supabase
        .from('fin_purchases')
        .select('id, supplier, total_amount, purchase_date, payment_status, notes, created_at')
        .eq('tenant_id', user.tenantId)
        .gte('purchase_date', startDate)
        .lte('purchase_date', endDate),

      // Folha de pagamento
      supabase
        .from('hr_payroll')
        .select('id, employee_name, net_salary, gross_salary, fgts, reference_month, status, paid_date, payment_method, notes, created_at')
        .eq('tenant_id', user.tenantId)
        .gte('reference_month', startDate.slice(0, 7))
        .lte('reference_month', endDate.slice(0, 7)),

      // Fluxo de caixa (saídas manuais)
      supabase
        .from('fin_cash_flow')
        .select('id, description, amount, date, category, type, origin, payment_method, notes, created_at')
        .eq('tenant_id', user.tenantId)
        .eq('type', 'expense')
        .eq('origin', 'manual')
        .gte('date', startDate)
        .lte('date', endDate),

      // Antecipações
      supabase
        .from('fin_anticipations')
        .select('id, gross_amount, fee_percent, net_amount, created_at, notes')
        .eq('tenant_id', user.tenantId)
        .gte('created_at', startDate)
        .lte('created_at', endDateTime),
    ]);

    const allItems: DespesaItem[] = [];

    // Contas a pagar
    (billsRes.data ?? []).forEach(b => {
      const isPaid = b.status === 'paid';
      const amount = isPaid ? Number(b.paid_amount ?? b.amount) : Number(b.amount);
      const status: DespesaStatus = b.status === 'overdue' ? 'overdue' : isPaid ? 'paid' : 'pending';
      allItems.push({
        id: `bill_${b.id}`,
        source: 'bill',
        description: b.description || 'Conta a pagar',
        category: b.category || 'Outros',
        amount,
        date: isPaid ? (b.paid_date || b.due_date) : b.due_date,
        status,
        payment_method: b.payment_method,
        supplier: b.supplier,
        reference_id: b.id,
        notes: b.notes,
        created_at: b.created_at,
      });
    });

    // Compras
    (purchasesRes.data ?? []).forEach(p => {
      const status: DespesaStatus = p.payment_status === 'paid' ? 'paid' : p.payment_status === 'partial' ? 'pending' : 'pending';
      allItems.push({
        id: `purchase_${p.id}`,
        source: 'purchase',
        description: `Compra — ${p.supplier || 'Fornecedor'}`,
        category: 'Compras de Insumos',
        amount: Number(p.total_amount),
        date: p.purchase_date,
        status,
        supplier: p.supplier,
        reference_id: p.id,
        notes: p.notes,
        created_at: p.created_at,
      });
    });

    // Folha de pagamento
    (payrollRes.data ?? []).forEach(p => {
      const status: DespesaStatus = p.status === 'paid' ? 'paid' : 'pending';
      // Custo total = bruto + FGTS
      const amount = Number(p.gross_salary) + Number(p.fgts);
      allItems.push({
        id: `payroll_${p.id}`,
        source: 'payroll',
        description: `Folha — ${p.employee_name}`,
        category: 'Folha de Pagamento',
        amount,
        date: p.paid_date || `${p.reference_month}-01`,
        status,
        payment_method: p.payment_method,
        reference_id: p.id,
        notes: p.notes,
        created_at: p.created_at,
      });
    });

    // Fluxo de caixa manual
    (cashflowRes.data ?? []).forEach(c => {
      allItems.push({
        id: `cashflow_${c.id}`,
        source: 'cashflow',
        description: c.description || 'Saída manual',
        category: c.category || 'Outros',
        amount: Number(c.amount),
        date: c.date,
        status: 'paid',
        payment_method: c.payment_method,
        reference_id: c.id,
        notes: c.notes,
        created_at: c.created_at,
      });
    });

    // Antecipações
    (anticipationRes.data ?? []).forEach(a => {
      allItems.push({
        id: `anticipation_${a.id}`,
        source: 'anticipation',
        description: 'Antecipação de recebíveis',
        category: 'Taxas Financeiras',
        amount: Number(a.gross_amount) - Number(a.net_amount),
        date: a.created_at.slice(0, 10),
        status: 'paid',
        reference_id: a.id,
        notes: a.notes,
        created_at: a.created_at,
      });
    });

    // Aplicar filtros
    let filtered = allItems;

    if (categories.length > 0) {
      filtered = filtered.filter(d => categories.includes(d.category));
    }
    if (sources.length > 0) {
      filtered = filtered.filter(d => sources.includes(d.source));
    }
    if (statuses.length > 0) {
      filtered = filtered.filter(d => statuses.includes(d.status));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(d =>
        d.description.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        (d.supplier?.toLowerCase().includes(q) ?? false)
      );
    }
    if (minAmount !== undefined) {
      filtered = filtered.filter(d => d.amount >= minAmount);
    }
    if (maxAmount !== undefined) {
      filtered = filtered.filter(d => d.amount <= maxAmount);
    }

    // Ordenar por data decrescente
    filtered.sort((a, b) => b.date.localeCompare(a.date));

    // Calcular resumo
    const byCategoryMap: Record<string, { total: number; count: number }> = {};
    const bySourceMap: Record<string, { total: number; count: number }> = {};
    const byMonthMap: Record<string, { total: number; paid: number; pending: number }> = {};
    const dailyMap: Record<string, number> = {};

    filtered.forEach(d => {
      // Categoria
      if (!byCategoryMap[d.category]) byCategoryMap[d.category] = { total: 0, count: 0 };
      byCategoryMap[d.category].total += d.amount;
      byCategoryMap[d.category].count += 1;

      // Fonte
      if (!bySourceMap[d.source]) bySourceMap[d.source] = { total: 0, count: 0 };
      bySourceMap[d.source].total += d.amount;
      bySourceMap[d.source].count += 1;

      // Mês
      const month = d.date.slice(0, 7);
      if (!byMonthMap[month]) byMonthMap[month] = { total: 0, paid: 0, pending: 0 };
      byMonthMap[month].total += d.amount;
      if (d.status === 'paid') byMonthMap[month].paid += d.amount;
      else byMonthMap[month].pending += d.amount;

      // Diário
      if (!dailyMap[d.date]) dailyMap[d.date] = 0;
      dailyMap[d.date] += d.amount;
    });

    const byCategory = Object.entries(byCategoryMap)
      .map(([category, { total, count }]) => ({ category, total, count }))
      .sort((a, b) => b.total - a.total);

    const bySource = Object.entries(bySourceMap)
      .map(([source, { total, count }]) => ({ source: source as DespesaSource, total, count }))
      .sort((a, b) => b.total - a.total);

    const byMonth = Object.entries(byMonthMap)
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const dailyTrend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));

    setItems(filtered);
    setSummary({
      total: filtered.reduce((s, d) => s + d.amount, 0),
      paid: filtered.filter(d => d.status === 'paid').reduce((s, d) => s + d.amount, 0),
      pending: filtered.filter(d => d.status === 'pending').reduce((s, d) => s + d.amount, 0),
      overdue: filtered.filter(d => d.status === 'overdue').reduce((s, d) => s + d.amount, 0),
      byCategory,
      bySource,
      byMonth,
      dailyTrend,
    });
    setLoading(false);
  }, [user?.tenantId, filters]);

  useEffect(() => { fetchDespesas(); }, [fetchDespesas]);

  return { items, summary, loading, refresh: fetchDespesas };
}