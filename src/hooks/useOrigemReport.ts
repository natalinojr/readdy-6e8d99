import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates, getPeriodoAnterior, labelPeriodoAnterior } from '@/lib/dateUtils';
import { fetchIfoodVendas } from '@/lib/ifoodVendas';

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
  qr: number;
  auto: number;
  delivery: number;
  /** Pedidos do iFood (relatório de conciliação importado em Financeiro › iFood). */
  ifood: number;
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
  qr_universal: 'QR CODE',
  self_service: 'Autoatendimento',
  delivery: 'Delivery',
  ifood: 'iFood',
};

const ORIGEM_COR: Record<string, string> = {
  cashier: '#f59e0b',
  waiter: '#10b981',
  table: '#06b6d4',
  qr_universal: '#8b5cf6',
  self_service: '#ec4899',
  delivery: '#3b82f6',
  ifood: '#ea1d2c',
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

      // ── iFood: pedidos do relatório de conciliação importado (não passam pelo PDV do ERP) ──
      // Valor das vendas como no Portal do Parceiro, na data/hora do pedido, todas as lojas iFood.
      const ifood = await fetchIfoodVendas(user.tenantId, from, to);
      if (ifood.error) console.warn('[useOrigemReport] iFood:', ifood.error);
      if (ifood.pedidos > 0 || Math.abs(ifood.total) > 0.005) {
        totalValor += ifood.total;
        totalPedidos += ifood.pedidos;
        porOrigem.push({
          origem: ORIGEM_LABEL.ifood,
          origemKey: 'ifood',
          pedidos: ifood.pedidos,
          valor: ifood.total,
          ticketMedio: ifood.pedidos > 0 ? Math.round((ifood.total / ifood.pedidos) * 100) / 100 : 0,
          pct: 0,
          cor: ORIGEM_COR.ifood,
        });
        porOrigem.sort((a, b) => b.valor - a.valor);
      }

      // Recalcular percentuais com o total correto
      porOrigem.forEach((o) => {
        o.pct = totalValor > 0 ? Math.round((o.valor / totalValor) * 1000) / 10 : 0;
      });

      // ── Agregar por hora cheia (0–23h) — busca pedidos direto para ter a hora exata ──
      // Em períodos de vários dias soma cada hora de todos os dias (perfil do dia por canal).
      const porHora: OrigemHoraItem[] = [];
      try {
        const horaMap: Record<string, Omit<OrigemHoraItem, 'hora'>> = {};
        const vazio = () => ({ caixa: 0, garcom: 0, mesa: 0, qr: 0, auto: 0, delivery: 0, ifood: 0 });
        const slot = (h: string) => (horaMap[h] ??= vazio());
        for (const [hm, valor] of Object.entries(ifood.porHora)) slot(hm.slice(0, 2)).ifood += valor;

        // Paginado: o PostgREST devolve no máximo 1000 linhas por chamada.
        const PAGINA = 1000;
        for (let ini = 0; ; ini += PAGINA) {
          const { data: ordersData, error: ordersErr } = await supabase
            .from('orders')
            .select('origin_type, total_amount, created_at')
            .eq('tenant_id', user.tenantId)
            .not('status', 'in', '(cancelled,draft)')
            .eq('is_training', false)
            .eq('is_draft', false)
            .gte('created_at', from)
            .lte('created_at', to)
            .order('created_at')
            .range(ini, ini + PAGINA - 1);
          if (ordersErr) throw ordersErr;
          for (const o of (ordersData ?? []) as Array<{ origin_type: string | null; total_amount: number | null; created_at: string }>) {
            // Hora de Brasília (UTC−3, sem horário de verão desde 2019).
            const h = String((new Date(o.created_at).getUTCHours() + 21) % 24).padStart(2, '0');
            const valor = Number(o.total_amount ?? 0);
            const v = slot(h);
            switch (o.origin_type ?? 'cashier') {
              case 'cashier': v.caixa += valor; break;
              case 'waiter': v.garcom += valor; break;
              case 'table': v.mesa += valor; break;
              case 'qr_universal': v.qr += valor; break;
              case 'self_service': v.auto += valor; break;
              case 'delivery': v.delivery += valor; break;
            }
          }
          if ((ordersData?.length ?? 0) < PAGINA) break;
        }

        const horas = Object.keys(horaMap).map(Number).sort((a, b) => a - b);
        if (horas.length > 0) {
          const r = (n: number) => Math.round(n * 100) / 100;
          // Faixa contínua da 1ª à última hora com venda (horas vazias no meio aparecem zeradas).
          for (let h = horas[0]; h <= horas[horas.length - 1]; h++) {
            const v = horaMap[String(h).padStart(2, '0')] ?? vazio();
            porHora.push({
              hora: `${String(h).padStart(2, '0')}h`,
              caixa: r(v.caixa), garcom: r(v.garcom), mesa: r(v.mesa), qr: r(v.qr),
              auto: r(v.auto), delivery: r(v.delivery), ifood: r(v.ifood),
            });
          }
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