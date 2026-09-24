/**
 * Versão em memória do useTarefas pro modo demonstração (ver modoDemo.ts).
 * Mesmo formato de retorno; `write` aplica as ações principais do task-write
 * localmente pra dar pra criar, editar, concluir e cronometrar de verdade.
 */
import { useCallback, useRef, useState } from 'react';
import type {
  ChecklistItem, TaskAnexo, TaskComment, TaskDetail, TaskList, TaskRow, TaskStatus, TaskTag,
} from '../hooks/useTarefas';
import { EU_DEMO, USUARIOS_DEMO } from './modoDemo';

const STATUS = (listId: string): TaskStatus[] => [
  { id: `${listId}-todo`, name: 'A fazer', color: '#94a3b8', category: 'todo', sort_order: 0 },
  { id: `${listId}-doing`, name: 'Em andamento', color: '#3b82f6', category: 'in_progress', sort_order: 1 },
  { id: `${listId}-done`, name: 'Concluído', color: '#22c55e', category: 'done', sort_order: 2 },
];

const LISTAS: TaskList[] = [
  { id: 'cozinha', name: 'Cozinha', color: '#f59e0b', icon: null, sort_order: 0, parent_list_id: null, statuses: STATUS('cozinha'), open_count: 0, access: 'owner', owner_id: EU_DEMO.id, owner_name: EU_DEMO.nome, share_count: 1 },
  { id: 'compras', name: 'Compras da semana', color: '#10b981', icon: null, sort_order: 1, parent_list_id: 'cozinha', statuses: STATUS('compras'), open_count: 0, access: 'owner', owner_id: EU_DEMO.id, owner_name: EU_DEMO.nome, share_count: 0 },
  { id: 'manut', name: 'Manutenção', color: '#6366f1', icon: null, sort_order: 2, parent_list_id: null, statuses: STATUS('manut'), open_count: 0, access: 'owner', owner_id: EU_DEMO.id, owner_name: EU_DEMO.nome, share_count: 0 },
];

const TAGS: TaskTag[] = [
  { id: 'tag-urg', name: 'Urgente', color: '#ef4444' },
  { id: 'tag-forn', name: 'Fornecedor', color: '#0ea5e9' },
  { id: 'tag-limp', name: 'Limpeza', color: '#8b5cf6' },
];

