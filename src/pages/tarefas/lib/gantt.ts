// Cronograma (Gantt) — contas puras: período de cada tarefa, linhas (grupos +
// tarefas + subtarefas), ligações "só começa depois que a outra terminar",
// empurrar as seguintes, progresso, atraso e as marcas do cabeçalho.
// A tela fica em components/ViewGantt.tsx.
import type { TaskList, TaskRow } from '../hooks/useTarefas';
import { CATEGORIAS_GENERICAS, type UsuarioOption } from './agrupamento';
import { idsResponsaveis, responsaveis } from './responsaveis';
import { GRUPO_FEITO, ehFeito } from './statusFeito';
import { chaveDia, diaLocal, somarDias } from './carga';
import { formatarDuracao } from './tempo';

export type Zoom = 'dia' | 'semana' | 'mes' | 'trimestre';
export const ZOOMS: Zoom[] = ['dia', 'semana', 'mes', 'trimestre'];
export const PX_POR_DIA: Record<Zoom, number> = { dia: 40, semana: 20, mes: 7, trimestre: 2.5 };
/** Quantos dias a faixa cresce quando a rolagem chega perto da borda. */
export const FOLGA_DIAS: Record<Zoom, number> = { dia: 21, semana: 42, mes: 120, trimestre: 240 };

/** Dias ocupados pela tarefa (YYYY-MM-DD, as duas pontas valem). */
export interface Periodo { inicio: string; fim: string }

/** Ligação: a seguinte só começa depois que a anterior termina. */
export interface Dependencia { predecessor_id: string; successor_id: string }

// ── Datas ──────────────────────────────────────────────────────────────────────

export function deslocar(chave: string, dias: number): string {
  return chaveDia(somarDias(diaLocal(chave), dias));
}

/** para − de, em dias (pode ser negativo). */
export function diasEntre(de: string, para: string): number {
  return Math.round((diaLocal(para).getTime() - diaLocal(de).getTime()) / 86400000);
}

/** Duração em dias corridos, contando as duas pontas. */
export function duracao(p: Periodo): number {
  return diasEntre(p.inicio, p.fim) + 1;
}

/**
 * Período da tarefa: início → vencimento. Só vencimento (ou início depois do
 * vencimento) = um dia, o do vencimento. Só início = um dia, o do início.
 */
export function periodoDaTarefa(t: Pick<TaskRow, 'start_date' | 'due_date'>): Periodo | null {
  const fim = t.due_date ? chaveDia(diaLocal(t.due_date)) : null;
  const inicio = t.start_date ? chaveDia(diaLocal(t.start_date)) : null;
  if (fim && inicio) return inicio <= fim ? { inicio, fim } : { inicio: fim, fim };
  if (fim) return { inicio: fim, fim };
  if (inicio) return { inicio, fim: inicio };
  return null;
}

export function moverPeriodo(p: Periodo, dias: number): Periodo {
  return { inicio: deslocar(p.inicio, dias), fim: deslocar(p.fim, dias) };
}

/** Puxar uma ponta: nunca inverte (no mínimo um dia). */
export function puxarPonta(p: Periodo, lado: 'inicio' | 'fim', dias: number): Periodo {
  if (lado === 'inicio') {
    const inicio = deslocar(p.inicio, dias);
    return { inicio: inicio > p.fim ? p.fim : inicio, fim: p.fim };
  }
  const fim = deslocar(p.fim, dias);
  return { inicio: p.inicio, fim: fim < p.inicio ? p.inicio : fim };
}

/** Desenhar no vazio da linha: de onde apertou até onde soltou, em qualquer sentido. */
export function periodoDesenhado(a: string, b: string): Periodo {
  return a <= b ? { inicio: a, fim: b } : { inicio: b, fim: a };
}

/**
 * O que gravar para um período novo. Mantém a hora do vencimento, se tinha.
 * Tarefa só com início (sem vencimento) que continua de um dia só segue sem
 * vencimento — senão passaria a entrar nos avisos de vencimento sem ninguém pedir.
 */
