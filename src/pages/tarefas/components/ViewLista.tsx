import { useState } from 'react';
import { Plus, Flag, MessageSquare, CheckSquare, GitBranch } from 'lucide-react';
import type { TaskList, TaskRow } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';

interface UsuarioOption {
  id: string;
  nome: string;
}

interface ViewListaProps {
  list: TaskList;
  tasks: TaskRow[];
  usuarios: UsuarioOption[];
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onOpenTask: (taskId: string) => void;
}

function dueLabel(task: TaskRow): { text: string; className: string } | null {
  if (!task.due_date) return null;
  const due = new Date(task.due_date);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDay.getTime() - hoje.getTime()) / 86400000);
  const isDone = task.status_category === 'done' || task.status_category === 'cancelled';
  const text = due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  if (isDone) return { text, className: 'text-slate-400' };
  if (diffDays < 0) return { text, className: 'text-red-600 font-medium' };
  if (diffDays === 0) return { text: 'Hoje', className: 'text-amber-600 font-medium' };
  if (diffDays === 1) return { text: 'Amanhã', className: 'text-amber-500' };
  return { text, className: 'text-slate-500' };
}

export default function ViewLista({ list, tasks, usuarios, write, onOpenTask }: ViewListaProps) {
  const [quickAdd, setQuickAdd] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<string | null>(null);

  const listTasks = tasks.filter((t) => t.list_id === list.id && !t.parent_task_id);

  const handleQuickAdd = async (statusId: string) => {
    const title = (quickAdd[statusId] ?? '').trim();
    if (!title) return;
    setAdding(statusId);
    await write('create_task', { list_id: list.id, title, status_id: statusId });
    setQuickAdd((prev) => ({ ...prev, [statusId]: '' }));
    setAdding(null);
  };

  return (
    <div className="space-y-6">
      {list.statuses.map((status) => {
        const grupo = listTasks.filter((t) => t.status_id === status.id);
        return (
          <div key={status.id}>
            {/* Cabeçalho do grupo */}
            <div className="flex items-center gap-2 mb-2">
              <span
                className="px-2 py-0.5 rounded-md text-xs font-semibold text-white"
                style={{ backgroundColor: status.color }}
              >
                {status.name}
              </span>
              <span className="text-xs text-slate-400">{grupo.length}</span>
            </div>

            {/* Linhas de tarefas */}
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {grupo.map((task) => {
                const due = dueLabel(task);
                const prio = PRIORIDADES.find((p) => p.value === task.priority);
                return (
                  <div
                    key={task.id}
                    onClick={() => onOpenTask(task.id)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer group"
                  >
                    {/* Toggle rápido: marcar como concluído */}
                    <input
                      type="checkbox"
                      checked={task.status_category === 'done'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        const target = e.target.checked
                          ? list.statuses.find((s) => s.category === 'done')
                          : list.statuses.find((s) => s.category !== 'done' && s.category !== 'cancelled');
                        if (target) write('update_task', { task_id: task.id, status_id: target.id });
                      }}
                      className="rounded-full border-slate-300 text-emerald-500 focus:ring-emerald-400"
                    />

                    <span className={`flex-1 text-sm truncate ${task.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                      {task.title}
                    </span>

                    {/* Metadados */}
                    <div className="flex items-center gap-2.5 text-xs text-slate-400 shrink-0">
                      {task.tags.map((tag) => (
                        <span key={tag.id} className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>
                          {tag.name}
                        </span>
                      ))}
                      {task.subtask_total > 0 && (
                        <span className="flex items-center gap-0.5"><GitBranch size={11} />{task.subtask_total}</span>
                      )}
                      {task.checklist_total > 0 && (
                        <span className="flex items-center gap-0.5"><CheckSquare size={11} />{task.checklist_done}/{task.checklist_total}</span>
                      )}
                      {task.comment_count > 0 && (
                        <span className="flex items-center gap-0.5"><MessageSquare size={11} />{task.comment_count}</span>
                      )}
                      {task.priority > 0 && prio && <Flag size={12} style={{ color: prio.color }} />}
                      {due && <span className={due.className}>{due.text}</span>}
                      {task.assignee_name && (
                        <span
                          className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-semibold"
                          title={task.assignee_name}
                        >
                          {task.assignee_name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Quick add */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleQuickAdd(status.id);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-slate-50/50"
              >
                <Plus size={14} className="text-slate-300" />
                <input
                  value={quickAdd[status.id] ?? ''}
                  onChange={(e) => setQuickAdd((prev) => ({ ...prev, [status.id]: e.target.value }))}
                  placeholder="Nova tarefa…"
                  disabled={adding === status.id}
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-300"
                />
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
}
