import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { modoDemo } from '../demo/modoDemo';

/**
 * Tempo estimado padrão de cada pessoa (2026-09-29): tarefa sem tempo vale o
 * padrão do responsável principal. Mora em task_user_capacity; lê pelo RPC
 * fn_get_task_default_estimates e grava pelo task-write (set_default_estimate).
 * No demo (/dev/tarefas) fica só em memória.
 */
export function usePadroesEstimativa(userIds: string[], tenantId: string | null) {
  const [padroes, setPadroes] = useState<Record<string, number>>({});
  const chave = [...new Set(userIds)].filter(Boolean).sort().join(',');

  useEffect(() => {
    if (!chave || modoDemo()) return;
    let cancelado = false;
    supabase.rpc('fn_get_task_default_estimates', { p_user_ids: chave.split(',') }).then(({ data, error }) => {
      if (!cancelado && !error && data && typeof data === 'object' && !Array.isArray(data)) {
        setPadroes(data as Record<string, number>);
      }
    });
    return () => { cancelado = true; };
  }, [chave]);

  /** minutos null = tira o padrão. Otimista; volta o valor antigo se o servidor recusar. */
  const salvarPadrao = useCallback(async (userId: string, minutos: number | null): Promise<{ success: boolean; error?: string }> => {
    let anterior: number | undefined;
    setPadroes((prev) => {
      anterior = prev[userId];
      const n = { ...prev };
      if (minutos) n[userId] = minutos; else delete n[userId];
      return n;
    });
    if (modoDemo()) return { success: true };
    const { data, error } = await invokeWithAuth<{ success?: boolean; error?: string }>('task-write', {
      body: { action: 'set_default_estimate', active_tenant_id: tenantId, user_id: userId, minutes: minutos },
    });
    if (error || !data?.success) {
      setPadroes((prev) => {
        const n = { ...prev };
        if (anterior) n[userId] = anterior; else delete n[userId];
        return n;
      });
      return { success: false, error: data?.error ?? error?.message ?? 'Erro desconhecido' };
    }
    return { success: true };
  }, [tenantId]);

  return { padroes, salvarPadrao };
}
