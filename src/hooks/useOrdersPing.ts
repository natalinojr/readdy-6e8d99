import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * Assina o canal público `orders-ping:<tenantId>` (broadcast enviado pelo
 * trigger `trg_orders_realtime_ping` em orders/order_items — mesmo padrão do
 * `print-jobs` da impressão). Cada mudança de pedido no banco chega como um
 * ping instantâneo, sem depender de `postgres_changes` (que roda RLS por
 * linha × dispositivo e sofre com o cold start do Realtime na instância Nano).
 *
 * O payload é mínimo ({ table, op, id }) — o consumidor deve refazer o fetch
 * autenticado (RPC/Edge) com debounce próprio; nada sensível trafega no canal.
 *
 * Vários consumidores no mesmo app compartilham UMA assinatura por tópico
 * (registry de módulo) — assinar o mesmo tópico duas vezes no mesmo socket
 * causa conflito de join no Phoenix.
 */
type PingCallback = () => void;

const registry = new Map<string, { channel: RealtimeChannel; cbs: Set<PingCallback> }>();

export function useOrdersPing(tenantId: string | null | undefined, onPing: PingCallback) {
  const cbRef = useRef(onPing);
  cbRef.current = onPing;

  useEffect(() => {
    if (!tenantId) return;
    const topic = `orders-ping:${tenantId}`;
    const cb: PingCallback = () => cbRef.current();

    let entry = registry.get(topic);
    if (!entry) {
      const channel = supabase
        .channel(topic)
        .on('broadcast', { event: 'order_change' }, () => {
          registry.get(topic)?.cbs.forEach((fn) => {
            try { fn(); } catch { /* um consumidor com erro não derruba os demais */ }
          });
        })
        .subscribe();
      entry = { channel, cbs: new Set() };
      registry.set(topic, entry);
    }
    entry.cbs.add(cb);

    return () => {
      const e = registry.get(topic);
      if (!e) return;
      e.cbs.delete(cb);
      if (e.cbs.size === 0) {
        supabase.removeChannel(e.channel);
        registry.delete(topic);
      }
    };
  }, [tenantId]);
}
