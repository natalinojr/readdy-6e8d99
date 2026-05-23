import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDateObjects } from '@/lib/dateUtils';
import { PLATAFORMAS_DELIVERY } from '@/constants/delivery';
import { useSystemSettings } from '@/hooks/useSystemSettings';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeliveryPlatformMetrics {
  platform: string;
  label: string;
  icon: string;
  cor: string;
  pedidos: number;
  receita_bruta: number;
  custo_entrega: number;
  comissao_valor: number;
  comissao_pct: number;
  receita_liquida: number;
  ticket_medio: number;
  pct_pedidos: number;
  pct_receita: number;
}

export interface DeliveryHoraPico {
  hora: string;
  pedidos: number;
  receita: number;
}

export interface DeliveryDiaSemana {
  dia: string;
  pedidos: number;
  receita: number;
}

export interface DeliveryReportData {
  porPlataforma: DeliveryPlatformMetrics[];
  horariosPico: DeliveryHoraPico[];
  porDiaSemana: DeliveryDiaSemana[];
  totalPedidos: number;
  totalReceita: number;
  totalCustoEntrega: number;
  totalComissao: number;
  totalReceitaLiquida: number;
  ticketMedioGeral: number;
  tempoMedioRegistro: number | null;
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const PLATFORM_MAP: Record<string, { label: string; icon: string; cor: string }> = {};
PLATAFORMAS_DELIVERY.forEach((p) => {
  PLATFORM_MAP[p.key] = { label: p.label, icon: p.icon, cor: p.cor };
});

// Plataforma desconhecida / sem plataforma
const UNKNOWN_PLATFORM = {
  label: 'Delivery (sem plataforma)',
  icon: 'ri-motorbike-line',
  cor: 'bg-zinc-100 text-zinc-600',
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDeliveryReport(periodo: string) {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [dados, setDados] = useState<DeliveryReportData>({
    porPlataforma: [],
    horariosPico: [],
    porDiaSemana: [],
    totalPedidos: 0,
    totalReceita: 0,
    totalCustoEntrega: 0,
    totalComissao: 0,
    totalReceitaLiquida: 0,
    ticketMedioGeral: 0,
    tempoMedioRegistro: null,
  });
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Taxas de comissão configuradas — lê do ref para não criar dependência instável
      const currentSettings = settingsRef.current;
      const commissionRates = (currentSettings as Record<string, unknown>).delivery_commission_rates as Record<string, number> | undefined ?? {};

      // Calcula range de datas sempre em Brasília (UTC-3)
      let fromTs: string;
      let toTs: string;

      const getBrasiliaDate = (offsetDays = 0): string => {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      };

      if (periodo.startsWith('custom:')) {
        const [, s, e] = periodo.split(':');
        fromTs = `${s}T00:00:00-03:00`;
        toTs = `${e}T23:59:59-03:00`;
      } else if (periodo === 'Hoje') {
        const today = getBrasiliaDate(0);
        fromTs = `${today}T00:00:00-03:00`;
        toTs = `${today}T23:59:59-03:00`;
      } else if (periodo === 'Ontem') {
        const ontem = getBrasiliaDate(-1);
        fromTs = `${ontem}T00:00:00-03:00`;
        toTs = `${ontem}T23:59:59-03:00`;
      } else if (periodo === '7 dias') {
        const today = getBrasiliaDate(0);
        const from7 = getBrasiliaDate(-6);
        fromTs = `${from7}T00:00:00-03:00`;
        toTs = `${today}T23:59:59-03:00`;
      } else if (periodo === '30 dias') {
        const today = getBrasiliaDate(0);
        const from30 = getBrasiliaDate(-29);
        fromTs = `${from30}T00:00:00-03:00`;
        toTs = `${today}T23:59:59-03:00`;
      } else {
        // fallback genérico
        const { from, to } = getPeriodDateObjects(periodo);
        fromTs = from.toISOString();
        toTs = to.toISOString();
      }

      const { data: orders, error } = await supabase
        .from('orders')
        .select('id, number, total_amount, delivery_fee, delivery_platform, created_at, paid_at, status, subtotal')
        .eq('tenant_id', user.tenantId)
        .eq('origin_type', 'delivery')
        .eq('is_training', false)
        .eq('status', 'delivered')
        .gte('created_at', fromTs)
        .lte('created_at', toTs)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = orders ?? [];

      // ── Agrupamento por plataforma ──────────────────────────────────────
      const platMap: Record<string, {
        pedidos: number;
        receita_bruta: number;
        custo_entrega: number;
        comissao_valor: number;
      }> = {};

      const horaMap: Record<string, { pedidos: number; receita: number }> = {};
      const diaMap: Record<number, { pedidos: number; receita: number }> = {};
      const temposRegistro: number[] = [];

      rows.forEach((o) => {
        const plat = (o.delivery_platform as string | null) ?? 'unknown';
        const total = Number(o.total_amount ?? 0);
        const fee = Number(o.delivery_fee ?? 0);

        const commissionPct = commissionRates[plat] ?? 0;
        const commissionVal = total * (commissionPct / 100);
        if (!platMap[plat]) platMap[plat] = { pedidos: 0, receita_bruta: 0, custo_entrega: 0, comissao_valor: 0 };
        platMap[plat].pedidos += 1;
        platMap[plat].receita_bruta += total;
        platMap[plat].custo_entrega += fee;
        platMap[plat].comissao_valor += commissionVal;

        // Hora do pedido (Brasília = UTC-3)
        const dt = new Date(o.created_at as string);
        const dtBR = new Date(dt.getTime() - 3 * 60 * 60 * 1000);
        const hora = `${String(dtBR.getUTCHours()).padStart(2, '0')}h`;
        if (!horaMap[hora]) horaMap[hora] = { pedidos: 0, receita: 0 };
        horaMap[hora].pedidos += 1;
        horaMap[hora].receita += total;

        // Dia da semana
        const diaSemana = dtBR.getUTCDay();
        if (!diaMap[diaSemana]) diaMap[diaSemana] = { pedidos: 0, receita: 0 };
        diaMap[diaSemana].pedidos += 1;
        diaMap[diaSemana].receita += total;

        // Tempo de registro (created_at → paid_at)
        if (o.paid_at) {
          const dtPaid = new Date(o.paid_at as string);
          const minutos = (dtPaid.getTime() - dt.getTime()) / 60000;
          if (minutos >= 0 && minutos < 120) temposRegistro.push(minutos);
        }
      });

      const totalPedidos = rows.length;
      const totalReceita = rows.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
      const totalCustoEntrega = rows.reduce((s, o) => s + Number(o.delivery_fee ?? 0), 0);
      const totalComissao = Object.values(platMap).reduce((s, v) => s + v.comissao_valor, 0);
      const totalReceitaLiquida = totalReceita - totalCustoEntrega - totalComissao;
      const ticketMedioGeral = totalPedidos > 0 ? totalReceita / totalPedidos : 0;
      const tempoMedioRegistro = temposRegistro.length > 0
        ? Math.round(temposRegistro.reduce((a, b) => a + b, 0) / temposRegistro.length)
        : null;

      // ── Montar porPlataforma ────────────────────────────────────────────
      const porPlataforma: DeliveryPlatformMetrics[] = Object.entries(platMap)
        .map(([key, v]) => {
          const info = PLATFORM_MAP[key] ?? UNKNOWN_PLATFORM;
          const commissionPct = commissionRates[key] ?? 0;
          const receita_liquida = v.receita_bruta - v.custo_entrega - v.comissao_valor;
          return {
            platform: key,
            label: info.label,
            icon: info.icon,
            cor: info.cor,
            pedidos: v.pedidos,
            receita_bruta: v.receita_bruta,
            custo_entrega: v.custo_entrega,
            comissao_valor: v.comissao_valor,
            comissao_pct: commissionPct,
            receita_liquida,
            ticket_medio: v.pedidos > 0 ? v.receita_bruta / v.pedidos : 0,
            pct_pedidos: totalPedidos > 0 ? (v.pedidos / totalPedidos) * 100 : 0,
            pct_receita: totalReceita > 0 ? (v.receita_bruta / totalReceita) * 100 : 0,
          };
        })
        .sort((a, b) => b.pedidos - a.pedidos);

      // ── Horários de pico (ordenados por hora) ──────────────────────────
      const horariosPico: DeliveryHoraPico[] = Array.from({ length: 24 }, (_, i) => {
        const hora = `${String(i).padStart(2, '0')}h`;
        return {
          hora,
          pedidos: horaMap[hora]?.pedidos ?? 0,
          receita: horaMap[hora]?.receita ?? 0,
        };
      }).filter((h) => h.pedidos > 0);

      // ── Por dia da semana ───────────────────────────────────────────────
      const porDiaSemana: DeliveryDiaSemana[] = Array.from({ length: 7 }, (_, i) => ({
        dia: DIAS_SEMANA[i],
        pedidos: diaMap[i]?.pedidos ?? 0,
        receita: diaMap[i]?.receita ?? 0,
      }));

      setDados({
        porPlataforma,
        horariosPico,
        porDiaSemana,
        totalPedidos,
        totalReceita,
        totalCustoEntrega,
        totalComissao,
        totalReceitaLiquida,
        ticketMedioGeral,
        tempoMedioRegistro,
      });
    } catch (e) {
      console.error('useDeliveryReport:', e);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId, periodo]);

  useEffect(() => { carregar(); }, [carregar]);

  return { dados, loading, recarregar: carregar };
}
