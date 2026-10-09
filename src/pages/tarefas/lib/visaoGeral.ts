// Visão geral da pasta-mãe (2026-10-09): as contas do painel, sem React.
// Entra a subárvore inteira (a pasta-mãe e todas as subpastas); sai o que o
// painel mostra — o que pede atenção, prazos dos próximos dias, progresso por
// subpasta, quem está com o quê e o ritmo de entrada × conclusão.
import type { TaskList, TaskRow, TaskStatus } from '../hooks/useTarefas';
import type { NoPasta } from './pastas';
import type { Dependencia } from './gantt';
import { idsSubarvore } from './pastas';
import { chaveDia, diaLocal, somarDias } from './carga';
import { responsaveis, type Responsavel } from './responsaveis';
import { CATEGORIAS_GENERICAS } from './agrupamento';

/** Chave do "Sem responsável" no resumo por pessoa. */
export const SEM_PESSOA = '__sem_responsavel__';

/** Quantos dias a faixa de prazos mostra (hoje incluído). */
export const DIAS_PROXIMOS = 14;
/** Quantas semanas o gráfico de ritmo mostra (a atual incluída). */
export const SEMANAS_RITMO = 8;

type Base = Pick<TaskRow, 'status_category' | 'due_date' | 'due_has_time'>;

export function aberta(t: Pick<TaskRow, 'status_category'>): boolean {
  return t.status_category !== 'done' && t.status_category !== 'cancelled';
}

/** Mesma regra do resto do módulo: com horário, passou da hora; sem horário, passou do dia. */
export function atrasada(t: Base, agora: Date): boolean {
  if (!aberta(t) || !t.due_date) return false;
  return t.due_has_time
    ? new Date(t.due_date).getTime() < agora.getTime()
    : chaveDia(diaLocal(t.due_date)) < chaveDia(agora);
}

/** Dia do vencimento (YYYY-MM-DD local) ou null. */
export function diaDoPrazo(t: Pick<TaskRow, 'due_date'>): string | null {
  return t.due_date ? chaveDia(diaLocal(t.due_date)) : null;
}

/** Segunda-feira da semana do dia. */
export function inicioSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

/** Minutos que faltam pela estimativa (estimado − cronometrado), nunca negativo. */
function minutosQueFaltam(t: Pick<TaskRow, 'time_estimate_minutes' | 'time_tracked_seconds'>): number {
  const est = t.time_estimate_minutes ?? 0;
  if (est <= 0) return 0;
  return Math.max(0, est - Math.floor((t.time_tracked_seconds ?? 0) / 60));
}

export interface ResumoSubpasta {
  id: string;
  nome: string;
  cor: string;
  /** Linha das tarefas que estão direto na pasta-mãe (fora das subpastas). */
  direta: boolean;
  /** Quantas pastas há dentro desta (a conta já soma todas). */
  subpastas: number;
  /** Dá para abrir a pasta? (Tarefa atribuída a mim numa pasta de outra pessoa: não.) */
  abrivel: boolean;
  total: number;
  concluidas: number;
  andamento: number;
  aFazer: number;
  atrasadas: number;
  /** Próximo vencimento ainda em dia (YYYY-MM-DD). */
  proximoPrazo: string | null;
  /** Último vencimento entre as tarefas em aberto — "termina em". */
  ultimoPrazo: string | null;
  /** Quem tem tarefa em aberto aqui, de quem tem mais para quem tem menos. */
  pessoas: Responsavel[];
}

export interface ResumoPessoa {
  id: string;
  nome: string | null;
  abertas: number;
  atrasadas: number;
  /** Vencem nos próximos 7 dias (em dia). */
  semana: number;
  concluidas7: number;
  /** Tempo estimado que falta, dividido entre os responsáveis da tarefa. */
  minutosRestantes: number;
}

export interface DiaPrazo {
  chave: string;
  data: Date;
  tarefas: TaskRow[];
}

export interface SemanaRitmo {
  /** Segunda-feira da semana (YYYY-MM-DD). */
  inicio: string;
  criadas: number;
  concluidas: number;
  /** Semana atual — ainda não terminou. */
  atual: boolean;
}

