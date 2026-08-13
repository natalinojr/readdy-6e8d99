import { useMemo } from 'react';
import { AlertCircle, Sun, CalendarRange, CalendarClock, Inbox, CheckCircle2 } from 'lucide-react';
import type { CampoCustom, TaskList, TaskRow } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { UsuarioOption } from '../lib/agrupamento';
import CampoBadge from './campos/CampoBadge';
import { iniciais } from './TaskCard';

interface MinhasTarefasProps {
  tasks: TaskRow[];
  lists: TaskList[];
  campos: CampoCustom[];
  usuarios: UsuarioOption[];
  meuId: string | null;
  /** true = só o que outra pessoa me atribuiu (tarefas de listas que não são minhas). */
  apenasCompartilhadas?: boolean;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onOpenTask: (taskId: string) => void;
}

type Balde = 'atrasadas' | 'hoje' | 'semana' | 'depois' | 'semData';

const BALDES: Array<{ id: Balde; label: string; icon: typeof Sun; cor: string }> = [
  { id: 'atrasadas', label: 'Atrasadas', icon: AlertCircle, cor: 'text-red-500' },
  { id: 'hoje', label: 'Hoje', icon: Sun, cor: 'text-amber-500' },
  { id: 'semana', label: 'Próximos 7 dias', icon: CalendarRange, cor: 'text-blue-500' },
  { id: 'depois', label: 'Mais tarde', icon: CalendarClock, cor: 'text-slate-400' },
  { id: 'semData', label: 'Sem data', icon: Inbox, cor: 'text-slate-400' },
];

function classificar(task: TaskRow): Balde {
  if (!task.due_date) return 'semData';
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const due = new Date(task.due_date);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - hoje.getTime()) / 86400000);
  if (diff < 0) return 'atrasadas';
  if (diff === 0) return 'hoje';
  if (diff <= 7) return 'semana';
  return 'depois';
}

export default function MinhasTarefas({
  tasks, lists, campos, usuarios, meuId, apenasCompartilhadas = false, write, onOpenTask,
}: MinhasTarefasProps) {
  // Cross-listas: só o que está atribuído a mim e ainda em aberto. Em
  // "Compartilhadas", só o que veio de uma lista de outra pessoa.
  const minhas = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.assignee_id === meuId &&
          t.status_category !== 'done' &&
          t.status_category !== 'cancelled' &&
          (!apenasCompartilhadas || t.created_by !== meuId),
      ),
    [tasks, meuId, apenasCompartilhadas],
  );

  const agrupadas = useMemo(() => {
    const mapa = new Map<Balde, TaskRow[]>();
    for (const t of minhas) {
      const b = classificar(t);
      const atual = mapa.get(b) ?? [];
      atual.push(t);
      mapa.set(b, atual);
    }
    for (const arr of mapa.values()) {
      arr.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
    }
    return mapa;
  }, [minhas]);

  // mark_done deixa o servidor resolver o status "feito" — tarefa compartilhada
  // vem de uma lista de outra pessoa, que não está em `lists` (só vejo as minhas).
  const concluir = async (task: TaskRow) => {
    await write('update_task', { task_id: task.id, mark_done: true });
  };

  if (!meuId) {
    return <p className="text-sm text-slate-400">Faça login para ver suas tarefas.</p>;
  }

  if (minhas.length === 0) {
    return (
      <div className="text-center py-16">
        <CheckCircle2 size={40} className="mx-auto text-emerald-300 mb-3" />
        <p className="text-sm text-slate-500">
          {apenasCompartilhadas ? 'Ninguém compartilhou uma tarefa com você ainda.' : 'Nada atribuído a você no momento.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {BALDES.map(({ id, label, icon: Icon, cor }) => {
        const grupo = agrupadas.get(id) ?? [];
        if (grupo.length === 0) return null;
        return (
          <div key={id}>
            <div className="flex items-center gap-1.5 mb-2">
              <Icon size={14} className={cor} />
              <span className="text-xs font-semibold text-slate-600">{label}</span>
              <span className="text-xs text-slate-400">{grupo.length}</span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {grupo.map((task) => {
                // Lista de outra pessoa não vem em `lists` (só vejo as minhas) —
                // nesse caso usa nome/cor que já vieram embutidos na tarefa.
                const lista = lists.find((l) => l.id === task.list_id);
                const nomeLista = lista?.name ?? task.list_name;
                const corLista = lista?.color ?? task.list_color ?? '#94a3b8';
                const prio = PRIORIDADES.find((p) => p.value === task.priority);
                const camposNoCard = campos.filter((c) => c.show_on_card && task.field_values?.[c.id] != null);
                return (
                  <div
                    key={task.id}
                    onClick={() => onOpenTask(task.id)}
                    className="flex items-center gap-3 px-4 py-3.5 md:py-2.5 hover:bg-slate-50 active:bg-slate-100 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => concluir(task)}
                      className="rounded-full border-slate-300 text-emerald-500 focus:ring-emerald-400 w-5 h-5 md:w-4 md:h-4 shrink-0"
                      title="Marcar como concluída"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 truncate">{task.title}</p>
                      {nomeLista && (
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: corLista }} />
                          {nomeLista}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs shrink-0">
                      {camposNoCard.map((c) => (
                        <CampoBadge key={c.id} campo={c} value={task.field_values[c.id]} usuarios={usuarios} />
                      ))}
                      {task.priority > 0 && prio && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ backgroundColor: prio.color }}>
                          {prio.label}
                        </span>
                      )}
                      {task.due_date && (
                        <span className={id === 'atrasadas' ? 'text-red-600 font-medium' : 'text-slate-500'}>
                          {new Date(task.due_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                        </span>
                      )}
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
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
