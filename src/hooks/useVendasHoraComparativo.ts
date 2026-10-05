import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { fetchIfoodVendas } from '@/lib/ifoodVendas';
import { horaBrasilia, type Comparacao } from '@/lib/vendasHoraComparativo';
import { dataBrasilia, horaDoDia, inicioDoDia, janelaDeBusca, somarNosDias, type JanelaSessao } from '@/lib/diaLoja';
import { somarDias } from '@/lib/dateUtils';

// Vendas por hora ('HH' → R$) de dias já fechados, para as linhas de comparação dos gráficos
// "Vendas por Hora" (Dashboard e Relatórios › Visão Geral).
// Regra 'pagos' = a do fn_get_dashboard_metrics (Dashboard: pedido pago, não cancelado, no dia da loja); 'relatorio' = a do
// useVisaoGeralExtras (Relatórios: não cancelado nem rascunho, pago ou não). Sempre sem treino/rascunho, + iFood por cima.
// Só busca as comparações ligadas; dia passado não muda, então cada dia é buscado uma vez só.
const cache = new Map<string, Record<string, number>>();

export type RegraVendasHora = 'pagos' | 'relatorio';

// 'pagos' (Dashboard) = dia da loja (src/lib/diaLoja.ts): pedidos das sessões abertas no dia, hora contada desde a
// 0h do dia (madrugada da sessão que passou da meia-noite = 24, 25…), iFood encaixado pela sessão aberta na hora.
async function vendasDoDiaLoja(tenantId: string, dia: string): Promise<Record<string, number>> {
  const ini = inicioDoDia(dia).toISOString();
  const fimDia = inicioDoDia(somarDias(dia, 1)).toISOString();
  const { data: sess, error } = await supabase
    .from('sessions')
    .select('id, opened_at, closed_at, is_training')
    .eq('tenant_id', tenantId)
    .lt('opened_at', fimDia)
    .or(`closed_at.is.null,closed_at.gt.${ini}`);
  if (error) throw new Error(error.message);
  const linhas = (sess ?? []) as Array<{ id: string; opened_at: string; closed_at: string | null; is_training: boolean | null }>;
  const janelas: JanelaSessao[] = linhas.filter((x) => !x.is_training)
    .map((x) => ({ dia: dataBrasilia(new Date(x.opened_at)), ini: x.opened_at, fim: x.closed_at }));
  const doDia = linhas.filter((x) => dataBrasilia(new Date(x.opened_at)) === dia).map((x) => x.id);
  const [comSessao, semSessao, ifood] = await Promise.all([
    doDia.length === 0 ? Promise.resolve({ rows: [] as Array<{ created_at: string; total_amount: number | null }>, error: null })
      : fetchAllRows<{ created_at: string; total_amount: number | null }>((a, b) => supabase
        .from('orders')
        .select('created_at, total_amount')
        .eq('tenant_id', tenantId)
        .in('session_id', doDia)
        .eq('is_paid', true).neq('status', 'cancelled').eq('ifood_repasse', false)
        .eq('is_training', false).eq('is_draft', false)
        .order('created_at', { ascending: true })
        .range(a, b)),
    fetchAllRows<{ created_at: string; total_amount: number | null }>((a, b) => supabase
      .from('orders')
      .select('created_at, total_amount')
      .eq('tenant_id', tenantId)
      .is('session_id', null)
      .eq('is_paid', true).neq('status', 'cancelled').eq('ifood_repasse', false)
      .eq('is_training', false).eq('is_draft', false)
      .gte('created_at', ini).lt('created_at', fimDia)
      .order('created_at', { ascending: true })
      .range(a, b)),
    (() => { const j = janelaDeBusca(dia, dia, janelas); return fetchIfoodVendas(tenantId, j.from, j.to); })(),
  ]);
  if (comSessao.error || semSessao.error || ifood.error) throw new Error(comSessao.error?.message ?? semSessao.error?.message ?? ifood.error ?? 'erro');
  const porHora: Record<string, number> = {};
  const somar = (h: number, v: number) => { const k = String(h).padStart(2, '0'); porHora[k] = (porHora[k] ?? 0) + v; };
  for (const o of [...(comSessao.rows ?? []), ...(semSessao.rows ?? [])]) somar(horaDoDia(new Date(o.created_at), dia), Number(o.total_amount ?? 0));
  for (const [h, v] of Object.entries(somarNosDias(ifood.lista, janelas, dia, dia).porHora)) somar(Number(h), v);
  return porHora;
}

async function vendasDoDia(tenantId: string, dia: string, regra: RegraVendasHora): Promise<Record<string, number>> {
  const chave = `${tenantId}:${regra}:${dia}`;
  const salvo = cache.get(chave);
  if (salvo) return salvo;
  if (regra === 'pagos') {
    const porHora = await vendasDoDiaLoja(tenantId, dia);
    cache.set(chave, porHora);
    return porHora;
  }
  const from = `${dia}T00:00:00-03:00`;
  const to = `${dia}T23:59:59.999-03:00`;
  const [pdv, ifood] = await Promise.all([
    fetchAllRows<{ created_at: string; total_amount: number | null }>((a, b) => {
      // 'relatorio' (Relatórios › Visão Geral): dia do calendário, pago ou não, sem cancelado/rascunho
      return supabase
        .from('orders')
        .select('created_at, total_amount')
        .eq('tenant_id', tenantId)
        .not('status', 'in', '(cancelled,draft)')
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
