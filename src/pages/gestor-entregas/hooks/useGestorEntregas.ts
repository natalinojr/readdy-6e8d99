import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useOrdersPing } from '@/hooks/useOrdersPing';
import { fetchShippingAtivas, fetchShippingByOrder, ifoodShipping, type IfoodShippingOrder } from '@/lib/ifoodShipping';

function getDeliveryWriteUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/delivery-write';
}

export interface ProblemaEntrega { at: string; text: string; by?: string; autor?: string | null }
export type NotaKind = 'problema' | 'observacao';
export interface NotaEntrega { at: string; kind: NotaKind; text: string; autor?: string | null }

export interface EntregaDetalhe {
  id: string;
  number: string;
  cliente: string;
  telefone: string;
  endereco: string;
  total: number;
  taxa: number;
  status: string;
  motoboy_status: string | null;
  driver_nome: string | null;
  created_at: string;
  out_for_delivery_at: string | null;
  delivery_sla_min: number | null;
  motoboy_timeline: Record<string, string>;
  cozinha: { novo_at: string | null; preparo_at: string | null; pronto_at: string | null };
  itens: { nome: string; quantidade: number; preco: number }[];
  problemas: ProblemaEntrega[];
  delivery_notes: NotaEntrega[];
  pago?: boolean;
  pagamento?: string | null;
}

export interface EntregaPedido {
  id: string;
  number: string;
  cliente: string;
  telefone: string;
  endereco: string;
  total: number;
  taxa: number;
  status: string;
  motoboy_status: string | null;
  motoboy_note: string | null;
  problemas: ProblemaEntrega[];
  delivery_notes: NotaEntrega[];
  driver_id: string | null;
  driver_nome: string | null;
  /** Pago pelo app (Pix online) — o motoboy não cobra */
  pago?: boolean;
  /** Texto "Pagamento: X | Troco para ..." gravado em orders.notes */
  pagamento?: string | null;
  created_at: string;
  motoboy_updated_at: string | null;
  out_for_delivery_at: string | null;
  delivery_sla_min: number | null;
  motoboy_timeline: Record<string, string>;
  lat: number | null;
  lng: number | null;
  /** Pedido do iFood entregue pelo motoboy da loja (Fase 4): id "ifood:<uuid>" */
  fonte?: 'ifood';
  /** Status no iFood (placed/confirmed/preparing/ready/dispatched/concluded) */
  ifood_status?: string;
  /** Modo "operar": cada passo no ERPOS avisa o iFood */
  ifood_operar?: boolean;
}

/** Passo do iFood antes do motoboy (só no modo operar): o botão do cartão chama o iFood. */
export const IFOOD_PASSO: Record<string, { op: string; label: string; icon: string }> = {
  placed: { op: 'confirm', label: 'Confirmar no iFood', icon: 'ri-check-line' },
  confirmed: { op: 'start', label: 'Iniciar preparo', icon: 'ri-fire-line' },
  preparing: { op: 'ready', label: 'Pedido pronto', icon: 'ri-restaurant-2-line' },
};

/**
 * Dados do "Gestor de Entregas". Reaproveita as ações da Edge `delivery-write`:
 * `list_delivery_board` (lista do kanban — só entrega própria, inclui entregues
 * recentes), `set_motoboy_status` (avançar fase, override da loja) e
 * `clear_motoboy_driver` (liberar entregador). Carga inicial + Realtime (refetch
 * debounced em qualquer mudança de `orders` da loja) + tick local p/ recalcular atraso.
 */
