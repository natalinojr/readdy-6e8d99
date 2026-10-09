// Tarefas do painel rápido (/widget, app Windows). Mesma leitura e gravação das ações rápidas de
// Tarefas (fn_get_tasks + task-write) e o mesmo "minhas" da visão Minhas: sou um dos responsáveis,
// ou criei e ninguém é responsável. Dia em Brasília.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { somarDias, todayBrasilia } from '@/lib/dateUtils';
import { useEuTarefas } from '@/pages/tarefas/hooks/useEuTarefas';
import type { TaskNotificacao, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { ehResponsavel } from '@/pages/tarefas/lib/responsaveis';
import { carregarTarefas, diaPrazo, gravarTarefa, novoPrazo, ordenarPorPrazo } from '@/components/feature/assistente/acoes/tarefas/comum';

/** Sem tempo real para tarefa de outra loja/sem loja: confere de novo a cada 2 min. */
const RECARGA_MS = 2 * 60 * 1000;

export const minhaNoWidget = (t: TaskRow, meuId: string) =>
  ehResponsavel(t, meuId) || (!t.assignee_id && t.created_by === meuId);

export function useWidgetTarefas(ativo: boolean) {
  const eu = useEuTarefas();
  const [tarefas, setTarefas] = useState<TaskRow[] | null>(null);
  const [notificacoes, setNotificacoes] = useState<TaskNotificacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [hoje, setHoje] = useState(todayBrasilia());
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const ocupado = useRef(false);

  const carregar = useCallback(async () => {
    if (!ativo || !eu.pronto || !eu.id || ocupado.current) return;
    ocupado.current = true;
    setAtualizando(true);
    try {
      const [{ tarefas: abertas, erro: e }, notif] = await Promise.all([
        carregarTarefas(eu.tenantId),
        supabase.rpc('fn_get_task_notifications', { p_tenant_id: eu.tenantId }),
      ]);
      setHoje(todayBrasilia());
      if (e) { setErro(e); return; }
      setErro(null);
      setTarefas(ordenarPorPrazo(abertas.filter((t) => minhaNoWidget(t, eu.id!))));
      if (!notif.error) setNotificacoes((notif.data as TaskNotificacao[]) ?? []);
      setAtualizadoEm(new Date());
    } finally {
      ocupado.current = false;
      setAtualizando(false);
    }
  }, [ativo, eu.pronto, eu.id, eu.tenantId]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(carregar, RECARGA_MS);
    return () => clearInterval(t);
  }, [ativo, carregar]);

  // Tempo real: mudança nas tarefas da loja ativa + notificação endereçada a mim (lembrete de
  // vencimento do task-lembretes, atribuição, menção, comentário). Rajadas viram uma leitura só.
  useEffect(() => {
    if (!ativo || !eu.id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const depois = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; carregar(); }, 600); };
    const canais = [supabase.channel(`task-notify:${eu.id}`).on('broadcast', { event: 'task_notification' }, depois).subscribe()];
    if (eu.tenantId) canais.push(supabase.channel(`tasks-ping:${eu.tenantId}`).on('broadcast', { event: 'task_change' }, depois).subscribe());
    return () => {
      if (timer) clearTimeout(timer);
      canais.forEach((c) => supabase.removeChannel(c));
    };
  }, [ativo, eu.id, eu.tenantId, carregar]);

  const grupos = useMemo(() => {
    const amanha = somarDias(hoje, 1);
    const lista = tarefas ?? [];
    return {
      atrasadas: lista.filter((t) => { const d = diaPrazo(t); return !!d && d < hoje; }),
      hoje: lista.filter((t) => diaPrazo(t) === hoje),
      amanha: lista.filter((t) => diaPrazo(t) === amanha),
    };
  }, [tarefas, hoje]);

  const tirar = (id: string) => setTarefas((l) => (l ? l.filter((x) => x.id !== id) : l));

  const concluir = useCallback(async (t: TaskRow) => {
    tirar(t.id);
    const { erro: e } = await gravarTarefa(eu.tenantId, 'update_task', { task_id: t.id, status_category: 'done' });
    if (e) setErro(`Não concluí "${t.title}": ${e}`);
    carregar();
  }, [eu.tenantId, carregar]);

  const adiarParaAmanha = useCallback(async (t: TaskRow) => {
    const dia = somarDias(todayBrasilia(), 1);
    const { erro: e } = await gravarTarefa(eu.tenantId, 'update_task', { task_id: t.id, ...novoPrazo(t, dia) });
    if (e) setErro(`Não adiei "${t.title}": ${e}`);
    carregar();
  }, [eu.tenantId, carregar]);

  const marcarLida = useCallback(async (n: TaskNotificacao) => {
    if (n.is_read) return;
    setNotificacoes((l) => l.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    await gravarTarefa(eu.tenantId, 'mark_notification_read', { notification_id: n.id });
  }, [eu.tenantId]);

  return {
    eu, tarefas, grupos, notificacoes, erro, hoje, atualizadoEm, atualizando,
    carregando: ativo && tarefas === null && !erro,
    recarregar: carregar, concluir, adiarParaAmanha, marcarLida,
  };
}
