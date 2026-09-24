import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { chatEquipe, EVENTO_MSG_EQUIPE, EVENTO_VISTO_EQUIPE, type ConversaResumo, type MensagemEquipe } from './api';

/**
 * Lista das conversas com a equipe + total de não lidas (badge do botão do chat).
 * Mensagem nova chega pelo Realtime: recarrega a lista e avisa a conversa aberta (evento de janela).
 * O Realtime pode cair em segundo plano (celular), então também confere de 60 em 60 s.
 */
export function useConversasEquipe(userId: string | undefined) {
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [carregado, setCarregado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recarregar = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await chatEquipe<{ conversas: ConversaResumo[] }>('conversas');
      setConversas(r.conversas);
    } catch { /* a lista é extra: tenta de novo no próximo ciclo */ }
    setCarregado(true);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    recarregar();
    const iv = setInterval(() => { if (document.visibilityState === 'visible') recarregar(); }, 60_000);
    const aoVoltar = () => { if (document.visibilityState === 'visible') recarregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    const canal = supabase
      .channel(`chat-equipe-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => {
        const m = p.new as MensagemEquipe & { thread_id: string };
        window.dispatchEvent(new CustomEvent(EVENTO_MSG_EQUIPE, { detail: m }));
        // Várias chegando juntas: uma recarga só.
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(recarregar, 400);
      })
      // Vistos (2026-09-24): a outra pessoa recebeu ou leu — o ✓✓ muda na hora.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_participants' }, (p) => {
        const r = p.new as { thread_id: string; user_id: string; last_read_id: number; last_delivered_id: number };
        if (r.user_id === userId) return;
        window.dispatchEvent(new CustomEvent(EVENTO_VISTO_EQUIPE, { detail: r }));
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(recarregar, 400);
      })
      .subscribe();
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', aoVoltar);
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(canal);
    };
  }, [userId, recarregar]);

  const naoLidas = conversas.reduce((s, c) => s + c.nao_lidas, 0);
  return { conversas, carregado, naoLidas, recarregar };
}
