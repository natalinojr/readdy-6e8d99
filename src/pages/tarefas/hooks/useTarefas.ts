import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, invokeWithAuth, uploadTaskAttachment } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface TaskStatus {
  id: string;
  name: string;
  color: string;
  category: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
  sort_order: number;
}

export interface TaskList {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
  /** Pasta-mãe — null = pasta raiz. Profundidade ilimitada. */
  parent_list_id: string | null;
  statuses: TaskStatus[];
  open_count: number;
}

export interface TaskTag {
  id: string;
  name: string;
  color: string;
}

export type CampoTipo =
  | 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'checkbox'
  | 'dropdown' | 'labels' | 'user' | 'rating' | 'url' | 'phone';

export interface CampoOpcao {
  id: string;
  label: string;
  color: string;
}

export interface CampoCustom {
  id: string;
  /** null = campo global do tenant (vale para todas as listas) */
  list_id: string | null;
  name: string;
  field_type: CampoTipo;
  options: CampoOpcao[];
  show_on_card: boolean;
  sort_order: number;
}

export const CAMPO_TIPOS: Array<{ value: CampoTipo; label: string; temOpcoes: boolean }> = [
  { value: 'text', label: 'Texto curto', temOpcoes: false },
  { value: 'textarea', label: 'Texto longo', temOpcoes: false },
  { value: 'number', label: 'Número', temOpcoes: false },
  { value: 'currency', label: 'Moeda (R$)', temOpcoes: false },
  { value: 'date', label: 'Data', temOpcoes: false },
  { value: 'checkbox', label: 'Caixa de seleção', temOpcoes: false },
  { value: 'dropdown', label: 'Lista suspensa', temOpcoes: true },
  { value: 'labels', label: 'Múltipla escolha', temOpcoes: true },
  { value: 'user', label: 'Pessoa', temOpcoes: false },
  { value: 'rating', label: 'Avaliação (1-5)', temOpcoes: false },
  { value: 'url', label: 'Link', temOpcoes: false },
  { value: 'phone', label: 'Telefone', temOpcoes: false },
];

export interface TaskRow {
  id: string;
  list_id: string;
  /** Nome/cor da lista — a lista em si só é carregada se eu for o dono; tarefas
   *  compartilhadas comigo vivem em listas de outra pessoa, então vêm embutidos aqui. */
  list_name: string | null;
  list_color: string | null;
  parent_task_id: string | null;
  title: string;
  status_id: string | null;
  status_category: TaskStatus['category'] | null;
  priority: number;
  assignee_id: string | null;
  assignee_name: string | null;
  start_date: string | null;
  due_date: string | null;
  due_has_time: boolean;
  sort_order: number;
  recurrence: { freq?: string; interval?: number } | null;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  tags: TaskTag[];
  checklist_total: number;
  checklist_done: number;
  subtask_total: number;
  comment_count: number;
  field_values: Record<string, unknown>;
}

export interface ChecklistItem {
  id: string;
  title: string;
  is_done: boolean;
  sort_order: number;
}

export interface TaskComment {
  id: string;
  user_id: string;
  user_name: string | null;
  body: string;
  created_at: string;
}

export interface TaskActivityEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskDetail {
  id: string;
  list_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status_id: string | null;
  priority: number;
  assignee_id: string | null;
  assignee_name: string | null;
  start_date: string | null;
  due_date: string | null;
  due_has_time: boolean;
  recurrence: { freq?: string; interval?: number } | null;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  tags: TaskTag[];
  checklist: ChecklistItem[];
  comments: TaskComment[];
  activity: TaskActivityEntry[];
  subtasks: Array<Pick<TaskRow, 'id' | 'title' | 'status_id' | 'status_category' | 'assignee_id' | 'due_date' | 'priority'>>;
  field_values: Record<string, unknown>;
}

