import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface MotoboySinal { status: string; note?: string | null; driverName?: string | null; }

/**
 * Lê `motoboy_status`/`motoboy_note` direto da tabela `orders` (read seguro, sem
 * tocar na RPC `fn_get_kds_orders`). Retorna um Map por order id. Atualiza em tempo
 * real (Realtime no UPDATE de `orders`), sem polling. Usado pelo gestor pra mostrar
 * "a caminho da loja"/dono do pedido e alerta de problema.
 */
export function useMotoboyStatus(): Map<string, MotoboySinal> {
  const { user } = useAuth();
  const tenantId = (user as { tenantId?: string } | null)?.tenantId;
  const [map, setMap] = useState<Map<string, MotoboySinal>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    try {
      const desde = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from('orders')
        .select('id, motoboy_status, motoboy_note, motoboy_driver:delivery_drivers!motoboy_driver_id(name)')
        .eq('tenant_id', tenantId)
        .eq('origin_type', 'delivery')
        .not('motoboy_status', 'is', null)
        .gte('created_at', desde);
      const m = new Map<string, MotoboySinal>();
      (data ?? []).forEach((o: { id: string; motoboy_status: string | null; motoboy_note: string | null; motoboy_driver?: { name: string | null } | { name: string | null }[] | null }) => {
        if (o.motoboy_status) {
          const drv = Array.isArray(o.motoboy_driver) ? o.motoboy_driver[0] : o.motoboy_driver;
          m.set(o.id, { status: o.motoboy_status, note: o.motoboy_note, driverName: drv?.name ?? null });
        }
      });
      setMap(m);
    } catch { /* silencioso */ }
  }, [tenantId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: o sinal do motoboy chega como UPDATE em `orders`. Recarrega na hora
  // (debounce p/ coalescer rajadas). É o que torna a atualização instantânea.
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`motoboy-status-${tenantId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { carregar(); }, 300);
      })
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [tenantId, carregar]);

  return map;
}
