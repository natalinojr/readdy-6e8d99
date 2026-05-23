import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates } from '@/lib/dateUtils';

export interface SLAItemHistorico {
  item_name: string;
  estacao: string;
  qtd: number;
  tempo_medio_min: number;
  tempo_max_min: number;
  sla_meta_min: number;
  cumpridos: number;
  estourados: number;
}

export interface SLAEstacaoHistorico {
  estacao: string;
  qtd: number;
  tempo_medio_min: number;
  tempo_max_min: number;
  sla_meta_min: number;
  cumpridos: number;
  estourados: number;
}

export interface SLAOperadorHistorico {
  operador: string;
  itens: number;
  tempo_medio_min: number;
  cumpridos: number;
  pct_cumprimento: number;
}

export interface SLAHoraHistorico {
  hora: number;
  itens: number;
  tempo_medio_min: number;
}

export interface SLAHistoricoData {
  porEstacao: SLAEstacaoHistorico[];
  porItem: SLAItemHistorico[];
  porOperador: SLAOperadorHistorico[];
  porHora: SLAHoraHistorico[];
  totalItens: number;
  totalEstourados: number;
  tempoMedioGeral: number;
  taxaCumprimento: number;
}

const EMPTY: SLAHistoricoData = {
  porEstacao: [],
  porItem: [],
  porOperador: [],
  porHora: [],
  totalItens: 0,
  totalEstourados: 0,
  tempoMedioGeral: 0,
  taxaCumprimento: 0,
};

