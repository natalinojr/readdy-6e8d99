import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import {
  fetchRevenueSettings, fetchCardProviders, moneyFlowLabels, EMPTY_MONEY_FLOW,
  type MoneyFlowSettings, type RevenueSettingSource, type CardProviderConfig,
} from '@/lib/revenueSources';

// Configuração "Como o dinheiro entra" da loja atual (fin_revenue_settings) + os
// nomes que as telas usam (ex.: "Vendas no cartão (Stone)", "Pix recebido (Banco Inter)").
export function useMoneyFlow() {
  const { user } = useAuth();
  const [flow, setFlow] = useState<MoneyFlowSettings>(EMPTY_MONEY_FLOW);
  const [sources, setSources] = useState<RevenueSettingSource[]>([]);
  // Maquininhas da loja — pode ser mais de uma ao mesmo tempo (fin_card_providers).
  const [providers, setProviders] = useState<CardProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // Troca de loja: zera antes de buscar para não mostrar a configuração da loja anterior.
    setFlow(EMPTY_MONEY_FLOW);
    setSources([]);
    setProviders([]);
    if (!user?.tenantId) { setLoading(false); return; }
    setLoading(true);
    const [r, cards] = await Promise.all([
      fetchRevenueSettings(user.tenantId),
      fetchCardProviders(user.tenantId),
    ]);
    setFlow(r.flow);
    setSources(r.sources);
    setProviders(cards.providers);
    setError(r.error ?? cards.error);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (next: MoneyFlowSettings) => {
    if (!user?.tenantId) return { error: 'Sem loja selecionada' };
    const r = await invokeWithAuth<{ data?: unknown; error?: string }>('financial-write', {
      body: { action: 'set_money_flow', tenant_id: user.tenantId, payload: next },
    });
    const err = r.data?.error ?? r.error?.message ?? null;
    if (!err) await reload();
    return { error: err };
  }, [user?.tenantId, reload]);

  const saveProviders = useCallback(async (next: CardProviderConfig[]) => {
    if (!user?.tenantId) return { error: 'Sem loja selecionada' };
    const r = await invokeWithAuth<{ data?: unknown; error?: string }>('financial-write', {
      body: { action: 'set_card_providers', tenant_id: user.tenantId, payload: { providers: next } },
    });
    const err = r.data?.error ?? r.error?.message ?? null;
    if (!err) await reload();
    return { error: err };
  }, [user?.tenantId, reload]);

  return { flow, sources, providers, labels: moneyFlowLabels(flow, providers), loading, error, reload, save, saveProviders };
}
