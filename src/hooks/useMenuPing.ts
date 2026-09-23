import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * "Publicar cardápio": o botão da aba Cardápio manda um broadcast no canal
 * público `menu-ping:<tenantId>` e toda tela aberta com o cardápio (PDV caixa,
 * garçom, PDV delivery, totem, mesa, QR universal/mesa-qr, link do delivery)
 * recarrega em segundo plano — sem o cliente/operador dar F5.
 *
 * Mesmo desenho do `useOrdersPing`: payload mínimo (nada sensível no canal) e
 * o consumidor refaz o fetch pelo caminho normal. Uma assinatura por tópico no
 * app (registry), porque assinar o mesmo tópico duas vezes no mesmo socket dá
 * conflito de join no Phoenix.
 *
 * Broadcast enviado com o aparelho desconectado se perde; por isso, quando o
 * canal volta a se inscrever depois de uma queda, os consumidores recarregam
 * também (pode ter perdido uma publicação no meio).
 */
type PingCallback = () => void;

const EVENT = 'menu_published';
const registry = new Map<string, { channel: RealtimeChannel; cbs: Set<PingCallback> }>();

export function useMenuPing(tenantId: string | null | undefined, onPing: PingCallback) {
  const cbRef = useRef(onPing);
  cbRef.current = onPing;

  useEffect(() => {
    if (!tenantId) return;
    const topic = `menu-ping:${tenantId}`;
    const cb: PingCallback = () => cbRef.current();

    let entry = registry.get(topic);
    if (!entry) {
      const fire = () => {
        registry.get(topic)?.cbs.forEach((fn) => {
          try { fn(); } catch { /* um consumidor com erro não derruba os demais */ }
        });
      };
      let jaInscrito = false;
      const channel = supabase
        .channel(topic)
        .on('broadcast', { event: EVENT }, fire)
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED') return;
          if (jaInscrito) fire(); // reconectou: pode ter perdido uma publicação
          jaInscrito = true;
        });
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

/** Avisa todas as telas abertas da loja que o cardápio mudou. */
export async function publicarCardapio(tenantId: string): Promise<boolean> {
  // `supabase.channel()` devolve o canal JÁ existente do tópico (a própria aba
  // do admin assina via CardapioContext) — nesse caso manda por ele e NÃO remove,
  // senão derruba a assinatura. Canal novo e não inscrito → o supabase-js manda
  // pelo endpoint REST de broadcast, e aí sim é descartado.
  const topic = `menu-ping:${tenantId}`;
  const jaExiste = registry.has(topic);
  const channel = jaExiste ? registry.get(topic)!.channel : supabase.channel(topic);
  try {
    const r = await channel.send({ type: 'broadcast', event: EVENT, payload: { at: Date.now() } });
    return r === 'ok';
  } catch {
    return false;
  } finally {
    if (!jaExiste) supabase.removeChannel(channel);
  }
}

/** Espalha o refetch de telas públicas (muitos clientes ao mesmo tempo) em até `maxMs`. */
export function comJitter(fn: () => void, maxMs = 4000): () => void {
  return () => { setTimeout(fn, Math.floor(Math.random() * maxMs)); };
}
