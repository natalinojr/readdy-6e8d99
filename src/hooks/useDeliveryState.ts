import { useState, useEffect, useCallback, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

function getDeliveryWriteUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/delivery-write';
}

export type DeliveryOp = 'open' | 'close' | 'pause' | 'resume' | 'force_off';

export interface DeliveryState {
  open_now: boolean;
  reason: string; // 'horario' | 'manual' | 'sem_sessao' | 'pausado' | 'fora_horario' | 'fechado_manual'
  manual_open: boolean;
  paused_until: string | null;
  schedule_enabled: boolean;
  within_schedule: boolean;
  has_session: boolean;
}

export interface UseDeliveryStateReturn {
  state: DeliveryState | null;
  loading: boolean;
  acting: boolean;
  refresh: () => Promise<void>;
  setOp: (op: DeliveryOp, minutes?: number) => Promise<{ error?: string } | null | undefined>;
}

/**
 * Estado de abertura do delivery (sessão + pausa + agenda + manual) controlado
 * pelo botão do PDV. A lógica de "aberto agora" é calculada no backend
 * (delivery-write get/set_delivery_state) — aqui só lemos e disparamos ações.
 *
 * Atualização do estado (modelo híbrido, p/ economizar invocações de Edge Function):
 *  - **Realtime broadcast** num canal por tenant (`delivery-state:<tenantId>`):
 *    quando QUALQUER dispositivo muda o estado (abrir/pausar/fechar), avisa os
 *    outros, que dão refresh na hora. Usamos broadcast (e não postgres_changes)
 *    porque `system_settings` tem RLS `tenant_id = auth_tenant_id()` e admin
 *    multi-loja não passaria nessa policy para a loja que não é a "última"
 *    membership — o mesmo motivo de a escrita ir por Edge Function.
 *  - **Poll lento** (default 5 min) só como fallback e para pegar as viradas de
 *    horário programado (que não geram evento no banco — dependem do relógio).
 *
 * Antes isto polava a cada 60s e o componente era montado 2× (barra desktop +
 * mobile), gerando ~4 invocações/min 24h e estourando a cota de Edge Functions.
 */
export function useDeliveryState(pollMs = 300000): UseDeliveryStateReturn {
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId as string | undefined;
  const [state, setState] = useState<DeliveryState | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const call = useCallback(async (action: string, extra: Record<string, unknown>) => {
    if (!tenantId) return null;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return null;
    const res = await fetch(getDeliveryWriteUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action, tenant_id: tenantId, ...extra }),
    });
    return res.json();
  }, [tenantId]);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await call('get_delivery_state', {});
      if (data && !data.error) setState(data as DeliveryState);
    } catch { /* silencioso */ } finally {
      setLoading(false);
    }
  }, [tenantId, call]);

  const setOp = useCallback(async (op: DeliveryOp, minutes?: number) => {
    setActing(true);
    try {
      const data = await call('set_delivery_state', { op, minutes });
      if (data && !data.error) {
        setState((prev) => ({
          ...(prev ?? ({} as DeliveryState)),
          open_now: data.open_now,
          reason: data.reason,
          manual_open: data.manual_open,
          paused_until: data.paused_until,
          schedule_enabled: data.schedule_enabled,
          has_session: data.has_session,
          within_schedule: prev?.within_schedule ?? false,
        }));
        // Avisa os outros dispositivos (outros PCs/abas) para darem refresh na hora.
        channelRef.current?.send({ type: 'broadcast', event: 'state-changed', payload: {} });
      }
      return data;
    } catch (e) {
      return { error: (e as Error)?.message ?? 'Falha na ação de delivery' };
    } finally {
      setActing(false);
    }
  }, [call]);

  useEffect(() => { if (tenantId) refresh(); }, [tenantId, refresh]);

  // Realtime: avisa/escuta mudanças manuais entre dispositivos da mesma loja.
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`delivery-state:${tenantId}`)
      .on('broadcast', { event: 'state-changed' }, () => { refresh(); })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [tenantId, refresh]);

  // Poll lento: fallback + viradas de horário programado (sem evento de banco).
  useEffect(() => {
    if (!tenantId || !pollMs) return;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [tenantId, pollMs, refresh]);

  return { state, loading, acting, refresh, setOp };
}
