import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getTodayBrasiliaRange } from '@/lib/dateUtils';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DBOrderItemUnit {
  id: string;
  unit_number: number;
  status: string;
  operator_name?: string;
  started_preparing_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
}

export interface DBOrderItem {
  id: string;
  nome: string;
  quantidade: number;
  preco: number;
  status: string;
  station_name?: string;
  operator_name?: string;
  notes?: string | null;
  entered_kds_at?: string | null;
  started_preparing_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
  options?: { option_name: string; group_name: string; additional_price?: number | null }[];
  observations?: { text: string }[];
  units?: DBOrderItemUnit[];
}

export interface DBPayment {
  id: string;
  amount: number;
  change_amount: number | null;
  is_refunded: boolean;
  payment_method_id: string | null;
  payment_method_name: string | null;
  payment_method_type: string | null;
  operator_name?: string | null;
  cash_register_id?: string | null;
  cash_register_name?: string | null;
  paid_by_pdv?: string | null;
  payment_group_id?: string | null;
}

export interface DBOrder {
  id: string;
  numero: string;
  status: string;
  total: number;
  subtotal: number;
  discount_amount: number;
  service_fee_amount: number;
  tip_amount: number;
  created_at: string;
  updated_at: string;
  cancelled_at?: string | null;
  origin: string;
  destination: string;
  destination_name: string | null;
  cancel_reason: string | null;
  is_paid: boolean;
  operador: string | null;
  mesa_numero: number | null;
  sla_espera_min: number | null;
  sla_cozinha_min: number | null;
  sla_entrega_min: number | null;
  tempo_total_min: number | null;
  delivery_platform?: string | null;
  delivery_fee?: number | null;
  paid_by_pdv?: string | null;
  session_id?: string | null;
  session_number?: string | null;
  participant_token?: string | null;
  participant_name?: string | null;
  itens: DBOrderItem[];
  pagamentos: DBPayment[];
  payment_group_id?: string | null;
}

// ─── Raw types from RPC fn_get_kds_orders ──────────────────────────────────────

interface RPCUnit {
  id: string;
  unit_number: number;
  status?: string | null;
  operator_name?: string | null;
  started_preparing_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
}

interface RPCItem {
  id: string;
  item_name: string;
  item_price?: number | null;
  quantity: number;
  status?: string | null;
  station_id?: string | null;
  notes?: string | null;
  skip_kds?: boolean | null;
  entered_kds_at?: string | null;
  started_preparing_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
  operator_name?: string | null;
  options?: { option_name: string; group_name: string; additional_price?: number | null }[] | null;
  observations?: { text: string }[] | null;
  units?: RPCUnit[] | null;
}

interface RPCPayment {
  id: string;
  amount?: number | null;
  change_amount?: number | null;
  is_refunded?: boolean | null;
  payment_method_id?: string | null;
  payment_method_name?: string | null;
  payment_method_type?: string | null;
  operator_name?: string | null;
  cash_register_id?: string | null;
  cash_register_name?: string | null;
  payment_group_id?: string | null;
}

