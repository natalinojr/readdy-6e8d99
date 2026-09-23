// Modelos de estrutura de pastas (Tarefas) — lógica pura, sem Deno nem browser.
// Usado pela Edge task-write (gravar/aplicar) e pela tela (pré-visualização),
// e testado no Vitest (src/test/components/tarefasModelosEstrutura.test.tsx).
//
// Ideia central:
//  - O modelo guarda uma CÓPIA COMPLETA da pasta (subpastas, status, campos,
//    tarefas com tudo). O que é criado ao aplicar é decidido pelas OPÇÕES e
//    pelos itens desmarcados na árvore (`excluidos`) — por isso dá pra mudar o
//    que entra no modelo depois, sem regravar a partir da pasta.
//  - Datas nunca ficam fixas: a data mais antiga da pasta vira o "dia 0" e as
//    outras viram "dia +N". Ao aplicar, quem aplica escolhe a data do dia 0.
//  - Refs dentro do modelo são os ids ORIGINAIS (pasta, tarefa, status, campo):
//    são estáveis entre pré-visualizar e gravar, e servem pra remapear
//    agrupamento/colunas que citam campos (`field:<id>`, `campo:<id>`).
// Mudar aqui exige redeploy do task-write.

export const FORMATO_MODELO = 1;

/** Fuso das lojas (Brasil sem horário de verão desde 2019). */
const OFFSET_MS = -3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

export const LIMITE_PASTAS = 200;
export const LIMITE_TAREFAS = 3000;

// ─── Tipos do conteúdo guardado ──────────────────────────────────────────────

export type CategoriaStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';

export interface StatusModelo {
  ref: string;
  name: string;
  color: string;
  category: CategoriaStatus;
  sort_order: number;
}

export interface CampoModelo {
  ref: string;
  name: string;
  field_type: string;
  options: unknown[];
  show_on_card: boolean;
  sort_order: number;
}

export interface ValorModelo {
  /** Id do campo de origem. */
  campo_ref: string;
  /** Campo global (vale pra todas as pastas): ao aplicar, reaproveita o mesmo campo se ainda existir. */
  global: boolean;
  value: unknown;
}

export interface TarefaModelo {
  ref: string;
  title: string;
  description: string | null;
  priority: number;
  status_ref: string | null;
  status_category: CategoriaStatus | null;
  concluida: boolean;
  assignee_id: string | null;
  /** Dias a partir do dia 0 (null = sem data). */
  start_dia: number | null;
  due_dia: number | null;
  /** 'HH:MM' no horário de Brasília quando o vencimento tem hora. */
  due_hora: string | null;
  recurrence: { freq?: string; interval?: number } | null;
  time_estimate_minutes: number | null;
  sort_order: number;
  checklist: Array<{ title: string; is_done: boolean }>;
  etiquetas: Array<{ name: string; color: string }>;
  valores: ValorModelo[];
  subtarefas: TarefaModelo[];
}

export interface VisaoModelo {
  name: string;
  view_type: string;
  group_by: string;
  filters: Record<string, unknown>;
}

/** Preferências de exibição da pasta (no navegador de quem gravou). */
export interface ExibicaoModelo {
  agrupar?: string | null;
  colunas?: string[] | null;
  ordem?: string[] | null;
  larguras?: Record<string, number> | null;
}

export interface PastaModelo {
  ref: string;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
  statuses: StatusModelo[];
  campos: CampoModelo[];
  tarefas: TarefaModelo[];
  visoes: VisaoModelo[];
  exibicao: ExibicaoModelo | null;
  filhas: PastaModelo[];
}

export interface ModeloConteudo {
  formato: number;
  /** Dia 0 original (YYYY-MM-DD) — só informativo. */
  data_referencia: string | null;
  raiz: PastaModelo;
}

export interface OpcoesModelo {
  subpastas: boolean;
  status: boolean;
  campos: boolean;
  tarefas: boolean;
  /** Incluir tarefas já concluídas/canceladas. */
  concluidas: boolean;
  /** Tarefa nasce no mesmo status da origem (senão, no primeiro status). */
  manter_status: boolean;
  subtarefas: boolean;
  descricao: boolean;
  checklist: boolean;
  etiquetas: boolean;
  responsavel: boolean;
  datas: boolean;
  recorrencia: boolean;
  estimativa: boolean;
  valores_campos: boolean;
  visoes: boolean;
  /** Refs de pastas/tarefas desmarcadas na árvore (vão junto as de dentro). */
  excluidos: string[];
}