export interface TaskNotificacao {
  id: string;
  type: 'assigned' | 'mentioned' | 'commented';
  task_id: string;
  task_title: string | null;
  actor_id: string | null;
  actor_name: string | null;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface TaskViewSalva {
  id: string;
  list_id: string | null;
  user_id: string | null;
  name: string;
  view_type: 'lista' | 'kanban' | 'calendario' | 'minhas';
  group_by: string;
  filters: Record<string, unknown>;
  is_shared: boolean;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  items: string[];
}

export interface TaskAnexo {
  id: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export const PRIORIDADES: Array<{ value: number; label: string; color: string }> = [
  { value: 0, label: 'Sem prioridade', color: '#94a3b8' },
  { value: 1, label: 'Baixa', color: '#64748b' },
  { value: 2, label: 'Média', color: '#3b82f6' },
  { value: 3, label: 'Alta', color: '#f59e0b' },
  { value: 4, label: 'Urgente', color: '#ef4444' },
];

// ─── Hook principal ───────────────────────────────────────────────────────────

export function useTarefas() {
  const { user } = useAuth();
  const toast = useToast();
  const tenantId = user?.tenantId ?? null;

  const [lists, setLists] = useState<TaskList[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [campos, setCampos] = useState<CampoCustom[]>([]);
  const [notificacoes, setNotificacoes] = useState<TaskNotificacao[]>([]);
  const [views, setViews] = useState<TaskViewSalva[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Reset na troca de loja: o tenantId em ref garante que respostas antigas não vazem
  const tenantRef = useRef(tenantId);
  tenantRef.current = tenantId;

  const reload = useCallback(async () => {
    if (!tenantId) return;
    const requestTenant = tenantId;
    try {
      const [listsRes, tasksRes, tagsRes, camposRes, notifRes, viewsRes, tplRes] = await Promise.all([
        supabase.rpc('fn_get_task_lists', { p_tenant_id: tenantId }),
        supabase.rpc('fn_get_tasks', { p_tenant_id: tenantId }),
        supabase.rpc('fn_get_task_tags', { p_tenant_id: tenantId }),
        supabase.rpc('fn_get_task_custom_fields', { p_tenant_id: tenantId }),
        supabase.rpc('fn_get_task_notifications', { p_tenant_id: tenantId }),
        supabase.rpc('fn_get_task_views', { p_tenant_id: tenantId }),
        supabase.rpc('fn_get_task_checklist_templates', { p_tenant_id: tenantId }),
      ]);
      if (tenantRef.current !== requestTenant) return; // trocou de loja no meio
      if (listsRes.error) throw listsRes.error;
      if (tasksRes.error) throw tasksRes.error;
      setLists((listsRes.data as TaskList[]) ?? []);
      setTasks((tasksRes.data as TaskRow[]) ?? []);
      setTags((tagsRes.data as TaskTag[]) ?? []);
      setCampos((camposRes.data as CampoCustom[]) ?? []);
      setNotificacoes((notifRes.data as TaskNotificacao[]) ?? []);
      setViews((viewsRes.data as TaskViewSalva[]) ?? []);
      setTemplates((tplRes.data as ChecklistTemplate[]) ?? []);
      setError(null);
    } catch (e) {
      console.error('[useTarefas] reload error:', e);
      setError(e instanceof Error ? e.message : 'Erro ao carregar tarefas');
    } finally {
      if (tenantRef.current === requestTenant) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    // Troca de loja: limpa estado antes de recarregar (pegadinha conhecida)
    setLists([]);
    setTasks([]);
    setTags([]);
    setCampos([]);
    setNotificacoes([]);
    setViews([]);
    setTemplates([]);
    setLoading(true);
    reload();
  }, [reload]);

  // Realtime: broadcast tasks-ping (trigger no banco)
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`tasks-ping:${tenantId}`)
      .on('broadcast', { event: 'task_change' }, () => {
        reload();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, reload]);

  // Realtime: notificações endereçadas a mim (canal por usuário)
  const meuId = user?.id ?? null;
  useEffect(() => {
    if (!meuId || !tenantId) return;
    const channel = supabase
      .channel(`task-notify:${meuId}`)
      .on('broadcast', { event: 'task_notification' }, async () => {
        const { data } = await supabase.rpc('fn_get_task_notifications', { p_tenant_id: tenantId });
        if (tenantRef.current === tenantId) setNotificacoes((data as TaskNotificacao[]) ?? []);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meuId, tenantId]);

  /**
   * Aplica um `update_task` localmente antes da resposta do servidor — o
   * checkbox de concluir, o arrasto no Kanban e a edição inline respondem na
   * hora em vez de esperar o reload completo. Se o servidor recusar, o
   * `reload()` do erro desfaz. Só cobre o que dá pra prever no cliente; o
   * resto (nome do responsável novo, contadores) o reload preenche depois.
   */
  const patchOtimista = useCallback((t: TaskRow, p: Record<string, unknown>): TaskRow => {
    const n: TaskRow = { ...t };
    const lista = lists.find((l) => l.id === (p.list_id as string | undefined ?? t.list_id));
    const aplicarStatus = (s: TaskStatus | null | undefined) => {
      if (!s) return;
      n.status_id = s.id;
      n.status_category = s.category;
      n.completed_at = s.category === 'done' ? new Date().toISOString() : null;
    };

    if (typeof p.title === 'string') n.title = p.title;
    if (p.priority !== undefined) n.priority = Number(p.priority);
    if (p.assignee_id !== undefined) {
      const novo = (p.assignee_id as string | null) ?? null;
      if (novo !== t.assignee_id) n.assignee_name = null; // o reload traz o nome
      n.assignee_id = novo;
    }
    if (p.due_date !== undefined) n.due_date = (p.due_date as string | null) ?? null;
    if (p.start_date !== undefined) n.start_date = (p.start_date as string | null) ?? null;
    if (p.due_has_time !== undefined) n.due_has_time = Boolean(p.due_has_time);
    if (p.sort_order !== undefined) n.sort_order = Number(p.sort_order);
    if (p.recurrence !== undefined) n.recurrence = (p.recurrence as TaskRow['recurrence']) ?? null;
    if (p.list_id !== undefined && lista) {
      n.list_id = lista.id;
      n.list_name = lista.name;
      n.list_color = lista.color;
    }
    if (Array.isArray(p.tag_ids)) {
      n.tags = (p.tag_ids as string[]).map((id) => tags.find((tg) => tg.id === id)).filter((x): x is TaskTag => !!x);
    }

    // Status: por id exato, por categoria (visões cross-pasta) ou "desmarcar".
    if (typeof p.status_id === 'string') {
      aplicarStatus(lista?.statuses.find((s) => s.id === p.status_id));
    } else if (typeof p.status_category === 'string') {
      const cat = p.status_category as TaskStatus['category'];
      const s = lista?.statuses.find((x) => x.category === cat);
      if (s) aplicarStatus(s);
      else { n.status_category = cat; n.completed_at = cat === 'done' ? new Date().toISOString() : null; } // pasta de outra pessoa
    } else if (p.status_action === 'undone') {
      const s = lista?.statuses.find((x) => x.category !== 'done' && x.category !== 'cancelled');
      if (s) aplicarStatus(s);
      else { n.status_category = 'todo'; n.completed_at = null; }
    }
    return n;
  }, [lists, tags]);

  const write = useCallback(
    async (action: string, payload: Record<string, unknown> = {}): Promise<{ success: boolean; id?: string; error?: string; next_occurrence_id?: string | null }> => {
      if (!tenantId) return { success: false, error: 'Sem loja ativa' };

      // Otimista: aplica antes de ir ao servidor. Erro abaixo chama reload() e desfaz.
      if (action === 'update_task' && typeof payload.task_id === 'string') {
        const id = payload.task_id;
        setTasks((prev) => prev.map((t) => (t.id === id ? patchOtimista(t, payload) : t)));
      } else if (action === 'delete_task' && typeof payload.task_id === 'string') {
        const id = payload.task_id;
        setTasks((prev) => prev.filter((t) => t.id !== id && t.parent_task_id !== id));
      }

      const { data, error: fnError } = await invokeWithAuth<{ success?: boolean; id?: string; error?: string; next_occurrence_id?: string | null }>('task-write', {
        body: { action, active_tenant_id: tenantId, ...payload },
      });
      if (fnError || !data?.success) {
        const msg = data?.error ?? fnError?.message ?? 'Erro desconhecido';
        console.error(`[useTarefas] ${action} falhou:`, msg);
        if (action === 'update_task' || action === 'delete_task') reload(); // desfaz o otimista
        return { success: false, error: msg };
      }

      // Tarefa recorrente concluída: o servidor já criou a próxima ocorrência.
      // Sem este aviso parece que a tarefa "duplicou" (mesmo título, nova data).
      if (action === 'update_task' && data.next_occurrence_id) {
        toast.success('Tarefa concluída', 'Por ser recorrente, a próxima ocorrência já foi criada com a nova data.');
      }

      // Mostra a tarefa nova na hora, sem esperar o reload completo (7 RPCs
      // em paralelo) nem o round-trip do broadcast do realtime — os dois
      // ainda rolam logo em seguida, mas só pra confirmar/completar campos
      // (responsável, tags…), que já nascem vazios/óbvios mesmo.
      if (action === 'create_task' && data.id) {
        const listId = payload.list_id as string;
        const lista = lists.find((l) => l.id === listId);
        const statusId = (payload.status_id as string | undefined) ?? lista?.statuses[0]?.id ?? null;
        const status = lista?.statuses.find((s) => s.id === statusId) ?? null;
        const otimista: TaskRow = {
          id: data.id,
          list_id: listId,
          list_name: lista?.name ?? null,
          list_color: lista?.color ?? null,
          parent_task_id: (payload.parent_task_id as string | undefined) ?? null,
          title: String(payload.title ?? ''),
          status_id: statusId,
          status_category: status?.category ?? null,
          priority: Number(payload.priority ?? 0),
          assignee_id: (payload.assignee_id as string | undefined) ?? null,
          assignee_name: null,
          start_date: (payload.start_date as string | undefined) ?? null,
          due_date: (payload.due_date as string | undefined) ?? null,
          due_has_time: Boolean(payload.due_has_time),
          sort_order: Number(payload.sort_order ?? Date.now()),
          recurrence: (payload.recurrence as TaskRow['recurrence']) ?? null,
          completed_at: null,
          created_at: new Date().toISOString(),
          created_by: user?.id ?? null,
          tags: [],
          checklist_total: 0,
          checklist_done: 0,
          subtask_total: 0,
          comment_count: 0,
          field_values: {},
        };
        setTasks((prev) => [...prev, otimista]);
      }

      // Recarrega em background (o broadcast também dispara, mas garante consistência)
      reload();
      return { success: true, id: data.id, next_occurrence_id: data.next_occurrence_id ?? null };
    },
    [tenantId, reload, lists, user?.id, patchOtimista, toast],
  );

  const fetchDetail = useCallback(
    async (taskId: string): Promise<TaskDetail | null> => {
      if (!tenantId) return null;
      const { data, error: rpcError } = await supabase.rpc('fn_get_task_detail', {
        p_tenant_id: tenantId,
        p_task_id: taskId,
      });
      if (rpcError) {
        console.error('[useTarefas] fetchDetail error:', rpcError);
        return null;
      }
      return data as TaskDetail;
    },
    [tenantId],
  );

  // ── Anexos ──
  const fetchAnexos = useCallback(
    async (taskId: string): Promise<TaskAnexo[]> => {
      if (!tenantId) return [];
      const { data, error: rpcError } = await supabase.rpc('fn_get_task_attachments', {
        p_tenant_id: tenantId,
        p_task_id: taskId,
      });
      if (rpcError) {
        console.error('[useTarefas] fetchAnexos error:', rpcError);
        return [];
      }
      return (data as TaskAnexo[]) ?? [];
    },
    [tenantId],
  );

  const enviarAnexo = useCallback(
    async (file: File, taskId: string): Promise<{ success: boolean; error?: string }> => {
      if (!tenantId) return { success: false, error: 'Sem loja ativa' };
      const { id, error: upError } = await uploadTaskAttachment(file, tenantId, taskId);
      if (upError || !id) return { success: false, error: upError?.message ?? 'Falha no upload' };
      return { success: true };
    },
    [tenantId],
  );

  /** Bucket privado: a URL de download é assinada sob demanda (1h). */
  const abrirAnexo = useCallback(
    async (attachmentId: string): Promise<string | null> => {
      if (!tenantId) return null;
      const { data } = await invokeWithAuth<{ success?: boolean; url?: string }>('task-write', {
        body: { action: 'sign_attachment', active_tenant_id: tenantId, attachment_id: attachmentId },
      });
      return data?.url ?? null;
    },
    [tenantId],
  );

  return {
    lists, tasks, tags, campos, notificacoes, views, templates,
    loading, error, reload, write, fetchDetail,
    fetchAnexos, enviarAnexo, abrirAnexo,
  };
}