export interface FatiaStatus {
  chave: string;
  nome: string;
  cor: string;
  categoria: TaskStatus['category'];
  qtd: number;
}

export interface Evento {
  tipo: 'criada' | 'concluida';
  quando: string;
  tarefa: TaskRow;
}

export interface Previsao {
  /** Média de concluídas por semana nas últimas 4 semanas. */
  porSemana: number;
  /** Semanas para zerar as abertas nesse ritmo (sem contar tarefa nova). */
  semanas: number;
  /** Dia estimado (YYYY-MM-DD). */
  data: string;
}

export interface VisaoGeral {
  total: number;
  abertas: number;
  concluidas: number;
  atrasadas: TaskRow[];
  hoje: TaskRow[];
  /** Vencem do hoje até 6 dias à frente (em dia). */
  semana: TaskRow[];
  bloqueadas: TaskRow[];
  semResponsavel: TaskRow[];
  semPrazo: number;
  concluidas7: number;
  concluidas7Antes: number;
  minutosRestantes: number;
  subpastas: ResumoSubpasta[];
  pessoas: ResumoPessoa[];
  proximosDias: DiaPrazo[];
  ritmo: SemanaRitmo[];
  /** Nas últimas 4 semanas: quantas entraram e quantas foram concluídas. */
  entraram4: number;
  sairam4: number;
  previsao: Previsao | null;
  status: FatiaStatus[];
  /** Só as em aberto — o "onde estão" das visões de várias pastas (Minhas, Que atribuí). */
  statusAbertas: FatiaStatus[];
  prioridades: Array<{ value: number; qtd: number }>;
  eventos: Evento[];
}

const ORDEM_CATEGORIA: Record<string, number> = { backlog: 0, todo: 1, in_progress: 2, done: 3, cancelled: 4 };

interface Opcoes {
  agora: Date;
  /** Todas as tarefas que eu enxergo — para saber se a tarefa de que esta depende já terminou. */
  todas: TaskRow[];
  dependencias: Dependencia[];
  lists: TaskList[];
  /** Sem pasta-mãe (Minhas, Que atribuí): árvore de pastas para agrupar por pasta-mãe. */
  arvore?: NoPasta[];
}

type BaseResumo = Omit<ResumoSubpasta, 'total' | 'concluidas' | 'andamento' | 'aFazer' | 'atrasadas' | 'proximoPrazo' | 'ultimoPrazo' | 'pessoas'>;

/** Progresso, atrasadas, próximo prazo e pessoas de um grupo de tarefas (uma subpasta, uma pasta). */
function resumirGrupo(lista: TaskRow[], base: BaseResumo, agora: Date): ResumoSubpasta {
  const ab = lista.filter(aberta);
  const prazosEmDia = ab.filter((t) => !atrasada(t, agora)).map(diaDoPrazo).filter((d): d is string => !!d).sort();
  const prazos = ab.map(diaDoPrazo).filter((d): d is string => !!d).sort();
  const contagem = new Map<string, { r: Responsavel; n: number }>();
  for (const t of ab) for (const r of responsaveis(t)) {
    const c = contagem.get(r.id);
    if (c) c.n++; else contagem.set(r.id, { r, n: 1 });
  }
  return {
    ...base,
    total: lista.length,
    concluidas: lista.filter((t) => t.status_category === 'done').length,
    andamento: ab.filter((t) => t.status_category === 'in_progress').length,
    aFazer: ab.filter((t) => t.status_category !== 'in_progress').length,
    atrasadas: ab.filter((t) => atrasada(t, agora)).length,
    proximoPrazo: prazosEmDia[0] ?? null,
    ultimoPrazo: prazos[prazos.length - 1] ?? null,
    pessoas: [...contagem.values()].sort((a, b) => b.n - a.n).map((c) => c.r),
  };
}

/**
 * Tarefas de várias pastas agrupadas pela pasta-mãe de cada uma (a subárvore inteira
 * conta para a mãe). Tarefa numa pasta que eu não enxergo (atribuída a mim por outra
 * pessoa) fica no grupo da própria pasta, sem abrir. Só grupos com tarefa em aberto,
 * os com atraso primeiro.
 */