export const OPCOES_PADRAO: OpcoesModelo = {
  subpastas: true,
  status: true,
  campos: true,
  tarefas: true,
  concluidas: false,
  manter_status: false,
  subtarefas: true,
  descricao: true,
  checklist: true,
  etiquetas: true,
  responsavel: false,
  datas: true,
  recorrencia: true,
  estimativa: true,
  valores_campos: true,
  visoes: true,
  excluidos: [],
};

/** Completa opções vindas do banco/cliente (chaves novas ganham o padrão). */
export function normalizarOpcoes(o: unknown): OpcoesModelo {
  const obj = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const r = { ...OPCOES_PADRAO, excluidos: [] as string[] } as unknown as Record<string, unknown>;
  for (const k of Object.keys(OPCOES_PADRAO)) {
    if (k === 'excluidos') continue;
    if (typeof obj[k] === 'boolean') r[k] = obj[k];
  }
  r.excluidos = Array.isArray(obj.excluidos) ? (obj.excluidos as unknown[]).filter((x) => typeof x === 'string') : [];
  return r as unknown as OpcoesModelo;
}

// ─── Datas ───────────────────────────────────────────────────────────────────

/** Dia (YYYY-MM-DD) no horário de Brasília de um timestamp ou data. */
export function diaLocal(valor: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  return new Date(new Date(valor).getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** 'HH:MM' no horário de Brasília. */
export function horaLocal(valor: string): string {
  return new Date(new Date(valor).getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

export function diferencaDias(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);
}

export function somarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
}

/** due_date a gravar: com hora → aquele horário de Brasília; sem hora → meio-dia UTC (igual ao editor da lista). */
export function vencimentoIso(dia: string, hora: string | null): string {
  if (hora) return new Date(`${dia}T${hora}:00-03:00`).toISOString();
  return `${dia}T12:00:00Z`;
}

// ─── Gravar: linhas do banco → conteúdo do modelo ────────────────────────────

export interface OrigemBruta {
  raiz_id: string;
  pastas: Array<{ id: string; name: string; color: string; icon: string | null; parent_list_id: string | null; sort_order: number | null }>;
  statuses: Array<{ id: string; list_id: string; name: string; color: string; category: string; sort_order: number | null }>;
  campos: Array<{ id: string; list_id: string; name: string; field_type: string; options: unknown; show_on_card: boolean | null; sort_order: number | null }>;
  tarefas: Array<{
    id: string; list_id: string; parent_task_id: string | null; title: string; description: string | null;
    status_id: string | null; priority: number | null; assignee_id: string | null;
    start_date: string | null; due_date: string | null; due_has_time: boolean | null;
    recurrence: unknown; time_estimate_minutes: number | null; sort_order: number | null;
  }>;
  checklist: Array<{ task_id: string; title: string; is_done: boolean | null; sort_order: number | null }>;
  etiquetas: Array<{ task_id: string; name: string; color: string }>;
  valores: Array<{ task_id: string; field_id: string; global: boolean; value: unknown }>;
  visoes: Array<{ list_id: string; name: string; view_type: string; group_by: string; filters: unknown; sort_order: number | null }>;
  /** Por id de pasta — vem do navegador de quem grava. */
  exibicao?: Record<string, ExibicaoModelo | null | undefined>;
}

const num = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0);

function limparExibicao(e: ExibicaoModelo | null | undefined): ExibicaoModelo | null {
  if (!e || typeof e !== 'object') return null;
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 100) : null);
  const larguras: Record<string, number> = {};
  if (e.larguras && typeof e.larguras === 'object') {
    for (const [k, v] of Object.entries(e.larguras)) if (typeof v === 'number' && isFinite(v)) larguras[k] = v;
  }
  const r: ExibicaoModelo = {
    agrupar: typeof e.agrupar === 'string' ? e.agrupar : null,
    colunas: lista(e.colunas),
    ordem: lista(e.ordem),
    larguras: Object.keys(larguras).length ? larguras : null,
  };
  return r.agrupar || r.colunas || r.ordem || r.larguras ? r : null;
}

