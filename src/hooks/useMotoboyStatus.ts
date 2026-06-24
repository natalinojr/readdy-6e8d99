import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface MotoboySinal { status: string; note?: string | null; }

/**
 * Lê `motoboy_status`/`motoboy_note` direto da tabela `orders` (read seguro, sem
 * tocar na RPC `fn_get_kds_orders`). Retorna um Map por order id, atualizado por
 * polling. Usado pelo gestor pra mostrar "a caminho da loja" e alerta de problema.
 */
export function useMotoboyStatus(pollMs = 25000): Map<string, MotoboySinal> {
  const { user } = useAuth();
  const tenantId = (user as { tenantId?: string } | null)?.tenantId;
  const [map, setMap] = useState<Map<string, MotoboySinal>>(new Map());

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    try {
      const desde = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from('orders')
        .select('id, motoboy_status, motoboy_note')
        .eq('tenant_id', tenantId)
        .eq('origin_type', 'delivery')
        .not('motoboy_status', 'is', null)
        .gte('created_at', desde);
      const m = new Map<string, MotoboySinal>();
      (data ?? []).forEach((o: { id: string; motoboy_status: string | null; motoboy_note: string | null }) => {
        if (o.motoboy_status) m.set(o.id, { status: o.motoboy_status, note: o.motoboy_note });
      });
      setMap(m);
    } catch { /* silencioso */ }
  }, [tenantId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!tenantId || !pollMs) return;
    const id = setInterval(carregar, pollMs);
    return () => clearInterval(id);
  }, [tenantId, pollMs, carregar]);

  return map;
}
