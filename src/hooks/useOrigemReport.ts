import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates, getPeriodoAnterior, labelPeriodoAnterior } from '@/lib/dateUtils';

export interface OrigemItem {
  origem: string;
  origemKey: string;
  pedidos: number;
  valor: number;
  ticketMedio: number;
  pct: number;
  cor: string;
}

export interface OrigemHoraItem {
  hora: string;
  caixa: number;
  garcom: number;
  mesa: number;
  auto: number;
  delivery: number;
}

export interface OrigemReportData {
  porOrigem: OrigemItem[];
  porHora: OrigemHoraItem[];
  totalValor: number;
  totalPedidos: number;
}

const ORIGEM_LABEL: Record<string, string> = {
  cashier: 'Caixa',
  waiter: 'Garçom',
  table: 'Mesa (QR)',
  self_service: 'Autoatendimento',
  delivery: 'Delivery',
};

const ORIGEM_COR: Record<string, string> = {
  cashier: '#f59e0b',
  waiter: '#10b981',
  table: '#06b6d4',
  self_service: '#f97316',
  delivery: '#ef4444',
};

/** @deprecated Use getPeriodoAnterior de @/lib/dateUtils */
export function getPeriodoAnteriorOrigem(periodo: string): string {
  return getPeriodoAnterior(periodo);
}

/** @deprecated Use labelPeriodoAnterior de @/lib/dateUtils */
export function labelPeriodoAnteriorOrigem(periodo: string): string {
  return labelPeriodoAnterior(periodo);
}

export function useOrigemReport(periodo: string) {
  const { user } = useAuth();
  const [dados, setDados] = useState<OrigemReportData>({
    porOrigem: [], porHora: [], totalValor: 0, totalPedidos: 0,
  });
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { from, to } = getPeriodDates(periodo);

      // Usar a MESMA RPC que o Dashboard — passa tenant_id explicitamente,
      // bypassando problemas de RLS com múltiplos tenants
      const { data: rpcData, error } = await supabase.rpc('fn_get_sales_report', {
        p_tenant_id: user.tenantId,
        p_date_from: from,
        p_date_to: to,
        p_session_id: null,
      });

      if (error) throw error;

      const report = rpcData as {
        total_revenue: number;
        total_orders: number;
        by_destination?: Array<{ destination: string; orders: number; revenue: number }>;
        orders_by_day?: Array<{ day: string; orders: number; revenue: number }>;
      } | null;

      // ── Agregar por origem (vem da RPC como by_destination) ──
      const byDest = report?.by_destination ?? [];
      let totalValor = 0;
      let totalPedidos = 0;

      const porOrigem: OrigemItem[] = byDest
        .map((d) => {
          const key = d.destination ?? 'cashier';
          const valor = Number(d.revenue ?? 0);
          const pedidos = Number(d.orders ?? 0);
          totalValor += valor;
          totalPedidos += pedidos;
          return {
            origem: ORIGEM_LABEL[key] ?? key,
            origemKey: key,
            pedidos,
            valor,
            ticketMedio: pedidos > 0 ? Math.round((valor / pedidos) * 100) / 100 : 0,
            pct: 0, // calculado abaixo
            cor: ORIGEM_COR[key] ?? '#94a3b8',
          };
        })
        .sort((a, b) => b.valor - a.valor);

      // Recalcular percentuais com o total correto
      porOrigem.forEach((o) => {
        o.pct = totalValor > 0 ? Math.round((o.valor / totalValor) * 1000) / 10 : 0;
      });

      // ── Agregar por hora — busca pedidos direto para ter a hora exata ──
      // Usamos query direta APENAS para o detalhe de hora, com fallback seguro
      let porHora: OrigemHoraItem[] = [];
      try {
        const { data: ordersData, error: ordersErr } = await supabase
          .from('orders')
          .select('origin_type, total_amount, created_at')
          .eq('tenant_id', user.tenantId)
          .not('status', 'in', '(cancelled,draft)')
          .eq('is_training', false)
          .eq('is_draft', false)
          .gte('created_at', from)
          .lte('created_at', to);

        if (!ordersErr && ordersData && ordersData.length > 0) {
          const horaMap: Record<string, { caixa: number; garcom: number; mesa: number; auto: number; delivery: number }> = {};
          ordersData.forEach((o: any) => {
            const hora = new Date(o.created_at).toLocaleTimeString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
              hour: '2-digit',
              minute: '2-digit',
            });
            const origem = o.origin_type ?? 'cashier';
            const valor = Number(o.total_amount ?? 0);
            if (!horaMap[hora]) {
              horaMap[hora] = { caixa: 0, garcom: 0, mesa: 0, auto: 0, delivery: 0 };
            }
            if (origem === 'cashier') horaMap[hora].caixa += valor;
            else if (origem === 'waiter') horaMap[hora].garcom += valor;
            else if (origem === 'table') horaMap[hora].mesa += valor;
            else if (origem === 'self_service') horaMap[hora].auto += valor;
            else if (origem === 'delivery') horaMap[hora].delivery += valor;
          });
          porHora = Object.entries(horaMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([hora, v]) => ({
              hora,
              caixa: Math.round(v.caixa * 100) / 100,
              garcom: Math.round(v.garcom * 100) / 100,
              mesa: Math.round(v.mesa * 100) / 100,
              auto: Math.round(v.auto * 100) / 100,
              delivery: Math.round(v.delivery * 100) / 100,
            }));
        }
      } catch (horaErr) {
        console.warn('[useOrigemReport] Falha ao carregar hora, usando sem gráfico de hora:', horaErr);
      }

      setDados({
        porOrigem,
        porHora,
        totalValor: Math.round(totalValor * 100) / 100,
        totalPedidos,
      });
    } catch (e) {
      console.error('[useOrigemReport] error:', e);
      setDados({ porOrigem: [], porHora: [], totalValor: 0, totalPedidos: 0 });
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo]);

  useEffect(() => { carregar(); }, [carregar]);

  return { dados, loading, recarregar: carregar };
}