import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface DistBucket { faixa: string; pedidos: number; custo: number; }
export interface CustoDia { dia: string; custo: number; pedidos: number; }
export interface HoraPico { hora: string; pedidos: number; }
export interface DiaSemana { dia: string; pedidos: number; receita: number; }
export interface TopCliente { nome: string; pedidos: number; total: number; }
export interface StatusItem { status: string; label: string; pedidos: number; }
export interface OrigemItem { origem: string; pedidos: number; receita: number; }

export interface DeliveryLinkData {
  totalPedidos: number;
  entregas: number;
  retiradas: number;
  faturamento: number;
  ticketMedio: number;
  taxaArrecadada: number;
  distMedia: number | null;
  distMax: number | null;
  entregasComKm: number;       // entregas com distância registrada (base p/ médias)
  entregasKmTotal: number;     // soma das distâncias (base p/ custo motoboy por km)
  distMaisPedida: string | null;
  distBuckets: DistBucket[];
  custoPorDia: CustoDia[];           // taxa (= custo motoboy) somada por dia
  tempoPreparoMedio: number | null;  // created_at → out_for_delivery_at (min)
  horariosPico: HoraPico[];
  porDiaSemana: DiaSemana[];
  topClientes: TopCliente[];
  porStatus: StatusItem[];
  porOrigem: OrigemItem[];
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Rótulo amigável para a origem (utm_source) do pedido.
const ORIGEM_LABEL: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp',
  google: 'Google', tiktok: 'TikTok', site: 'Site', bio: 'Link da bio',
};
function origemLabel(src: string | null): string {
  const s = (src ?? '').trim().toLowerCase();
  if (!s) return 'Direto';
  return ORIGEM_LABEL[s] ?? (s.charAt(0).toUpperCase() + s.slice(1));
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Novo', received: 'Recebido', confirmed: 'Confirmado', preparing: 'Em preparo',
  preparo: 'Em preparo', ready: 'Pronto', pronto: 'Pronto', em_rota: 'Em rota',
  out_for_delivery: 'Em rota', delivered: 'Entregue', entregue: 'Entregue',
};

const EMPTY: DeliveryLinkData = {
  totalPedidos: 0, entregas: 0, retiradas: 0, faturamento: 0, ticketMedio: 0,
  taxaArrecadada: 0, distMedia: null, distMax: null, entregasComKm: 0, entregasKmTotal: 0,
  distMaisPedida: null, distBuckets: [], custoPorDia: [], tempoPreparoMedio: null, horariosPico: [],
  porDiaSemana: [], topClientes: [], porStatus: [], porOrigem: [],
};

