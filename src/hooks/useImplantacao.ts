import { useState, useEffect, useCallback } from 'react';
import { supabase, SUPABASE_URL } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ImplementationCost, ImplementationColumn, InvestmentSettings } from '@/types/financeiro';

async function invokeImpl(action: string, tenantId: string, payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/implementation-write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ action, tenant_id: tenantId, payload }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error('[invokeImpl] Erro:', json.error);
  }
  return json;
}

export function useImplantacao() {
  const { user } = useAuth();
  const [costs, setCosts] = useState<ImplementationCost[]>([]);
  const [columns, setColumns] = useState<ImplementationColumn[]>([]);
  const [settings, setSettings] = useState<InvestmentSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const [costsRes, colsRes, settingsRes] = await Promise.all([
      supabase.from('fin_implementation_costs').select('*').eq('tenant_id', user.tenantId).order('date', { ascending: false }),
      supabase.from('fin_implementation_columns').select('*').eq('tenant_id', user.tenantId).eq('is_active', true).order('sort_order'),
      supabase.from('fin_investment_settings').select('*').eq('tenant_id', user.tenantId).maybeSingle(),
    ]);
    if (costsRes.error) console.error('[useImplantacao] Erro ao buscar custos de implantação:', costsRes.error.message);
    if (colsRes.error) console.error('[useImplantacao] Erro ao buscar colunas de implantação:', colsRes.error.message);
    if (settingsRes.error) console.error('[useImplantacao] Erro ao buscar configurações de investimento:', settingsRes.error.message);
    setCosts(costsRes.data ?? []);
    setColumns(colsRes.data ?? []);
    setSettings(settingsRes.data ?? null);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const upsertCost = async (payload: Partial<ImplementationCost>) => {
    await invokeImpl('upsert_cost', user!.tenantId, payload as Record<string, unknown>);
    fetchAll();
  };

  const deleteCost = async (id: string) => {
    await invokeImpl('delete_cost', user!.tenantId, { id });
    fetchAll();
  };

  const upsertColumn = async (payload: Partial<ImplementationColumn>) => {
    await invokeImpl('upsert_column', user!.tenantId, payload as Record<string, unknown>);
    fetchAll();
  };

  const deleteColumn = async (id: string) => {
    await invokeImpl('delete_column', user!.tenantId, { id });
    fetchAll();
  };

  const saveSettings = async (payload: Partial<InvestmentSettings>) => {
    await invokeImpl('upsert_investment_settings', user!.tenantId, payload as Record<string, unknown>);
    fetchAll();
  };

  const totalInvestimento = costs.reduce((s, c) => s + Number(c.amount), 0);

  return {
    costs, columns, settings, loading,
    upsertCost, deleteCost, upsertColumn, deleteColumn, saveSettings,
    totalInvestimento, refresh: fetchAll,
  };
}