export function montarModelo(b: OrigemBruta): ModeloConteudo {
  const raizBruta = b.pastas.find((p) => p.id === b.raiz_id);
  if (!raizBruta) throw new Error('Pasta de origem não encontrada');

  const idsTarefas = new Set(b.tarefas.map((t) => t.id));
  const statusPorId = new Map(b.statuses.map((s) => [s.id, s]));

  // Dia 0 = a data mais antiga (início ou vencimento) entre todas as tarefas
  const dias: string[] = [];
  for (const t of b.tarefas) {
    if (t.start_date) dias.push(diaLocal(t.start_date));
    if (t.due_date) dias.push(diaLocal(t.due_date));
  }
  const referencia = dias.length ? dias.sort()[0] : null;

  const checklistPor = agruparPor(b.checklist, (c) => c.task_id);
  const etiquetasPor = agruparPor(b.etiquetas, (e) => e.task_id);
  const valoresPor = agruparPor(b.valores, (v) => v.task_id);
  // Subtarefa cujo pai não veio (arquivado) vira tarefa de primeiro nível
  const filhasPor = agruparPor(b.tarefas.filter((t) => t.parent_task_id && idsTarefas.has(t.parent_task_id)), (t) => t.parent_task_id as string);

  const montarTarefa = (t: OrigemBruta['tarefas'][number]): TarefaModelo => {
    const st = t.status_id ? statusPorId.get(t.status_id) : undefined;
    const cat = (st?.category ?? null) as CategoriaStatus | null;
    const rec = t.recurrence && typeof t.recurrence === 'object' && (t.recurrence as { freq?: unknown }).freq
      ? (t.recurrence as TarefaModelo['recurrence']) : null;
    return {
      ref: t.id,
      title: t.title,
      description: t.description ?? null,
      priority: num(t.priority),
      status_ref: st?.id ?? null,
      status_category: cat,
      concluida: cat === 'done' || cat === 'cancelled',
      assignee_id: t.assignee_id ?? null,
      start_dia: t.start_date && referencia ? diferencaDias(referencia, diaLocal(t.start_date)) : null,
      due_dia: t.due_date && referencia ? diferencaDias(referencia, diaLocal(t.due_date)) : null,
      due_hora: t.due_date && t.due_has_time ? horaLocal(t.due_date) : null,
      recurrence: rec,
      time_estimate_minutes: typeof t.time_estimate_minutes === 'number' ? t.time_estimate_minutes : null,
      sort_order: num(t.sort_order),
      checklist: (checklistPor.get(t.id) ?? [])
        .slice().sort((a, c) => num(a.sort_order) - num(c.sort_order))
        .map((c) => ({ title: c.title, is_done: !!c.is_done })),
      etiquetas: (etiquetasPor.get(t.id) ?? []).map((e) => ({ name: e.name, color: e.color })),
      valores: (valoresPor.get(t.id) ?? []).map((v) => ({ campo_ref: v.field_id, global: v.global, value: v.value })),
      subtarefas: (filhasPor.get(t.id) ?? []).slice().sort(porOrdem).map(montarTarefa),
    };
  };

  const pastasPorPai = agruparPor(b.pastas.filter((p) => p.id !== b.raiz_id), (p) => p.parent_list_id ?? '');
  const visitadas = new Set<string>();
  const montarPasta = (p: OrigemBruta['pastas'][number]): PastaModelo => {
    visitadas.add(p.id);
    return {
      ref: p.id,
      name: p.name,
      color: p.color,
      icon: p.icon ?? null,
      sort_order: num(p.sort_order),
      statuses: b.statuses.filter((s) => s.list_id === p.id).sort(porOrdem).map((s) => ({
        ref: s.id, name: s.name, color: s.color, category: s.category as CategoriaStatus, sort_order: num(s.sort_order),
      })),
      campos: b.campos.filter((c) => c.list_id === p.id).sort(porOrdem).map((c) => ({
        ref: c.id, name: c.name, field_type: c.field_type,
        options: Array.isArray(c.options) ? c.options : [], show_on_card: !!c.show_on_card, sort_order: num(c.sort_order),
      })),
      tarefas: b.tarefas
        .filter((t) => t.list_id === p.id && !(t.parent_task_id && idsTarefas.has(t.parent_task_id)))
        .sort(porOrdem).map(montarTarefa),
      visoes: b.visoes.filter((v) => v.list_id === p.id).sort(porOrdem).map((v) => ({
        name: v.name, view_type: v.view_type, group_by: v.group_by,
        filters: v.filters && typeof v.filters === 'object' ? (v.filters as Record<string, unknown>) : {},
      })),
      exibicao: limparExibicao(b.exibicao?.[p.id]),
      filhas: (pastasPorPai.get(p.id) ?? []).filter((f) => !visitadas.has(f.id)).sort(porOrdem).map(montarPasta),
    };
  };

  return { formato: FORMATO_MODELO, data_referencia: referencia, raiz: montarPasta(raizBruta) };
}