export function resumoPorPasta(principais: TaskRow[], arvore: NoPasta[], agora: Date): ResumoSubpasta[] {
  const raizDe = new Map<string, NoPasta>();
  for (const raiz of arvore) for (const id of idsSubarvore(raiz)) raizDe.set(id, raiz);
  const grupos = new Map<string, { base: BaseResumo; tarefas: TaskRow[] }>();
  for (const t of principais) {
    const raiz = raizDe.get(t.list_id);
    const id = raiz?.id ?? t.list_id;
    let g = grupos.get(id);
    if (!g) {
      g = {
        base: raiz
          ? { id, nome: raiz.name, cor: raiz.color, direta: false, subpastas: idsSubarvore(raiz).size - 1, abrivel: true }
          : { id, nome: t.list_name ?? 'Pasta', cor: t.list_color ?? '#94a3b8', direta: false, subpastas: 0, abrivel: false },
        tarefas: [],
      };
      grupos.set(id, g);
    }
    g.tarefas.push(t);
  }
  return [...grupos.values()]
    .map((g) => resumirGrupo(g.tarefas, g.base, agora))
    .filter((r) => r.total - r.concluidas > 0)
    .sort((a, b) => b.atrasadas - a.atrasadas || (b.total - b.concluidas) - (a.total - a.concluidas) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Painel da pasta-mãe (ou de Minhas / Que atribuí, com `raiz` null). `tarefas` = as da
 * subárvore ou do recorte (já filtradas pela barra de filtros, SEM esconder concluídas —
 * o progresso precisa delas). Conta só tarefas principais (subtarefa entra pela
 * tarefa-mãe) e ignora as canceladas. Sem raiz, `subpastas` vira o resumo por pasta-mãe.
 */
export function calcularVisaoGeral(tarefas: TaskRow[], raiz: NoPasta | null, op: Opcoes): VisaoGeral {
  const { agora } = op;
  const hoje = chaveDia(agora);
  const daquiASeis = chaveDia(somarDias(agora, 6));
  const ha7 = chaveDia(somarDias(agora, -6));
  const ha14 = chaveDia(somarDias(agora, -13));
  const ha28 = chaveDia(somarDias(agora, -27));

  const principais = tarefas.filter((t) => !t.parent_task_id && t.status_category !== 'cancelled');
  const abertas = principais.filter(aberta);
  const concluidas = principais.filter((t) => t.status_category === 'done');
  const diaConclusao = (t: TaskRow) => (t.completed_at ? chaveDia(new Date(t.completed_at)) : null);

  const atrasadas = abertas.filter((t) => atrasada(t, agora))
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const emDia = abertas.filter((t) => !atrasada(t, agora));
  const hojeLista = emDia.filter((t) => diaDoPrazo(t) === hoje);
  const semana = emDia.filter((t) => { const d = diaDoPrazo(t); return !!d && d >= hoje && d <= daquiASeis; })
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));

  // Bloqueada: espera uma tarefa que ainda está aberta (Cronograma › ligações).
  const porId = new Map(op.todas.map((t) => [t.id, t]));
  const antes = new Map<string, string[]>();
  for (const d of op.dependencias) antes.set(d.successor_id, [...(antes.get(d.successor_id) ?? []), d.predecessor_id]);
  const bloqueadas = abertas.filter((t) => (antes.get(t.id) ?? []).some((pid) => {
    const p = porId.get(pid);
    return !!p && aberta(p);
  }));

  const semResponsavel = abertas.filter((t) => responsaveis(t).length === 0);
  const concluidas7 = concluidas.filter((t) => { const d = diaConclusao(t); return !!d && d >= ha7; }).length;
  const concluidas7Antes = concluidas.filter((t) => { const d = diaConclusao(t); return !!d && d >= ha14 && d < ha7; }).length;

  // ── Subpastas: cada filha direta soma a subárvore dela; tarefas soltas na mãe viram uma linha à parte.
  //    Sem pasta-mãe (Minhas, Que atribuí): uma linha por pasta-mãe.
  const subpastas: ResumoSubpasta[] = [];
  if (raiz) {
    const diretas = principais.filter((t) => t.list_id === raiz.id);
    if (diretas.length) {
      subpastas.push(resumirGrupo(diretas, { id: raiz.id, nome: raiz.name, cor: raiz.color, direta: true, subpastas: 0, abrivel: true }, agora));
    }
    for (const filha of raiz.filhas) {
      const ids = idsSubarvore(filha);
      subpastas.push(resumirGrupo(principais.filter((t) => ids.has(t.list_id)), {
        id: filha.id, nome: filha.name, cor: filha.color, direta: false, subpastas: ids.size - 1, abrivel: true,
      }, agora));
    }
  } else {
    subpastas.push(...resumoPorPasta(principais, op.arvore ?? [], agora));
  }

  // ── Por pessoa: tarefa com vários responsáveis conta para cada um; o tempo se divide.
  const pessoasMap = new Map<string, ResumoPessoa>();
  const pessoa = (id: string, nome: string | null) => {
    let p = pessoasMap.get(id);
    if (!p) { p = { id, nome, abertas: 0, atrasadas: 0, semana: 0, concluidas7: 0, minutosRestantes: 0 }; pessoasMap.set(id, p); }
    if (!p.nome && nome) p.nome = nome;
    return p;
  };
  for (const t of abertas) {
    const rs = responsaveis(t);
    const lista = rs.length ? rs : [{ id: SEM_PESSOA, name: null }];
    const falta = minutosQueFaltam(t) / lista.length;
    const d = diaDoPrazo(t);
    const atr = atrasada(t, agora);
    for (const r of lista) {
      const p = pessoa(r.id, r.name);
      p.abertas++;
      if (atr) p.atrasadas++;
      else if (d && d >= hoje && d <= daquiASeis) p.semana++;
      p.minutosRestantes += falta;
    }
  }
  for (const t of concluidas) {
    const d = diaConclusao(t);
    if (!d || d < ha7) continue;
    for (const r of responsaveis(t)) pessoa(r.id, r.name).concluidas7++;
  }
  const pessoas = [...pessoasMap.values()].sort((a, b) => {
    if ((a.id === SEM_PESSOA) !== (b.id === SEM_PESSOA)) return a.id === SEM_PESSOA ? 1 : -1;
    return b.atrasadas - a.atrasadas || b.abertas - a.abertas || (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
  });

  // ── Próximos dias (em dia; o que já passou fica em "atrasadas").
  const proximosDias: DiaPrazo[] = [];
  for (let i = 0; i < DIAS_PROXIMOS; i++) {
    const data = somarDias(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()), i);
    const chave = chaveDia(data);
    proximosDias.push({ chave, data, tarefas: emDia.filter((t) => diaDoPrazo(t) === chave) });
  }

  // ── Ritmo: entraram × concluídas por semana (segunda a domingo).
  const semanaAtual = inicioSemana(agora);
  const ritmo: SemanaRitmo[] = [];
  for (let w = SEMANAS_RITMO - 1; w >= 0; w--) {
    const ini = somarDias(semanaAtual, -7 * w);
    const de = chaveDia(ini);
    const ate = chaveDia(somarDias(ini, 7));
    ritmo.push({
      inicio: de,
      atual: w === 0,
      criadas: principais.filter((t) => { const d = chaveDia(new Date(t.created_at)); return d >= de && d < ate; }).length,
      concluidas: concluidas.filter((t) => { const d = diaConclusao(t); return !!d && d >= de && d < ate; }).length,
    });
  }
  const entraram4 = principais.filter((t) => chaveDia(new Date(t.created_at)) >= ha28).length;
  const sairam4 = concluidas.filter((t) => { const d = diaConclusao(t); return !!d && d >= ha28; }).length;
  const porSemana = sairam4 / 4;
  let previsao: Previsao | null = null;
  if (abertas.length > 0 && porSemana > 0) {
    const semanas = abertas.length / porSemana;
    previsao = { porSemana, semanas, data: chaveDia(somarDias(agora, Math.ceil(semanas * 7))) };
  }

  // ── Status: pelos status reais das pastas (mesmo nome em subpastas diferentes vira uma fatia só).
  const statusPorId = new Map<string, TaskStatus>();
  for (const l of op.lists) for (const s of l.statuses ?? []) statusPorId.set(s.id, s);
  const fatias = new Map<string, FatiaStatus>();
  for (const t of principais) {
    const s = t.status_id ? statusPorId.get(t.status_id) : undefined;
    const generica = CATEGORIAS_GENERICAS.find((c) => c.key === (t.status_category ?? 'todo')) ?? CATEGORIAS_GENERICAS[1];
    const nome = s?.name ?? generica.label;
    const chave = nome.trim().toLowerCase();
    const f = fatias.get(chave);
    if (f) f.qtd++;
    else fatias.set(chave, { chave, nome, cor: s?.color ?? generica.color, categoria: s?.category ?? generica.key, qtd: 1 });
  }
  const status = [...fatias.values()].sort((a, b) => ORDEM_CATEGORIA[a.categoria] - ORDEM_CATEGORIA[b.categoria]);
  const statusAbertas = status.filter((f) => f.categoria !== 'done' && f.categoria !== 'cancelled');

  const prioridades = [4, 3, 2, 1, 0].map((value) => ({ value, qtd: abertas.filter((t) => (t.priority ?? 0) === value).length }));

  const eventos: Evento[] = [
    ...principais.map((t) => ({ tipo: 'criada' as const, quando: t.created_at, tarefa: t })),
    ...concluidas.filter((t) => t.completed_at).map((t) => ({ tipo: 'concluida' as const, quando: t.completed_at!, tarefa: t })),
  ].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, 8);

  return {
    total: principais.length,
    abertas: abertas.length,
    concluidas: concluidas.length,
    atrasadas,
    hoje: hojeLista,
    semana,
    bloqueadas,
    semResponsavel,
    semPrazo: abertas.filter((t) => !t.due_date).length,
    concluidas7,
    concluidas7Antes,
    minutosRestantes: abertas.reduce((s, t) => s + minutosQueFaltam(t), 0),
    subpastas,
    pessoas,
    proximosDias,
    ritmo,
    entraram4,
    sairam4,
    previsao,
    status,
    statusAbertas,
    prioridades,
    eventos,
  };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O estado da pasta numa frase — o que o dono lê primeiro. */
