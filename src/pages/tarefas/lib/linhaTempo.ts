// Linha do tempo (2026-10-02) — a conta por trás da visão: que dias cada tarefa
// ocupa, como as linhas se agrupam, e o que gravar ao arrastar/esticar/marcar.
// Sem React aqui: a tela (ViewLinhaTempo) só desenha o que sai daqui.
import type { TaskList, TaskRow } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import { chaveDia, diaLocal, somarDias } from './carga';
import { ajustarPeriodo, diferencaDias } from './calendario';
import { CATEGORIAS_GENERICAS, type UsuarioOption } from './agrupamento';
import { idsResponsaveis, responsaveis } from './responsaveis';
import { GRUPO_FEITO, ehFeito } from './statusFeito';
import { achatarArvore, montarArvorePastas } from './pastas';

export type AgruparLinha = 'pessoa' | 'pasta' | 'status' | 'prioridade' | 'nenhum';
export type CorLinha = 'status' | 'pasta' | 'prioridade';

export const OPCOES_AGRUPAR: Array<{ id: AgruparLinha; label: string }> = [
  { id: 'pessoa', label: 'Pessoa' },
  { id: 'pasta', label: 'Pasta' },
  { id: 'status', label: 'Status' },
  { id: 'prioridade', label: 'Prioridade' },
  { id: 'nenhum', label: 'Sem grupo' },
];

export const OPCOES_COR: Array<{ id: CorLinha; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'pasta', label: 'Pasta' },
  { id: 'prioridade', label: 'Prioridade' },
];

/** Dias (YYYY-MM-DD, inclusive) que a barra ocupa. */
export interface Periodo {
  inicio: string;
  fim: string;
  /** periodo = início→vencimento; dia = só vencimento (ou início ≥ vencimento); soInicio = começa e não tem prazo. */
  tipo: 'periodo' | 'dia' | 'soInicio';
}

/** Sem início e sem vencimento → null (fica no "sem data" do grupo, nunca some). */
export function periodoDaTarefa(t: Pick<TaskRow, 'start_date' | 'due_date'>): Periodo | null {
  const fim = t.due_date ? chaveDia(diaLocal(t.due_date)) : null;
  const inicio = t.start_date ? chaveDia(diaLocal(t.start_date)) : null;
  if (!fim && !inicio) return null;
  if (!fim) return { inicio: inicio!, fim: inicio!, tipo: 'soInicio' };
  if (!inicio || inicio >= fim) return { inicio: fim, fim, tipo: 'dia' };
  return { inicio, fim, tipo: 'periodo' };
}

export function aberta(t: Pick<TaskRow, 'status_category'>): boolean {
  return t.status_category !== 'done' && t.status_category !== 'cancelled';
}

/**
 * Dias de atraso de uma tarefa em aberto (0 = em dia). Vencimento com hora já
 * passado conta como atrasada no próprio dia (1).
 */
export function diasAtraso(t: Pick<TaskRow, 'status_category' | 'due_date' | 'due_has_time'>, agora: Date): number {
  if (!t.due_date || !aberta(t)) return 0;
  const fim = chaveDia(diaLocal(t.due_date));
  const hoje = chaveDia(agora);
  if (fim < hoje) return diferencaDias(fim, hoje);
  if (fim === hoje && t.due_has_time && new Date(t.due_date).getTime() < agora.getTime()) return 1;
  return 0;
}

/** Quanto da barra pintar como feito: checklist → tempo cronometrado → nada. Concluída = 1. */
export function progressoDaTarefa(t: Pick<TaskRow, 'status_category' | 'checklist_total' | 'checklist_done' | 'time_estimate_minutes' | 'time_tracked_seconds'>): number | null {
  if (t.status_category === 'done') return 1;
  if (t.checklist_total > 0) return t.checklist_done / t.checklist_total;
  if (t.time_estimate_minutes && t.time_tracked_seconds > 0) {
    return Math.min(1, t.time_tracked_seconds / 60 / t.time_estimate_minutes);
  }
  return null;
}

