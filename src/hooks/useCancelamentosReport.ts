import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDateObjects } from '@/lib/dateUtils';

export interface CancelamentoItem {
  id: string;
  pedido: string;
  mesa: string;
  motivo: string;
  valor: number;
  hora: string;
  data: string;
  origem: string;
}

export interface EstornoItem {
  id: string;
  pedido: string;
  cliente: string;
  motivo: string;
  valor: number;
  hora: string;
  data: string;
}

export interface DescontoItem {
  id: string;
  pedido: string;
  mesa: string;
  valor: number;
  pct: number;
  hora: string;
  data: string;
  origem: string;
}

export interface GorjetaItem {
  garcom: string;
  pedidos: number;
  totalGorjeta: number;
  mediaGorjeta: number;
  pctPedidosGorjeta: number;
}

export interface CancelamentosData {
  cancelamentos: CancelamentoItem[];
  estornos: EstornoItem[];
  descontos: DescontoItem[];
  gorjetas: GorjetaItem[];
}

export function useCancelamentosReport(periodo: string) {
  const { user } = useAuth();
  const [dados, setDados] = useState<CancelamentosData>({
    cancelamentos: [],
    estornos: [],
    descontos: [],
    gorjetas: [],
  });
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { from, to } = getPeriodDateObjects(periodo);
      const { data } = await supabase.rpc('fn_get_cancelamentos_report', {
        p_tenant_id: user.tenantId,
        p_start: from.toISOString(),
        p_end: to.toISOString(),
      });

      const raw = data as Record<string, unknown[]>;
      setDados({
        cancelamentos: (raw?.cancelamentos ?? []) as CancelamentoItem[],
        estornos: (raw?.estornos ?? []) as EstornoItem[],
        descontos: (raw?.descontos ?? []) as DescontoItem[],
        gorjetas: (raw?.gorjetas ?? []) as GorjetaItem[],
      });
    } catch (e) {
      console.error('useCancelamentosReport:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo]);

  useEffect(() => { carregar(); }, [carregar]);

  return { dados, loading, recarregar: carregar };
}