export function payloadDoPeriodo(
  t: Pick<TaskRow, 'due_date' | 'due_has_time'> & { start_date?: string | null },
  p: Periodo,
): { start_date: string | null; due_date: string | null; due_has_time: boolean } {
  if (!t.due_date && t.start_date && p.inicio === p.fim) return { start_date: p.inicio, due_date: null, due_has_time: false };
  const start_date = p.inicio < p.fim ? p.inicio : null;
  if (t.due_has_time && t.due_date) {
    const d = new Date(t.due_date);
    const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return { start_date, due_date: new Date(`${p.fim}T${hora}:00`).toISOString(), due_has_time: true };
  }
  return { start_date, due_date: `${p.fim}T12:00:00Z`, due_has_time: false };
}

/**
 * Horas planejadas por dia (time_plan) acompanham o período: a barra andou
 * inteira → cada dia anda junto; mudou a duração → o que caiu fora do período
 * vai pra ponta mais próxima (o total de horas não muda). null = não mexer.
 */
export function planoParaPeriodo(
  plano: { dias: Record<string, number> } | null | undefined,
  antigo: Periodo | null,
  novo: Periodo,
): { dias: Record<string, number> } | null {
  if (!plano || !Object.keys(plano.dias ?? {}).length) return null;
  const dias: Record<string, number> = {};
  const somar = (d: string, m: number) => { dias[d] = (dias[d] ?? 0) + m; };
  if (antigo && duracao(antigo) === duracao(novo)) {
    const delta = diasEntre(antigo.inicio, novo.inicio);
    if (delta === 0) return null;
    for (const [d, m] of Object.entries(plano.dias)) somar(deslocar(d, delta), m);
    return { dias };
  }
  let mudou = false;
  for (const [d, m] of Object.entries(plano.dias)) {
    const alvo = d < novo.inicio ? novo.inicio : d > novo.fim ? novo.fim : d;
    if (alvo !== d) mudou = true;
    somar(alvo, m);
  }
  if (!mudou) return null;
  // Ponta com mais de 24h (o task-write recusa): reparte igual pelo período.
  if (Object.values(dias).some((m) => m > 1440)) {
    const total = Object.values(plano.dias).reduce((a, b) => a + b, 0);
    const n = Math.min(duracao(novo), 366);
    const base = Math.floor(total / n);
    const resto = total - base * n;
    const igual: Record<string, number> = {};
    for (let k = 0; k < n; k++) igual[deslocar(novo.inicio, k)] = base + (k < resto ? 1 : 0);
    return { dias: igual };
  }
  return { dias };
}

/** Atalhos de "sem data → agenda num toque". */
export function periodoRapido(opcao: 'hoje' | 'amanha' | 'semana' | 'proxima', hoje: string): Periodo {
  if (opcao === 'hoje') return { inicio: hoje, fim: hoje };
  if (opcao === 'amanha') { const d = deslocar(hoje, 1); return { inicio: d, fim: d }; }
  // Semana de trabalho: até sábado (restaurante trabalha no sábado).
  const dow = diaLocal(hoje).getDay(); // 0 = domingo
  if (opcao === 'semana') return { inicio: hoje, fim: deslocar(hoje, Math.max(0, 6 - dow)) };
  const segunda = deslocar(hoje, ((8 - dow) % 7) || 7);
  return { inicio: segunda, fim: deslocar(segunda, 5) };
}

// ── Ligações ───────────────────────────────────────────────────────────────────

/** A seguinte começa antes de a anterior terminar? (mesmo dia pode.) */
export function emConflito(anterior: Periodo, seguinte: Periodo): boolean {
  return seguinte.inicio < anterior.fim;
}

/** Criar anterior → seguinte fecharia um ciclo? (a seguinte já vem antes da anterior). */
export function criaCiclo(deps: Dependencia[], anteriorId: string, seguinteId: string): boolean {
  if (anteriorId === seguinteId) return true;
  const seguintes = new Map<string, string[]>();
  for (const d of deps) seguintes.set(d.predecessor_id, [...(seguintes.get(d.predecessor_id) ?? []), d.successor_id]);
  const vistos = new Set<string>();
  const fila = [seguinteId];
  while (fila.length) {
    const id = fila.shift()!;
    if (id === anteriorId) return true;
    if (vistos.has(id)) continue;
    vistos.add(id);
    fila.push(...(seguintes.get(id) ?? []));
  }
  return false;
}

