import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useOrdersPing } from '@/hooks/useOrdersPing';

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
  created_at: string;
  motoboy_updated_at: string | null;
  out_for_delivery_at: string | null;
  delivery_sla_min: number | null;
  motoboy_timeline: Record<string, string>;
  lat: number | null;
  lng: number | null;
}

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
      if (data.ok) { setOrders(data.orders ?? []); setErro(''); }
      else setErro('Não foi possível carregar as entregas.');
    } catch { setErro('Erro de conexão.'); } finally { setLoading(false); }
  }, [tenantId, token]);

  useEffect(() => { carregar(); }, [carregar]);

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
    const onVis = () => { if (document.visibilityState === 'visible') carregar(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(backstop);
      document.removeEventListener('visibilitychange', onVis);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tenantId, carregar]);

  // Tick local: recalcula prazo/atraso sem tocar o servidor.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const setStatus = useCallback(async (orderId: string, signal: string, motivo?: string) => {
    setBusy(`${orderId}:${signal}`);
    try {
      const t = await token();
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ action: 'set_motoboy_status', tenant_id: tenantId, order_id: orderId, signal, motivo }),
      });
      const data = await res.json();
      if (data.ok) await carregar(true); else setErro('Não foi possível atualizar.');
    } catch { setErro('Erro de conexão.'); } finally { setBusy(''); }
  }, [tenantId, token, carregar]);

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

  return { orders, loading, erro, busy, now, autor, recarregar: () => carregar(), setStatus, liberar, fetchDetalhe, addNote };
}
