import { Flag, MessageSquare, CheckSquare, GitBranch, Repeat } from 'lucide-react';
import type { CampoCustom, TaskRow } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { UsuarioOption } from '../lib/agrupamento';
import CampoBadge from './campos/CampoBadge';

interface TaskCardProps {
  task: TaskRow;
  campos: CampoCustom[];
  usuarios: UsuarioOption[];
  onOpen: (taskId: string) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  arrastando?: boolean;
  /** Kanban usa card completo; calendário usa uma pílula de uma linha. */
  variante?: 'card' | 'pill';
}

export function iniciais(nome: string): string {
  return nome.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

/** Rótulo e cor do vencimento — vermelho atrasado, âmbar hoje/amanhã. */
export function rotuloVencimento(task: TaskRow): { text: string; className: string } | null {
  if (!task.due_date) return null;
  const due = new Date(task.due_date);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDay.getTime() - hoje.getTime()) / 86400000);
  const concluida = task.status_category === 'done' || task.status_category === 'cancelled';
  const text = due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  if (concluida) return { text, className: 'text-slate-400' };
  if (diffDays < 0) return { text, className: 'text-red-600 font-medium' };
  if (diffDays === 0) return { text: 'Hoje', className: 'text-amber-600 font-medium' };
  if (diffDays === 1) return { text: 'Amanhã', className: 'text-amber-500' };
  return { text, className: 'text-slate-500' };
}

export default function TaskCard({
  task, campos, usuarios, onOpen, onDragStart, onDragEnd, arrastando = false, variante = 'card',
}: TaskCardProps) {
  const due = rotuloVencimento(task);
  const prio = PRIORIDADES.find((p) => p.value === task.priority);
  const concluida = task.status_category === 'done' || task.status_category === 'cancelled';
  const camposNoCard = campos.filter((c) => c.show_on_card && task.field_values?.[c.id] != null);

  if (variante === 'pill') {
    return (
      <div
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          e.stopPropagation(); // a célula do calendário abaixo cria tarefa ao clicar
          onOpen(task.id);
        }}
        className={`px-1.5 py-0.5 rounded text-[11px] truncate cursor-pointer border-l-2 bg-white hover:bg-slate-50 transition ${
          arrastando ? 'opacity-40' : ''
        } ${concluida ? 'text-slate-400 line-through' : 'text-slate-700'}`}
        style={{ borderLeftColor: prio && task.priority > 0 ? prio.color : '#cbd5e1' }}
        title={task.title}
      >
        {task.title}
      </div>
    );
  }

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(task.id);
      }}
      className={`bg-white rounded-lg border border-slate-200 p-2.5 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition ${
        arrastando ? 'opacity-40' : ''
      }`}
    >
      {(task.tags.length > 0 || camposNoCard.length > 0) && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {task.tags.map((tag) => (
            <span
              key={tag.id}
              className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
            </span>
          ))}
          {camposNoCard.map((c) => (
            <CampoBadge key={c.id} campo={c} value={task.field_values[c.id]} usuarios={usuarios} compacto />
          ))}
        </div>
      )}

      <p className={`text-sm leading-snug mb-2 ${concluida ? 'line-through text-slate-400' : 'text-slate-700'}`}>
        {task.title}
      </p>

      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        {task.priority > 0 && prio && <Flag size={11} style={{ color: prio.color }} />}
        {task.recurrence?.freq && <Repeat size={11} className="text-slate-400" />}
        {task.checklist_total > 0 && (
          <span className="flex items-center gap-0.5">
            <CheckSquare size={11} />{task.checklist_done}/{task.checklist_total}
          </span>
        )}
        {task.subtask_total > 0 && (
          <span className="flex items-center gap-0.5"><GitBranch size={11} />{task.subtask_total}</span>
        )}
        {task.comment_count > 0 && (
          <span className="flex items-center gap-0.5"><MessageSquare size={11} />{task.comment_count}</span>
        )}
        {due && <span className={`ml-auto ${due.className}`}>{due.text}</span>}
        {task.assignee_name && (
          <span
            className={`w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[9px] font-semibold shrink-0 ${due ? '' : 'ml-auto'}`}
            title={task.assignee_name}
          >
            {iniciais(task.assignee_name)}
          </span>
        )}
      </div>
    </div>
  );
}
