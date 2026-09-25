import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * Assina `caixa-ping:<tenantId>` (broadcast do trigger `trg_caixa_realtime_ping` em
 * cash_movements / cash_sangrias_previstas — mesmo padrão do useOrdersPing). Cada mudança
 * chega como ping sem dado nenhum; o consumidor refaz a própria leitura. O callback já vem
 * com debounce de 400 ms (uma baixa mexe em várias linhas de uma vez).
 * Consumidores do mesmo tópico compartilham UMA assinatura (join duplicado no Phoenix dá conflito).
 */
type PingCallback = () => void;

const registry = new Map<string, { channel: RealtimeChannel; cbs: Set<PingCallback> }>();

export function useCaixaPing(tenantId: string | null | undefined, onPing: PingCallback) {
  const cbRef = useRef(onPing);
  cbRef.current = onPing;

  useEffect(() => {
    if (!tenantId) return;
    const topic = `caixa-ping:${tenantId}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cb: PingCallback = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), 400);
    };

    let entry = registry.get(topic);
    if (!entry) {
      const channel = supabase
        .channel(topic)
        .on('broadcast', { event: 'caixa_change' }, () => {
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
      if (timer) clearTimeout(timer);
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
