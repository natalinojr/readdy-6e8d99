import { useState, useEffect, useCallback } from 'react';
import { supabase, SUPABASE_URL } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { dateKeyBrasilia } from '@/lib/dateUtils';
import { DEFAULT_REVENUE_SOURCES, fetchRevenueSources, fetchPixRecebidos, type RevenueSettingSource } from '@/lib/revenueSources';

// Formato das linhas lidas nas queries paginadas (o helper é genérico, então
// o tipo precisa ser declarado aqui em vez de inferido pelo supabase-js).
interface OrderRow {
  id: string; number: string | null; total_amount: number;
  is_paid: boolean | null; paid_at: string | null; created_at: string;
  origin_type: string | null; destination_type: string | null;
  table_number: number | null; waiter_name: string | null;
  status: string;
}
interface CashFlowRow {
  id: string; description: string; amount: number; date: string;
  category: string | null; origin: string | null;
  payment_method_id: string | null; notes: string | null; created_at: string;
}
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ──────────────────────────────────────────────────────────────────
export type ReceitaSource = 'order' | 'stone' | 'pix' | 'manual';

// Fontes configuráveis por loja (fin_revenue_settings.sources) — regra única
// compartilhada com DRE e Visão Geral, em src/lib/revenueSources.ts.
export { DEFAULT_REVENUE_SOURCES, REVENUE_SOURCE_INFO } from '@/lib/revenueSources';
export type { RevenueSettingSource } from '@/lib/revenueSources';
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
  fromStone: number;
  fromPix: number;
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
  stone: 'Stone (cartão)',
  pix: 'Pix recebido',
  manual: 'Lançamento Manual',
};

