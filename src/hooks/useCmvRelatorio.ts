import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates } from '@/lib/dateUtils';

export interface CmvItem {
  item_name: string;
  category_name: string;
  total_qty: number;
  receita_total: number;
  custo_total: number;
  cmv_pct: number;
  margem_bruta: number;
  tem_ficha_tecnica: boolean;
}

export interface CmvResumo {
  receita_total: number;
  itens_com_ficha: number;
  itens_sem_ficha: number;
  cobertura_pct: number;
}

export interface CmvData {
  por_item: CmvItem[];
  resumo: CmvResumo;
}

const EMPTY: CmvData = {
  por_item: [],
  resumo: { receita_total: 0, itens_com_ficha: 0, itens_sem_ficha: 0, cobertura_pct: 0 },
};

export function useCmvRelatorio(periodo: string) {
  const { user } = useAuth();
  const [data, setData] = useState<CmvData>(EMPTY);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { from, to } = getPeriodDates(periodo);
      const { data: result, error } = await supabase.rpc('fn_get_cmv_report', {
        p_tenant_id: user.tenantId,
        p_date_from: from,
        p_date_to: to,
      });
      if (error) throw error;
      const raw = result as { por_item: CmvItem[]; resumo: CmvResumo } | null;
      setData({
        por_item: raw?.por_item ?? [],
        resumo: raw?.resumo ?? EMPTY.resumo,
      });
    } catch (e) {
      console.error('[useCmvRelatorio]', e);
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}
