import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { fetchIfoodVendas } from '@/lib/ifoodVendas';
import { horaBrasilia, type Comparacao } from '@/lib/vendasHoraComparativo';

// Vendas por hora ('HH' → R$) de dias já fechados, para as linhas de comparação dos gráficos
// "Vendas por Hora" (Dashboard e Relatórios › Visão Geral).
// Regra 'pagos' = a do fn_get_dashboard_metrics (Dashboard: pedido pago, não cancelado); 'relatorio' = a do
// useVisaoGeralExtras (Relatórios: não cancelado nem rascunho, pago ou não). Sempre sem treino/rascunho, + iFood por cima.
// Só busca as comparações ligadas; dia passado não muda, então cada dia é buscado uma vez só.
const cache = new Map<string, Record<string, number>>();

export type RegraVendasHora = 'pagos' | 'relatorio';

async function vendasDoDia(tenantId: string, dia: string, regra: RegraVendasHora): Promise<Record<string, number>> {
  const chave = `${tenantId}:${regra}:${dia}`;
  const salvo = cache.get(chave);
  if (salvo) return salvo;
  const from = `${dia}T00:00:00-03:00`;
  const to = `${dia}T23:59:59.999-03:00`;
  const [pdv, ifood] = await Promise.all([
    fetchAllRows<{ created_at: string; total_amount: number | null }>((a, b) => {
      let q = supabase
        .from('orders')
        .select('created_at, total_amount')
        .eq('tenant_id', tenantId);
      q = regra === 'pagos' ? q.eq('is_paid', true).neq('status', 'cancelled') : q.not('status', 'in', '(cancelled,draft)');
      return q
        .eq('is_training', false)
        .eq('is_draft', false)
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: true })
        .range(a, b);
    }),
    fetchIfoodVendas(tenantId, from, to),
  ]);
  if (pdv.error || ifood.error) throw new Error(pdv.error?.message ?? ifood.error ?? 'erro');
  const porHora: Record<string, number> = {};
  for (const o of pdv.rows ?? []) {
    const h = horaBrasilia(o.created_at);
    porHora[h] = (porHora[h] ?? 0) + Number(o.total_amount ?? 0);
  }
  for (const [hm, v] of Object.entries(ifood.porHora)) {
    const h = hm.slice(0, 2);
    porHora[h] = (porHora[h] ?? 0) + v;
  }
  cache.set(chave, porHora);
  return porHora;
}

/** `dias` null = desligado (ex.: período de vários dias nos Relatórios). */
export function useVendasHoraComparativo(
  dias: Record<Comparacao, string> | null,
  ligadas: Record<Comparacao, boolean>,
  regra: RegraVendasHora = 'pagos',
) {
  const { user } = useAuth();
  const [series, setSeries] = useState<Partial<Record<Comparacao, Record<string, number>>>>({});
  const tenantId = user?.tenantId;

  useEffect(() => {
    if (!tenantId || !dias) { setSeries({}); return; }
    let vivo = true;
    const ks = (Object.keys(dias) as Comparacao[]).filter((k) => ligadas[k]);
    Promise.all(ks.map((k) => vendasDoDia(tenantId, dias[k], regra).then((s) => [k, s] as const).catch((e) => {
      console.error('[useVendasHoraComparativo]', k, e);
      return null;
    }))).then((res) => {
      if (!vivo) return;
      const out: Partial<Record<Comparacao, Record<string, number>>> = {};
      for (const r of res) if (r) out[r[0]] = r[1];
      setSeries(out);
    });
    return () => { vivo = false; };
  }, [tenantId, regra, dias?.ontem, dias?.semana, dias?.mes, ligadas.ontem, ligadas.semana, ligadas.mes]); // eslint-disable-line react-hooks/exhaustive-deps

  return series;
}