function agruparPor<T>(itens: T[], chave: (i: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of itens) {
    const k = chave(i);
    const l = m.get(k);
    if (l) l.push(i);
    else m.set(k, [i]);
  }
  return m;
}

function porOrdem(a: { sort_order: number | null }, b: { sort_order: number | null }) {
  return num(a.sort_order) - num(b.sort_order);
}

// ─── Opções: o que efetivamente entra ────────────────────────────────────────

/** Conteúdo com só o que as opções e a árvore deixam passar. */
export function filtrarModelo(c: ModeloConteudo, o: OpcoesModelo): ModeloConteudo {
  const excl = new Set(o.excluidos);
  const camposInclusos = new Set<string>();
  if (o.campos) {
    const juntar = (p: PastaModelo) => {
      if (excl.has(p.ref) && p !== c.raiz) return;
      p.campos.forEach((f) => camposInclusos.add(f.ref));
      if (o.subpastas) p.filhas.forEach(juntar);
    };
    juntar(c.raiz);
  }

  const filtrarTarefa = (t: TarefaModelo): TarefaModelo | null => {
    if (excl.has(t.ref)) return null;
    if (!o.concluidas && t.concluida) return null;
    return {
      ...t,
      description: o.descricao ? t.description : null,
      status_ref: o.manter_status ? t.status_ref : null,
      status_category: o.manter_status ? t.status_category : null,
      assignee_id: o.responsavel ? t.assignee_id : null,
      start_dia: o.datas ? t.start_dia : null,
      due_dia: o.datas ? t.due_dia : null,
      due_hora: o.datas ? t.due_hora : null,
      recurrence: o.recorrencia ? t.recurrence : null,
      time_estimate_minutes: o.estimativa ? t.time_estimate_minutes : null,
      checklist: o.checklist ? t.checklist.map((i) => ({ title: i.title, is_done: false })) : [],
      etiquetas: o.etiquetas ? t.etiquetas : [],
      valores: o.valores_campos ? t.valores.filter((v) => v.global || camposInclusos.has(v.campo_ref)) : [],
      subtarefas: o.subtarefas ? t.subtarefas.map(filtrarTarefa).filter((x): x is TarefaModelo => !!x) : [],
    };
  };

  const filtrarPasta = (p: PastaModelo, raiz: boolean): PastaModelo | null => {
    if (!raiz && excl.has(p.ref)) return null;
    return {
      ...p,
      statuses: o.status ? p.statuses : [],
      campos: o.campos ? p.campos : [],
      tarefas: o.tarefas ? p.tarefas.map(filtrarTarefa).filter((x): x is TarefaModelo => !!x) : [],
      visoes: o.visoes ? p.visoes : [],
      exibicao: o.visoes ? p.exibicao : null,
      filhas: o.subpastas ? p.filhas.map((f) => filtrarPasta(f, false)).filter((x): x is PastaModelo => !!x) : [],
    };
  };

  return { ...c, raiz: filtrarPasta(c.raiz, true) as PastaModelo };
}

export interface ResumoModelo {
  pastas: number;
  tarefas: number;
  subtarefas: number;
  itens_checklist: number;
  status: number;
  campos: number;
  visoes: number;
  com_data: boolean;
  /** Maior "dia +N" usado (pra mostrar a duração do cronograma). */
  ultimo_dia: number | null;
}

export function resumirModelo(c: ModeloConteudo): ResumoModelo {
  const r: ResumoModelo = { pastas: 0, tarefas: 0, subtarefas: 0, itens_checklist: 0, status: 0, campos: 0, visoes: 0, com_data: false, ultimo_dia: null };
  const tarefa = (t: TarefaModelo, sub: boolean) => {
    if (sub) r.subtarefas++;
    else r.tarefas++;
    r.itens_checklist += t.checklist.length;
    for (const d of [t.start_dia, t.due_dia]) {
      if (d === null) continue;
      r.com_data = true;
      r.ultimo_dia = r.ultimo_dia === null ? d : Math.max(r.ultimo_dia, d);
    }
    t.subtarefas.forEach((s) => tarefa(s, true));
  };
  const pasta = (p: PastaModelo) => {
    r.pastas++;
    r.status += p.statuses.length;
    r.campos += p.campos.length;
    r.visoes += p.visoes.length;
    p.tarefas.forEach((t) => tarefa(t, false));
    p.filhas.forEach(pasta);
  };
  pasta(c.raiz);
  return r;
}