export const SOURCE_COLORS_R: Record<ReceitaSource, string> = {
  order: '#10b981',
  stone: '#0ea5e9',
  pix: '#8b5cf6',
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
  // Erro VISÍVEL. Antes o retorno das queries era lido como `res.rows ?? []` e o
  // `error` era descartado: qualquer falha (coluna inexistente, RLS, rede) virava
  // "nenhuma receita encontrada" — indistinguível de um período sem vendas.
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [enabledSources, setEnabledSources] = useState<RevenueSettingSource[]>(DEFAULT_REVENUE_SOURCES);

  const fetchReceitas = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);

    const { startDate, endDate, categories, sources, search, minAmount, maxAmount } = filters;

    // Quais fontes contam como recebido nesta loja (configurável na própria aba).
    const { sources: enabled, error: cfgErr } = await fetchRevenueSources(user.tenantId);
    if (cfgErr) {
      console.error('[useReceitas] Falha ao ler fontes de receita:', cfgErr);
      setError(cfgErr);
      setItems([]);
      setSummary(null);
      setLoading(false);
      return;
    }
    setEnabledSources(enabled);
    const empty = Promise.resolve({ rows: [] as never[], error: null, truncated: false });
    // Fuso EXPLÍCITO de Brasília: sem o offset, 'T23:59:59' é interpretado como
    // UTC contra um timestamptz e o período fechava às 20:59 do horário local —
    // todo o faturamento das 21h à meia-noite do último dia caía fora.
    const startISO = startDate + 'T00:00:00-03:00';
    const endISO = endDate + 'T23:59:59-03:00';

    // PAGINADO: sem .range() o PostgREST corta em ~1000 linhas SEM ERRO, e o
    // total da aba simplesmente parava de crescer em períodos longos
    // ("Últimos 3 Meses", "Este Ano") sem nada indicar o truncamento.
    const [ordersRes, manualRes, stoneRes, pixRes] = await Promise.all([
      // Pedidos entregues (fonte única de verdade: status = 'delivered')
      !enabled.includes('orders') ? empty : fetchAllRows<OrderRow>((from, to) => supabase
        .from('orders')
        // NÃO peça `payment_method`: essa coluna NÃO existe em `orders` (a forma
        // de pagamento vive em `payments`). O PostgREST devolvia 400
        // (42703 column does not exist) e a query INTEIRA falhava — como o erro
        // era ignorado, a aba renderizava R$ 0,00 em todas as lojas, em todos os
        // períodos, sem nada na tela indicando falha. O campo nunca era usado.
        .select('id, number, total_amount, is_paid, paid_at, created_at, origin_type, destination_type, table_number, waiter_name, status')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'delivered')
        // is_paid era SELECIONADO e nunca aplicado: comanda entregue e não
        // fechada (fiado, mesa aberta) entrava como receita recebida, inflando
        // a aba. Contrato do FINANCEIRO_MAP §5: delivered AND is_paid.
        .eq('is_paid', true)
        .eq('is_training', false)
        .neq('status', 'cancelled')
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .order('created_at', { ascending: false })
        .range(from, to)),

      // Receitas manuais no fin_cash_flow
      !enabled.includes('manual') ? empty : fetchAllRows<CashFlowRow>((from, to) => supabase
        .from('fin_cash_flow')
        .select('id, description, amount, date, category, origin, payment_method_id, notes, created_at')
        .eq('tenant_id', user.tenantId)
        .eq('type', 'income')
        .eq('origin', 'manual')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false })
        .range(from, to)),

      // Vendas em cartão liquidadas pela Stone (lançadas pela edge
      // stone-conciliation com post_to_ledger ligado). Datadas pelo dia do
      // pagamento da Stone = dinheiro que efetivamente entrou.
      !enabled.includes('stone') ? empty : fetchAllRows<CashFlowRow>((from, to) => supabase
        .from('fin_cash_flow')
        .select('id, description, amount, date, category, origin, payment_method_id, notes, created_at')
        .eq('tenant_id', user.tenantId)
        .eq('type', 'income')
        .eq('origin', 'stone_sale')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false })
        .range(from, to)),

      // Pix que entrou no Inter (extrato), inclusive o da maquininha vindo da Conta Stone
      !enabled.includes('pix')
        ? Promise.resolve({ rows: [], error: null })
        : fetchPixRecebidos(user.tenantId, startDate, endDate),
    ]);

    const falha = ordersRes.error ?? manualRes.error ?? stoneRes.error ?? (pixRes.error ? { message: pixRes.error } : null);
    if (falha) {
      console.error('[useReceitas] Falha ao carregar receitas:', falha.message);
      setError(falha.message);
      setItems([]);
      setSummary(null);
      setLoading(false);
      return;
    }
    setError(null);
    setTruncated(ordersRes.truncated || manualRes.truncated || stoneRes.truncated);

    const allItems: ReceitaItem[] = [];

    // Pedidos pagos
    (ordersRes.rows ?? []).forEach(o => {
      // Data da VENDA (`created_at`), não do pagamento. A aba mede faturamento
      // por venda e o FILTRO de período já usa `created_at`; datar a linha por
      // `paid_at` fazia o pedido aberto em 31/08 e fechado em 01/09 entrar no
      // filtro de agosto exibindo data de setembro — e sumir do filtro de setembro.
      // E sempre em Brasília: `slice(0,10)` corta em UTC e joga o jantar
      // (depois das 21h) para o dia seguinte.
      const saleDate = dateKeyBrasilia(o.created_at);
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
        date: saleDate,
        status: 'received',
        origin_detail: originDetail,
        reference_id: o.id,
        notes: o.waiter_name ? `Operador: ${o.waiter_name}` : undefined,
        created_at: o.created_at,
      });
    });

    // Receitas manuais
    (manualRes.rows ?? []).forEach(c => {
      allItems.push({
        id: `manual_${c.id}`,
        source: 'manual',
        description: c.description || 'Receita manual',
        category: c.category || 'Outros',
        amount: Number(c.amount),
        date: c.date,
        status: 'received',
        reference_id: c.id,
        notes: c.notes ?? undefined,
        created_at: c.created_at,
      });
    });

    // Vendas Stone (uma linha por dia de pagamento)
    (stoneRes.rows ?? []).forEach(c => {
      allItems.push({
        id: `stone_${c.id}`,
        source: 'stone',
        description: c.description || 'Vendas em cartão (Stone)',
        category: 'Cartão (Stone)',
        amount: Number(c.amount),
        date: c.date,
        status: 'received',
        origin_detail: 'Conciliação Stone',
        reference_id: c.id,
        notes: c.notes ?? undefined,
        created_at: c.created_at,
      });
    });

    // Pix recebido no Inter
    pixRes.rows.forEach(p => {
      allItems.push({
        id: `pix_${p.id}`,
        source: 'pix',
        description: p.description || 'Pix recebido',
        category: 'Pix',
        amount: p.amount,
        date: p.transaction_date,
        status: 'received',
        origin_detail: p.match_kind === 'internal_transfer' ? 'Transferido da Conta Stone (Pix da maquininha)' : (p.counterpart_name ?? 'Banco Inter'),
        reference_id: p.id,
        created_at: p.created_at,
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
    const fromStone = filtered.filter(r => r.source === 'stone').reduce((s, r) => s + r.amount, 0);
    const fromPix = filtered.filter(r => r.source === 'pix').reduce((s, r) => s + r.amount, 0);

    setItems(filtered);
    setSummary({
      total: filtered.reduce((s, r) => s + r.amount, 0),
      fromOrders,
      fromStone,
      fromPix,
      fromManual,
      byCategory,
      bySource,
      byMonth,
      dailyTrend,
    });
    setLoading(false);
  }, [user?.tenantId, filters]);

  useEffect(() => { fetchReceitas(); }, [fetchReceitas]);

  return { items, summary, loading, error, truncated, enabledSources, refresh: fetchReceitas };
}

// ─── Hook para salvar as fontes dos recebidos da loja ────────────────────────
export function useSaveRevenueSources() {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (sources: RevenueSettingSource[]) => {
    if (!user?.tenantId) return { error: 'Sem tenant' };
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return { error: 'Sessão expirada' };
      const res = await fetch(`${SUPABASE_URL}/functions/v1/financial-write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify({ action: 'set_revenue_sources', tenant_id: user.tenantId, payload: { sources } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) return { error: String(json?.error ?? 'Erro ao salvar') };
      return { error: null };
    } finally {
      setSaving(false);
    }
  }, [user?.tenantId]);

  return { save, saving };
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
      // Escrita via Edge Function (service_role), NÃO direto na tabela.
      // O insert direto dependia da política RLS `*_auth_uid`, que resolve o
      // tenant com `SELECT ... FROM user_tenants WHERE user_id = auth.uid()
      // LIMIT 1` — sem ORDER BY. Para um usuário com várias lojas isso sorteia
      // UMA membership: nas demais o insert afetava zero linhas, sem erro
      // nenhum (o usuário salvava e nada acontecia).
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return { error: 'Sessão expirada' };

      const res = await fetch(`${SUPABASE_URL}/functions/v1/financial-write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify({
          action: 'insert_cash_flow',
          tenant_id: user.tenantId,
          payload: {
            type: 'income',
            origin: 'manual',
            description: data.description,
            amount: data.amount,
            date: data.date,
            category: data.category,
            notes: data.notes || null,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        return { error: String(json?.error ?? 'Erro ao salvar a receita') };
      }
      return { error: null };
    } finally {
      setSaving(false);
    }
  }, [user?.tenantId]);

  return { insert, saving };
}