interface RPCOrder {
  id: string;
  number?: string | null;
  status?: string | null;
  destination_type?: string | null;
  destination_name?: string | null;
  origin_type?: string | null;
  table_number?: number | null;
  waiter_name?: string | null;
  created_at: string;
  total_amount?: number | string | null;
  is_paid?: boolean | null;
  cancel_reason?: string | null;
  session_id?: string | null;
  session_number?: string | null;
  participant_token?: string | null;
  participant_name?: string | null;
  items?: RPCItem[] | null;
  payments?: RPCPayment[] | null;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useOrdersHistory
 *
 * Usa a mesma RPC fn_get_kds_orders que o KDSContext — garantindo que
 * os dados são idênticos entre a aba Pedidos e o KDS/PDV.
 *
 * Para filtro por data (modo histórico), usa query direta na tabela orders
 * via Supabase REST com o JWT do usuário autenticado.
 *
 * Para sessão atual (modo tempo real), usa fn_get_kds_orders com session_id.
 */
export function useOrdersHistory(dateFrom?: string, dateTo?: string, sessionId?: string | null) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (from?: string, to?: string, sid?: string | null) => {
    if (!user?.tenantId) return;

    setLoading(true);
    try {
      let rawOrders: RPCOrder[] = [];

      if (sid) {
        // ── MODO SESSÃO: usa RPC (mesma fonte do KDS) ──────────────────────
        const { data, error } = await supabase.rpc('fn_get_kds_orders', {
          p_tenant_id: user.tenantId,
          p_session_id: sid,
        });

        if (error) {
          console.error('[useOrdersHistory] rpc error (session mode):', error.message);
          rawOrders = [];
        } else {
          rawOrders = (data as RPCOrder[]) ?? [];
        }
        console.log('[useOrdersHistory] session mode — RPC returned:', rawOrders.length, 'orders');

        // ── Complemento: busca pedidos de delivery (skip_kds) da sessão ──
        // A RPC fn_get_kds_orders pode não retornar pedidos com todos os itens skip_kds=true
        // (ex: delivery do iFood que não vai para o KDS). Buscamos separadamente e fazemos merge.
        try {
          const { data: deliveryData, error: deliveryErr } = await supabase
            .from('orders')
            .select(`
              id,
              number,
              status,
              subtotal,
              discount_amount,
              service_fee_amount,
              tip_amount,
              total_amount,
              origin_type,
              destination_type,
              destination_name,
              cancel_reason,
              cancelled_at,
              table_number,
              created_at,
              updated_at,
              origin_user_id,
              is_training,
              is_draft,
              is_paid,
              waiter_name,
              delivery_platform,
              delivery_fee,
              paid_by_pdv,
              session_id,
              session:sessions(id, number),
              order_items (
                id,
                item_name,
                item_price,
                quantity,
                status,
                notes,
                station_id,
                operator_id,
                entered_kds_at,
                started_preparing_at,
                ready_at,
                delivered_at,
                order_item_options ( option_name, group_name, additional_price ),
                order_item_observations ( text ),
                order_item_units (
                  id, unit_number, status,
                  operator_id, started_preparing_at, ready_at, delivered_at
                )
              ),
              payments ( id, amount, change_amount, is_refunded, payment_method_id, cash_register_id, operator_name, payment_group_id, payment_methods ( name, type ) )
            `)
            .eq('tenant_id', user.tenantId)
            .eq('session_id', sid)
            .eq('is_training', false)
            .eq('is_draft', false)
            .neq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(200);

          if (!deliveryErr && deliveryData && deliveryData.length > 0) {
            const rpcIds = new Set(rawOrders.map((o) => o.id));
            const missingOrders = (deliveryData as DirectQueryOrder[]).filter((o) => !rpcIds.has(o.id));
            if (missingOrders.length > 0) {
              console.log('[useOrdersHistory] session mode — found', missingOrders.length, 'orders missing from RPC (delivery/skip_kds)');
              const mappedMissing = await mapDirectQueryOrders(missingOrders, user.tenantId);
              const rpcMapped = mapRPCOrders(rawOrders, user.tenantId);
              // Enriquece RPC orders com pagamentos se necessário
              const needsEnrich = rpcMapped.filter((o) => o.pagamentos.length === 0);
              let finalRpc = rpcMapped;
              if (needsEnrich.length > 0) {
                const enriched = await enrichWithPayments(needsEnrich, user.tenantId);
                const enrichedMap = new Map(enriched.map((o) => [o.id, o]));
                finalRpc = rpcMapped.map((o) => enrichedMap.get(o.id) ?? o);
              }
              setOrders([...finalRpc, ...mappedMissing].sort((a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              ));
              return;
            }
          }
        } catch (deliveryFetchErr) {
          console.warn('[useOrdersHistory] delivery complement fetch failed (non-blocking):', deliveryFetchErr);
        }

      } else if (!from && !to) {
        // ── MODO ATUAL (sem filtro de data): usa RPC com session_id=null ──
        // Isso retorna pedidos das últimas 12h, igual ao KDS em modo sem sessão
        const { data, error } = await supabase.rpc('fn_get_kds_orders', {
          p_tenant_id: user.tenantId,
          p_session_id: null,
        });

        if (error) {
          console.error('[useOrdersHistory] rpc error (no-filter mode):', error.message);
          rawOrders = [];
        } else {
          rawOrders = (data as RPCOrder[]) ?? [];
        }
        console.log('[useOrdersHistory] no-filter mode — RPC returned:', rawOrders.length, 'orders');

      } else {
        // ── MODO HISTÓRICO: query direta com filtro de data ────────────────
        // Usa fuso horário de Brasília para garantir que o dia completo é coberto
        const fromTs = from ? `${from}T00:00:00-03:00` : undefined;
        const toTs = to ? `${to}T23:59:59-03:00` : undefined;

        console.log('[useOrdersHistory] historic mode — querying:', { from: fromTs, to: toTs, tenant: user.tenantId });

        let query = supabase
          .from('orders')
          .select(`
            id,
            number,
            status,
            subtotal,
            discount_amount,
            service_fee_amount,
            tip_amount,
            total_amount,
            origin_type,
            destination_type,
            destination_name,
            cancel_reason,
            cancelled_at,
            table_number,
            created_at,
            updated_at,
            origin_user_id,
            is_training,
            is_draft,
            is_paid,
            waiter_name,
            delivery_platform,
            delivery_fee,
            session_id,
            session:sessions(id, number),
            order_items (
              id,
              item_name,
              item_price,
              quantity,
              status,
              notes,
              station_id,
              operator_id,
              entered_kds_at,
              started_preparing_at,
              ready_at,
              delivered_at,
              order_item_options ( option_name, group_name, additional_price ),
              order_item_observations ( text ),
              order_item_units (
                id, unit_number, status,
                operator_id, started_preparing_at, ready_at, delivered_at
              )
            ),
            payments ( id, amount, change_amount, is_refunded, payment_method_id, cash_register_id, operator_name, payment_methods ( name, type ) )
          `)
          .eq('tenant_id', user.tenantId)
          .eq('is_training', false)
          .eq('is_draft', false)
          .neq('status', 'draft')
          .order('created_at', { ascending: false })
          .limit(500);

        if (fromTs) query = query.gte('created_at', fromTs);
        if (toTs) query = query.lte('created_at', toTs);

        const { data, error } = await query;

        if (error) {
          console.error('[useOrdersHistory] direct query error:', error.message, error.code);
          // Fallback: tenta RPC com filtro de data via query simples
          try {
            const { data: fallbackData, error: fallbackErr } = await supabase
              .from('orders')
              .select('id, number, status, subtotal, discount_amount, service_fee_amount, tip_amount, total_amount, origin_type, destination_type, destination_name, cancel_reason, cancelled_at, table_number, created_at, updated_at, origin_user_id, is_training, is_draft, is_paid, waiter_name, delivery_platform, delivery_fee, session_id')
              .eq('tenant_id', user.tenantId)
              .eq('is_training', false)
              .eq('is_draft', false)
              .gte('created_at', fromTs ?? '')
              .lte('created_at', toTs ?? '')
              .order('created_at', { ascending: false })
              .limit(500);
            if (!fallbackErr && fallbackData && fallbackData.length > 0) {
              const simpleMapped = (fallbackData as DirectQueryOrder[]).map((o) => ({
                id: o.id,
                numero: o.number ?? '',
                status: o.status ?? 'new',
                total: Number(o.total_amount) || 0,
                subtotal: Number(o.subtotal) || 0,
                discount_amount: Number(o.discount_amount) || 0,
                service_fee_amount: Number(o.service_fee_amount) || 0,
                tip_amount: Number(o.tip_amount) || 0,
                created_at: o.created_at,
                updated_at: o.updated_at ?? o.created_at,
                cancelled_at: o.cancelled_at ?? null,
                origin: o.origin_type ?? 'cashier',
                destination: o.destination_type ?? 'immediate',
                destination_name: o.destination_name ?? null,
                cancel_reason: o.cancel_reason ?? null,
                is_paid: o.is_paid ?? false,
                operador: o.waiter_name ?? null,
                mesa_numero: o.table_number ?? null,
                sla_espera_min: null,
                sla_cozinha_min: null,
                tempo_total_min: null,
                delivery_platform: o.delivery_platform ?? null,
                delivery_fee: Number(o.delivery_fee) || null,
                itens: [],
                pagamentos: [],
              } as DBOrder));
              // Enriquece com pagamentos
              const enriched = await enrichWithPayments(simpleMapped, user.tenantId);
              setOrders(enriched);
              return;
            }
          } catch (fb) {
            console.warn('[useOrdersHistory] fallback simples também falhou:', fb);
          }
          return;
        }

        console.log('[useOrdersHistory] historic mode — direct query returned:', data?.length ?? 0, 'orders');

        if (!Array.isArray(data)) return;

        // Histórico: mapeia direto sem passar pela RPC
        const mapped = await mapDirectQueryOrders(data as DirectQueryOrder[], user.tenantId);
        setOrders(mapped);
        return;
      }

      // Se RPC retornou vazio no modo "hoje", faz fallback para query direta
      if (rawOrders.length === 0 && !from && !to) {
        console.log('[useOrdersHistory] RPC vazio — tentando fallback direto');
        const { fromTs, toTs } = getTodayBrasiliaRange();
        let query = supabase
          .from('orders')
          .select(`
            id,
            number,
            status,
            subtotal,
            discount_amount,
            service_fee_amount,
            tip_amount,
            total_amount,
            origin_type,
            destination_type,
            destination_name,
            cancel_reason,
            cancelled_at,
            table_number,
            created_at,
            updated_at,
            origin_user_id,
            is_training,
            is_draft,
            is_paid,
            waiter_name,
            delivery_platform,
            delivery_fee,
            session_id,
            session:sessions(id, number),
            order_items (
              id,
              item_name,
              item_price,
              quantity,
              status,
              notes,
              station_id,
              operator_id,
              entered_kds_at,
              started_preparing_at,
              ready_at,
              delivered_at,
              order_item_options ( option_name, group_name, additional_price ),
              order_item_observations ( text ),
              order_item_units (
                id, unit_number, status,
                operator_id, started_preparing_at, ready_at, delivered_at
              )
            ),
            payments ( id, amount, is_refunded, payment_method_id, operator_name, payment_group_id, payment_methods ( name ) )
          `)
          .eq('tenant_id', user.tenantId)
          .eq('is_training', false)
          .eq('is_draft', false)
          .neq('status', 'draft')
          .gte('created_at', fromTs)
          .lte('created_at', toTs)
          .order('created_at', { ascending: false })
          .limit(500);

        const { data: fallbackData, error: fallbackErr } = await query;
        if (fallbackErr) {
          console.error('[useOrdersHistory] fallback query error:', fallbackErr.message);
        } else if (fallbackData && fallbackData.length > 0) {
          console.log('[useOrdersHistory] fallback retornou:', fallbackData.length, 'orders');
          const mappedFallback = await mapDirectQueryOrders(fallbackData as DirectQueryOrder[], user.tenantId);
          setOrders(mappedFallback);
          return;
        }
      }

      // Mapeia resultado da RPC para DBOrder (já inclui pagamentos da RPC)
      const mapped = mapRPCOrders(rawOrders, user.tenantId);
      // Enriquece apenas pedidos que não vieram com pagamentos na RPC
      const needsEnrich = mapped.filter((o) => o.pagamentos.length === 0);
      if (needsEnrich.length > 0) {
        const enriched = await enrichWithPayments(needsEnrich, user.tenantId);
        const enrichedMap = new Map(enriched.map((o) => [o.id, o]));
        const final = mapped.map((o) => enrichedMap.get(o.id) ?? o);
        setOrders(final);
      } else {
        setOrders(mapped);
      }

    } catch (e) {
      console.error('[useOrdersHistory] unexpected error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  // Debounce para evitar chamadas múltiplas quando filtros mudam juntos
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(dateFrom, dateTo, sessionId);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load, dateFrom, dateTo, sessionId]);

  return { orders, loading, reload: load };
}

// ─── Mappers ───────────────────────────────────────────────────────────────────

function mapRPCOrders(rpcOrders: RPCOrder[], _tenantId: string): DBOrder[] {
  return rpcOrders.map((o) => {
    const rawItems = o.items ?? [];

    const items: DBOrderItem[] = rawItems.map((oi) => {
      const rawUnits = oi.units ?? [];
      const units: DBOrderItemUnit[] = rawUnits
        .sort((a, b) => a.unit_number - b.unit_number)
        .map((u) => ({
          id: u.id,
          unit_number: u.unit_number,
          status: u.status ?? 'new',
          operator_name: u.operator_name ?? undefined,
          started_preparing_at: u.started_preparing_at ?? null,
          ready_at: u.ready_at ?? null,
          delivered_at: u.delivered_at ?? null,
        }));

      return {
        id: oi.id,
        nome: oi.item_name ?? '',
        quantidade: oi.quantity ?? 1,
        preco: Number(oi.item_price) || 0,
        status: oi.status ?? 'new',
        notes: oi.notes ?? null,
        entered_kds_at: oi.entered_kds_at ?? null,
        started_preparing_at: oi.started_preparing_at ?? null,
        ready_at: oi.ready_at ?? null,
        delivered_at: oi.delivered_at ?? null,
        options: oi.options ?? [],
        observations: oi.observations ?? [],
        units: units.length > 0 ? units : undefined,
      };
    });

    const slaData = computeSLA(rawItems, o.status ?? '', o.created_at);

    // Mapeia pagamentos que já vêm na RPC (evita round-trip extra)
    const rpcPayments = o.payments ?? [];
    const pagamentos: DBPayment[] = rpcPayments.map((p) => ({
      id: p.id,
      amount: Number(p.amount) || 0,
      change_amount: p.change_amount != null ? Number(p.change_amount) : null,
      is_refunded: p.is_refunded ?? false,
      payment_method_id: p.payment_method_id ?? null,
      payment_method_name: p.payment_method_name ?? null,
      payment_method_type: p.payment_method_type ?? null,
      operator_name: p.operator_name ?? null,
      cash_register_id: p.cash_register_id ?? null,
      cash_register_name: p.cash_register_name ?? null,
      paid_by_pdv: null,
      payment_group_id: p.payment_group_id ?? null,
    }));
    const isPaid = o.status !== 'cancelled' && (
      rpcPayments.length > 0
        ? rpcPayments.some((p) => !p.is_refunded)
        : (o.is_paid ?? false)
    );

    // Fallback: calcula total dos itens se total_amount da RPC for nulo/zerado
    const calcTotalFromItems = items.reduce((sum, item) => sum + item.preco * item.quantidade, 0);
    const rpcTotal = Number(o.total_amount) || 0;
    const finalTotal = rpcTotal > 0 ? rpcTotal : calcTotalFromItems;

    return {
      id: o.id,
      numero: o.number ?? '',
      status: o.status ?? 'new',
      total: finalTotal,
      subtotal: Number(o.total_amount) || 0,
      discount_amount: 0,
      service_fee_amount: 0,
      tip_amount: 0,
      created_at: o.created_at,
      updated_at: o.created_at,
      origin: o.origin_type ?? 'cashier',
      destination: o.destination_type ?? 'immediate',
      destination_name: o.destination_name ?? null,
      cancel_reason: o.cancel_reason ?? null,
      is_paid: isPaid,
      operador: o.waiter_name ?? null,
      mesa_numero: o.table_number ?? null,
      sla_espera_min: slaData.slaEspera,
      sla_cozinha_min: slaData.slaCozinha,
      sla_entrega_min: slaData.slaEntrega,
      tempo_total_min: slaData.tempoTotal,
      delivery_platform: (o as RPCOrder & { delivery_platform?: string | null }).delivery_platform ?? null,
      delivery_fee: null,
      session_id: (o as RPCOrder & { session_id?: string | null }).session_id ?? null,
      session_number: (o as RPCOrder & { session_number?: string | null }).session_number ?? null,
      participant_token: o.participant_token ?? null,
      participant_name: o.participant_name ?? null,
      itens: items,
      pagamentos,
    };
  });
}

// ─── Direct query order type (resultado do select REST) ───────────────────────

interface DirectQueryItem {
  id: string;
  item_name?: string | null;
  item_price?: number | null;
  quantity?: number | null;
  status?: string | null;
  notes?: string | null;
  station_id?: string | null;
  operator_id?: string | null;
  entered_kds_at?: string | null;
  started_preparing_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
  order_item_options?: { option_name: string; group_name: string; additional_price?: number | null }[] | null;
  order_item_observations?: { text: string }[] | null;
  order_item_units?: {
    id: string;
    unit_number: number;
    status?: string | null;
    operator_id?: string | null;
    started_preparing_at?: string | null;
    ready_at?: string | null;
    delivered_at?: string | null;
  }[] | null;
}

interface DirectQueryPayment {
  id: string;
  amount?: number | null;
  change_amount?: number | null;
  is_refunded?: boolean | null;
  payment_method_id?: string | null;
  cash_register_id?: string | null;
  operator_name?: string | null;
  payment_methods?: { name: string; type?: string | null } | null;
  payment_group_id?: string | null;
}

interface DirectQueryOrder {
  id: string;
  number?: string | null;
  status?: string | null;
  subtotal?: number | null;
  discount_amount?: number | null;
  service_fee_amount?: number | null;
  tip_amount?: number | null;
  total_amount?: number | null;
  origin_type?: string | null;
  destination_type?: string | null;
  destination_name?: string | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  table_number?: number | null;
  created_at: string;
  updated_at?: string | null;
  origin_user_id?: string | null;
  is_paid?: boolean | null;
  waiter_name?: string | null;
  delivery_platform?: string | null;
  delivery_fee?: number | null;
  paid_by_pdv?: string | null;
  session_id?: string | null;
  session?: { id: string; number: string | null } | null;
  order_items?: DirectQueryItem[] | null;
  payments?: DirectQueryPayment[] | null;
}

async function mapDirectQueryOrders(data: DirectQueryOrder[], tenantId: string): Promise<DBOrder[]> {
  // Coleta IDs de usuários para resolver nomes
  const userIdSet = new Set<string>();
  const stationIdSet = new Set<string>();

  data.forEach((o) => {
    if (o.origin_user_id) userIdSet.add(o.origin_user_id);
    (o.order_items ?? []).forEach((oi) => {
      if (oi.operator_id) userIdSet.add(oi.operator_id);
      if (oi.station_id) stationIdSet.add(oi.station_id);
    });
  });

  // Resolve nomes de usuários
  let userMap: Record<string, string> = {};
  const userIds = [...userIdSet].filter(Boolean);
  if (userIds.length > 0) {
    const { data: usersData } = await supabase
      .from('users')
      .select('id, name')
      .in('id', userIds);
    if (usersData) {
      userMap = Object.fromEntries((usersData as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    }
  }

  // Resolve nomes de estações
  let stationMap: Record<string, string> = {};
  const stationIds = [...stationIdSet].filter(Boolean);
  if (stationIds.length > 0) {
    const { data: stationsData } = await supabase
      .from('kitchen_stations')
      .select('id, name')
      .in('id', stationIds);
    if (stationsData) {
      stationMap = Object.fromEntries((stationsData as { id: string; name: string }[]).map((s) => [s.id, s.name]));
    }
  }

  const mapped = data.map((o) => {
    const rawItems = o.order_items ?? [];

    const items: DBOrderItem[] = rawItems.map((oi) => {
      const rawUnits = oi.order_item_units ?? [];
      const units: DBOrderItemUnit[] = rawUnits
        .sort((a, b) => a.unit_number - b.unit_number)
        .map((u) => ({
          id: u.id,
          unit_number: u.unit_number,
          status: u.status ?? 'new',
          operator_name: u.operator_id ? (userMap[u.operator_id] ?? undefined) : undefined,
          started_preparing_at: u.started_preparing_at ?? null,
          ready_at: u.ready_at ?? null,
          delivered_at: u.delivered_at ?? null,
        }));

      return {
        id: oi.id,
        nome: oi.item_name ?? '',
        quantidade: oi.quantity ?? 1,
        preco: Number(oi.item_price) || 0,
        status: oi.status ?? 'new',
        station_name: oi.station_id ? (stationMap[oi.station_id] ?? undefined) : undefined,
        operator_name: oi.operator_id ? (userMap[oi.operator_id] ?? undefined) : undefined,
        notes: oi.notes ?? null,
        entered_kds_at: oi.entered_kds_at ?? null,
        started_preparing_at: oi.started_preparing_at ?? null,
        ready_at: oi.ready_at ?? null,
        delivered_at: oi.delivered_at ?? null,
        options: oi.order_item_options ?? [],
        observations: oi.order_item_observations ?? [],
        units: units.length > 0 ? units : undefined,
      };
    });

    const slaData = computeSLA(rawItems, o.status ?? '', o.created_at);
    const rawPayments = o.payments ?? [];
    // Supabase pode retornar payment_methods como array [ { name, type } ]
    const resolvePm = (p: DirectQueryPayment) => {
      const pmRaw = p.payment_methods;
      const pm = Array.isArray(pmRaw) ? pmRaw[0] : pmRaw;
      return {
        name: pm?.name ?? null,
        type: (pm as { name: string; type?: string | null } | null)?.type ?? null,
      };
    };
    // Usa is_paid do banco diretamente (campo confiável), com fallback nos pagamentos
    const isPaid = o.is_paid != null
      ? o.is_paid
      : (o.status !== 'cancelled' && rawPayments.some((p) => !p.is_refunded));

    const pagamentos: DBPayment[] = rawPayments.map((p) => {
      const pm = resolvePm(p);
      return {
        id: p.id,
        amount: Number(p.amount) || 0,
        change_amount: p.change_amount != null ? Number(p.change_amount) : null,
        is_refunded: p.is_refunded ?? false,
        payment_method_id: p.payment_method_id ?? null,
        payment_method_name: pm.name,
        payment_method_type: pm.type,
        operator_name: p.operator_name ?? null,
        cash_register_id: p.cash_register_id ?? null,
        cash_register_name: null, // resolvido depois via enrichWithCashRegisters se necessário
        paid_by_pdv: o.paid_by_pdv ?? null,
        payment_group_id: p.payment_group_id ?? null,
      };
    });

    // Calcula total dos itens como fallback se total_amount do banco estiver nulo/zerado
    const calcTotalFromItems = items.reduce((sum, item) => sum + item.preco * item.quantidade, 0);
    const dbTotal = Number(o.total_amount) || 0;
    const finalTotal = dbTotal > 0 ? dbTotal : calcTotalFromItems;

    // Usa waiter_name do banco diretamente; fallback para userMap se não disponível
    const operador = o.waiter_name ?? (o.origin_user_id ? (userMap[o.origin_user_id] ?? null) : null);

    return {
      id: o.id,
      numero: o.number ?? '',
      status: o.status ?? 'new',
      total: finalTotal,
      subtotal: Number(o.subtotal) || 0,
      discount_amount: Number(o.discount_amount) || 0,
      service_fee_amount: Number(o.service_fee_amount) || 0,
      tip_amount: Number(o.tip_amount) || 0,
      created_at: o.created_at,
      updated_at: o.updated_at ?? o.created_at,
      cancelled_at: o.cancelled_at ?? null,
      origin: o.origin_type ?? 'cashier',
      destination: o.destination_type ?? 'immediate',
      destination_name: o.destination_name ?? null,
      cancel_reason: o.cancel_reason ?? null,
      is_paid: isPaid,
      operador,
      mesa_numero: o.table_number ?? null,
      sla_espera_min: slaData.slaEspera,
      sla_cozinha_min: slaData.slaCozinha,
      sla_entrega_min: slaData.slaEntrega,
      tempo_total_min: slaData.tempoTotal,
      delivery_platform: o.delivery_platform ?? null,
      delivery_fee: Number(o.delivery_fee) || null,
      paid_by_pdv: o.paid_by_pdv ?? null,
      session_id: o.session_id ?? null,
      session_number: (o as any).session?.number ?? null,
      itens: items,
      pagamentos,
    };
  });

  // Log de debug para totais
  if (mapped.length > 0) {
    const primeiro = mapped[0];
    console.log('[useOrdersHistory] mapDirectQueryOrders — first order total:', primeiro.total, 'itemsTotal:', primeiro.itens.reduce((s, i) => s + i.preco * i.quantidade, 0), 'raw_total_amount:', data[0]?.total_amount);
  }

  return mapped;
}

// ─── Enrich RPC orders with payments ──────────────────────────────────────────

async function enrichWithPayments(orders: DBOrder[], tenantId: string): Promise<DBOrder[]> {
  if (orders.length === 0) return orders;

  const orderIds = orders.map((o) => o.id);

  const { data: paymentsData, error } = await supabase
    .from('payments')
    .select('id, order_id, amount, change_amount, is_refunded, payment_method_id, cash_register_id, operator_name, payment_group_id, payment_methods ( name, type )')
    .in('order_id', orderIds)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[useOrdersHistory] enrichWithPayments error:', error.message);
    return orders;
  }

  // Log para debug — mostra quantos pagamentos foram encontrados
  console.log('[useOrdersHistory] enrichWithPayments:', {
    ordersCount: orders.length,
    paymentsFound: paymentsData?.length ?? 0,
    orderIds: orderIds.slice(0, 5),
  });

  const paymentsByOrder: Record<string, DBPayment[]> = {};
  ((paymentsData as (DirectQueryPayment & { order_id: string })[]) ?? []).forEach((p) => {
    if (!paymentsByOrder[p.order_id]) paymentsByOrder[p.order_id] = [];
    // Supabase pode retornar payment_methods como array [ { name, type } ]
    const pmRaw = p.payment_methods;
    const pm = Array.isArray(pmRaw) ? pmRaw[0] : pmRaw;
    paymentsByOrder[p.order_id].push({
      id: p.id,
      amount: Number(p.amount) || 0,
      change_amount: p.change_amount != null ? Number(p.change_amount) : null,
      is_refunded: p.is_refunded ?? false,
      payment_method_id: p.payment_method_id ?? null,
      payment_method_name: pm?.name ?? null,
      payment_method_type: (pm as { name: string; type?: string | null } | null)?.type ?? null,
      operator_name: p.operator_name ?? null,
      cash_register_id: p.cash_register_id ?? null,
      cash_register_name: null,
      paid_by_pdv: null,
      payment_group_id: p.payment_group_id ?? null,
    });
  });

  return orders.map((o) => {
    const pagamentos = paymentsByOrder[o.id] ?? [];
    // Se encontrou pagamentos, recalcula; caso contrário, mantém o is_paid que veio da RPC/banco
    const isPaid = pagamentos.length > 0
      ? (o.status !== 'cancelled' && pagamentos.some((p) => !p.is_refunded))
      : o.is_paid;
    return { ...o, pagamentos, is_paid: isPaid };
  });
}

// ─── SLA Computation ──────────────────────────────────────────────────────────

/** Converte timestamp string para número ms, ou null se inválido */
function parseTsMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const d = new Date(ts).getTime();
  return isNaN(d) ? null : d;
}

/** Ordena timestamps e retorna min/max em ms */
function minMaxTsMs(timestamps: (string | null | undefined)[]): { min: number | null; max: number | null } {
  const nums = timestamps.map(parseTsMs).filter((n): n is number => n !== null);
  if (nums.length === 0) return { min: null, max: null };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function computeSLA(
  rawItems: (RPCItem | DirectQueryItem)[],
  orderStatus: string,
  createdAt: string,
): { slaEspera: number | null; slaCozinha: number | null; tempoTotal: number | null; slaEntrega: number | null } {
  const itemsWithEspera = rawItems.filter((oi) => oi.started_preparing_at && oi.entered_kds_at);
  const itemsWithCozinha = rawItems.filter((oi) => oi.started_preparing_at && oi.ready_at);
  const itemsWithEntrega = rawItems.filter((oi) => oi.ready_at && oi.delivered_at);

  let slaEspera: number | null = null;
  if (itemsWithEspera.length > 0) {
    const total = itemsWithEspera.reduce((sum, oi) => {
      const start = parseTsMs(oi.entered_kds_at);
      const end = parseTsMs(oi.started_preparing_at);
      if (!start || !end) return sum;
      return sum + (end - start) / 60000;
    }, 0);
    slaEspera = Math.round(total / itemsWithEspera.length);
  }

  let slaCozinha: number | null = null;
  if (itemsWithCozinha.length > 0) {
    const total = itemsWithCozinha.reduce((sum, oi) => {
      const start = parseTsMs(oi.started_preparing_at);
      const end = parseTsMs(oi.ready_at);
      if (!start || !end) return sum;
      return sum + (end - start) / 60000;
    }, 0);
    slaCozinha = Math.round(total / itemsWithCozinha.length);
  }

  let slaEntrega: number | null = null;
  if (itemsWithEntrega.length > 0) {
    const total = itemsWithEntrega.reduce((sum, oi) => {
      const start = parseTsMs(oi.ready_at);
      const end = parseTsMs(oi.delivered_at);
      if (!start || !end) return sum;
      return sum + (end - start) / 60000;
    }, 0);
    slaEntrega = Math.round(total / itemsWithEntrega.length);
  }

  // Tempo total: do criado ao último evento de entrega/pronto/preparo
  let tempoTotal: number | null = null;
  const allTimestamps = rawItems.flatMap((oi) => [
    oi.entered_kds_at,
    oi.started_preparing_at,
    oi.ready_at,
    oi.delivered_at,
    ...(oi.units?.flatMap((u) => [u.started_preparing_at, u.ready_at, u.delivered_at]) ?? []),
  ]);

  const { max: lastTsMs } = minMaxTsMs(allTimestamps);
  const createdMs = parseTsMs(createdAt);

  if (lastTsMs && createdMs) {
    tempoTotal = Math.round((lastTsMs - createdMs) / 60000);
  } else if (orderStatus === 'cancelled') {
    // Cancelado: não calcula tempo total
    tempoTotal = null;
  }

  return { slaEspera, slaCozinha, tempoTotal, slaEntrega };
}