// ─── Aplicar: conteúdo → linhas a inserir ────────────────────────────────────

export interface ContextoAplicacao {
  tenant_id: string | null;
  user_id: string;
  /** Pasta onde o modelo vai ser criado (null = raiz). */
  parent_list_id: string | null;
  /** Nome da pasta principal (vazio = nome do modelo). */
  nome: string | null;
  /** Dia 0 (YYYY-MM-DD). */
  data_base: string;
  /** Etiquetas que a pessoa já tem, por nome em minúsculas. */
  etiquetas_existentes: Record<string, string>;
  /** Campos globais que ainda existem (os valores deles são reaproveitados). */
  campos_globais: string[];
  novo_id: () => string;
  /** Base pro sort_order da pasta principal (fica por último entre as irmãs). */
  agora: number;
}

type Linha = Record<string, unknown>;

export interface PlanoAplicacao {
  raiz_id: string;
  pastas: Linha[];
  /** Pastas que ganham os status do modelo (os padrões do gatilho saem). */
  pastas_com_status: string[];
  statuses: Linha[];
  campos: Linha[];
  novas_etiquetas: Linha[];
  /** Na ordem certa: tarefa-mãe antes das subtarefas. `status_id` é resolvido depois dos status existirem. */
  tarefas: Array<Linha & { status_preferido: string | null; categoria_preferida: string | null }>;
  checklist: Linha[];
  etiquetas: Linha[];
  valores: Linha[];
  visoes: Linha[];
  /** Pasta de origem → pasta nova. */
  mapa_pastas: Record<string, string>;
  /** Campo de origem → campo novo (campos globais mapeiam pra eles mesmos). */
  mapa_campos: Record<string, string>;
  /** Exibição já remapeada, por id da pasta nova. */
  exibicao: Record<string, ExibicaoModelo>;
}