// Nome do cliente sem o endereço (destination_name vem como "Nome - Endereço").
function nomeLimpo(destinationName: string | null): string {
  const n = (destinationName ?? '').trim();
  if (!n) return 'Sem nome';
  return n.split(/\s+[-–—]\s+/)[0].trim() || 'Sem nome';
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useDeliveryLinkReport(periodo: string) {
  const { user } = useAuth();
  const [dados, setDados] = useState<DeliveryLinkData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const getBrasiliaDate = (offsetDays = 0): string => {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      };

      let fromTs: string;
      let toTs: string;
      if (periodo.startsWith('custom:')) {
        const [, s, e] = periodo.split(':');
        fromTs = `${s}T00:00:00-03:00`;
        toTs = `${e}T23:59:59-03:00`;
      } else if (periodo === 'Ontem') {
        const d = getBrasiliaDate(-1);
        fromTs = `${d}T00:00:00-03:00`; toTs = `${d}T23:59:59-03:00`;
      } else if (periodo === '7 dias') {
        fromTs = `${getBrasiliaDate(-6)}T00:00:00-03:00`; toTs = `${getBrasiliaDate(0)}T23:59:59-03:00`;
      } else if (periodo === '30 dias') {
        fromTs = `${getBrasiliaDate(-29)}T00:00:00-03:00`; toTs = `${getBrasiliaDate(0)}T23:59:59-03:00`;
      } else {
        // Hoje (default)
        const t = getBrasiliaDate(0);
        fromTs = `${t}T00:00:00-03:00`; toTs = `${t}T23:59:59-03:00`;
      }

      const { data, error } = await supabase
        .from('orders')
        .select('id, total_amount, subtotal, delivery_fee, delivery_distance_km, delivery_platform, delivery_source, destination_name, created_at, out_for_delivery_at, status')
        .eq('tenant_id', user.tenantId)
        .eq('origin_type', 'delivery')
        .in('delivery_platform', ['propria', 'retirada'])
        .eq('is_training', false)
        .gte('created_at', fromTs)
        .lte('created_at', toTs)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Exclui cancelados (qualquer status com "cancel")
      const rows = (data ?? []).filter((o) => !String(o.status ?? '').toLowerCase().includes('cancel'));

      if (rows.length === 0) { setDados(EMPTY); return; }

      let entregas = 0, retiradas = 0, faturamento = 0, taxaArrecadada = 0;
      let entregasKmTotal = 0, entregasComKm = 0, distMax = 0;
      const buckets: Record<string, { pedidos: number; custo: number }> = {
        '0–2 km': { pedidos: 0, custo: 0 }, '2–4 km': { pedidos: 0, custo: 0 },
        '4–6 km': { pedidos: 0, custo: 0 }, '6+ km': { pedidos: 0, custo: 0 },
      };
      const diaCalMap: Record<string, { custo: number; pedidos: number }> = {};
      const horaMap: Record<number, number> = {};
      const diaMap: Record<number, { pedidos: number; receita: number }> = {};
      const clienteMap: Record<string, { pedidos: number; total: number }> = {};
      const statusMap: Record<string, number> = {};
      const origemMap: Record<string, { pedidos: number; receita: number }> = {};
      const tempos: number[] = [];

      rows.forEach((o) => {
        const total = Number(o.total_amount ?? 0);
        const fee = Number(o.delivery_fee ?? 0);
        const isRetirada = o.delivery_platform === 'retirada';
        faturamento += total;
        taxaArrecadada += fee;
        if (isRetirada) retiradas += 1; else entregas += 1;

        const km = o.delivery_distance_km != null ? Number(o.delivery_distance_km) : null;
        if (!isRetirada && km != null && km > 0) {
          entregasComKm += 1;
          entregasKmTotal += km;
          if (km > distMax) distMax = km;
          const faixa = km <= 2 ? '0–2 km' : km <= 4 ? '2–4 km' : km <= 6 ? '4–6 km' : '6+ km';
          buckets[faixa].pedidos += 1;
          buckets[faixa].custo += fee;
        }

        const dtBR = new Date(new Date(o.created_at as string).getTime() - 3 * 3600 * 1000);
        const h = dtBR.getUTCHours();
        horaMap[h] = (horaMap[h] ?? 0) + 1;
        const dia = dtBR.getUTCDay();
        if (!diaMap[dia]) diaMap[dia] = { pedidos: 0, receita: 0 };
        diaMap[dia].pedidos += 1; diaMap[dia].receita += total;

        const dataCal = new Date(o.created_at as string).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        if (!diaCalMap[dataCal]) diaCalMap[dataCal] = { custo: 0, pedidos: 0 };
        diaCalMap[dataCal].custo += fee;
        diaCalMap[dataCal].pedidos += 1;

        const nome = nomeLimpo(o.destination_name as string | null);
        if (!clienteMap[nome]) clienteMap[nome] = { pedidos: 0, total: 0 };
        clienteMap[nome].pedidos += 1; clienteMap[nome].total += total;

        const st = String(o.status ?? 'new');
        statusMap[st] = (statusMap[st] ?? 0) + 1;

        const origem = origemLabel((o as { delivery_source?: string | null }).delivery_source ?? null);
        if (!origemMap[origem]) origemMap[origem] = { pedidos: 0, receita: 0 };
        origemMap[origem].pedidos += 1; origemMap[origem].receita += total;

        if (!isRetirada && o.out_for_delivery_at) {
          const min = (new Date(o.out_for_delivery_at as string).getTime() - new Date(o.created_at as string).getTime()) / 60000;
          if (min >= 0 && min < 240) tempos.push(min);
        }
      });

      const distBuckets: DistBucket[] = Object.entries(buckets).map(([faixa, v]) => ({ faixa, pedidos: v.pedidos, custo: v.custo }));
      const distMaisPedida = distBuckets.filter((b) => b.pedidos > 0).sort((a, b) => b.pedidos - a.pedidos)[0]?.faixa ?? null;
      const custoPorDia: CustoDia[] = Object.entries(diaCalMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, v]) => ({ dia: d.slice(8, 10) + '/' + d.slice(5, 7), custo: v.custo, pedidos: v.pedidos }));

      const horariosPico: HoraPico[] = Array.from({ length: 24 }, (_, i) => ({
        hora: `${String(i).padStart(2, '0')}h`, pedidos: horaMap[i] ?? 0,
      })).filter((h) => h.pedidos > 0);

      const porDiaSemana: DiaSemana[] = Array.from({ length: 7 }, (_, i) => ({
        dia: DIAS_SEMANA[i], pedidos: diaMap[i]?.pedidos ?? 0, receita: diaMap[i]?.receita ?? 0,
      }));

      const topClientes: TopCliente[] = Object.entries(clienteMap)
        .map(([nome, v]) => ({ nome, pedidos: v.pedidos, total: v.total }))
        .sort((a, b) => b.pedidos - a.pedidos || b.total - a.total)
        .slice(0, 6);

      const porStatus: StatusItem[] = Object.entries(statusMap)
        .map(([status, pedidos]) => ({ status, label: STATUS_LABEL[status] ?? status, pedidos }))
        .sort((a, b) => b.pedidos - a.pedidos);

      const porOrigem: OrigemItem[] = Object.entries(origemMap)
        .map(([origem, v]) => ({ origem, pedidos: v.pedidos, receita: v.receita }))
        .sort((a, b) => b.pedidos - a.pedidos);

      setDados({
        totalPedidos: rows.length,
        entregas, retiradas, faturamento,
        ticketMedio: rows.length > 0 ? faturamento / rows.length : 0,
        taxaArrecadada,
        distMedia: entregasComKm > 0 ? entregasKmTotal / entregasComKm : null,
        distMax: distMax > 0 ? distMax : null,
        entregasComKm, entregasKmTotal,
        distMaisPedida, distBuckets, custoPorDia,
        tempoPreparoMedio: tempos.length > 0 ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null,
        horariosPico, porDiaSemana, topClientes, porStatus, porOrigem,
      });
    } catch (e) {
      console.error('useDeliveryLinkReport:', e);
      setDados(EMPTY);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId, periodo]);

  useEffect(() => { carregar(); }, [carregar]);

  return { dados, loading, recarregar: carregar };
}
