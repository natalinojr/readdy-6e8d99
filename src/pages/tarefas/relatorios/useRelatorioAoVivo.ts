import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Relatório ao vivo: a edge `task-reports` manda um ping (sem conteúdo) no canal
 * público `report-ping:<id>` a cada resposta/edição; aqui a tela só recarrega,
 * pelo caminho autenticado de sempre (equipe: JWT; link: token do convidado).
 * Vários pings seguidos viram uma recarga só.
 */
export function useRelatorioAoVivo(reportId: string | null | undefined, recarregar: () => void) {
  const cb = useRef(recarregar);
  cb.current = recarregar;

  useEffect(() => {
    if (!reportId) return;
    let espera: number | undefined;
    let canal: ReturnType<typeof supabase.channel>;
    try {
      canal = supabase
        .channel(`report-ping:${reportId}`)
        .on('broadcast', { event: 'mudou' }, () => {
          window.clearTimeout(espera);
          espera = window.setTimeout(() => cb.current(), 400);
        })
        .subscribe();
    } catch {
      return; // sem Realtime (ex.: testes): fica a recarga de 60 s / ao voltar para a aba
    }
    return () => {
      window.clearTimeout(espera);
      supabase.removeChannel(canal);
    };
  }, [reportId]);
}
