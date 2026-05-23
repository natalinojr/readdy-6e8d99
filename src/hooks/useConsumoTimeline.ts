import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface TimelinePoint {
  dia: string;
  consumo: number;
  estoque: number;
}

export function useConsumoTimeline(ingredientId: string | null, days = 30) {
  const { user } = useAuth();
  const [dados, setDados] = useState<TimelinePoint[]>([]);
  const [loading, setLoading] = useState(false);

  const tenantIdFromStorage = typeof window !== 'undefined'
    ? localStorage.getItem('erpos_selected_tenant_id')
    : null;

  // PRIORIDADE: localStorage (fonte mais confiável) > user.tenantId
  const rawTenantId =
    tenantIdFromStorage ||
    user?.tenantId ||
    '';

  const tenantIdFinal = rawTenantId && String(rawTenantId).trim().length > 0
    ? String(rawTenantId).trim()
    : null;

  const load = useCallback(async () => {
    const tId = tenantIdFinal;
    if (!ingredientId || !tId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_get_ingredient_consumption_timeline', {
        p_tenant_id: tId,
        p_ingredient_id: ingredientId,
        p_days: days,
      });
      if (!error && data) {
        const rows = (data as Array<{ dia: string; consumo: number; estoque: number }>) ?? [];
        setDados(rows.map((r) => ({
          dia: r.dia,
          consumo: Number(r.consumo),
          estoque: Number(r.estoque),
        })));
      }
    } catch (e) {
      console.error('[useConsumoTimeline]', e);
    } finally {
      setLoading(false);
    }
  }, [ingredientId, tenantIdFinal, days]);

  useEffect(() => { load(); }, [load]);

  return { dados, loading };
}