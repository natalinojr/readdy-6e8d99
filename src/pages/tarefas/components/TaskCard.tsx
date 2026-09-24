import { Flag, MessageSquare, CheckSquare, GitBranch, Repeat } from 'lucide-react';
import type { CampoCustom, TaskRow } from '../hooks/useTarefas';
import { responsaveis } from '../lib/responsaveis';
import AvataresResponsaveis from './AvataresResponsaveis';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { UsuarioOption } from '../lib/agrupamento';
import { rotuloRecorrencia, DICA_RECORRENCIA } from '../lib/recorrencia';
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
  /** Pílula de tarefa de vários dias: em que dia do período está (ex.: 2 de 5). */
  trecho?: { dia: number; total: number } | null;
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
  // Com horário: mostra a hora e fica "atrasada" assim que passa dela (não só no dia seguinte).
  const hora = task.due_has_time ? ` ${due.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
  const text = due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + hora;
  const passou = task.due_has_time ? due.getTime() < Date.now() : diffDays < 0;
  if (concluida) return { text, className: 'text-slate-400' };
  if (passou) return { text: diffDays === 0 ? `Hoje${hora}` : text, className: 'text-red-600 font-medium' };
  if (diffDays === 0) return { text: `Hoje${hora}`, className: 'text-amber-600 font-medium' };
  if (diffDays === 1) return { text: `Amanhã${hora}`, className: 'text-amber-500' };
  return { text, className: 'text-slate-500' };
}

export default function TaskCard({
  task, campos, usuarios, onOpen, onDragStart, onDragEnd, arrastando = false, variante = 'card', trecho = null,
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
        className={`px-1.5 py-0.5 rounded text-[11px] cursor-pointer border-l-2 transition flex items-center gap-1 min-w-0 ${
          trecho ? 'bg-indigo-50 hover:bg-indigo-100' : 'bg-white hover:bg-slate-50'
        } ${arrastando ? 'opacity-40' : ''} ${concluida ? 'text-slate-400 line-through' : 'text-slate-700'}`}
        style={{ borderLeftColor: prio && task.priority > 0 ? prio.color : trecho ? '#a5b4fc' : '#cbd5e1' }}
        title={trecho ? `${task.title} — dia ${trecho.dia} de ${trecho.total}` : task.title}
      >
        {trecho && trecho.dia > 1 && <span className="text-indigo-300 shrink-0">↳</span>}
        <span className="truncate flex-1">{task.title}</span>
        {trecho && <span className="text-[9px] text-indigo-400 shrink-0 no-underline">{trecho.dia}/{trecho.total}</span>}
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

      {trecho && (
        <p className="text-[11px] text-indigo-500 -mt-1 mb-2">Dia {trecho.dia} de {trecho.total}</p>
      )}

      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        {task.priority > 0 && prio && <Flag size={11} style={{ color: prio.color }} />}
        {task.recurrence?.freq && (
          <span title={`${rotuloRecorrencia(task.recurrence)}. ${DICA_RECORRENCIA}`}>
            <Repeat size={11} className="text-slate-400" />
          </span>
        )}
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
        {responsaveis(task).length > 0 && (
          <span className={due ? '' : 'ml-auto'}>
            <AvataresResponsaveis pessoas={responsaveis(task)} comNome={false} />
          </span>
        )}
      </div>
    </div>
  );
}
