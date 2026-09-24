import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * "Atualizar os aparelhos" (2026-09-24): depois de um deploy, o dono manda (ação rápida) um
 * broadcast no canal `app-update` e todo aparelho com alguém logado recarrega na versão nova
 * (celulares, PDV, KDS, tablets). O service worker serve o HTML sempre da rede, então o reload
 * já pega o deploy novo. Mesmo desenho do menu-ping: payload mínimo, nada sensível no canal.
 */
const TOPIC = 'app-update';
const EVENT = 'reload';
let ouvindo: RealtimeChannel | null = null;

export function useAtualizarApp(ativo: boolean, onPedido: () => void) {
  const cb = useRef(onPedido);
  cb.current = onPedido;
  useEffect(() => {
    if (!ativo) return;
    const channel = supabase.channel(TOPIC).on('broadcast', { event: EVENT }, () => cb.current()).subscribe();
    ouvindo = channel;
    return () => { ouvindo = null; supabase.removeChannel(channel); };
  }, [ativo]);
}

/** Manda todos os aparelhos logados recarregarem (o próprio aparelho não recebe). */
export async function pedirAtualizacaoDosAparelhos(): Promise<boolean> {
  // `supabase.channel()` devolve o canal já inscrito deste tópico (o do hook): manda por ele e NÃO
  // remove, senão este aparelho para de ouvir. Canal novo vai pelo endpoint REST e é descartado.
  const jaExiste = !!ouvindo;
  const channel = ouvindo ?? supabase.channel(TOPIC);
  try {
    const r = await channel.send({ type: 'broadcast', event: EVENT, payload: { at: Date.now() } });
    return r === 'ok';
  } catch {
    return false;
  } finally {
    if (!jaExiste) supabase.removeChannel(channel);
  }
}

/** Recarrega pegando a versão nova (atualiza o service worker antes, se houver). */
export async function recarregarNaVersaoNova(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    await reg?.update();
  } catch { /* sem SW (dev) ou sem rede: o reload resolve */ }
  window.location.reload();
}
