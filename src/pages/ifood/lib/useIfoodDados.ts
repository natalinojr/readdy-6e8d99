import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { fetchPedidosIfood, type PedidoIfood } from '@/lib/ifoodDashboard';
import { fetchCustosIfood } from '@/lib/ifoodCusto';
import { getPeriodDates } from '@/lib/dateUtils';
import {
  montarPedidoOrder, montarPedidosArea, taxaMediaPorLoja, taxaTeoricaPorLoja,
  type MapaCustos, type OrderRow, type ItemRow, type PedidoArea, type PedidoOrder,
} from '@/lib/ifoodArea';

// Dados da área iFood para um período (string de getPeriodDates: 'Hoje', 'Ontem', '7 dias', '30 dias',
// 'Este mês', 'custom:AAAA-MM-DD:AAAA-MM-DD'). Junta pedidos (módulo Pedidos), dinheiro (conciliação +
// API de Vendas) e custo (fichas). Período com hoje: atualiza a cada minuto e pede ao iFood as vendas
// de hoje/ontem (sync_sales) no máximo a cada 5 min.

export interface LojaIfood { id: string; short: string | null; nome: string }

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const ultimoSync = new Map<string, number>();
// Últimos 30 dias de dinheiro (média das taxas por loja): uma leitura a cada 10 min por loja, não a cada tela/minuto.
const cacheFin30 = new Map<string, { em: number; pedidos: PedidoIfood[] }>();
async function fin30Ifood(tenantId: string): Promise<PedidoIfood[]> {
  const c = cacheFin30.get(tenantId);
  if (c && Date.now() - c.em < 10 * 60_000) return c.pedidos;
  const r = await fetchPedidosIfood(tenantId, new Date(Date.now() - 30 * 86_400_000).toISOString(), new Date().toISOString());
  const pedidos = r.error ? [] : r.pedidos;
  if (!r.error) cacheFin30.set(tenantId, { em: Date.now(), pedidos });
  return pedidos;
}
const cacheCustos = new Map<string, { em: number; mapa: MapaCustos; erro: string | null }>();

/** Custos pelas fichas (cache de 2 min; `forcar` depois de ligar um item). */
export async function custosIfood(tenantId: string, forcar = false) {
  const c = cacheCustos.get(tenantId);
  if (!forcar && c && Date.now() - c.em < 120_000) return c;
  const r = await fetchCustosIfood(tenantId);
  const v = { em: Date.now(), ...r };
  cacheCustos.set(tenantId, v);
  return v;
}

