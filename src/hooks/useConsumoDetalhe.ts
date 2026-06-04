import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { convertUnit } from '@/lib/unitConversion';
import type { UnidadeEstoque } from '@/types/estoque';

export interface PedidoConsumo {
  id: string;
  number: string | null;
  originType: string | null;
  destinationName: string | null;
  tableNumber: number | null;
  total: number;
  paidByPdv: string | null;
  status: string;
}

export interface ConsumoNoDia {
  data: string;        // 'YYYY-MM-DD'
  dataLabel: string;   // 'DD/MM'
  diaSemana: string;   // 'Seg', 'Ter'...
  totalQtd: number;
  unidade: UnidadeEstoque;
  buckets: { vendas: number; producao: number; perda: number; ajuste: number; transferencia: number };
  movimentos: Array<{
    id: string;
    type: string;
    qty: number;
    bucket: string;
    reason: string | null;
    hora: string;
    orderId: string | null;
  }>;
  pedidos: PedidoConsumo[];
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const BUCKET_MAP: Record<string, string> = {
  theoretical_out: 'vendas',
  manual_out: 'ajuste',
  transfer_out: 'transferencia',
  inventory_adjustment: 'ajuste',
};

function getBucket(type: string, reason: string | null): { bucket: string; isConsumo: boolean } {
  if (type === 'in' || type === 'transfer_in') return { bucket: 'ajuste', isConsumo: false };
  const r = (reason || '').toLowerCase();
  if (type === 'theoretical_out') return { bucket: 'vendas', isConsumo: true };
  if (r.includes('perda') || r.includes('descarte') || r.includes('quebra') || r.includes('dano') || r.includes('estrago')) {
    return { bucket: 'perda', isConsumo: true };
  }
  if (type === 'manual_out' && (r.includes('producao') || r.includes('produção') || r.includes('saida (producao)'))) {
    return { bucket: 'producao', isConsumo: true };
  }
  if (type === 'transfer_out') return { bucket: 'transferencia', isConsumo: true };
  if (type === 'inventory_adjustment') return { bucket: 'ajuste', isConsumo: true };
  if (type === 'manual_out') return { bucket: 'ajuste', isConsumo: true };
  return { bucket: 'ajuste', isConsumo: false };
}

function formatHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function useConsumoDetalhe(
  ingredientId: string | null,
  ingredientUnit: UnidadeEstoque,
  dateFrom: string,
  dateTo: string,
) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [dias, setDias] = useState<ConsumoNoDia[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !ingredientId) {
      setDias([]);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const fromDate = new Date(`${dateFrom}T00:00:00`);
        const toDate = new Date(`${dateTo}T23:59:59`);

        // 1) Buscar movimentações via RPC (respeita RLS corretamente)
        const { data: rpcData, error: movsErr } = await supabase.rpc('fn_get_stock_movements', {
          p_tenant_id: tenantId,
          p_limit: 5000,
        });

        if (movsErr) throw movsErr;

        // Filtrar pelo ingrediente e período no JS
        const allMovs = (rpcData ?? []) as Array<{
          id: string;
          ingredient_id: string;
          type: string;
          quantity: number;
          ingredient_unit?: string | null;
          reason?: string | null;
          created_at?: string | null;
          order_id?: string | null;
        }>;

        const rawMovs = allMovs
          .filter(m => {
            if (m.ingredient_id !== ingredientId) return false;
            if (!m.created_at) return false;
            const d = new Date(m.created_at);
            return d >= fromDate && d <= toDate;
          })
          .map(m => ({
            id: m.id,
            type: m.type,
            quantity: Number(m.quantity),
            unit: m.ingredient_unit ?? null,
            reason: m.reason ?? null,
            created_at: m.created_at ?? '',
            order_id: m.order_id ?? null,
          }))
          .sort((a, b) => a.created_at.localeCompare(b.created_at));

        // 2) Coletar order_ids únicos
        const orderIds = Array.from(
          new Set(rawMovs.map(m => m.order_id).filter(Boolean) as string[])
        );

        // 3) Buscar pedidos via RPC
        const pedidosMap = new Map<string, PedidoConsumo>();
        if (orderIds.length > 0) {
          const { data: ordersData } = await supabase.rpc('fn_get_orders_by_ids', {
            p_order_ids: orderIds,
          });

          for (const o of (ordersData ?? []) as Array<{
            id: string;
            number: string | null;
            origin_type: string | null;
            destination_name: string | null;
            table_number: number | null;
            total_amount: number;
            paid_by_pdv: string | null;
            status: string;
          }>) {
            pedidosMap.set(o.id, {
              id: o.id,
              number: o.number,
              originType: o.origin_type,
              destinationName: o.destination_name,
              tableNumber: o.table_number,
              total: Number(o.total_amount ?? 0),
              paidByPdv: o.paid_by_pdv,
              status: o.status,
            });
          }
        }

        // 4) Agrupar por dia
        const byDay = new Map<
          string,
          {
            movs: typeof rawMovs;
          }
        >();

        for (const m of rawMovs) {
          const dateKey = m.created_at.slice(0, 10); // 'YYYY-MM-DD'
          const prev = byDay.get(dateKey) ?? { movs: [] };
          prev.movs.push(m);
          byDay.set(dateKey, prev);
        }

        // 5) Construir dias
        const result: ConsumoNoDia[] = [];

        for (const [dateKey, { movs }] of byDay.entries()) {
          const d = new Date(`${dateKey}T12:00:00`);
          const dataLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          const diaSemana = DIAS_SEMANA[d.getDay()];

          const buckets = { vendas: 0, producao: 0, perda: 0, ajuste: 0, transferencia: 0 };
          let totalQtd = 0;
          const pedidosNoDia = new Map<string, PedidoConsumo>();

          const movimentos = movs.map(m => {
            const { bucket, isConsumo } = getBucket(m.type, m.reason);
            const qtyAbs = Math.abs(Number(m.quantity));

            // Conversão de unidade se necessário
            const movUnit = (m.unit?.toLowerCase() ?? ingredientUnit) as UnidadeEstoque;
            let finalQty = qtyAbs;
            if (movUnit !== ingredientUnit) {
              const converted = convertUnit(qtyAbs, movUnit, ingredientUnit);
              if (converted !== null) finalQty = converted;
            }

            if (isConsumo) {
              totalQtd += finalQty;
              if (bucket in buckets) {
                (buckets as Record<string, number>)[bucket] += finalQty;
              }
            }

            // Se tem order_id, adiciona ao mapa de pedidos do dia
            if (m.order_id && isConsumo) {
              const pedido = pedidosMap.get(m.order_id);
              if (pedido && !pedidosNoDia.has(m.order_id)) {
                pedidosNoDia.set(m.order_id, pedido);
              }
            }

            return {
              id: m.id,
              type: m.type,
              qty: isConsumo ? finalQty : -finalQty, // negativo = entrada
              bucket,
              reason: m.reason,
              hora: formatHora(m.created_at),
              orderId: m.order_id,
            };
          });

          result.push({
            data: dateKey,
            dataLabel,
            diaSemana,
            totalQtd,
            unidade: ingredientUnit,
            buckets,
            movimentos,
            pedidos: Array.from(pedidosNoDia.values()),
          });
        }

        // Ordenar por data decrescente (mais recente primeiro)
        result.sort((a, b) => b.data.localeCompare(a.data));

        if (!cancelled) {
          setDias(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Erro ao carregar detalhe');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => { cancelled = true; };
  }, [tenantId, ingredientId, ingredientUnit, dateFrom, dateTo]);

  return { dias, loading, error };
}