/**
 * Depois de mudar o período de algumas tarefas, empurra as seguintes (em cadeia)
 * só o necessário para começarem no dia em que a anterior termina. Nunca puxa
 * para trás, não mexe nas `fixas` (concluídas/canceladas: são história) nem nas
 * sem data. Devolve só as que mudaram (sem as `mudadas` de entrada).
 */
export function empurrarSeguintes(
  periodos: Map<string, Periodo>,
  deps: Dependencia[],
  mudadas: Map<string, Periodo>,
  fixas: Set<string> = new Set(),
): Map<string, Periodo> {
  const atual = new Map(periodos);
  for (const [id, p] of mudadas) atual.set(id, p);
  const seguintes = new Map<string, string[]>();
  for (const d of deps) seguintes.set(d.predecessor_id, [...(seguintes.get(d.predecessor_id) ?? []), d.successor_id]);
  const empurradas = new Map<string, Periodo>();
  const fila = [...mudadas.keys()];
  // Limite contra ciclo vindo do banco (o task-write recusa, mas a tela não confia).
  for (let passos = 0; fila.length && passos < 5000; passos++) {
    const id = fila.shift()!;
    const anterior = atual.get(id);
    if (!anterior) continue;
    for (const sid of seguintes.get(id) ?? []) {
      if (fixas.has(sid) || mudadas.has(sid)) continue;
      const p = atual.get(sid);
      if (!p || !emConflito(anterior, p)) continue;
      const novo = moverPeriodo(p, diasEntre(p.inicio, anterior.fim));
      atual.set(sid, novo);
      empurradas.set(sid, novo);
      fila.push(sid);
    }
  }
  return empurradas;
}

// ── Progresso e atraso ─────────────────────────────────────────────────────────

export function concluida(t: Pick<TaskRow, 'status_category'>): boolean {
  return t.status_category === 'done';
}

/**
 * Quanto da barra pintar: concluída = tudo; senão checklist; senão subtarefas;
 * senão o tempo cronometrado sobre o estimado. `texto` diz de onde veio.
 */
export function progressoDaTarefa(
  t: Pick<TaskRow, 'status_category' | 'checklist_total' | 'checklist_done' | 'time_estimate_minutes' | 'time_tracked_seconds'>,
  subtarefas: Array<Pick<TaskRow, 'status_category'>> = [],
): { fracao: number; texto: string | null } {
  if (concluida(t)) return { fracao: 1, texto: 'Concluída' };
  if (t.checklist_total > 0) {
    return { fracao: t.checklist_done / t.checklist_total, texto: `Checklist ${t.checklist_done}/${t.checklist_total}` };
  }
  if (subtarefas.length) {
    const feitas = subtarefas.filter(concluida).length;
    return { fracao: feitas / subtarefas.length, texto: `Subtarefas ${feitas}/${subtarefas.length}` };
  }
  const estimativa = t.time_estimate_minutes ?? 0;
  const feito = Math.floor((t.time_tracked_seconds ?? 0) / 60);
  if (estimativa > 0 && feito > 0) {
    return {
      fracao: Math.min(1, feito / estimativa),
      texto: `Tempo ${formatarDuracao(feito * 60)} de ${formatarDuracao(estimativa * 60)}`,
    };
  }
  return { fracao: 0, texto: null };
}

/**
 * Atraso no cronograma: aberta com o fim antes de hoje (a barra ganha uma cauda
 * vermelha até hoje) ou concluída depois do fim (cauda até o dia em que terminou).
 */
export function atrasoDaTarefa(
  t: Pick<TaskRow, 'status_category' | 'completed_at' | 'due_date'>,
  p: Periodo,
  hoje: string,
): { tipo: 'atrasada' | 'terminou_depois'; ate: string; dias: number } | null {
  // Atraso é pelo vencimento, como no resto do módulo (só início não atrasa).
  if (t.status_category === 'cancelled' || !t.due_date) return null;
  if (concluida(t)) {
    if (!t.completed_at) return null;
    const terminou = chaveDia(new Date(t.completed_at));
    return terminou > p.fim ? { tipo: 'terminou_depois', ate: terminou, dias: diasEntre(p.fim, terminou) } : null;
  }
  return p.fim < hoje ? { tipo: 'atrasada', ate: hoje, dias: diasEntre(p.fim, hoje) } : null;
}

