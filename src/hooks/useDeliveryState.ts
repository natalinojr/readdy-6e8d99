import { useState, useEffect, useCallback } from 'react';
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

/**
 * Estado de abertura do delivery (sessão + pausa + agenda + manual) controlado
 * pelo botão do PDV. A lógica de "aberto agora" é calculada no backend
 * (delivery-write get/set_delivery_state) — aqui só lemos e disparamos ações.
 */
export function useDeliveryState(pollMs = 60000) {
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId as string | undefined;
  const [state, setState] = useState<DeliveryState | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

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
      }
      return data;
    } catch (e) {
      return { error: (e as Error)?.message ?? 'Falha na ação de delivery' };
    } finally {
      setActing(false);
    }
  }, [call]);

  useEffect(() => { if (tenantId) refresh(); }, [tenantId, refresh]);

  useEffect(() => {
    if (!tenantId || !pollMs) return;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [tenantId, pollMs, refresh]);

  return { state, loading, acting, refresh, setOp };
}