export function resumoEmFrases(v: VisaoGeral): { tom: 'ok' | 'atencao' | 'atraso'; frases: string[] } {
  if (v.total === 0) return { tom: 'ok', frases: ['Ainda não há tarefas aqui.'] };
  const tom = v.atrasadas.length > 0 ? 'atraso' : v.hoje.length > 0 || v.bloqueadas.length > 0 ? 'atencao' : 'ok';
  const partes: string[] = [];
  if (v.atrasadas.length) partes.push(plural(v.atrasadas.length, 'tarefa atrasada', 'tarefas atrasadas'));
  if (v.hoje.length) partes.push(`${v.hoje.length} ${v.hoje.length === 1 ? 'vence' : 'vencem'} hoje`);
  if (v.bloqueadas.length) partes.push(`${v.bloqueadas.length} esperando outra tarefa terminar`);
  const frases: string[] = [];
  if (partes.length) {
    const texto = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
    frases.push(`${texto[0].toUpperCase()}${texto.slice(1)}.`);
  } else {
    frases.push(v.abertas === 0 ? 'Tudo concluído.' : 'Nada atrasado.');
  }
  const proximas = v.semana.length - v.hoje.length;
  if (proximas > 0) frases.push(`Nos próximos 6 dias ${proximas === 1 ? 'vence mais 1' : `vencem mais ${proximas}`}.`);
  const dif = v.concluidas7 - v.concluidas7Antes;
  if (v.concluidas7 === 0) {
    frases.push(`Nenhuma concluída nos últimos 7 dias${v.concluidas7Antes ? ` (na semana anterior, ${v.concluidas7Antes})` : ''}.`);
  } else {
    const comparacao = dif === 0 ? ' (igual à semana anterior)'
      : dif > 0 ? ` (${dif} a mais que na semana anterior)` : ` (${-dif} a menos que na semana anterior)`;
    frases.push(`${plural(v.concluidas7, 'concluída', 'concluídas')} nos últimos 7 dias${comparacao}.`);
  }
  return { tom, frases };
}
