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

export interface OcorrenciaDia {
  task: TaskRow;
  trecho: TrechoPeriodo | null;
  /** Tarefa de vários dias: linha fixa (mesma altura em todos os dias do período). */
  faixa?: number;
}

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
  // Faixas: cada tarefa de vários dias pega a menor linha livre em TODOS os seus dias.
  const multi = tasks
    .map((t) => ({ t, dias: diasDaTarefa(t) }))
    .filter((x) => x.dias.length > 1)
    .sort((a, b) => a.dias[0].localeCompare(b.dias[0]) || b.dias.length - a.dias.length);
  const ocupadas = new Map<string, Set<number>>();
  const faixaDe = new Map<string, number>();
  for (const { t, dias } of multi) {
    let f = 0;
    while (dias.some((d) => ocupadas.get(d)?.has(f))) f++;
    faixaDe.set(t.id, f);
    for (const d of dias) {
      const set = ocupadas.get(d) ?? new Set<number>();
      set.add(f);
      ocupadas.set(d, set);
    }
  }
  for (const lista of mapa.values()) {
    for (const o of lista) if (o.trecho) o.faixa = faixaDe.get(o.task.id);
    lista.sort((a, b) => {
      if (a.faixa !== undefined && b.faixa !== undefined) return a.faixa - b.faixa;
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

/**
 * Arrastar a ponta da tarefa no calendário. Devolve o que gravar (start_date e/ou
 * o dia do vencimento) ou um erro. Tarefa de um dia só vira período ao puxar uma ponta.
 */
export function ajustarPeriodo(
  t: Pick<TaskRow, 'start_date' | 'due_date'>,
  lado: 'inicio' | 'fim',
  chave: string,
): { start_date?: string | null; diaVencimento?: string; erro?: string } | null {
  if (!t.due_date) return null;
  const fim = chaveDia(diaLocal(t.due_date));
  const inicio = t.start_date ? chaveDia(diaLocal(t.start_date)) : null;
  if (lado === 'inicio') {
    if (chave > fim) return { erro: 'O início não pode ficar depois do vencimento.' };
    if (chave === (inicio ?? fim)) return null;
    return { start_date: chave === fim ? null : chave };
  }
  if (inicio && chave < inicio) return { erro: 'O vencimento não pode ficar antes do início.' };
  if (chave === fim) return null;
  // Um dia só puxado pra frente: o dia antigo vira o início.
  if (!inicio && chave > fim) return { start_date: fim, diaVencimento: chave };
  if (inicio && chave === inicio) return { start_date: null, diaVencimento: chave };
  return { diaVencimento: chave };
}

/**
 * Linhas de um dia na grade: tarefas de vários dias na sua faixa (com buraco
 * `null` onde a faixa está vazia naquele dia) e depois as de um dia só.
 */
export function linhasDoDia(lista: OcorrenciaDia[]): (OcorrenciaDia | null)[] {
  const linhas: (OcorrenciaDia | null)[] = [];
  for (const o of lista) {
    if (o.faixa === undefined) continue;
    while (linhas.length < o.faixa) linhas.push(null);
    linhas[o.faixa] = o;
  }
  return [...linhas, ...lista.filter((o) => o.faixa === undefined)];
}