/** Início mais cedo e fim mais tarde de um conjunto (null = nenhum com data). */
export function envoltoria(periodos: Array<Periodo | null>): Periodo | null {
  let inicio: string | null = null;
  let fim: string | null = null;
  for (const p of periodos) {
    if (!p) continue;
    if (!inicio || p.inicio < inicio) inicio = p.inicio;
    if (!fim || p.fim > fim) fim = p.fim;
  }
  return inicio && fim ? { inicio, fim } : null;
}

// ── Linhas ─────────────────────────────────────────────────────────────────────

export type ModoAgrupar = 'pasta' | 'responsavel' | 'status' | 'nenhum';
export type OrdemGantt = 'manual' | 'inicio';

export interface LinhaGrupo {
  tipo: 'grupo';
  key: string;
  label: string;
  cor: string;
  nivel: number;
  recolhido: boolean;
  total: number;
  concluidas: number;
  /** Do primeiro início ao último fim das tarefas do grupo (barra-resumo). */
  periodo: Periodo | null;
  /** Agrupando por pessoa: de quem é (a faixa de carga usa). */
  pessoaId?: string | null;
  /** Agrupando por pasta: a pasta (o "+ tarefa" do grupo cria nela). */
  listId?: string | null;
}

export interface LinhaTarefa {
  tipo: 'tarefa';
  key: string;
  task: TaskRow;
  nivel: number;
  temFilhas: boolean;
  recolhido: boolean;
  periodo: Periodo | null;
  /** Tarefa-pai sem data própria: do início ao fim das subtarefas (barra tracejada). */
  resumo: Periodo | null;
  filhas: TaskRow[];
}

/** Linha de "+ Nova tarefa" no fim de um grupo de pasta (ou da pasta aberta). */
export interface LinhaNova {
  tipo: 'nova';
  key: string;
  nivel: number;
  listId: string;
}

export type Linha = LinhaGrupo | LinhaTarefa | LinhaNova;

interface OpcoesLinhas {
  tasks: TaskRow[];
  modo: ModoAgrupar;
  /** Todas as pastas que eu enxergo (para montar a árvore de subpastas). */
  lists: TaskList[];
  /** Pasta aberta (origem "pasta"): as tarefas dela ficam soltas no topo, as das subpastas em grupos. */
  raizId: string | null;
  usuarios: UsuarioOption[];
  recolhidos: Set<string>;
  ordem: OrdemGantt;
  /** Mostrar as tarefas sem data (padrão: sim — sumir com elas é a reclamação nº 1). */
  mostrarSemData: boolean;
  /** Pastas em que posso criar tarefa (ganham a linha "+ Nova tarefa"). */
  podeCriarEm?: (listId: string) => boolean;
}

/** Ordem dos irmãos: a manual (sort_order, igual à Lista) ou pelo início. */
function ordenar(tasks: TaskRow[], ordem: OrdemGantt): TaskRow[] {
  return [...tasks].sort((a, b) => {
    if (ordem === 'inicio') {
      const pa = periodoDaTarefa(a)?.inicio ?? '9999';
      const pb = periodoDaTarefa(b)?.inicio ?? '9999';
      if (pa !== pb) return pa.localeCompare(pb);
    }
    return a.sort_order - b.sort_order;
  });
}

/**
 * Monta as linhas na ordem da tela. Por pasta: subpastas viram grupos aninhados
 * e subtarefas ficam embaixo da tarefa-pai (recolhível). Por pessoa/status:
 * lista plana em cada grupo (tarefa com vários responsáveis aparece em cada um).
 */