export function useSLAHistorico(periodo: string) {
  const { user } = useAuth();
  const [data, setData] = useState<SLAHistoricoData>(EMPTY);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { from, to } = getPeriodDates(periodo);

      // Busca order_items com timestamps de preparo preenchidos
      // station_name e sla_minutes vêm de kitchen_stations via station_id
      // operator vem de users via operator_id
      const { data: items, error } = await supabase
        .from('order_items')
        .select(`
          item_name,
          station_id,
          operator_id,
          started_preparing_at,
          ready_at,
          kitchen_stations(name, sla_minutes),
          orders!inner(created_at, status, tenant_id, is_training, is_draft)
        `)
        .eq('tenant_id', user.tenantId)
        .eq('orders.status', 'delivered')
        .eq('orders.is_training', false)
        .eq('orders.is_draft', false)
        .not('started_preparing_at', 'is', null)
        .not('ready_at', 'is', null)
        .gte('orders.created_at', from)
        .lte('orders.created_at', to);

      if (error) throw error;

      // Busca nomes dos operadores separadamente
      const operatorIds = [...new Set((items ?? []).map((r: any) => r.operator_id).filter(Boolean))];
      let operatorMap: Record<string, string> = {};
      if (operatorIds.length > 0) {
        const { data: ops } = await supabase
          .from('users')
          .select('id, name')
          .in('id', operatorIds);
        (ops ?? []).forEach((u: any) => { operatorMap[u.id] = u.name; });
      }

      const rows = (items ?? []) as Array<{
        item_name: string;
        station_id: string | null;
        operator_id: string | null;
        started_preparing_at: string;
        ready_at: string;
        kitchen_stations: { name: string; sla_minutes: number | null } | null;
        orders: { created_at: string };
      }>;

      if (rows.length === 0) {
        setData(EMPTY);
        return;
      }

      // ── Por Estação ──────────────────────────────────────────────────────
      const estacaoMap: Record<string, {
        qtd: number; tempos: number[]; sla: number; cumpridos: number;
      }> = {};

      // ── Por Item ─────────────────────────────────────────────────────────
      const itemMap: Record<string, {
        estacao: string; qtd: number; tempos: number[]; sla: number; cumpridos: number;
      }> = {};

      // ── Por Operador ─────────────────────────────────────────────────────
      const opMap: Record<string, {
        itens: number; tempos: number[]; cumpridos: number;
      }> = {};

      // ── Por Hora ─────────────────────────────────────────────────────────
      const horaMap: Record<number, { itens: number; total: number }> = {};

      rows.forEach((r) => {
        const tempoCozinha = (new Date(r.ready_at).getTime() - new Date(r.started_preparing_at).getTime()) / 60000;
        if (tempoCozinha < 0 || tempoCozinha > 300) return; // sanity check

        const estacao = r.kitchen_stations?.name ?? 'Sem estação';
        const sla = r.kitchen_stations?.sla_minutes ?? 12;
        const cumprido = tempoCozinha <= sla;

        // Estação
        if (!estacaoMap[estacao]) estacaoMap[estacao] = { qtd: 0, tempos: [], sla, cumpridos: 0 };
        estacaoMap[estacao].qtd++;
        estacaoMap[estacao].tempos.push(tempoCozinha);
        if (cumprido) estacaoMap[estacao].cumpridos++;

        // Item
        const itemKey = r.item_name ?? 'Item';
        if (!itemMap[itemKey]) itemMap[itemKey] = { estacao, qtd: 0, tempos: [], sla, cumpridos: 0 };
        itemMap[itemKey].qtd++;
        itemMap[itemKey].tempos.push(tempoCozinha);
        if (cumprido) itemMap[itemKey].cumpridos++;

        // Operador
        const op = (r.operator_id ? operatorMap[r.operator_id] : null) ?? 'Sem operador';
        if (!opMap[op]) opMap[op] = { itens: 0, tempos: [], cumpridos: 0 };
        opMap[op].itens++;
        opMap[op].tempos.push(tempoCozinha);
        if (cumprido) opMap[op].cumpridos++;

        // Hora
        const hora = new Date(r.started_preparing_at).getHours();
        if (!horaMap[hora]) horaMap[hora] = { itens: 0, total: 0 };
        horaMap[hora].itens++;
        horaMap[hora].total += tempoCozinha;
      });

      const porEstacao: SLAEstacaoHistorico[] = Object.entries(estacaoMap).map(([estacao, d]) => ({
        estacao,
        qtd: d.qtd,
        tempo_medio_min: parseFloat((d.tempos.reduce((a, b) => a + b, 0) / d.tempos.length).toFixed(1)),
        tempo_max_min: parseFloat(Math.max(...d.tempos).toFixed(1)),
        sla_meta_min: d.sla,
        cumpridos: d.cumpridos,
        estourados: d.qtd - d.cumpridos,
      }));

      const porItem: SLAItemHistorico[] = Object.entries(itemMap)
        .map(([item_name, d]) => ({
          item_name,
          estacao: d.estacao,
          qtd: d.qtd,
          tempo_medio_min: parseFloat((d.tempos.reduce((a, b) => a + b, 0) / d.tempos.length).toFixed(1)),
          tempo_max_min: parseFloat(Math.max(...d.tempos).toFixed(1)),
          sla_meta_min: d.sla,
          cumpridos: d.cumpridos,
          estourados: d.qtd - d.cumpridos,
        }))
        .sort((a, b) => b.estourados - a.estourados);

      const porOperador: SLAOperadorHistorico[] = Object.entries(opMap)
        .map(([operador, d]) => ({
          operador,
          itens: d.itens,
          tempo_medio_min: parseFloat((d.tempos.reduce((a, b) => a + b, 0) / d.tempos.length).toFixed(1)),
          cumpridos: d.cumpridos,
          pct_cumprimento: parseFloat(((d.cumpridos / d.itens) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.pct_cumprimento - a.pct_cumprimento);

      const porHora: SLAHoraHistorico[] = Object.entries(horaMap)
        .map(([hora, d]) => ({
          hora: Number(hora),
          itens: d.itens,
          tempo_medio_min: parseFloat((d.total / d.itens).toFixed(1)),
        }))
        .sort((a, b) => a.hora - b.hora);

      const totalItens = rows.length;
      const totalEstourados = porEstacao.reduce((s, e) => s + e.estourados, 0);
      const tempoMedioGeral = totalItens > 0
        ? parseFloat((porEstacao.reduce((s, e) => s + e.tempo_medio_min * e.qtd, 0) / totalItens).toFixed(1))
        : 0;
      const taxaCumprimento = totalItens > 0
        ? parseFloat((((totalItens - totalEstourados) / totalItens) * 100).toFixed(1))
        : 0;

      setData({ porEstacao, porItem, porOperador, porHora, totalItens, totalEstourados, tempoMedioGeral, taxaCumprimento });
    } catch (e) {
      console.error('[useSLAHistorico]', e);
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}
