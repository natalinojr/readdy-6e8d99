import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { CampoCustom, TaskList, TaskRow } from '../hooks/useTarefas';
import type { GroupBy, Grupo, UsuarioOption } from '../lib/agrupamento';
import { agruparTarefas, calcularSortOrder, payloadMoverGrupo } from '../lib/agrupamento';
import TaskCard from './TaskCard';

interface ViewKanbanProps {
  list: TaskList | null;
  tasks: TaskRow[];
  campos: CampoCustom[];
  usuarios: UsuarioOption[];
  groupBy: GroupBy;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onOpenTask: (taskId: string) => void;
}

interface Arrasto {
  taskId: string;
  origem: string | null;
}

export default function ViewKanban({
  list, tasks, campos, usuarios, groupBy, write, onOpenTask,
}: ViewKanbanProps) {
  const toast = useToast();
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const [alvoColuna, setAlvoColuna] = useState<string | null | undefined>(undefined);
  const [quickAdd, setQuickAdd] = useState<Record<string, string>>({});

  const grupos = agruparTarefas(tasks, groupBy, list, usuarios, campos);

  const soltarEm = async (grupo: Grupo, indiceDestino: number) => {
    if (!arrasto) return;
    const task = tasks.find((t) => t.id === arrasto.taskId);
    setArrasto(null);
    setAlvoColuna(undefined);
    if (!task) return;

    const mudouDeGrupo = arrasto.origem !== grupo.key;
    // Vizinhos no destino, ignorando a própria tarefa quando ela já está na coluna
    const destinoSemEla = grupo.tasks.filter((t) => t.id !== task.id);
    const anterior = destinoSemEla[indiceDestino - 1];
    const proxima = destinoSemEla[indiceDestino];
    const novoSort = calcularSortOrder(anterior, proxima);

    if (!mudouDeGrupo) {
      await write('update_task', { task_id: task.id, sort_order: novoSort });
      return;
    }

    const mov = payloadMoverGrupo(groupBy, grupo.key);
    if (!mov) {
      toast.error('Não é possível mover para esta coluna');
      return;
    }
    if (mov.action === 'set_field_value') {
      // Valor do campo e reordenação são escritas separadas
      const res = await write('set_field_value', { task_id: task.id, ...mov.patch });
      if (!res.success) {
        toast.error('Erro ao mover tarefa', res.error);
        return;
      }
      await write('update_task', { task_id: task.id, sort_order: novoSort });
      return;
    }
    const res = await write('update_task', { task_id: task.id, ...mov.patch, sort_order: novoSort });
    if (!res.success) toast.error('Erro ao mover tarefa', res.error);
  };

  const criarNaColuna = async (grupo: Grupo) => {
    const chave = grupo.key ?? '__vazio';
    const title = (quickAdd[chave] ?? '').trim();
    if (!title || !list) return;
    setQuickAdd((prev) => ({ ...prev, [chave]: '' }));

    const extras: Record<string, unknown> = {};
    if (groupBy === 'status' && grupo.key) extras.status_id = grupo.key;
    if (groupBy === 'priority' && grupo.key) extras.priority = Number(grupo.key);
    if (groupBy === 'assignee' && grupo.key) extras.assignee_id = grupo.key;

    const res = await write('create_task', { list_id: list.id, title, ...extras });
    if (!res.success) {
      toast.error('Erro ao criar tarefa', res.error);
      return;
    }
    // Agrupamento por campo custom: grava o valor depois de criar
    if (groupBy.startsWith('field:') && grupo.key && res.id) {
      await write('set_field_value', {
        task_id: res.id,
        field_id: groupBy.slice('field:'.length),
        value: grupo.key,
      });
    }
  };

  if (!list) return null;

  return (
    <div className="flex gap-3 items-start overflow-x-auto pb-4">
      {grupos.map((grupo) => {
        const chave = grupo.key ?? '__vazio';
        const destacada = alvoColuna === grupo.key && arrasto !== null;
        return (
          <div
            key={chave}
            onDragOver={(e) => {
              if (!arrasto) return;
              e.preventDefault();
              setAlvoColuna(grupo.key);
            }}
            onDrop={(e) => {
              e.preventDefault();
              soltarEm(grupo, grupo.tasks.length);
            }}
            className={`w-72 shrink-0 rounded-xl border transition ${
              destacada ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-200 bg-slate-100/60'
            }`}
          >
            {/* Cabeçalho da coluna */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: grupo.color }} />
              <span className="text-xs font-semibold text-slate-700 truncate">{grupo.label}</span>
              <span className="text-xs text-slate-400 ml-auto">{grupo.tasks.length}</span>
            </div>

            {/* Cards */}
            <div className="px-2 pb-2 space-y-1.5 min-h-[60px]">
              {grupo.tasks.map((task, i) => (
                <div
                  key={task.id}
                  onDragOver={(e) => {
                    if (!arrasto) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setAlvoColuna(grupo.key);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    soltarEm(grupo, i);
                  }}
                >
                  <TaskCard
                    task={task}
                    campos={campos}
                    usuarios={usuarios}
                    onOpen={onOpenTask}
                    arrastando={arrasto?.taskId === task.id}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      // Alguns navegadores exigem payload para iniciar o arrasto
                      e.dataTransfer.setData('text/plain', task.id);
                      setArrasto({ taskId: task.id, origem: grupo.key });
                    }}
                    onDragEnd={() => {
                      setArrasto(null);
                      setAlvoColuna(undefined);
                    }}
                  />
                </div>
              ))}

              {/* Quick add na coluna */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  criarNaColuna(grupo);
                }}
                className="flex items-center gap-1.5 px-1 pt-1"
              >
                <Plus size={13} className="text-slate-300 shrink-0" />
                <input
                  value={quickAdd[chave] ?? ''}
                  onChange={(e) => setQuickAdd((prev) => ({ ...prev, [chave]: e.target.value }))}
                  placeholder="Nova tarefa…"
                  className="flex-1 text-xs bg-transparent outline-none placeholder:text-slate-400 py-1"
                />
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
}