export function montarLinhas(o: OpcoesLinhas): Linha[] {
  const visiveis = new Set(o.tasks.map((t) => t.id));
  const filhasDe = new Map<string, TaskRow[]>();
  for (const t of o.tasks) {
    if (t.parent_task_id && visiveis.has(t.parent_task_id)) {
      filhasDe.set(t.parent_task_id, [...(filhasDe.get(t.parent_task_id) ?? []), t]);
    }
  }
  const aninhar = o.modo === 'pasta' || o.modo === 'nenhum';
  const linhas: Linha[] = [];

  /** Período próprio ou, sem data, o das subtarefas (recursivo). */
  const resumoCache = new Map<string, Periodo | null>();
  const resumoDe = (t: TaskRow, guarda = 0): Periodo | null => {
    if (resumoCache.has(t.id)) return resumoCache.get(t.id)!;
    const r = guarda > 30 ? null : envoltoria((filhasDe.get(t.id) ?? []).map((f) => periodoDaTarefa(f) ?? resumoDe(f, guarda + 1)));
    resumoCache.set(t.id, r);
    return r;
  };
  const aparece = (t: TaskRow) => o.mostrarSemData || !!periodoDaTarefa(t) || (aninhar && !!resumoDe(t));

  /** `prefixo`: por pessoa/status a mesma tarefa pode estar em dois grupos — a chave da linha precisa ser única. */
  const empurrarTarefa = (t: TaskRow, nivel: number, prefixo = '') => {
    if (!aparece(t)) return;
    const filhas = aninhar ? ordenar(filhasDe.get(t.id) ?? [], o.ordem) : [];
    const key = `${prefixo}t:${t.id}`;
    const periodo = periodoDaTarefa(t);
    const recolhido = o.recolhidos.has(key);
    linhas.push({
      tipo: 'tarefa', key, task: t, nivel, temFilhas: filhas.length > 0, recolhido,
      periodo, resumo: !periodo && filhas.length ? resumoDe(t) : null, filhas: filhasDe.get(t.id) ?? [],
    });
    if (!recolhido) for (const f of filhas) empurrarTarefa(f, nivel + 1);
  };
  /** Tarefas de um grupo: no modo aninhado, só as que não estão embaixo de uma pai visível. */
  const raizesDe = (tasks: TaskRow[]) => (aninhar ? tasks.filter((t) => !t.parent_task_id || !visiveis.has(t.parent_task_id)) : tasks);
  /** Todas as tarefas do grupo, com as subtarefas (para contar e para a barra-resumo). */
  const comDescendentes = (tasks: TaskRow[]): TaskRow[] => {
    if (!aninhar) return tasks;
    const out: TaskRow[] = [];
    const ver = (t: TaskRow, g = 0) => { out.push(t); if (g < 30) for (const f of filhasDe.get(t.id) ?? []) ver(f, g + 1); };
    tasks.forEach((t) => ver(t));
    return out;
  };
  const grupo = (
    key: string, label: string, cor: string, nivel: number, todas: TaskRow[], extra: Partial<LinhaGrupo> = {},
  ): LinhaGrupo => ({
    tipo: 'grupo', key, label, cor, nivel, recolhido: o.recolhidos.has(key),
    total: todas.length, concluidas: todas.filter(concluida).length,
    periodo: envoltoria(todas.map((t) => periodoDaTarefa(t))), ...extra,
  });

  if (o.modo === 'pasta') {
    const listaPorId = new Map(o.lists.map((l) => [l.id, l]));
    interface No { id: string; label: string; cor: string; ordem: number; tasks: TaskRow[]; filhas: No[] }
    const nos = new Map<string, No>();
    const raizes: No[] = [];
    const soltas: TaskRow[] = []; // tarefas da pasta aberta: sem cabeçalho
    const pegarNo = (listId: string, t?: TaskRow): No => {
      const ja = nos.get(listId);
      if (ja) return ja;
      const l = listaPorId.get(listId);
      const no: No = {
        id: listId,
        label: l?.name ?? t?.list_name ?? 'Pasta',
        cor: l?.color ?? t?.list_color ?? '#94a3b8',
        ordem: l?.sort_order ?? Number.MAX_SAFE_INTEGER,
        tasks: [],
        filhas: [],
      };
      nos.set(listId, no);
      // Sobe até a pasta aberta (ou até a raiz) criando os grupos do caminho.
      const paiId = l?.parent_list_id ?? null;
      if (paiId && paiId !== o.raizId && listaPorId.has(paiId)) pegarNo(paiId).filhas.push(no);
      else raizes.push(no);
      return no;
    };
    for (const t of raizesDe(o.tasks)) {
      if (o.raizId && t.list_id === o.raizId) soltas.push(t);
      else pegarNo(t.list_id, t).tasks.push(t);
    }
    // A pasta aberta: suas tarefas primeiro, soltas, e o "+ Nova tarefa" dela.
    for (const t of ordenar(soltas, o.ordem)) empurrarTarefa(t, 0);
    if (o.raizId && o.podeCriarEm?.(o.raizId)) linhas.push({ tipo: 'nova', key: `n:${o.raizId}`, nivel: 0, listId: o.raizId });

    const todasDoNo = (n: No): TaskRow[] => [...comDescendentes(n.tasks), ...n.filhas.flatMap(todasDoNo)];
    const visitar = (lista: No[], nivel: number) => {
      for (const n of [...lista].sort((a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label, 'pt-BR'))) {
        const g = grupo(`g:pasta:${n.id}`, n.label, n.cor, nivel, todasDoNo(n), { listId: n.id });
        if (!o.mostrarSemData && !g.periodo) continue;
        linhas.push(g);
        if (g.recolhido) continue;
        for (const t of ordenar(n.tasks, o.ordem)) empurrarTarefa(t, nivel + 1);
        if (o.podeCriarEm?.(n.id)) linhas.push({ tipo: 'nova', key: `n:${n.id}`, nivel: nivel + 1, listId: n.id });
        visitar(n.filhas, nivel + 1);
      }
    };
    visitar(raizes, 0);
    return linhas;
  }

  if (o.modo === 'nenhum') {
    for (const t of ordenar(raizesDe(o.tasks), o.ordem)) empurrarTarefa(t, 0);
    return linhas;
  }

  if (o.modo === 'responsavel') {
    const ids = [...new Set(o.tasks.flatMap((t) => idsResponsaveis(t)))];
    const posicao = (id: string) => { const i = o.usuarios.findIndex((u) => u.id === id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
    const nomeDe = (id: string) => o.usuarios.find((u) => u.id === id)?.nome
      ?? o.tasks.flatMap((t) => responsaveis(t)).find((r) => r.id === id && r.name)?.name ?? 'Usuário sem nome';
    const grupos = ids
      .map((id) => ({ id: id as string | null, label: nomeDe(id), tasks: o.tasks.filter((t) => idsResponsaveis(t).includes(id)) }))
      .sort((a, b) => posicao(a.id!) - posicao(b.id!) || a.label.localeCompare(b.label, 'pt-BR'));
    const sem = o.tasks.filter((t) => !idsResponsaveis(t).length);
    if (sem.length) grupos.push({ id: null, label: 'Sem responsável', tasks: sem });
    for (const gr of grupos) {
      const g = grupo(`g:pessoa:${gr.id ?? 'nenhum'}`, gr.label, gr.id ? '#6366f1' : '#94a3b8', 0, gr.tasks, { pessoaId: gr.id });
      if (!o.mostrarSemData && !g.periodo) continue;
      linhas.push(g);
      if (!g.recolhido) for (const t of ordenar(gr.tasks, o.ordem)) empurrarTarefa(t, 1, `${g.key}|`);
    }
    return linhas;
  }

  // status: pela categoria (as tarefas podem vir de várias pastas, cada uma com seus status).
  const categorias: Array<{ key: string; label: string; color: string; tasks: TaskRow[] }> = [];
  for (const c of CATEGORIAS_GENERICAS) {
    if (c.key === 'done') {
      const feitos = o.tasks.filter(ehFeito);
      if (feitos.length) categorias.push({ ...GRUPO_FEITO, tasks: feitos });
    }
    categorias.push({ key: c.key, label: c.label, color: c.color, tasks: o.tasks.filter((t) => t.status_category === c.key && !ehFeito(t)) });
  }
  for (const c of categorias) {
    if (!c.tasks.length) continue;
    const g = grupo(`g:status:${c.key}`, c.label, c.color, 0, c.tasks);
    if (!o.mostrarSemData && !g.periodo) continue;
    linhas.push(g);
    if (!g.recolhido) for (const t of ordenar(c.tasks, o.ordem)) empurrarTarefa(t, 1, `${g.key}|`);
  }
  return linhas;
}

// ── Faixa e cabeçalho ──────────────────────────────────────────────────────────

/** Faixa inicial: cobre as tarefas e hoje, com folga dos dois lados. */
export function faixaInicial(periodos: Array<Periodo | null>, hoje: string, zoom: Zoom): Periodo {
  const env = envoltoria([...periodos, { inicio: hoje, fim: hoje }])!;
  const folga = FOLGA_DIAS[zoom];
  // Não abre anos para trás por causa de uma tarefa esquecida: no máximo 1 ano antes de hoje.
  const limiteAntes = deslocar(hoje, -365);
  const inicio = env.inicio < limiteAntes ? limiteAntes : env.inicio;
  return { inicio: deslocar(inicio, -folga), fim: deslocar(env.fim > deslocar(hoje, 730) ? deslocar(hoje, 730) : env.fim, folga) };
}

export interface Marca { x: number; largura: number; rotulo: string; destaque?: boolean }

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** Divide [inicio, inicio + dias) em pedaços que começam quando `chaveDe` muda. */
function pedacos(inicio: string, dias: number, px: number, chaveDe: (d: Date) => string, rotuloDe: (d: Date) => string): Marca[] {
  const marcas: Marca[] = [];
  let atual = '';
  const base = diaLocal(inicio);
  for (let i = 0; i < dias; i++) {
    const d = somarDias(base, i);
    const k = chaveDe(d);
    if (k !== atual) {
      atual = k;
      marcas.push({ x: i * px, largura: px, rotulo: rotuloDe(d) });
    } else {
      marcas[marcas.length - 1].largura += px;
    }
  }
  return marcas;
}

/** As duas linhas do cabeçalho para o zoom. */
export function marcasCabecalho(inicio: string, dias: number, zoom: Zoom, hoje: string): { cima: Marca[]; baixo: Marca[] } {
  const px = PX_POR_DIA[zoom];
  const mesAno = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  if (zoom === 'dia') {
    return {
      cima: pedacos(inicio, dias, px, mesAno, (d) => `${MESES_LONGOS[d.getMonth()]} ${d.getFullYear()}`),
      baixo: pedacos(inicio, dias, px, chaveDia, (d) => `${DIAS_SEMANA[d.getDay()]} ${d.getDate()}`)
        .map((m, i) => ({ ...m, destaque: deslocar(inicio, i) === hoje })),
    };
  }
  if (zoom === 'semana') {
    // Semana começa na segunda (igual à Carga).
    const segundaDe = (d: Date) => chaveDia(somarDias(d, -((d.getDay() + 6) % 7)));
    return {
      cima: pedacos(inicio, dias, px, mesAno, (d) => `${MESES_LONGOS[d.getMonth()]} ${d.getFullYear()}`),
      baixo: pedacos(inicio, dias, px, segundaDe, (d) => {
        const s = diaLocal(segundaDe(d));
        return `${s.getDate()} ${MESES[s.getMonth()]}`;
      }).map((m) => {
        const ini = deslocar(inicio, Math.round(m.x / px));
        const fim = deslocar(ini, Math.round(m.largura / px) - 1);
        return { ...m, destaque: hoje >= ini && hoje <= fim };
      }),
    };
  }
  const ano = (d: Date) => String(d.getFullYear());
  if (zoom === 'mes') {
    return {
      cima: pedacos(inicio, dias, px, ano, ano),
      baixo: pedacos(inicio, dias, px, mesAno, (d) => MESES[d.getMonth()]).map((m) => {
        const d = diaLocal(deslocar(inicio, Math.round(m.x / px)));
        return { ...m, destaque: mesAno(d) === mesAno(diaLocal(hoje)) };
      }),
    };
  }
  const trimestre = (d: Date) => `${d.getFullYear()}-${Math.floor(d.getMonth() / 3)}`;
  return {
    cima: pedacos(inicio, dias, px, trimestre, (d) => `${Math.floor(d.getMonth() / 3) + 1}º tri ${d.getFullYear()}`),
    baixo: pedacos(inicio, dias, px, mesAno, (d) => MESES[d.getMonth()].slice(0, 1).toUpperCase()),
  };
}

/** "02/10", "02/10 → 05/10 (4 dias)". */
export function rotuloPeriodo(p: Periodo, comDuracao = false): string {
  const curto = (c: string) => `${c.slice(8, 10)}/${c.slice(5, 7)}`;
  if (p.inicio === p.fim) return curto(p.fim);
  const n = duracao(p);
  return `${curto(p.inicio)} → ${curto(p.fim)}${comDuracao ? ` (${n} dias)` : ''}`;
}