/** Cor da barra conforme o modo escolhido (status usa a cor real do status da pasta). */
export function corDaTarefa(t: TaskRow, modo: CorLinha, lists: TaskList[]): string {
  if (modo === 'pasta') return lists.find((l) => l.id === t.list_id)?.color ?? t.list_color ?? '#6366f1';
  if (modo === 'prioridade') {
    if (!t.priority) return '#94a3b8';
    return PRIORIDADES.find((p) => p.value === t.priority)?.color ?? '#94a3b8';
  }
  const status = lists.find((l) => l.id === t.list_id)?.statuses.find((s) => s.id === t.status_id);
  if (status) return status.color;
  if (ehFeito(t)) return GRUPO_FEITO.color;
  return CATEGORIAS_GENERICAS.find((c) => c.key === t.status_category)?.color ?? '#94a3b8';
}

// ── Linhas e grupos ──

export interface LinhaTarefa {
  task: TaskRow;
  periodo: Periodo | null;
  /** 0 = tarefa; 1+ = subtarefa (aninhada embaixo da mãe quando a mãe está no mesmo grupo). */
  nivel: number;
  /** Quantas subtarefas desta tarefa estão no grupo (para a setinha de abrir). */
  filhas: number;
  /** Do primeiro início ao último vencimento das subtarefas (a mãe "herda" o período delas). */
  resumoFilhas: { inicio: string; fim: string } | null;
}

export interface GrupoLinha {
  key: string;
  label: string;
  color: string;
  /** Agrupado por pessoa: o id (ou null = sem responsável), para a faixa de ocupação. */
  pessoaId?: string | null;
  /** Pasta do grupo (agrupado por pasta) — onde criar tarefa nova. */
  listId?: string;
  /** Tarefas com data (e as subtarefas abertas), na ordem da tela. */
  linhas: LinhaTarefa[];
  /** Tarefas de primeiro nível sem data nenhuma — ficam numa gaveta do grupo. */
  semData: TaskRow[];
  /** Do primeiro início ao último vencimento do grupo (barra-resumo do cabeçalho). */
  resumo: { inicio: string; fim: string } | null;
  total: number;
  atrasadas: number;
}

function ordemCronologica(a: TaskRow, b: TaskRow): number {
  const pa = periodoDaTarefa(a);
  const pb = periodoDaTarefa(b);
  if (pa && pb) {
    if (pa.inicio !== pb.inicio) return pa.inicio.localeCompare(pb.inicio);
    if (pa.fim !== pb.fim) return pa.fim.localeCompare(pb.fim);
  } else if (pa || pb) {
    return pa ? -1 : 1;
  }
  return a.sort_order - b.sort_order;
}

/**
 * Monta as linhas de um grupo: tarefas com data em ordem cronológica, cada uma
 * seguida das subtarefas (se a mãe estiver aberta); sem data vão para a gaveta.
 * Subtarefa cuja mãe não está no grupo vira linha normal.
 */
export function linhasDoGrupo(
  tarefas: TaskRow[],
  abertas: Set<string>,
  agora: Date,
): Pick<GrupoLinha, 'linhas' | 'semData' | 'resumo' | 'total' | 'atrasadas'> {
  const ids = new Set(tarefas.map((t) => t.id));
  const filhasDe = new Map<string, TaskRow[]>();
  const raizes: TaskRow[] = [];
  for (const t of tarefas) {
    if (t.parent_task_id && ids.has(t.parent_task_id)) {
      const l = filhasDe.get(t.parent_task_id) ?? [];
      l.push(t);
      filhasDe.set(t.parent_task_id, l);
    } else raizes.push(t);
  }

  // Período herdado: do primeiro início ao último vencimento de todas as descendentes.
  const resumoDe = (id: string, vistos = new Set<string>()): { inicio: string; fim: string } | null => {
    let inicio: string | null = null;
    let fim: string | null = null;
    for (const f of filhasDe.get(id) ?? []) {
      if (vistos.has(f.id)) continue;
      vistos.add(f.id);
      for (const p of [periodoDaTarefa(f), resumoDe(f.id, vistos)]) {
        if (!p) continue;
        if (inicio === null || p.inicio < inicio) inicio = p.inicio;
        if (fim === null || p.fim > fim) fim = p.fim;
      }
    }
    return inicio !== null && fim !== null ? { inicio, fim } : null;
  };

  const linhas: LinhaTarefa[] = [];
  const semData: TaskRow[] = [];
  const visitados = new Set<string>();
  const empilhar = (t: TaskRow, nivel: number) => {
    if (visitados.has(t.id)) return; // proteção contra ciclo
    visitados.add(t.id);
    const filhas = [...(filhasDe.get(t.id) ?? [])].sort(ordemCronologica);
    linhas.push({ task: t, periodo: periodoDaTarefa(t), nivel, filhas: filhas.length, resumoFilhas: filhas.length ? resumoDe(t.id) : null });
    if (abertas.has(t.id)) for (const f of filhas) empilhar(f, nivel + 1);
  };
  for (const t of [...raizes].sort(ordemCronologica)) {
    if (!periodoDaTarefa(t) && !resumoDe(t.id)) {
      // Gaveta "sem data" é pra marcar o dia: concluída/cancelada sem data não tem lugar no tempo.
      if (aberta(t)) semData.push(t);
    } else empilhar(t, 0);
  }

  let inicio: string | null = null;
  let fim: string | null = null;
  for (const t of tarefas) {
    const p = periodoDaTarefa(t);
    if (!p) continue;
    if (!inicio || p.inicio < inicio) inicio = p.inicio;
    if (!fim || p.fim > fim) fim = p.fim;
  }
  return {
    linhas,
    semData,
    resumo: inicio && fim ? { inicio, fim } : null,
    total: tarefas.length,
    atrasadas: tarefas.filter((t) => diasAtraso(t, agora) > 0).length,
  };
}

