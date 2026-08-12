import { useState } from 'react';
import { Plus, Flag, MessageSquare, CheckSquare, GitBranch, Repeat, ChevronDown, ChevronRight } from 'lucide-react';
import type { CampoCustom, TaskList, TaskRow } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { GroupBy, UsuarioOption } from '../lib/agrupamento';
import { agruparTarefas, camposDaLista, payloadMoverGrupo } from '../lib/agrupamento';
import CampoBadge from './campos/CampoBadge';
import { iniciais, rotuloVencimento } from './TaskCard';

interface ViewListaProps {
  list: TaskList;
  tasks: TaskRow[];
  campos: CampoCustom[];
  usuarios: UsuarioOption[];
  groupBy: GroupBy;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onOpenTask: (taskId: string) => void;
}

export default function ViewLista({
  list, tasks, campos, usuarios, groupBy, write, onOpenTask,
}: ViewListaProps) {
  const [quickAdd, setQuickAdd] = useState<Record<string, string>>({});
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  // Só tarefas-raiz nos grupos; subtarefas aparecem aninhadas na sua tarefa-pai.
  const raizes = tasks.filter((t) => !t.parent_task_id);
  const grupos = agruparTarefas(raizes, groupBy, list, usuarios, campos);
  const colunas = camposDaLista(campos, list.id).filter((c) => c.show_on_card);

  const handleQuickAdd = async (chave: string, grupoKey: string | null) => {
    const title = (quickAdd[chave] ?? '').trim();
    if (!title) return;
    setQuickAdd((prev) => ({ ...prev, [chave]: '' }));

    const extras: Record<string, unknown> = {};
    if (groupBy === 'status' && grupoKey) extras.status_id = grupoKey;
    if (groupBy === 'priority' && grupoKey) extras.priority = Number(grupoKey);
    if (groupBy === 'assignee' && grupoKey) extras.assignee_id = grupoKey;

    const res = await write('create_task', { list_id: list.id, title, ...extras });
    if (res.success && res.id && groupBy.startsWith('field:') && grupoKey) {
      await write('set_field_value', {
        task_id: res.id,
        field_id: groupBy.slice('field:'.length),
        value: grupoKey,
      });
    }
  };

  const alternarConclusao = async (task: TaskRow, concluir: boolean) => {
    const destino = concluir
      ? list.statuses.find((s) => s.category === 'done')
      : list.statuses.find((s) => s.category !== 'done' && s.category !== 'cancelled');
    if (destino) await write('update_task', { task_id: task.id, status_id: destino.id });
  };

  const renderLinha = (task: TaskRow, nivel: number) => {
    const due = rotuloVencimento(task);
    const prio = PRIORIDADES.find((p) => p.value === task.priority);
    const concluida = task.status_category === 'done';
    const subtarefas = tasks.filter((t) => t.parent_task_id === task.id);
    const aberta = expandidas.has(task.id);

    return (
      <div key={task.id}>
        <div
          onClick={() => onOpenTask(task.id)}
          className="flex items-center gap-3 px-4 py-3.5 md:py-2.5 hover:bg-slate-50 active:bg-slate-100 cursor-pointer group"
          style={{ paddingLeft: `${16 + nivel * 22}px` }}
        >
          {subtarefas.length > 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpandidas((prev) => {
                  const p = new Set(prev);
                  if (p.has(task.id)) p.delete(task.id);
                  else p.add(task.id);
                  return p;
                });
              }}
              className="text-slate-300 hover:text-slate-500 -ml-1"
            >
              {aberta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            nivel === 0 && <span className="w-[13px] shrink-0" />
          )}

          <input
            type="checkbox"
            checked={concluida}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => alternarConclusao(task, e.target.checked)}
            className="rounded-full border-slate-300 text-emerald-500 focus:ring-emerald-400 shrink-0 w-5 h-5 md:w-4 md:h-4"
          />

          <span className={`flex-1 text-sm truncate ${concluida ? 'line-through text-slate-400' : 'text-slate-700'}`}>
            {task.title}
          </span>

          <div className="flex items-center gap-2.5 text-xs text-slate-400 shrink-0">
            {colunas.map((c) => (
              <CampoBadge key={c.id} campo={c} value={task.field_values?.[c.id]} usuarios={usuarios} />
            ))}
            {task.tags.map((tag) => (
              <span key={tag.id} className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>
                {tag.name}
              </span>
            ))}
            {task.recurrence?.freq && <Repeat size={11} />}
            {subtarefas.length > 0 && (
              <span className="flex items-center gap-0.5"><GitBranch size={11} />{subtarefas.length}</span>
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
                {iniciais(task.assignee_name)}
              </span>
            )}
          </div>
        </div>

        {aberta && subtarefas.map((sub) => renderLinha(sub, nivel + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {grupos.map((grupo) => {
        const chave = grupo.key ?? '__vazio';
        const recolhido = recolhidos.has(chave);
        const podeAdicionar = payloadMoverGrupo(groupBy, grupo.key) !== null || groupBy === 'status';

        return (
          <div key={chave}>
            <button
              onClick={() =>
                setRecolhidos((prev) => {
                  const p = new Set(prev);
                  if (p.has(chave)) p.delete(chave);
                  else p.add(chave);
                  return p;
                })
              }
              className="flex items-center gap-2 mb-2 group"
            >
              {recolhido ? <ChevronRight size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              <span
                className="px-2 py-0.5 rounded-md text-xs font-semibold text-white"
                style={{ backgroundColor: grupo.color }}
              >
                {grupo.label}
              </span>
              <span className="text-xs text-slate-400">{grupo.tasks.length}</span>
            </button>

            {!recolhido && (
              <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {grupo.tasks.map((task) => renderLinha(task, 0))}

                {podeAdicionar && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleQuickAdd(chave, grupo.key);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-50/50"
                  >
                    <Plus size={14} className="text-slate-300" />
                    <input
                      value={quickAdd[chave] ?? ''}
                      onChange={(e) => setQuickAdd((prev) => ({ ...prev, [chave]: e.target.value }))}
                      placeholder="Nova tarefa…"
                      className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-300"
                    />
                  </form>
                )}

                {grupo.tasks.length === 0 && !podeAdicionar && (
                  <p className="px-4 py-3 text-xs text-slate-300">Nenhuma tarefa</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
