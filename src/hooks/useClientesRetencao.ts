import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDateObjects } from '@/lib/dateUtils';
import type { RPCCustomerOrderRow, RPCCustomerOrderPreviousRow } from '@/types/rpc';

export interface RetencaoSemana {
  semana: string;
  label: string;
  novos: number;
  retornantes: number;
  taxa: number;
}

export function useClientesRetencao(periodo: string) {
  const { user } = useAuth();
  const [semanas, setSemanas] = useState<RetencaoSemana[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { from, to } = getPeriodDateObjects(periodo);
      const diffMs = to.getTime() - from.getTime();
      const diffDias = Math.ceil(diffMs / 86_400_000);

      // Divide o período em janelas (~4 janelas, máx 8)
      const tamanhoJanela = Math.max(1, Math.ceil(diffDias / 4));
      const janelas: { from: Date; to: Date; label: string }[] = [];

      let cursor = new Date(from);
      let idx = 0;
      while (cursor < to && idx < 8) {
        const jFrom = new Date(cursor);
        const jTo = new Date(Math.min(cursor.getTime() + tamanhoJanela * 86_400_000 - 1, to.getTime()));
        const fmtD = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        janelas.push({ from: jFrom, to: jTo, label: `${fmtD(jFrom)} - ${fmtD(jTo)}` });
        cursor = new Date(jTo.getTime() + 1);
        idx++;
      }

      // Pedidos com customer_id no período
      const { data: orders, error } = await supabase
        .from('orders')
        .select('customer_id, created_at')
        .eq('tenant_id', user.tenantId)
        .not('customer_id', 'is', null)
        .eq('status', 'delivered')
        .eq('is_training', false)
        .eq('is_draft', false)
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString());

      if (error) throw error;

      // Pedidos anteriores ao período (para identificar retornantes)
      const { data: ordersAntes } = await supabase
        .from('orders')
        .select('customer_id')
        .eq('tenant_id', user.tenantId)
        .not('customer_id', 'is', null)
        .eq('status', 'delivered')
        .eq('is_training', false)
        .eq('is_draft', false)
        .lt('created_at', from.toISOString());

      const clientesAntigos = new Set(
        ((ordersAntes ?? []) as RPCCustomerOrderPreviousRow[]).map((o) => o.customer_id)
      );

      // Primeira compra de cada cliente no período
      const primeiraCompraNoPeríodo: Record<string, Date> = {};
      ((orders ?? []) as RPCCustomerOrderRow[]).forEach((o) => {
        const cid = o.customer_id;
        const dt = new Date(o.created_at);
        if (!primeiraCompraNoPeríodo[cid] || dt < primeiraCompraNoPeríodo[cid]) {
          primeiraCompraNoPeríodo[cid] = dt;
        }
      });

      const resultado: RetencaoSemana[] = janelas.map((j, i) => {
        const clientesNaJanela = new Set(
          ((orders ?? []) as RPCCustomerOrderRow[])
            .filter((o) => {
              const dt = new Date(o.created_at);
              return dt >= j.from && dt <= j.to;
            })
            .map((o) => o.customer_id)
        );

        let novos = 0;
        let retornantes = 0;

        clientesNaJanela.forEach((cid) => {
          const primeiraCompra = primeiraCompraNoPeríodo[cid];
          const eraAntigoAntesDoPeriodo = clientesAntigos.has(cid);
          const primeiraCompraFoiNessaJanela =
            primeiraCompra && primeiraCompra >= j.from && primeiraCompra <= j.to;

          if (eraAntigoAntesDoPeriodo || !primeiraCompraFoiNessaJanela) {
            retornantes++;
          } else {
            novos++;
          }
        });

        const total = novos + retornantes;
        const taxa = total > 0 ? parseFloat(((retornantes / total) * 100).toFixed(1)) : 0;
        const semanaLabel = janelas.length <= 4
          ? `S-${janelas.length - i}`
          : `S${i + 1}`;

        return { semana: semanaLabel, label: j.label, novos, retornantes, taxa };
      });

      setSemanas(resultado);
    } catch (e) {
      console.error('[useClientesRetencao]', e);
      setSemanas([]);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo]);

  useEffect(() => { load(); }, [load]);

  return { semanas, loading };
}
