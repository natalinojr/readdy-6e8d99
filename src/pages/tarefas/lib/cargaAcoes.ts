import type { TaskRow } from '../hooks/useTarefas';
import { partesDoPrazo, prazoParaGravar } from '../components/EditorCelula';
import { SEM_RESPONSAVEL, chaveDia, diaLocal, somarDias, type Parcela } from './carga';
import { idsResponsaveis } from './responsaveis';

/**
 * Ações da Carga que viram UMA gravação (update_task): trocar a pessoa de uma
 * parcela e mover o trabalho de um dia pra outro. Puro, pra testar sem tela.
 */

/** Tira `de` dos responsáveis e põe `para` (vários responsáveis: só troca aquela pessoa). */
export function trocarPessoa(task: Pick<TaskRow, 'assignee_id' | 'assignees'>, de: string, para: string): string[] {
  const atuais = idsResponsaveis(task as TaskRow);
  const semDe = de === SEM_RESPONSAVEL ? atuais : atuais.filter((id) => id !== de);
  if (para === SEM_RESPONSAVEL) return semDe;
  return semDe.includes(para) ? semDe : [...semDe, para];
}

const diff = (de: string, para: string) =>
  Math.round((diaLocal(para).getTime() - diaLocal(de).getTime()) / 86400000);

/**
 * Mover o trabalho do dia `de` para o dia `para`:
 * - tarefa com horas por dia (time_plan): leva só os minutos daquele dia, e o
 *   início/vencimento se ajustam pra cobrir o plano;
 * - tarefa de um dia só: muda o vencimento (e o início junto);
 * - tarefa de vários dias sem plano: o período inteiro anda os mesmos dias.
 */
export function moverDia(
  task: Pick<TaskRow, 'start_date' | 'due_date' | 'due_has_time' | 'time_plan'>,
  de: string,
  para: string,
): Record<string, unknown> | null {
  if (!task.due_date || de === para) return null;
  const hora = task.due_has_time ? partesDoPrazo(task.due_date, true).hora : null;
  const plano = task.time_plan?.dias;
  if (plano && Object.keys(plano).length) {
    const minutos = plano[de] ?? 0;
    if (!minutos) return null;
    const dias: Record<string, number> = { ...plano };
    delete dias[de];
    dias[para] = (dias[para] ?? 0) + minutos;
    const chaves = Object.keys(dias).filter((k) => dias[k] > 0).sort();
    const primeiro = chaves[0];
    const ultimo = chaves[chaves.length - 1];
    return {
      time_plan: { dias },
      ...prazoParaGravar(ultimo, hora),
      start_date: primeiro === ultimo ? null : primeiro,
    };
  }
  const delta = diff(de, para);
  const novoFim = chaveDia(somarDias(diaLocal(task.due_date), delta));
  const payload: Record<string, unknown> = { ...prazoParaGravar(novoFim, hora) };
  if (task.start_date) payload.start_date = chaveDia(somarDias(diaLocal(task.start_date), delta));
  return payload;
}

export interface Sugestao {
  parcela: Parcela;
  para: string;
  /** Minutos que faltam da parcela (o que muda de dono). */
  minutos: number;
  /** Quanto sobra livre pra quem recebe depois de receber. */
  sobra: number;
}

/**
 * Dia estourado: quem pode receber o quê. Pega as parcelas abertas da pessoa no
 * dia (a maior primeiro) e, pra cada uma, a pessoa com mais folga que ainda cabe.
 * Até `limite` sugestões, sem repetir tarefa.
 */
export function sugerirRedistribuicao(
  parcelas: Parcela[],
  excesso: number,
  candidatos: string[],
  livreDe: (pessoa: string) => number,
  limite = 2,
): Sugestao[] {
  if (excesso <= 0) return [];
  const abertas = parcelas
    .filter((p) => !p.concluida && p.minutos - p.feitos > 1)
    .sort((a, b) => (b.minutos - b.feitos) - (a.minutos - a.feitos));
  const livres = new Map(candidatos.map((c) => [c, livreDe(c)]));
  const saida: Sugestao[] = [];
  let resolver = excesso;
  for (const p of abertas) {
    if (saida.length >= limite || resolver <= 0) break;
    const minutos = p.minutos - p.feitos;
    const [melhor] = [...livres.entries()]
      .filter(([, livre]) => livre >= minutos)
      .sort((a, b) => b[1] - a[1]);
    if (!melhor) continue;
    saida.push({ parcela: p, para: melhor[0], minutos, sobra: melhor[1] - minutos });
    livres.set(melhor[0], melhor[1] - minutos);
    resolver -= minutos;
  }
  return saida;
}