interface OpcoesGrupos {
  agrupar: AgruparLinha;
  /** Pasta única aberta (status agrupa pelos status dela); null = várias pastas. */
  list: TaskList | null;
  lists: TaskList[];
  usuarios: UsuarioOption[];
  /** Tarefas com subtarefas abertas na tela. */
  abertas: Set<string>;
  agora: Date;
}

export function montarGrupos(tasks: TaskRow[], o: OpcoesGrupos): GrupoLinha[] {
  const grupo = (key: string, label: string, color: string, tarefas: TaskRow[], extra: Partial<GrupoLinha> = {}): GrupoLinha => ({
    key, label, color, ...linhasDoGrupo(tarefas, o.abertas, o.agora), ...extra,
  });

  if (o.agrupar === 'nenhum') return [grupo('todas', 'Todas', '#6366f1', tasks)];

  if (o.agrupar === 'pessoa') {
    // Igual à Lista: os grupos saem das próprias tarefas (gente de outra loja não
    // some); tarefa com vários responsáveis aparece no grupo de cada um.
    const ids = [...new Set(tasks.flatMap((t) => idsResponsaveis(t)))];
    const posicao = (id: string) => {
      const i = o.usuarios.findIndex((u) => u.id === id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const nomeDe = (id: string) => o.usuarios.find((u) => u.id === id)?.nome
      ?? tasks.flatMap((t) => responsaveis(t)).find((r) => r.id === id && r.name)?.name
      ?? 'Usuário sem nome';
    const grupos = ids
      .map((id) => grupo(`p:${id}`, nomeDe(id), '#6366f1', tasks.filter((t) => idsResponsaveis(t).includes(id)), { pessoaId: id }))
      .sort((a, b) => posicao(a.pessoaId!) - posicao(b.pessoaId!) || a.label.localeCompare(b.label, 'pt-BR'));
    const sem = tasks.filter((t) => !idsResponsaveis(t).length);
    if (sem.length) grupos.push(grupo('p:-', 'Sem responsável', '#94a3b8', sem, { pessoaId: null }));
    return grupos;
  }

  if (o.agrupar === 'pasta') {
    // Ordem da árvore de pastas (mãe antes das filhas); pasta que não está na
    // minha árvore (tarefa passada pra mim) vem depois, pelo nome.
    const ordem = achatarArvore(montarArvorePastas(o.lists));
    const caminho = (id: string): string => {
      const nomes: string[] = [];
      let atual = o.lists.find((l) => l.id === id);
      for (let n = 0; atual && n < 20; n++) {
        nomes.unshift(atual.name);
        atual = atual.parent_list_id ? o.lists.find((l) => l.id === atual!.parent_list_id) : undefined;
      }
      return nomes.join(' › ');
    };
    const ids = [...new Set(tasks.map((t) => t.list_id))];
    const pos = (id: string) => {
      const i = ordem.findIndex((n) => n.id === id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return ids
      .map((id) => {
        const tarefas = tasks.filter((t) => t.list_id === id);
        const pasta = o.lists.find((l) => l.id === id);
        return grupo(`l:${id}`, pasta ? caminho(id) : tarefas[0]?.list_name ?? 'Pasta', pasta?.color ?? tarefas[0]?.list_color ?? '#6366f1', tarefas, { listId: id });
      })
      .sort((a, b) => pos(a.listId!) - pos(b.listId!) || a.label.localeCompare(b.label, 'pt-BR'));
  }

  if (o.agrupar === 'prioridade') {
    return [...PRIORIDADES].reverse()
      .map((p) => grupo(`r:${p.value}`, p.label, p.color, tasks.filter((t) => (t.priority ?? 0) === p.value)))
      .filter((g) => g.total > 0);
  }

  // status
  if (o.list) {
    return [...o.list.statuses].sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => grupo(`s:${s.id}`, s.name, s.color, tasks.filter((t) => t.status_id === s.id)))
      .filter((g) => g.total > 0);
  }
  const grupos: GrupoLinha[] = [];
  for (const c of CATEGORIAS_GENERICAS) {
    if (c.key === 'done') {
      const feitos = tasks.filter(ehFeito);
      if (feitos.length) grupos.push(grupo(`c:${GRUPO_FEITO.key}`, GRUPO_FEITO.label, GRUPO_FEITO.color, feitos));
    }
    const daCategoria = tasks.filter((t) => t.status_category === c.key && !ehFeito(t));
    if (daCategoria.length) grupos.push(grupo(`c:${c.key}`, c.label, c.color, daCategoria));
  }
  return grupos;
}

// ── Faixa de dias da tela ──

/** Do mais cedo ao mais tarde entre as tarefas e hoje, com folga dos dois lados (máx. ~2 anos). */
export function faixaDaLinha(tasks: Array<Pick<TaskRow, 'start_date' | 'due_date'>>, agora: Date): { de: string; ate: string } {
  const hoje = chaveDia(agora);
  let de = chaveDia(somarDias(diaLocal(hoje), -21));
  let ate = chaveDia(somarDias(diaLocal(hoje), 70));
  for (const t of tasks) {
    const p = periodoDaTarefa(t);
    if (!p) continue;
    if (p.inicio < de) de = p.inicio;
    if (p.fim > ate) ate = p.fim;
  }
  const limiteDe = chaveDia(somarDias(diaLocal(hoje), -366));
  const limiteAte = chaveDia(somarDias(diaLocal(hoje), 366));
  if (de < limiteDe) de = limiteDe;
  if (ate > limiteAte) ate = limiteAte;
  return { de: chaveDia(somarDias(diaLocal(de), -7)), ate: chaveDia(somarDias(diaLocal(ate), 14)) };
}

// ── O que gravar ──

/** Vencimento num outro dia, mantendo a hora se tiver. */
function vencimentoNoDia(t: Pick<TaskRow, 'due_date' | 'due_has_time'>, dia: string): { due_date: string; due_has_time: boolean } {
  if (t.due_has_time && t.due_date) {
    const antes = new Date(t.due_date);
    const [a, m, d] = dia.split('-').map(Number);
    const novo = new Date(a, m - 1, d, antes.getHours(), antes.getMinutes());
    return { due_date: novo.toISOString(), due_has_time: true };
  }
  // Sem hora: meio-dia UTC (o dia não muda em nenhum fuso do Brasil) — igual à Lista.
  return { due_date: `${dia}T12:00:00Z`, due_has_time: false };
}

/** Arrastar a barra inteira `delta` dias (mantém a duração e a hora do vencimento). */
export function payloadMover(t: TaskRow, delta: number): Record<string, unknown> | null {
  const p = periodoDaTarefa(t);
  if (!p || !delta) return null;
  const desloca = (dia: string) => chaveDia(somarDias(diaLocal(dia), delta));
  if (p.tipo === 'soInicio') return { start_date: desloca(p.inicio) };
  const payload: Record<string, unknown> = { ...vencimentoNoDia(t, desloca(p.fim)) };
  // Início gravado (mesmo igual ou depois do vencimento) anda junto — senão vira período.
  if (t.start_date) payload.start_date = chaveDia(somarDias(diaLocal(t.start_date), delta));
  return payload;
}

/** Puxar uma ponta até `dia`. Tarefa de um dia vira período; sem prazo ganha prazo. */
export function payloadAjustar(t: TaskRow, lado: 'inicio' | 'fim', dia: string): { payload?: Record<string, unknown>; erro?: string } | null {
  const p = periodoDaTarefa(t);
  if (!p) return null;
  if (p.tipo === 'soInicio') {
    if (lado === 'inicio') return dia === p.inicio ? null : { payload: { start_date: dia } };
    if (dia < p.inicio) return { erro: 'O vencimento não pode ficar antes do início.' };
    return { payload: { ...vencimentoNoDia(t, dia), ...(dia === p.inicio ? { start_date: null } : {}) } };
  }
  const r = ajustarPeriodo(t, lado, dia);
  if (!r) return null;
  if (r.erro) return { erro: r.erro };
  return {
    payload: {
      ...(r.start_date !== undefined ? { start_date: r.start_date } : {}),
      ...(r.diaVencimento ? vencimentoNoDia(t, r.diaVencimento) : {}),
    },
  };
}

/** Marcar data numa tarefa sem data (clique = um dia; arrastar = período). */
export function payloadMarcar(de: string, ate: string): Record<string, unknown> {
  const [inicio, fim] = de <= ate ? [de, ate] : [ate, de];
  return {
    ...(inicio !== fim ? { start_date: inicio } : {}),
    due_date: `${fim}T12:00:00Z`,
    due_has_time: false,
  };
}

/** Período na tela durante o arrasto (antes de gravar). */
export function periodoPrevisto(
  p: Periodo,
  modo: 'mover' | 'inicio' | 'fim',
  delta: number,
): { inicio: string; fim: string } {
  const desloca = (dia: string, n: number) => chaveDia(somarDias(diaLocal(dia), n));
  if (modo === 'mover') return { inicio: desloca(p.inicio, delta), fim: desloca(p.fim, delta) };
  if (modo === 'inicio') {
    const inicio = desloca(p.inicio, delta);
    return inicio > p.fim ? { inicio: p.fim, fim: p.fim } : { inicio, fim: p.fim };
  }
  const fim = desloca(p.fim, delta);
  return fim < p.inicio ? { inicio: p.inicio, fim: p.inicio } : { inicio: p.inicio, fim };
}

// ── Desenho ──

/** Largura aproximada (px) de um rótulo em texto de 12px — o suficiente pra decidir dentro × fora da barra. */
export function larguraRotulo(texto: string): number {
  return Math.ceil(texto.length * 6.3) + 16;
}

/**
 * Modo compacto: põe várias tarefas na mesma faixa quando não se encostam
 * (o rótulo que fica fora da barra conta como ocupado). Primeira faixa livre,
 * na ordem de início. Devolve a faixa de cada id e quantas faixas deu.
 */
export function empacotar<T>(itens: Array<{ id: T; ini: number; fim: number }>, folga = 8): { faixa: Map<T, number>; total: number } {
  const fins: number[] = [];
  const faixa = new Map<T, number>();
  for (const it of [...itens].sort((a, b) => a.ini - b.ini || b.fim - a.fim)) {
    let f = fins.findIndex((fim) => fim + folga <= it.ini);
    if (f === -1) { f = fins.length; fins.push(it.fim); } else fins[f] = it.fim;
    faixa.set(it.id, f);
  }
  return { faixa, total: fins.length };
}

const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "qua 08/10" — rótulo curto de um dia. */
export function diaCurto(dia: string): string {
  const d = diaLocal(dia);
  return `${NOMES_DIA[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "08/10 → 12/10 · 5 dias" ou "08/10 · 1 dia". */
export function rotuloPeriodo(inicio: string, fim: string): string {
  const curto = (d: string) => diaLocal(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const n = diferencaDias(inicio, fim) + 1;
  return inicio === fim ? `${curto(fim)} · 1 dia` : `${curto(inicio)} → ${curto(fim)} · ${n} dias`;
}
