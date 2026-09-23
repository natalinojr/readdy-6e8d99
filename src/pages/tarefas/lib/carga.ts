import type { TaskRow } from '../hooks/useTarefas';

/**
 * Carga de trabalho: quanto de trabalho ESTIMADO cada pessoa tem por dia.
 *
 * Diferente do ClickUp (que joga a estimativa inteira no dia do prazo ou
 * espalha igual entre início e prazo), aqui:
 * - conta o que FALTA (estimativa − tempo já cronometrado), não a estimativa cheia;
 * - espalha entre início e prazo PROPORCIONAL à capacidade de cada dia da pessoa
 *   (sábado de meio período recebe metade do trabalho de um dia cheio);
 * - tarefa atrasada não some: o que falta dela cai em "hoje", marcada como atrasada;
 * - sem estimativa / sem prazo / sem responsável aparecem como pendências à parte,
 *   em vez de ficarem invisíveis.
 */

/** Horas por dia da semana, índice 0 = domingo (igual a Date.getDay()). */
export type Capacidade = [number, number, number, number, number, number, number];

export const CAPACIDADE_PADRAO: Capacidade = [0, 8, 8, 8, 8, 8, 0];

export const SEM_RESPONSAVEL = '__sem_responsavel';

export interface Parcela {
  task: TaskRow;
  minutos: number;
  atrasada: boolean;
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

function aberta(t: TaskRow): boolean {
  return t.status_category !== 'done' && t.status_category !== 'cancelled';
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
    if (!aberta(t)) continue;
    if (!t.time_estimate_minutes) { semEstimativa.push(t); continue; }
    const falta = minutosRestantes(t);
    if (falta <= 0) continue; // já cronometrou tudo o que estimou
    if (!t.due_date) { semData.push(t); continue; }

    const pessoa = t.assignee_id ?? SEM_RESPONSAVEL;
    const prazo = diaLocal(t.due_date);
    const atrasada = prazo < hoje0;
    if (atrasada) atrasadas.push(t);

    let inicio = t.start_date ? diaLocal(t.start_date) : prazo;
    if (inicio > prazo) inicio = prazo;
    if (inicio < hoje0) inicio = hoje0;
    const fim = prazo < hoje0 ? hoje0 : prazo;

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
      const minutos = (falta * d.peso) / pesoTotal;
      const lista = mapa.get(d.chave) ?? [];
      lista.push({ task: t, minutos, atrasada });
      mapa.set(d.chave, lista);
    }
  }
  return { porPessoa, semEstimativa, semData, atrasadas };
}

export function minutosNoDia(r: ResultadoCarga, pessoa: string, dia: string): number {
  return (r.porPessoa.get(pessoa)?.get(dia) ?? []).reduce((s, p) => s + p.minutos, 0);
}

// ── Capacidade: preferência de quem olha a tela (localStorage) ──
const CHAVE_CAPACIDADE = 'erpos_tarefas_capacidade';

export function carregarCapacidades(): Record<string, Capacidade> {
  try {
    const obj = JSON.parse(localStorage.getItem(CHAVE_CAPACIDADE) ?? '{}');
    return obj && typeof obj === 'object' ? obj as Record<string, Capacidade> : {};
  } catch {
    return {};
  }
}

export function salvarCapacidades(caps: Record<string, Capacidade>): void {
  try {
    localStorage.setItem(CHAVE_CAPACIDADE, JSON.stringify(caps));
  } catch {
    /* sem localStorage — vale só nesta sessão */
  }
}