export function useGestorEntregas() {
  const { user } = useAuth();
  const tenantId = (user as { tenantId?: string } | null)?.tenantId;
  const [orders, setOrders] = useState<EntregaPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // iFood Entrega: última entrega iFood de cada pedido + se o botão aparece nesta loja.
  const [ifood, setIfood] = useState<Record<string, IfoodShippingOrder>>({});
  const [ifoodOn, setIfoodOn] = useState(false);
  // Pedidos do iFood (módulo Order): botão "Pedidos iFood" + modo operar (homologação).
  const [ifoodPedidos, setIfoodPedidos] = useState<{ on: boolean; operar: boolean }>({ on: false, operar: false });
  // Loja no iFood (Merchant/Review): lojas autorizadas no app ERPOS PDV + se a pessoa pode alterar.
  const [ifoodLoja, setIfoodLoja] = useState<{ merchants: { id: string; name: string }[]; podeEditar: boolean }>({ merchants: [], podeEditar: false });
  // Entregas iFood ativas cujo pedido saiu do quadro (cancelado no ERPOS etc.) — o entregador ainda vai.
  const [ifoodForaDoQuadro, setIfoodForaDoQuadro] = useState<IfoodShippingOrder[]>([]);

  const token = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }, []);

  const carregar = useCallback(async (silent = false) => {
    if (!tenantId) return;
    if (!silent) setLoading(true);
    try {
      const t = await token();
      if (!t) { setErro('Sessão expirada.'); setLoading(false); return; }
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ action: 'list_delivery_board', tenant_id: tenantId }),
      });
      const data = await res.json();
      if (data.ok) {
        const lista: EntregaPedido[] = data.orders ?? [];
        setOrders(lista); setErro('');
        // (pedido do iFood não tem iFood Entrega: o id "ifood:..." nem é uuid)
        const [porPedido, ativas] = await Promise.all([fetchShippingByOrder(tenantId, lista.filter((o) => o.fonte !== 'ifood').map((o) => o.id)), fetchShippingAtivas(tenantId)]);
        setIfood(porPedido);
        const noQuadro = new Set(lista.map((o) => o.id));
        setIfoodForaDoQuadro(ativas.filter((s) => !noQuadro.has(s.order_id)));
      }
      else setErro('Não foi possível carregar as entregas.');
    } catch { setErro('Erro de conexão.'); } finally { setLoading(false); }
  }, [tenantId, token]);

  useEffect(() => { carregar(); }, [carregar]);

  const carregarIfoodCfg = useCallback(async () => {
    if (!tenantId) return;
    const r = await ifoodShipping<{ config: { shipping_enabled: boolean; order_enabled?: boolean; order_mode?: string; merchants?: { id: string; name: string }[] } | null; can_edit?: boolean }>('get_config', tenantId);
    setIfoodLoja({ merchants: r.success ? (r.config?.merchants ?? []) : [], podeEditar: !!r.can_edit });
    setIfoodOn(!!r.success && !!r.config?.shipping_enabled);
    setIfoodPedidos({ on: !!r.success && !!r.config?.order_enabled, operar: r.config?.order_mode === 'operate' });
  }, [tenantId]);
  useEffect(() => { carregarIfoodCfg(); }, [carregarIfoodCfg]);

  // Realtime: refetch debounced a cada mudança em `orders` da loja (mesmo padrão do
  // useMotoboyStatus). Backstop 90s + reload ao voltar pra aba.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ping instantâneo via trigger no banco (orders-ping) — não depende de RLS
  // por linha nem do cold start do postgres_changes.
  useOrdersPing(tenantId, () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => carregar(true), 600);
  });
  useEffect(() => {
    if (!tenantId) return;
    const agendar = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => carregar(true), 600);
    };
    const ch = supabase
      .channel(`gestor-entregas-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, agendar)
      .subscribe();
    const backstop = setInterval(() => carregar(true), 90000);
    // Pedidos do iFood mudam pelos eventos do iFood (fora de `orders`): com o módulo ligado, relê a cada 20 s.
    const ifoodTick = ifoodPedidos.operar ? setInterval(() => { if (document.visibilityState === 'visible') carregar(true); }, 20000) : null;
    const onVis = () => { if (document.visibilityState === 'visible') carregar(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(backstop);
      if (ifoodTick) clearInterval(ifoodTick);
      document.removeEventListener('visibilitychange', onVis);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tenantId, carregar, ifoodPedidos.operar]);

  // Tick local: recalcula prazo/atraso sem tocar o servidor.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // `code`: código de entrega do iFood (pedido do iFood no modo operar, ao marcar entregue)
  const setStatus = useCallback(async (orderId: string, signal: string, motivo?: string, code?: string) => {
    setBusy(`${orderId}:${signal}`);
    try {
      const t = await token();
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ action: 'set_motoboy_status', tenant_id: tenantId, order_id: orderId, signal, motivo, code }),
      });
      const data = await res.json();
      if (data.ok) await carregar(true); else setErro(typeof data.error === 'string' && data.error ? data.error : 'Não foi possível atualizar.');
    } catch { setErro('Erro de conexão.'); } finally { setBusy(''); }
  }, [tenantId, token, carregar]);

  // Pedido do iFood (modo operar): confirmar / iniciar preparo / pronto direto no iFood.
  const ifoodPasso = useCallback(async (orderId: string, op: string) => {
    if (!tenantId) return;
    setBusy(`${orderId}:${op}`);
    try {
      const r = await ifoodShipping('order_action', tenantId, { order_row_id: orderId.replace(/^ifood:/, ''), op });
      if (!r.success) setErro(r.error || 'O iFood não aceitou.');
      else { setErro(''); setTimeout(() => carregar(true), 4000); }
    } catch { setErro('Erro de conexão com o iFood.'); } finally { setBusy(''); }
  }, [tenantId, carregar]);

  const liberar = useCallback(async (orderId: string) => {
    setBusy(`${orderId}:liberar`);
    try {
      const t = await token();
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ action: 'clear_motoboy_driver', tenant_id: tenantId, order_id: orderId }),
      });
      const data = await res.json();
      if (data.ok) await carregar(true);
    } catch { setErro('Erro de conexão.'); } finally { setBusy(''); }
  }, [tenantId, token, carregar]);

  // Nome do operador logado — gravado como autor do problema/observação.
  const autor = (user as { nome?: string } | null)?.nome ?? null;

  const fetchDetalhe = useCallback(async (orderId: string): Promise<EntregaDetalhe | null> => {
    try {
      const t = await token();
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ action: 'get_delivery_order', tenant_id: tenantId, order_id: orderId }),
      });
      const data = await res.json();
      return data.ok ? (data.order as EntregaDetalhe) : null;
    } catch { return null; }
  }, [tenantId, token]);

  const addNote = useCallback(async (orderId: string, kind: NotaKind, text: string): Promise<boolean> => {
    setBusy(`${orderId}:nota`);
    try {
      const t = await token();
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ action: 'add_delivery_note', tenant_id: tenantId, order_id: orderId, kind, text, autor }),
      });
      const data = await res.json();
      if (data.ok) { await carregar(true); return true; }
      return false;
    } catch { return false; } finally { setBusy(''); }
  }, [tenantId, token, autor, carregar]);

  return {
    orders, loading, erro, busy, now, autor, recarregar: () => carregar(), setStatus, liberar, fetchDetalhe, addNote, ifoodPasso,
    tenantId, ifood, ifoodOn, ifoodForaDoQuadro, ifoodPedidos, ifoodLoja, recarregarIfoodCfg: carregarIfoodCfg,
  };
}
