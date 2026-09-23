import type { TaskRow } from '../hooks/useTarefas';

/**
 * Carga de trabalho: quanto de trabalho ESTIMADO cada pessoa tem por dia.
 *
 * Cada dia mostra o TOTAL planejado (inclusive tarefas já concluídas — pedido do
 * dono 2026-09-23) e quanto desse total já está FEITO:
 * - concluída: a estimativa inteira conta como feita, nos dias em que estava planejada;
 * - aberta: a estimativa inteira conta no total; o que já foi cronometrado é a parte feita.
 * Diferente do ClickUp, espalha entre início e prazo PROPORCIONAL à capacidade de
 * cada dia (sábado de meio período recebe metade de um dia cheio); tarefa aberta
 * atrasada não some — cai em "hoje", marcada; sem estimativa / sem prazo aparecem
 * como pendências à parte.
 */

/** Horas por dia da semana, índice 0 = domingo (igual a Date.getDay()). */
export type Capacidade = [number, number, number, number, number, number, number];

export const CAPACIDADE_PADRAO: Capacidade = [0, 8, 8, 8, 8, 8, 0];

export const SEM_RESPONSAVEL = '__sem_responsavel';

export interface Parcela {
  task: TaskRow;
  /** Minutos planejados pra esse dia. */
  minutos: number;
  /** Quanto desses minutos já está feito (concluída = tudo; aberta = proporção cronometrada). */
  feitos: number;
  atrasada: boolean;
  concluida: boolean;
}

export interface ResultadoCarga {
  /** pessoa → dia (YYYY-MM-DD) → parcelas do dia */
  porPessoa: Map<string, Map<string, Parcela[]>>;
  semEstimativa: TaskRow[];
  semData: TaskRow[];
  atrasadas: TaskRow[];
}

export function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' (date) ou ISO com hora (due_date ao meio-dia UTC) → dia local. */
export function diaLocal(valor: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split('-').map(Number);
    return new Date(a, m - 1, d);
  }
  const dt = new Date(valor);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function somarDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function minutosRestantes(task: TaskRow): number {
  if (!task.time_estimate_minutes) return 0;
  const feitos = Math.floor((task.time_tracked_seconds ?? 0) / 60);
  return Math.max(0, task.time_estimate_minutes - feitos);
}

export function calcularCarga(
  tasks: TaskRow[],
  hoje: Date,
  capacidadeDe: (pessoa: string) => Capacidade,
): ResultadoCarga {
  const porPessoa = new Map<string, Map<string, Parcela[]>>();
  const semEstimativa: TaskRow[] = [];
  const semData: TaskRow[] = [];
  const atrasadas: TaskRow[] = [];
  const hoje0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  for (const t of tasks) {
    if (t.status_category === 'cancelled') continue;
    const concluida = t.status_category === 'done';
    const estimativa = t.time_estimate_minutes ?? 0;
    if (!estimativa) { if (!concluida) semEstimativa.push(t); continue; }
    if (!t.due_date) { if (!concluida) semData.push(t); continue; }

    const pessoa = t.assignee_id ?? SEM_RESPONSAVEL;
    const prazo = diaLocal(t.due_date);
    const atrasada = !concluida && prazo < hoje0;
    if (atrasada) atrasadas.push(t);
    // Fração já feita: concluída = 1; aberta = cronometrado ÷ estimado (até 1).
    const fracaoFeita = concluida ? 1 : Math.min(1, (estimativa - minutosRestantes(t)) / estimativa);

    // Plano por dia definido na tarefa: usa exatamente os minutos de cada dia.
    const plano = t.time_plan?.dias ? Object.entries(t.time_plan.dias).filter(([, m]) => m > 0) : [];
    if (plano.length) {
      const mapaP = porPessoa.get(pessoa) ?? new Map<string, Parcela[]>();
      porPessoa.set(pessoa, mapaP);
      for (const [dia, minutos] of plano) {
        const lista = mapaP.get(dia) ?? [];
        lista.push({ task: t, minutos, feitos: minutos * fracaoFeita, atrasada, concluida });
        mapaP.set(dia, lista);
      }
      continue;
    }

    let inicio = t.start_date ? diaLocal(t.start_date) : prazo;
    if (inicio > prazo) inicio = prazo;
    let fim = prazo;
    // Concluída fica onde estava planejada (é histórico). Aberta não planeja o
    // passado: começa hoje, e a atrasada cai inteira em hoje.
    if (!concluida) {
      if (inicio < hoje0) inicio = hoje0;
      if (fim < hoje0) fim = hoje0;
    }

    const cap = capacidadeDe(pessoa);
    const dias: Array<{ chave: string; peso: number }> = [];
    for (let d = inicio; d <= fim; d = somarDias(d, 1)) dias.push({ chave: chaveDia(d), peso: cap[d.getDay()] });
    let pesoTotal = dias.reduce((s, d) => s + d.peso, 0);
    // Nenhum dia útil no intervalo (ex.: prazo num domingo de folga): divide igual.
    if (pesoTotal === 0) { dias.forEach((d) => { d.peso = 1; }); pesoTotal = dias.length; }

    const mapa = porPessoa.get(pessoa) ?? new Map<string, Parcela[]>();
    porPessoa.set(pessoa, mapa);
    for (const d of dias) {
      if (d.peso === 0) continue;
      const minutos = (estimativa * d.peso) / pesoTotal;
      const lista = mapa.get(d.chave) ?? [];
      lista.push({ task: t, minutos, feitos: minutos * fracaoFeita, atrasada, concluida });
      mapa.set(d.chave, lista);
    }
  }
  return { porPessoa, semEstimativa, semData, atrasadas };
}

export function minutosNoDia(r: ResultadoCarga, pessoa: string, dia: string): number {
  return (r.porPessoa.get(pessoa)?.get(dia) ?? []).reduce((s, p) => s + p.minutos, 0);
}

export function feitosNoDia(r: ResultadoCarga, pessoa: string, dia: string): number {
  return (r.porPessoa.get(pessoa)?.get(dia) ?? []).reduce((s, p) => s + p.feitos, 0);
}

// ── Capacidade antiga no localStorage ──
// Até 2026-09-23 as horas ficavam só no navegador de quem configurava. Hoje
// ficam no banco (task_user_capacity); isto só serve pra levar o que já tinha
// sido configurado pro banco na primeira vez que a Carga abre.
const CHAVE_CAPACIDADE_LOCAL = 'erpos_tarefas_capacidade';

export function capacidadesLocaisAntigas(): Record<string, Capacidade> {
  try {
    const obj = JSON.parse(localStorage.getItem(CHAVE_CAPACIDADE_LOCAL) ?? '{}');
    return obj && typeof obj === 'object' ? obj as Record<string, Capacidade> : {};
  } catch {
    return {};
  }
}

export function esquecerCapacidadesLocais(ids: string[]): void {
  try {
    const resto = capacidadesLocaisAntigas();
    for (const id of ids) delete resto[id];
    if (Object.keys(resto).length) localStorage.setItem(CHAVE_CAPACIDADE_LOCAL, JSON.stringify(resto));
    else localStorage.removeItem(CHAVE_CAPACIDADE_LOCAL);
  } catch {
    /* sem localStorage */
  }
}
