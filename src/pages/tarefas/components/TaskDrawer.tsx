import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Flag, CalendarDays, User as UserIcon, Tag, CheckSquare, Clock, Repeat, GitBranch, SlidersHorizontal, Paperclip, Download, ListChecks, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { CampoCustom, ChecklistTemplate, TaskAnexo, TaskDetail, TaskList, TaskTag } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { UsuarioOption } from '../lib/agrupamento';
import { camposDaLista } from '../lib/agrupamento';
import CampoInput from './campos/CampoInput';
import ComentarioInput from './ComentarioInput';

interface TaskDrawerProps {
  taskId: string;
  lists: TaskList[];
  tags: TaskTag[];
  campos: CampoCustom[];
  templates: ChecklistTemplate[];
  usuarios: UsuarioOption[];
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  fetchDetail: (taskId: string) => Promise<TaskDetail | null>;
  fetchAnexos: (taskId: string) => Promise<TaskAnexo[]>;
  enviarAnexo: (file: File, taskId: string) => Promise<{ success: boolean; error?: string }>;
  abrirAnexo: (attachmentId: string) => Promise<string | null>;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
}

function formatarTamanho(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const RECORRENCIAS: Array<{ value: string; label: string; rec: { freq: string; interval: number } | null }> = [
  { value: 'nenhuma', label: 'Não se repete', rec: null },
  { value: 'daily-1', label: 'Todo dia', rec: { freq: 'daily', interval: 1 } },
  { value: 'weekly-1', label: 'Toda semana', rec: { freq: 'weekly', interval: 1 } },
  { value: 'weekly-2', label: 'A cada 2 semanas', rec: { freq: 'weekly', interval: 2 } },
  { value: 'monthly-1', label: 'Todo mês', rec: { freq: 'monthly', interval: 1 } },
];

function chaveRecorrencia(rec: { freq?: string; interval?: number } | null): string {
  if (!rec?.freq) return 'nenhuma';
  return `${rec.freq}-${rec.interval ?? 1}`;
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

export default function TaskDrawer({
  taskId, lists, tags, campos, templates, usuarios,
  write, fetchDetail, fetchAnexos, enviarAnexo, abrirAnexo, onClose, onOpenTask,
}: TaskDrawerProps) {
  const toast = useToast();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [anexos, setAnexos] = useState<TaskAnexo[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [saving, setSaving] = useState(false);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [mostrarTemplates, setMostrarTemplates] = useState(false);

  const load = useCallback(async () => {
    const [d, a] = await Promise.all([fetchDetail(taskId), fetchAnexos(taskId)]);
    if (d) {
      setDetail(d);
      setTitle(d.title);
      setDescription(d.description ?? '');
    }
    setAnexos(a);
    setLoading(false);
  }, [taskId, fetchDetail, fetchAnexos]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const list = detail ? lists.find((l) => l.id === detail.list_id) : undefined;
  const statuses = list?.statuses ?? [];
  const camposVisiveis = detail ? camposDaLista(campos, detail.list_id) : [];

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
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-slate-500 flex items-center gap-1"><Repeat size={12} /> Recorrência</span>
              <select
                value={chaveRecorrencia(detail.recurrence)}
                onChange={(e) => {
                  const opcao = RECORRENCIAS.find((r) => r.value === e.target.value);
                  update({ recurrence: opcao?.rec ?? null });
                }}
                className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              >
                {RECORRENCIAS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {detail.recurrence?.freq && (
                <span className="text-[11px] text-slate-400">
                  Ao concluir, a próxima ocorrência é criada automaticamente.
                </span>
              )}
            </label>
          </div>

          {/* Campos personalizados */}
          {camposVisiveis.length > 0 && (
            <div>
              <span className="text-xs text-slate-500 flex items-center gap-1 mb-2">
                <SlidersHorizontal size={12} /> Campos personalizados
              </span>
              <div className="space-y-2.5">
                {camposVisiveis.map((campo) => (
                  <div key={campo.id} className="grid grid-cols-[110px_1fr] gap-2 items-start">
                    <span className="text-xs text-slate-500 pt-2 truncate" title={campo.name}>{campo.name}</span>
                    <CampoInput
                      campo={campo}
                      value={detail.field_values?.[campo.id]}
                      usuarios={usuarios}
                      onChange={async (value) => {
                        setSaving(true);
                        const res = await write('set_field_value', { task_id: taskId, field_id: campo.id, value });
                        setSaving(false);
                        if (!res.success) toast.error('Erro ao salvar campo', res.error);
                        else load();
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

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
            <div className="flex items-center justify-between mb-1.5 relative">
              <span className="text-xs text-slate-500">
                Checklist {detail.checklist.length > 0 && `(${detail.checklist.filter((c) => c.is_done).length}/${detail.checklist.length})`}
              </span>
              {templates.length > 0 && (
                <button
                  onClick={() => setMostrarTemplates((v) => !v)}
                  className="text-[11px] text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  <ListChecks size={12} /> Usar template
                </button>
              )}
              {mostrarTemplates && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMostrarTemplates(false)} />
                  <div className="absolute right-0 top-full mt-1 z-30 w-56 bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden">
                    {templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={async () => {
                          setMostrarTemplates(false);
                          const res = await write('apply_checklist_template', { task_id: taskId, template_id: tpl.id });
                          if (!res.success) toast.error('Erro ao aplicar template', res.error);
                          else load();
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-0"
                      >
                        <span className="text-xs text-slate-700 block">{tpl.name}</span>
                        <span className="text-[10px] text-slate-400">{tpl.items.length} itens</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
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

          {/* Anexos */}
          <div>
            <span className="text-xs text-slate-500 flex items-center gap-1 mb-1.5">
              <Paperclip size={12} /> Anexos {anexos.length > 0 && `(${anexos.length})`}
            </span>
            <div className="space-y-1">
              {anexos.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-200 group">
                  <Paperclip size={13} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-slate-700 truncate block">{a.file_name}</span>
                    <span className="text-[10px] text-slate-400">
                      {formatarTamanho(a.size_bytes)}
                      {a.uploaded_by_name && ` · ${a.uploaded_by_name}`}
                    </span>
                  </div>
                  <button
                    onClick={async () => {
                      const url = await abrirAnexo(a.id);
                      if (url) window.open(url, '_blank', 'noopener');
                      else toast.error('Não foi possível abrir o anexo');
                    }}
                    className="p-1 text-slate-400 hover:text-indigo-500"
                    title="Baixar"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Remover "${a.file_name}"?`)) return;
                      const res = await write('delete_attachment', { attachment_id: a.id });
                      if (!res.success) toast.error('Erro ao remover anexo', res.error);
                      else load();
                    }}
                    className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                    title="Remover"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 cursor-pointer px-2 py-1">
              {enviandoAnexo ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {enviandoAnexo ? 'Enviando…' : 'Anexar arquivo (até 10 MB)'}
              <input
                type="file"
                className="hidden"
                disabled={enviandoAnexo}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // permite reenviar o mesmo arquivo
                  if (!file) return;
                  setEnviandoAnexo(true);
                  const res = await enviarAnexo(file, taskId);
                  setEnviandoAnexo(false);
                  if (!res.success) toast.error('Erro ao anexar', res.error);
                  else load();
                }}
              />
            </label>
          </div>

          {/* Subtarefas (1 nível) */}
          {!detail.parent_task_id && (
            <div>
              <span className="text-xs text-slate-500 flex items-center gap-1 mb-1.5">
                <GitBranch size={12} /> Subtarefas {detail.subtasks.length > 0 && `(${detail.subtasks.length})`}
              </span>
              <div className="space-y-1">
                {detail.subtasks.map((sub) => (
                  <div
                    key={sub.id}
                    onClick={() => onOpenTask?.(sub.id)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        sub.status_category === 'done' ? 'bg-emerald-400' : 'bg-slate-300'
                      }`}
                    />
                    <span className={`text-sm flex-1 truncate ${sub.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-600'}`}>
                      {sub.title}
                    </span>
                    {sub.due_date && (
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {new Date(sub.due_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const t = newSubtask.trim();
                  if (!t || !detail) return;
                  setNewSubtask('');
                  const res = await write('create_task', {
                    list_id: detail.list_id,
                    title: t,
                    parent_task_id: taskId,
                  });
                  if (!res.success) toast.error('Erro ao criar subtarefa', res.error);
                  else load();
                }}
                className="flex items-center gap-2 mt-1.5 px-2"
              >
                <Plus size={14} className="text-slate-400" />
                <input
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  placeholder="Adicionar subtarefa…"
                  className="flex-1 text-sm outline-none py-1 border-b border-transparent focus:border-indigo-300"
                />
              </form>
            </div>
          )}

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
            <ComentarioInput
              usuarios={usuarios}
              onEnviar={async (body, mentions) => {
                const res = await write('add_comment', { task_id: taskId, body, mentions });
                if (!res.success) toast.error('Erro ao comentar', res.error);
                else load();
              }}
            />
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
