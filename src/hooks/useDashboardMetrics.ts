import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface DashboardMesa {
  numero: number;
  status: string;
  tempo: number | null;
  valor: number;
  pessoas: number;
}

export interface DashboardAlertaEstoque {
  id: string;
  nome: string;
  estoque: number;
  minimo: number;
  unidade: string;
  critico: boolean;
}

export interface DashboardPagamento {
  id: string;
  amount: number;
  change_amount: number | null;
  payment_method_name: string | null;
  payment_method_type: string | null;
  operator_name: string | null;
  cash_register_id: string | null;
  cash_register_name: string | null;
  is_refunded: boolean;
}

export interface DashboardPedido {
  id: string;
  numero: string;
  status: string;
  total: number;
  created_at: string;
  origin: string;
  destination: string;
  destination_name: string | null;
  is_paid: boolean;
  operador: string | null;
  itens: Array<{ nome: string; qtd: number; valor: number }>;
  pagamentos: DashboardPagamento[];
}

export interface DashboardMetrics {
  faturamento_hoje: number;
  faturamento_ontem: number;
  pedidos_hoje: number;
  pedidos_ontem: number;
  ticket_medio: number;
  ticket_medio_ontem: number;
  mesas_ocupadas: number;
  mesas_total: number;
  pedidos_new: number;
  pedidos_preparing: number;
  pedidos_ready: number;
  pedidos_delivered_today: number;
  vendas_por_hora: Array<{ hora: string; valor: number }>;
  ultimos_pedidos: DashboardPedido[];
  mesas_mapa: DashboardMesa[];
  alertas_estoque: DashboardAlertaEstoque[];
  pedidos_abertos_valor: number;
  pedidos_abertos_count: number;
  faturamento_andamento_hoje: number;
  pedidos_andamento_hoje: number;
}

export function useDashboardMetrics() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: rpcError } = await supabase.rpc('fn_get_dashboard_metrics', {
        p_tenant_id: user.tenantId,
      });
      if (rpcError) {
        console.error('[useDashboardMetrics] RPC error:', rpcError);
        setError(rpcError.message);
      } else if (result) {
        setData(result as DashboardMetrics);
      }
    } catch (e) {
      console.error('[useDashboardMetrics]', e);
      setError('Erro ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