export function planejarAplicacao(c: ModeloConteudo, ctx: ContextoAplicacao): PlanoAplicacao {
  const plano: PlanoAplicacao = {
    raiz_id: '', pastas: [], pastas_com_status: [], statuses: [], campos: [], novas_etiquetas: [],
    tarefas: [], checklist: [], etiquetas: [], valores: [], visoes: [], mapa_pastas: {}, mapa_campos: {}, exibicao: {},
  };
  const base = { tenant_id: ctx.tenant_id };
  const globais = new Set(ctx.campos_globais);
  globais.forEach((id) => { plano.mapa_campos[id] = id; });
  const etiquetas = new Map(Object.entries(ctx.etiquetas_existentes));
  const mapaStatus = new Map<string, string>();

  // 1ª passada: pastas, status e campos (tarefas podem citar campos de outra pasta do modelo)
  const pasta = (p: PastaModelo, pai: string | null, raiz: boolean) => {
    const id = ctx.novo_id();
    plano.mapa_pastas[p.ref] = id;
    if (raiz) plano.raiz_id = id;
    plano.pastas.push({
      ...base, id, name: raiz ? (ctx.nome?.trim() || p.name) : p.name, color: p.color, icon: p.icon,
      parent_list_id: pai, sort_order: raiz ? ctx.agora : p.sort_order, created_by: ctx.user_id, is_archived: false,
    });
    if (p.statuses.length) {
      plano.pastas_com_status.push(id);
      for (const s of p.statuses) {
        const sid = ctx.novo_id();
        mapaStatus.set(s.ref, sid);
        plano.statuses.push({ ...base, id: sid, list_id: id, name: s.name, color: s.color, category: s.category, sort_order: s.sort_order });
      }
    }
    for (const f of p.campos) {
      const fid = ctx.novo_id();
      plano.mapa_campos[f.ref] = fid;
      plano.campos.push({
        ...base, id: fid, list_id: id, name: f.name, field_type: f.field_type, options: f.options,
        show_on_card: f.show_on_card, sort_order: f.sort_order, is_archived: false, created_by: ctx.user_id,
      });
    }
    p.filhas.forEach((f) => pasta(f, id, false));
  };
  pasta(c.raiz, ctx.parent_list_id, true);

  const etiquetaId = (nome: string, cor: string): string => {
    const chave = nome.trim().toLowerCase();
    const existente = etiquetas.get(chave);
    if (existente) return existente;
    const id = ctx.novo_id();
    etiquetas.set(chave, id);
    plano.novas_etiquetas.push({ ...base, id, name: nome.trim(), color: cor, created_by: ctx.user_id });
    return id;
  };

  const tarefa = (t: TarefaModelo, listId: string, paiId: string | null) => {
    const id = ctx.novo_id();
    plano.tarefas.push({
      ...base, id, list_id: listId, parent_task_id: paiId, title: t.title, description: t.description,
      status_id: null, priority: t.priority, assignee_id: t.assignee_id,
      start_date: t.start_dia !== null ? somarDias(ctx.data_base, t.start_dia) : null,
      due_date: t.due_dia !== null ? vencimentoIso(somarDias(ctx.data_base, t.due_dia), t.due_hora) : null,
      due_has_time: t.due_dia !== null && !!t.due_hora,
      recurrence: t.recurrence, time_estimate_minutes: t.time_estimate_minutes,
      sort_order: t.sort_order, created_by: ctx.user_id, is_archived: false,
      status_preferido: t.status_ref ? mapaStatus.get(t.status_ref) ?? null : null,
      categoria_preferida: t.status_category,
    });
    t.checklist.forEach((i, n) => plano.checklist.push({ ...base, task_id: id, title: i.title, is_done: false, sort_order: n + 1 }));
    const vistas = new Set<string>();
    for (const e of t.etiquetas) {
      const tid = etiquetaId(e.name, e.color);
      if (vistas.has(tid)) continue;
      vistas.add(tid);
      plano.etiquetas.push({ ...base, task_id: id, tag_id: tid });
    }
    for (const v of t.valores) {
      const fid = plano.mapa_campos[v.campo_ref];
      if (fid && v.value !== null && v.value !== undefined) plano.valores.push({ ...base, task_id: id, field_id: fid, value: v.value });
    }
    t.subtarefas.forEach((s) => tarefa(s, listId, id));
  };

  const remapear = (s: string): string | null => {
    for (const prefixo of ['field:', 'campo:']) {
      if (s.startsWith(prefixo)) {
        const novo = plano.mapa_campos[s.slice(prefixo.length)];
        return novo ? prefixo + novo : null;
      }
    }
    return s;
  };

  // 2ª passada: tarefas, visões e exibição
  const conteudoPasta = (p: PastaModelo) => {
    const listId = plano.mapa_pastas[p.ref];
    p.tarefas.forEach((t) => tarefa(t, listId, null));
    p.visoes.forEach((v, n) => plano.visoes.push({
      ...base, list_id: listId, user_id: ctx.user_id, name: v.name, view_type: v.view_type,
      group_by: remapear(v.group_by) ?? 'status', filters: v.filters, sort_order: n + 1, created_by: ctx.user_id,
    }));
    if (p.exibicao) {
      const lista = (l: string[] | null | undefined) => (l ? l.map(remapear).filter((x): x is string => !!x) : null);
      const larguras: Record<string, number> = {};
      for (const [k, v] of Object.entries(p.exibicao.larguras ?? {})) {
        const nk = remapear(k);
        if (nk) larguras[nk] = v;
      }
      plano.exibicao[listId] = {
        agrupar: p.exibicao.agrupar ? remapear(p.exibicao.agrupar) ?? 'status' : null,
        colunas: lista(p.exibicao.colunas),
        ordem: lista(p.exibicao.ordem),
        larguras: Object.keys(larguras).length ? larguras : null,
      };
    }
    p.filhas.forEach(conteudoPasta);
  };
  conteudoPasta(c.raiz);

  return plano;
}

/**
 * Status de cada tarefa nova, depois que os status das pastas novas existem:
 * o mesmo status do modelo → a mesma categoria → o primeiro da pasta.
 */
export function resolverStatus(
  tarefas: PlanoAplicacao['tarefas'],
  statuses: Array<{ id: string; list_id: string; category: string; sort_order: number | null }>,
): Linha[] {
  const porLista = agruparPor(statuses.slice().sort(porOrdem), (s) => s.list_id);
  return tarefas.map(({ status_preferido, categoria_preferida, ...t }) => {
    const daLista = porLista.get(t.list_id as string) ?? [];
    const escolhido = daLista.find((s) => s.id === status_preferido)
      ?? (categoria_preferida ? daLista.find((s) => s.category === categoria_preferida) : undefined)
      ?? daLista.find((s) => s.category !== 'done' && s.category !== 'cancelled')
      ?? daLista[0];
    const concluida = escolhido && (escolhido.category === 'done' || escolhido.category === 'cancelled');
    return { ...t, status_id: escolhido?.id ?? null, completed_at: concluida ? new Date().toISOString() : null };
  });
}
