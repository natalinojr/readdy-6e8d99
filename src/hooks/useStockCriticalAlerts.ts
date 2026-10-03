import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// Insumos ABAIXO DO MÍNIMO pela regra única (2026-10-03): fn_get_stock_critical_alerts agora deriva de
// fn_estoque_situacao — 'critico' = esgotado, 'alerta' = abaixo do mínimo. Para a tela inteira (vai faltar,
// contagem, pedidos), use useEstoqueSituacao. Antes listava só insumo com pedido em preparo e "metade do mínimo".
export interface StockCriticalAlert {
  id: string;
  nome: string;
  unidade: string;
  estoqueAtual: number;
  minimo: number;
  consumoPrevisto: number;
  estoqueProjetado: number;
  /** Dias até acabar pelo uso dos últimos 14 dias (null = sem uso registrado) */
  diasRestantes: number | null;
  nivelAlerta: 'critico' | 'alerta';
}

export function useStockCriticalAlerts() {
  const { user } = useAuth();
  const [alertas, setAlertas] = useState<StockCriticalAlert[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_get_stock_critical_alerts', {
        p_tenant_id: user.tenantId,
      });
      if (!error && data) {
        const rows = (data as Array<{
          id: string;
          nome: string;
          unidade: string;
          estoque_atual: number;
          minimo: number;
          consumo_previsto: number;
          estoque_projetado: number;
          dias_restantes: number | null;
          nivel_alerta: 'critico' | 'alerta';
        }>) ?? [];
        setAlertas(rows.map((r) => ({
          id: r.id,
          nome: r.nome,
          unidade: r.unidade,
          estoqueAtual: Number(r.estoque_atual),
          minimo: Number(r.minimo),
          consumoPrevisto: Number(r.consumo_previsto),
          estoqueProjetado: Number(r.estoque_projetado),
          diasRestantes: r.dias_restantes == null ? null : Number(r.dias_restantes),
          nivelAlerta: r.nivel_alerta,
        })));
      }
    } catch (e) {
      console.error('[useStockCriticalAlerts]', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load]);

  return { alertas, loading, reload: load };
}