import { useEffect, useState } from 'react';
import type { TaskRow } from '../hooks/useTarefas';

/** "1h 30m", "45m", "2h", "0m". Segundos só aparecem abaixo de 1 min com `comSegundos`. */
export function formatarDuracao(segundos: number, comSegundos = false): string {
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (comSegundos && h === 0 && m === 0) return `${s}s`;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Relógio do cronômetro rodando: "0:04:12". */
export function formatarRelogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Horas com uma casa, pt-BR: 5,5h. */
export function formatarHoras(minutos: number): string {
  const h = Math.round((minutos / 60) * 10) / 10;
  return `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
}

/**
 * Lê o que a pessoa digita e devolve minutos (ou null se não entendeu):
 * "1h30", "1h 30m", "1:30", "90m", "90", "1,5h", "2d" (dia = 8h).
 * Número solto = minutos (é o que cabe em "15", "30", "90").
 */
export function lerDuracao(texto: string): number | null {
  const t = texto.trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
  if (!t) return null;
  const relogio = t.match(/^(\d+):(\d{1,2})$/);
  if (relogio) return Number(relogio[1]) * 60 + Number(relogio[2]);
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  // [Nd][Nh][N(m|min)] — os minutos depois de "h" podem vir sem o "m" ("1h30").
  const m = t.match(/^(?:(\d+(?:\.\d+)?)d)?(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)(?:m|min)?)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const total = Number(m[1] ?? 0) * 8 * 60 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return Math.round(total);
}

/** Tempo registrado agora (trechos encerrados + o que está rodando), em segundos. */
export function segundosRegistrados(task: TaskRow, agoraMs: number): number {
  const rodando = task.timer_started_at ? Math.max(0, (agoraMs - new Date(task.timer_started_at).getTime()) / 1000) : 0;
  return (task.time_tracked_seconds ?? 0) + rodando;
}

/** `Date.now()` que atualiza a cada segundo enquanto `ativo` — pro cronômetro contar na tela. */
export function useAgora(ativo: boolean): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    setAgora(Date.now());
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ativo]);
  return agora;
}

export interface EstimativaEfetiva {
  /** Minutos que valem para a tarefa (null = sem estimativa). */
  minutos: number | null;
  /** true = veio da soma das subtarefas (a estimativa própria da tarefa é ignorada). */
  somada: boolean;
  /** true = a tarefa não tem tempo e vale o padrão do responsável (2026-09-29). */
  padrao?: boolean;
}

/** Regra do dono (2026-09-29): tarefa com subtarefas estimadas vale a SOMA delas
 *  (só as que têm estimativa; recursivo). Sem subtarefa estimada, vale a própria. */
export function estimativasEfetivas<T extends Pick<TaskRow, 'id' | 'parent_task_id' | 'time_estimate_minutes' | 'status_category'>>(
  tasks: T[],
  /** Padrão para tarefa sem tempo (ex.: o do responsável principal); null = nenhum. */
  padraoDe?: (task: T) => number | null,
): Map<string, EstimativaEfetiva> {
  const filhas = new Map<string, string[]>();
  const porId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) {
    // Subtarefa cancelada não soma (mesma regra da Carga).
    if (t.parent_task_id && porId.has(t.parent_task_id) && t.status_category !== 'cancelled') {
      filhas.set(t.parent_task_id, [...(filhas.get(t.parent_task_id) ?? []), t.id]);
    }
  }
  const memo = new Map<string, EstimativaEfetiva>();
  const calcular = (id: string, visitando: Set<string>): EstimativaEfetiva => {
    const pronto = memo.get(id);
    if (pronto) return pronto;
    const t = porId.get(id);
    const propria = t?.time_estimate_minutes || null;
    const padrao = !propria && t && padraoDe ? padraoDe(t) || null : null;
    if (visitando.has(id)) return { minutos: propria, somada: false }; // ciclo: não deveria existir
    visitando.add(id);
    let soma = 0;
    let algumaEstimada = false;
    for (const f of filhas.get(id) ?? []) {
      const e = calcular(f, visitando);
      if (e.minutos) { soma += e.minutos; algumaEstimada = true; }
    }
    visitando.delete(id);
    const r: EstimativaEfetiva = algumaEstimada ? { minutos: soma, somada: true }
      : propria ? { minutos: propria, somada: false }
      : padrao ? { minutos: padrao, somada: false, padrao: true }
      : { minutos: null, somada: false };
    memo.set(id, r);
    return r;
  };
  for (const t of tasks) calcular(t.id, new Set());
  return memo;
}
