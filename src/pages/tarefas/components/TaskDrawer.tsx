import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Send, Flag, CalendarDays, User as UserIcon, Tag, CheckSquare, Clock } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { TaskDetail, TaskList, TaskTag } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';

interface UsuarioOption {
  id: string;
  nome: string;
}

interface TaskDrawerProps {
  taskId: string;
  lists: TaskList[];
  tags: TaskTag[];
  usuarios: UsuarioOption[];
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  fetchDetail: (taskId: string) => Promise<TaskDetail | null>;
  onClose: () => void;
}

const ACTIVITY_LABEL: Record<string, string> = {
  created: 'criou a tarefa',
  status_changed: 'mudou o status',
  assignee_changed: 'mudou o responsável',
  due_date_changed: 'mudou o vencimento',
  priority_changed: 'mudou a prioridade',
  created_from_recurrence: 'criada por recorrência',
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function TaskDrawer({ taskId, lists, tags, usuarios, write, fetchDetail, onClose }: TaskDrawerProps) {
  const toast = useToast();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const d = await fetchDetail(taskId);
    if (d) {
      setDetail(d);
      setTitle(d.title);
      setDescription(d.description ?? '');
    }
    setLoading(false);
  }, [taskId, fetchDetail]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const list = detail ? lists.find((l) => l.id === detail.list_id) : undefined;
  const statuses = list?.statuses ?? [];

  const update = async (payload: Record<string, unknown>) => {
    setSaving(true);
    const res = await write('update_task', { task_id: taskId, ...payload });
    setSaving(false);
    if (!res.success) {
      toast.error('Erro ao salvar', res.error);
      return;
    }
    load();
  };

  const toggleTag = async (tagId: string) => {
    if (!detail) return;
    const current = detail.tags.map((t) => t.id);
    const next = current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId];
    await update({ tag_ids: next });
  };

  if (loading || !detail) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
        <div className="w-full max-w-xl bg-white h-full p-6" onClick={(e) => e.stopPropagation()}>
          <div className="animate-pulse space-y-4 mt-8">
            <div className="h-6 bg-slate-200 rounded w-2/3" />
            <div className="h-4 bg-slate-100 rounded w-1/2" />
            <div className="h-24 bg-slate-100 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-xl bg-white h-full flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: list?.color ?? '#94a3b8' }} />
            {list?.name ?? 'Lista'}
          </span>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-slate-400">salvando…</span>}
            <button
              onClick={async () => {
                if (!confirm('Arquivar esta tarefa?')) return;
                const res = await write('delete_task', { task_id: taskId });
                if (res.success) onClose();
              }}
              className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
              title="Arquivar tarefa"
            >
              <Trash2 size={16} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Título */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== detail.title && update({ title: title.trim() })}
            className="w-full text-lg font-semibold text-slate-800 outline-none border-b border-transparent focus:border-indigo-300 pb-1"
            placeholder="Título da tarefa"
          />

          {/* Propriedades */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 flex items-center gap-1"><CheckSquare size={12} /> Status</span>
              <select
                value={detail.status_id ?? ''}
                onChange={(e) => update({ status_id: e.target.value })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 flex items-center gap-1"><Flag size={12} /> Prioridade</span>
              <select
                value={detail.priority}
                onChange={(e) => update({ priority: Number(e.target.value) })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 flex items-center gap-1"><UserIcon size={12} /> Responsável</span>
              <select
                value={detail.assignee_id ?? ''}
                onChange={(e) => update({ assignee_id: e.target.value || null })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">Ninguém</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>{u.nome}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 flex items-center gap-1"><CalendarDays size={12} /> Vencimento</span>
              <input
                type="date"
                value={detail.due_date ? detail.due_date.slice(0, 10) : ''}
                onChange={(e) => update({ due_date: e.target.value ? `${e.target.value}T12:00:00Z` : null })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              />
            </label>
          </div>

          {/* Tags */}
          <div>
            <span className="text-xs text-slate-500 flex items-center gap-1 mb-1.5"><Tag size={12} /> Etiquetas</span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const active = detail.tags.some((dt) => dt.id === t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTag(t.id)}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium border transition ${active ? 'text-white' : 'text-slate-500 bg-white border-slate-200 hover:border-slate-300'}`}
                    style={active ? { backgroundColor: t.color, borderColor: t.color } : undefined}
                  >
                    {t.name}
                  </button>
                );
              })}
              {tags.length === 0 && <span className="text-xs text-slate-400">Nenhuma etiqueta criada ainda</span>}
            </div>
          </div>

          {/* Descrição */}
          <div>
            <span className="text-xs text-slate-500 block mb-1.5">Descrição</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => (description || null) !== (detail.description ?? null) && update({ description: description || null })}
              rows={4}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y outline-none focus:border-indigo-300"
              placeholder="Adicione detalhes, instruções, links…"
            />
          </div>

          {/* Checklist */}
          <div>
            <span className="text-xs text-slate-500 block mb-1.5">
              Checklist {detail.checklist.length > 0 && `(${detail.checklist.filter((c) => c.is_done).length}/${detail.checklist.length})`}
            </span>
            <div className="space-y-1">
              {detail.checklist.map((item) => (
                <div key={item.id} className="flex items-center gap-2 group">
                  <input
                    type="checkbox"
                    checked={item.is_done}
                    onChange={(e) => write('update_checklist_item', { item_id: item.id, is_done: e.target.checked }).then(load)}
                    className="rounded border-slate-300"
                  />
                  <span className={`text-sm flex-1 ${item.is_done ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.title}</span>
                  <button
                    onClick={() => write('delete_checklist_item', { item_id: item.id }).then(load)}
                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newChecklistItem.trim()) return;
                await write('add_checklist_item', { task_id: taskId, title: newChecklistItem.trim() });
                setNewChecklistItem('');
                load();
              }}
              className="flex items-center gap-2 mt-1.5"
            >
              <Plus size={14} className="text-slate-400" />
              <input
                value={newChecklistItem}
                onChange={(e) => setNewChecklistItem(e.target.value)}
                placeholder="Adicionar item…"
                className="flex-1 text-sm outline-none py-1 border-b border-transparent focus:border-indigo-300"
              />
            </form>
          </div>

          {/* Comentários */}
          <div>
            <span className="text-xs text-slate-500 block mb-1.5">Comentários</span>
            <div className="space-y-2.5">
              {detail.comments.map((c) => (
                <div key={c.id} className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-slate-600">{c.user_name ?? 'Usuário'}</span>
                    <span className="text-[10px] text-slate-400">{fmtDateTime(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newComment.trim()) return;
                await write('add_comment', { task_id: taskId, body: newComment.trim() });
                setNewComment('');
                load();
              }}
              className="flex items-center gap-2 mt-2"
            >
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Escrever comentário…"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300"
              />
              <button type="submit" className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40" disabled={!newComment.trim()}>
                <Send size={14} />
              </button>
            </form>
          </div>

          {/* Atividade */}
          {detail.activity.length > 0 && (
            <div>
              <span className="text-xs text-slate-500 flex items-center gap-1 mb-1.5"><Clock size={12} /> Atividade</span>
              <div className="space-y-1">
                {detail.activity.slice(0, 10).map((a) => (
                  <div key={a.id} className="text-xs text-slate-400 flex items-center gap-1.5">
                    <span className="font-medium text-slate-500">{a.user_name ?? 'Sistema'}</span>
                    <span>{ACTIVITY_LABEL[a.action] ?? a.action}</span>
                    <span className="ml-auto">{fmtDateTime(a.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