export async function fetchOrders(tenantId: string, fromISO: string, toISO: string): Promise<PedidoOrder[]> {
  const cols = 'id, ifood_order_id, display_id, merchant_id, status, order_type, delivered_by, is_test, ordered_at, created_at, customer_name, customer_orders_count, total, benefits, payments, timeline, cancel_reason, order_id';
  const { data, error } = await supabase.from('ifood_orders').select(cols)
    // Pela hora do PEDIDO (ordered_at), não pela hora em que entrou no ERPOS: pedidos antigos relidos do iFood
    // entram com created_at de hoje (05/10 a tela mostrou 117 "hoje" com 8 de verdade).
    .eq('tenant_id', tenantId).not('ordered_at', 'is', null).gte('ordered_at', fromISO).lte('ordered_at', toISO)
    .order('ordered_at', { ascending: false }).limit(3000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as OrderRow[];
  const itens: ItemRow[] = [];
  for (const part of chunk(rows.map((r) => r.id), 150)) {
    const r = await supabase.from('ifood_order_items').select('order_row_id, idx, name, quantity, total_price, observations, options').in('order_row_id', part);
    if (r.error) throw new Error(r.error.message);
    itens.push(...((r.data ?? []) as unknown as ItemRow[]));
  }
  return rows.map((o) => montarPedidoOrder(o, itens));
}

export function useIfoodDados(tenantId: string | undefined, periodo: string) {
  const { from, to } = useMemo(() => getPeriodDates(periodo), [periodo]);
  const [orders, setOrders] = useState<PedidoOrder[]>([]);
  const [fin, setFin] = useState<PedidoIfood[]>([]);
  const [fin30, setFin30] = useState<PedidoIfood[]>([]);
  const [custos, setCustos] = useState<MapaCustos>(new Map());
  const [lojas, setLojas] = useState<LojaIfood[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semDinheiro, setSemDinheiro] = useState(false);
  const geracao = useRef(0);
  const hojeBR = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const comHoje = to.slice(0, 10) >= hojeBR;

  const carregar = useCallback(async (forcarCustos = false) => {
    if (!tenantId) return;
    const g = ++geracao.current;
    try {
      const [o0, f, f30, c, lj] = await Promise.all([
        fetchOrders(tenantId, from, to),
        fetchPedidosIfood(tenantId, from, to),
        fin30Ifood(tenantId),
        custosIfood(tenantId, forcarCustos),
        supabase.from('fin_ifood_merchants').select('merchant_id, merchant_short, name').eq('tenant_id', tenantId),
      ]);
      if (g !== geracao.current) return;
      // Pedido de teste do iFood fica fora, a não ser que a loja só tenha pedido de teste (a loja de testes).
      const o = o0.every((x) => x.teste) ? o0 : o0.filter((x) => !x.teste);
      setOrders(o);
      setFin(f.error ? [] : f.pedidos);
      setFin30(f30);
      setSemDinheiro(!!f.error);
      setCustos(c.mapa);
      const ls = ((lj.data ?? []) as Array<{ merchant_id: string; merchant_short: string | null; name: string | null }>)
        .map((l) => ({ id: l.merchant_id, short: l.merchant_short, nome: l.name?.trim() || `Loja ${l.merchant_short ?? ''}`.trim() }));
      // Loja que só aparece nos pedidos (sem cadastro no financeiro) também entra.
      for (const id of new Set(o.map((x) => x.loja))) if (!ls.some((l) => l.id === id)) ls.push({ id, short: null, nome: 'Loja iFood' });
      setLojas(ls);
      setErro(c.erro);
    } catch (e) {
      if (g === geracao.current) setErro(e instanceof Error ? e.message : String(e));
    } finally {
      if (g === geracao.current) setCarregando(false);
    }
  }, [tenantId, from, to]);

  useEffect(() => { setCarregando(true); carregar(); }, [carregar]);

  // Período com hoje: atualiza a cada minuto e busca as vendas novas no iFood (no máx. a cada 5 min).
  useEffect(() => {
    if (!tenantId || !comHoje) return;
    const ult = ultimoSync.get(tenantId) ?? 0;
    if (Date.now() - ult > 5 * 60_000) {
      ultimoSync.set(tenantId, Date.now());
      invokeWithAuth('ifood-financial', { body: { action: 'sync_sales', tenant_id: tenantId, days: 2 } }).catch(() => null).then(() => carregar());
    }
    // Hoje/ontem: a cada minuto. Período longo que inclui hoje (30 dias, mês): a cada 10 min.
    const curto = Date.parse(to) - Date.parse(from) <= 2 * 86_400_000;
    const id = setInterval(() => carregar(), curto ? 60_000 : 10 * 60_000);
    return () => clearInterval(id);
  }, [tenantId, comHoje, carregar, from, to]);

  const taxaMedia = useMemo(() => taxaMediaPorLoja(fin30), [fin30]);
  // Taxa do iFood sem promoção (CMV puro da aba Itens e CMV e dos cartões de item da Hoje).
  const taxaTeorica = useMemo(() => taxaTeoricaPorLoja(fin30), [fin30]);
  const pedidos: PedidoArea[] = useMemo(() => montarPedidosArea(orders, fin, custos, taxaMedia), [orders, fin, custos, taxaMedia]);

  return { from, to, orders, fin, fin30, custos, lojas, pedidos, taxaMedia, taxaTeorica, carregando, erro, semDinheiro, recarregar: carregar };
}
