import type { TaskRow } from '../hooks/useTarefas';
import { diaLocal, somarDias } from './carga';

/** Limite de dias que uma tarefa ocupa no calendário (evita laço enorme com data errada). */
const MAX_DIAS = 366;

/** Chave local YYYY-MM-DD (evita o deslocamento de fuso do toISOString). */
export function chaveDia(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Em que ponto do período a tarefa está naquele dia (tarefa de vários dias). */
export interface TrechoPeriodo { dia: number; total: number }

export interface OcorrenciaDia { task: TaskRow; trecho: TrechoPeriodo | null }

/**
 * Dias (chave local) que a tarefa ocupa no calendário: do início ao vencimento.
 * Sem início, ou início depois do vencimento → só o dia do vencimento.
 */
export function diasDaTarefa(t: Pick<TaskRow, 'start_date' | 'due_date'>): string[] {
  if (!t.due_date) return [];
  const fim = diaLocal(t.due_date);
  if (!t.start_date) return [chaveDia(fim)];
  let atual = diaLocal(t.start_date);
  if (atual >= fim) return [chaveDia(fim)];
  const dias: string[] = [];
  while (atual <= fim && dias.length < MAX_DIAS) {
    dias.push(chaveDia(atual));
    atual = somarDias(atual, 1);
  }
  // Período maior que o limite: garante que o vencimento apareça.
  if (dias[dias.length - 1] !== chaveDia(fim)) dias.push(chaveDia(fim));
  return dias;
}

/**
 * Tarefas por dia. Tarefa de vários dias aparece em cada dia do período e vem
 * antes das de um dia só (ordenadas pelo início), pra ficar na mesma altura.
 */
export function tarefasPorDia(tasks: TaskRow[]): Map<string, OcorrenciaDia[]> {
  const mapa = new Map<string, OcorrenciaDia[]>();
  for (const t of tasks) {
    const dias = diasDaTarefa(t);
    dias.forEach((chave, i) => {
      const lista = mapa.get(chave) ?? [];
      lista.push({ task: t, trecho: dias.length > 1 ? { dia: i + 1, total: dias.length } : null });
      mapa.set(chave, lista);
    });
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => {
      const va = a.trecho ? 0 : 1;
      const vb = b.trecho ? 0 : 1;
      if (va !== vb) return va - vb;
      if (a.trecho && b.trecho) {
        const ia = a.task.start_date ?? '';
        const ib = b.task.start_date ?? '';
        if (ia !== ib) return ia.localeCompare(ib);
      }
      return (a.task.due_date ?? '').localeCompare(b.task.due_date ?? '');
    });
  }
  return mapa;
}

/** Diferença em dias entre duas chaves YYYY-MM-DD. */
export function diferencaDias(de: string, para: string): number {
  return Math.round((diaLocal(para).getTime() - diaLocal(de).getTime()) / 86400000);
}