function dia(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const prazo = (offset: number) => `${dia(offset)}T12:00:00Z`;
const nome = (id: string | null) => USUARIOS_DEMO.find((u) => u.id === id)?.nome ?? null;

let seq = 100;
function tarefa(p: Partial<TaskRow> & { id: string; list_id: string; title: string }): TaskRow {
  const lista = LISTAS.find((l) => l.id === p.list_id)!;
  const status = lista.statuses[0];
  const t: TaskRow = {
    list_name: lista.name, list_color: lista.color, parent_task_id: null, status_id: status.id,
    status_category: status.category, priority: 0, assignee_id: null, assignee_name: null, start_date: null,
    due_date: null, due_has_time: false, sort_order: seq++, recurrence: null, completed_at: null,
    created_at: new Date().toISOString(), created_by: EU_DEMO.id, tags: [], checklist_total: 0, checklist_done: 0,
    subtask_total: 0, comment_count: 0, field_values: {}, time_estimate_minutes: null, time_tracked_seconds: 0,
    timer_started_at: null, time_plan: null,
    ...p,
  };
  t.assignee_name = p.assignee_name ?? nome(p.assignee_id ?? null);
  return t;
}

function inicial(): TaskRow[] {
  return [
    tarefa({ id: 't1', list_id: 'cozinha', title: 'Trocar o óleo da fritadeira', assignee_id: 'demo-eu', due_date: prazo(0), priority: 3, time_estimate_minutes: 45, tags: [TAGS[0]] }),
    tarefa({ id: 't2', list_id: 'cozinha', title: 'Conferir validade dos molhos', assignee_id: 'demo-ana', due_date: prazo(-1), priority: 2, time_estimate_minutes: 30 }),
    tarefa({ id: 't3', list_id: 'cozinha', title: 'Limpeza pesada da coifa', assignee_id: 'demo-bruno', start_date: dia(1), due_date: prazo(3), time_estimate_minutes: 360, tags: [TAGS[2]], status_id: 'cozinha-doing', status_category: 'in_progress', time_tracked_seconds: 5400 }),
    tarefa({ id: 't4', list_id: 'cozinha', title: 'Treinar equipe no novo prato do cardápio', assignee_id: 'demo-eu', due_date: prazo(5), time_estimate_minutes: 120, priority: 1 }),
    tarefa({ id: 't5', list_id: 'cozinha', title: 'Organizar câmara fria', assignee_id: 'demo-carla', due_date: prazo(-3), status_id: 'cozinha-done', status_category: 'done', completed_at: new Date().toISOString(), time_estimate_minutes: 60, time_tracked_seconds: 3600 }),
    tarefa({ id: 't6', list_id: 'compras', title: 'Pedir carne do fornecedor', assignee_id: 'demo-eu', due_date: prazo(1), tags: [TAGS[1]], time_estimate_minutes: 20, checklist_total: 3, checklist_done: 1 }),
    tarefa({ id: 't7', list_id: 'compras', title: 'Cotar embalagens de delivery', assignee_id: 'demo-ana', due_date: prazo(2), tags: [TAGS[1]], comment_count: 2 }),
    tarefa({ id: 't8', list_id: 'manut', title: 'Chamar técnico do ar-condicionado', assignee_id: 'demo-eu', due_date: prazo(0), priority: 4, tags: [TAGS[0]], time_estimate_minutes: 15 }),
    tarefa({ id: 't9', list_id: 'manut', title: 'Trocar lâmpadas do salão', assignee_id: 'demo-bruno', due_date: prazo(4), time_estimate_minutes: 90 }),
    tarefa({ id: 't10', list_id: 'manut', title: 'Revisar extintores (vencimento em novembro)', assignee_id: null, due_date: prazo(10), priority: 2 }),
    tarefa({ id: 't11', list_id: 'manut', title: 'Pintar a parede do banheiro', assignee_id: 'demo-carla' }),
    tarefa({ id: 't12', list_id: 'manut', title: 'Comprar tinta', parent_task_id: 't11', assignee_id: 'demo-carla', due_date: prazo(2) }),
  ];
}

interface Extra { description: string | null; checklist: ChecklistItem[]; comments: TaskComment[] }

export function useTarefasDemo() {
  const [tasks, setTasks] = useState<TaskRow[]>(inicial);
  const [lists, setLists] = useState<TaskList[]>(LISTAS);
  const [extras, setExtras] = useState<Record<string, Extra>>({
    t6: {
      description: 'Pedido da semana: 20kg de fraldinha, 10kg de peito de frango.',
      checklist: [
        { id: 'c1', title: 'Conferir estoque', is_done: true, sort_order: 0 },
        { id: 'c2', title: 'Mandar pedido no WhatsApp', is_done: false, sort_order: 1 },
        { id: 'c3', title: 'Confirmar entrega', is_done: false, sort_order: 2 },
      ],
      comments: [],
    },
  });

  // A janela da tarefa relê o detalhe logo depois de gravar: lê sempre o estado
  // mais novo (ref), e o write espera o React aplicar antes de responder.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const extrasRef = useRef(extras);
  extrasRef.current = extras;

  const extra = (id: string): Extra => extras[id] ?? { description: null, checklist: [], comments: [] };
  const mudarExtra = (id: string, f: (e: Extra) => Extra) => setExtras((prev) => ({ ...prev, [id]: f(prev[id] ?? { description: null, checklist: [], comments: [] }) }));
  const mudarTarefa = (id: string, f: (t: TaskRow) => TaskRow) => setTasks((prev) => prev.map((t) => (t.id === id ? f(t) : t)));

  const aplicar = useCallback(async (action: string, p: Record<string, unknown> = {}): Promise<{ success: boolean; id?: string; error?: string }> => {
    const id = p.task_id as string | undefined;
    switch (action) {
      case 'create_task': {
        const novo = tarefa({
          id: `n${seq}`, list_id: String(p.list_id), title: String(p.title ?? 'Nova tarefa'),
          parent_task_id: (p.parent_task_id as string) ?? null, assignee_id: (p.assignee_id as string) ?? null,
          due_date: (p.due_date as string) ?? null, priority: Number(p.priority ?? 0),
        });
        if (p.status_id) {
          const st = lists.find((l) => l.id === novo.list_id)?.statuses.find((s) => s.id === p.status_id);
          if (st) { novo.status_id = st.id; novo.status_category = st.category; }
        }
        setTasks((prev) => [...prev, novo]);
        return { success: true, id: novo.id };
      }
      case 'update_task': {
        mudarTarefa(id!, (t) => {
          const n: TaskRow = { ...t };
          for (const k of ['title', 'priority', 'assignee_id', 'start_date', 'due_date', 'due_has_time', 'sort_order', 'recurrence', 'time_estimate_minutes', 'time_plan', 'list_id'] as const) {
            if (p[k] !== undefined) (n as unknown as Record<string, unknown>)[k] = p[k];
          }
          if (p.assignee_id !== undefined) n.assignee_name = nome(p.assignee_id as string | null);
          if (Array.isArray(p.tag_ids)) n.tags = TAGS.filter((tg) => (p.tag_ids as string[]).includes(tg.id));
          const lista = lists.find((l) => l.id === n.list_id)!;
          const st = typeof p.status_id === 'string'
            ? lista.statuses.find((s) => s.id === p.status_id)
            : typeof p.status_category === 'string' ? lista.statuses.find((s) => s.category === p.status_category)
              : p.status_action === 'undone' ? lista.statuses[0] : undefined;
          if (st) { n.status_id = st.id; n.status_category = st.category; n.completed_at = st.category === 'done' ? new Date().toISOString() : null; }
          if (p.time_plan) n.time_estimate_minutes = Object.values((p.time_plan as { dias: Record<string, number> }).dias).reduce((a, b) => a + b, 0);
          return n;
        });
        if (typeof p.description !== 'undefined') mudarExtra(id!, (e) => ({ ...e, description: (p.description as string) ?? null }));
        return { success: true };
      }
      case 'delete_task':
        setTasks((prev) => prev.filter((t) => t.id !== id && t.parent_task_id !== id));
        return { success: true };
      case 'start_timer':
      case 'stop_timer': {
        const agora = Date.now();
        setTasks((prev) => prev.map((t) => {
          let n = t;
          if (t.timer_started_at) n = { ...t, timer_started_at: null, time_tracked_seconds: t.time_tracked_seconds + Math.round((agora - new Date(t.timer_started_at).getTime()) / 1000) };
          if (action === 'start_timer' && t.id === id) n = { ...n, timer_started_at: new Date(agora).toISOString() };
          return n;
        }));
        return { success: true };
      }
      case 'add_time_entry':
        mudarTarefa(id!, (t) => ({ ...t, time_tracked_seconds: Math.max(0, t.time_tracked_seconds + Number(p.minutes) * 60) }));
        return { success: true };
      case 'add_comment':
        mudarExtra(id!, (e) => ({ ...e, comments: [...e.comments, { id: `cm${seq++}`, user_id: EU_DEMO.id, user_name: EU_DEMO.nome, body: String(p.body), created_at: new Date().toISOString() }] }));
        mudarTarefa(id!, (t) => ({ ...t, comment_count: t.comment_count + 1 }));
        return { success: true };
      case 'add_checklist_item':
        mudarExtra(id!, (e) => ({ ...e, checklist: [...e.checklist, { id: `ci${seq++}`, title: String(p.title), is_done: false, sort_order: seq }] }));
        mudarTarefa(id!, (t) => ({ ...t, checklist_total: t.checklist_total + 1 }));
        return { success: true };
      case 'update_checklist_item':
      case 'delete_checklist_item': {
        const itemId = String(p.item_id);
        setExtras((prev) => {
          const novo = { ...prev };
          for (const [tid, e] of Object.entries(prev)) {
            if (!e.checklist.some((c) => c.id === itemId)) continue;
            const checklist = action === 'delete_checklist_item'
              ? e.checklist.filter((c) => c.id !== itemId)
              : e.checklist.map((c) => (c.id === itemId ? { ...c, is_done: Boolean(p.is_done) } : c));
            novo[tid] = { ...e, checklist };
            mudarTarefa(tid, (t) => ({ ...t, checklist_total: checklist.length, checklist_done: checklist.filter((c) => c.is_done).length }));
          }
          return novo;
        });
        return { success: true };
      }
      case 'create_list': {
        const novaId = `l${seq++}`;
        setLists((prev) => [...prev, { id: novaId, name: String(p.name), color: String(p.color ?? '#6366f1'), icon: null, sort_order: seq, parent_list_id: (p.parent_list_id as string) ?? null, statuses: STATUS(novaId), open_count: 0, access: 'owner', owner_id: EU_DEMO.id, owner_name: EU_DEMO.nome, share_count: 0 }]);
        return { success: true, id: novaId };
      }
      default:
        return { success: true }; // demais ações: aceitas sem efeito no demo
    }
  }, [lists]);

  const write = useCallback(async (action: string, p: Record<string, unknown> = {}) => {
    const res = await aplicar(action, p);
    await new Promise((r) => setTimeout(r, 50));
    return res;
  }, [aplicar]);

  const fetchDetail = useCallback(async (taskId: string): Promise<TaskDetail | null> => {
    const t = tasksRef.current.find((x) => x.id === taskId);
    if (!t) return null;
    const e = extrasRef.current[taskId] ?? extra(taskId);
    return {
      id: t.id, list_id: t.list_id, parent_task_id: t.parent_task_id, title: t.title, description: e.description,
      status_id: t.status_id, priority: t.priority, assignee_id: t.assignee_id, assignee_name: t.assignee_name,
      start_date: t.start_date, due_date: t.due_date, due_has_time: t.due_has_time, recurrence: t.recurrence,
      completed_at: t.completed_at, created_at: t.created_at, created_by: t.created_by, created_by_name: EU_DEMO.nome,
      tags: t.tags, checklist: e.checklist, comments: e.comments, activity: [],
      subtasks: tasksRef.current.filter((s) => s.parent_task_id === t.id).map((s) => ({
        id: s.id, title: s.title, status_id: s.status_id, status_category: s.status_category,
        assignee_id: s.assignee_id, due_date: s.due_date, priority: s.priority,
      })),
      field_values: t.field_values,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, extras]);

  const listasComContagem = lists.map((l) => ({
    ...l,
    open_count: tasks.filter((t) => t.list_id === l.id && !t.parent_task_id && t.status_category !== 'done').length,
  }));

  return {
    lists: listasComContagem, tasks, tags: TAGS, campos: [], notificacoes: [], views: [], templates: [],
    loading: false, error: null as string | null, reload: async () => {}, write, fetchDetail,
    fetchAnexos: async (): Promise<TaskAnexo[]> => [],
    enviarAnexo: async () => ({ success: false, error: 'Anexo não funciona no modo demonstração' }),
    abrirAnexo: async () => null,
  };
}
