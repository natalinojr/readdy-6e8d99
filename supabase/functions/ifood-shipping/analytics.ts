// Analytics do iFood (indicadores D-1 agregados por loja/dia) — regras puras, sem rede. Testes em
// src/test/edge/ifoodAnalytics.test.ts. Doc: /docs/food/guides/modules/analytics (endpoints + critérios de homologação).
//
// POST analytics/v1.0/merchants/{merchantId}/orders/kpis. Motivos de reprovação que a validação daqui evita:
// sem agregação, sem filter.referenceDate, gte > lte (ou gte+gt juntos), campo de groupBy fora do enum, função de
// métrica inválida (ex.: median) e valores duplicados nos arrays — todos viram HTTP 400 no iFood.
// deno-lint-ignore-file no-explicit-any

export const GROUP_FIELDS = [
  'salesChannel', 'deliveredBy', 'category', 'dayOfWeek', 'customerFirstOrderInMerchant', 'orderCreationHour', 'orderStatus',
  'paymentMethod', 'merchantId', 'merchantShortId', 'cancellationCode', 'cancellationOrigin', 'cancellationStage', 'cancellationReason',
] as const;
export const METRIC_FUNCS = ['sum', 'avg', 'min', 'max'] as const;
export const TERM_FUNCS = ['count', 'cardinality'] as const;
const DATA_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;
export const MAX_DIAS = 366;
export const PAGE_MAX = 1000;
export const SIZE_MAX = 10000;

const dup = (a: unknown[]) => new Set(a).size !== a.length;

/** Confere o corpo antes de enviar. Devolve a mensagem de erro (pt-BR) ou null se está válido. */
export function validarCorpoKpis(b: any): string | null {
  const rd = b?.filter?.referenceDate;
  if (!rd || typeof rd !== 'object') return 'Falta o período (filter.referenceDate).';
  if (rd.gte && rd.gt) return 'Use só um início (gte ou gt).';
  if (rd.lte && rd.lt) return 'Use só um fim (lte ou lt).';
  const ini = rd.gte ?? rd.gt, fim = rd.lte ?? rd.lt;
  for (const d of [ini, fim]) if (d !== undefined && !(typeof d === 'string' && DATA_RE.test(d))) return `Data inválida: ${d} (use aaaa-mm-dd ou aaaa-mm-dd hh:mm:ss).`;
  if (!ini && !fim) return 'Falta o período (filter.referenceDate).';
  if (ini && fim && String(ini) > String(fim)) return 'A data inicial é depois da final.';

  const agg = b?.agg ?? {};
  const metrics = agg.metrics && typeof agg.metrics === 'object' ? agg.metrics : null;
  const terms = agg.terms && typeof agg.terms === 'object' ? agg.terms : null;
  const fields = Array.isArray(agg.groupBy?.fields) ? agg.groupBy.fields : null;
  const intervals = Array.isArray(agg.dateIntervals) ? agg.dateIntervals : null;
  const tem = (metrics && Object.keys(metrics).length) || (terms && Object.keys(terms).length) || (fields && fields.length) || (intervals && intervals.length);
  if (!tem) return 'A consulta precisa de ao menos uma agregação (metrics, terms, groupBy ou dateIntervals).';

  for (const [k, fns] of Object.entries(metrics ?? {})) {
    if (!Array.isArray(fns) || fns.length === 0) return `Métrica ${k} sem função.`;
    if (dup(fns)) return `Métrica ${k} com função repetida.`;
    const ruim = fns.find((f) => !(METRIC_FUNCS as readonly string[]).includes(f));
    if (ruim) return `Função "${ruim}" não existe para métricas (aceitas: sum, avg, min, max).`;
  }
  for (const [k, fns] of Object.entries(terms ?? {})) {
    if (!Array.isArray(fns) || fns.length === 0) return `Distribuição ${k} sem função.`;
    if (dup(fns)) return `Distribuição ${k} com função repetida.`;
    const ruim = fns.find((f) => !(TERM_FUNCS as readonly string[]).includes(f));
    if (ruim) return `Função "${ruim}" não existe para distribuições (aceitas: count, cardinality).`;
  }
  if (fields) {
    if (dup(fields)) return 'Campo repetido no agrupamento.';
    const ruim = fields.find((f: string) => !(GROUP_FIELDS as readonly string[]).includes(f));
    if (ruim) return `Campo de agrupamento "${ruim}" não existe.`;
  }
  for (const it of intervals ?? []) {
    if (!DATA_RE.test(String(it?.from ?? '')) || !DATA_RE.test(String(it?.to ?? ''))) return 'Intervalo de datas inválido.';
    if (String(it.from) > String(it.to)) return 'Intervalo com início depois do fim.';
  }
  const page = b.page ?? 1, size = b.size ?? 10;
  if (!Number.isInteger(page) || page < 1 || page > PAGE_MAX) return `Página fora do limite (1 a ${PAGE_MAX}).`;
  if (!Number.isInteger(size) || size < 1 || size > SIZE_MAX) return `Tamanho de página fora do limite (1 a ${SIZE_MAX}).`;
  if (b.sort?.groupByKey && !['asc', 'desc'].includes(b.sort.groupByKey)) return 'Ordenação inválida (asc ou desc).';
  return null;
}

const addDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Data de hoje em São Paulo (aaaa-mm-dd). */
export const hojeSP = (agora = new Date()) => new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Período pedido pela tela → referenceDate. Os dados são D-1: o fim vai no máximo até ontem.
 * Devolve { erro } ou { gte, lte, de, ate, ajustado } (ajustado = o fim pedido era hoje/futuro e foi puxado para ontem).
 */
export function periodoKpis(de: unknown, ate: unknown, hoje = hojeSP()) {
  const ontem = addDias(hoje, -1);
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const d = typeof de === 'string' && re.test(de) ? de : addDias(ontem, -6);
  let a = typeof ate === 'string' && re.test(ate) ? ate : ontem;
  let ajustado = false;
  if (a > ontem) { a = ontem; ajustado = true; }
  if (d > a) return { erro: d > ontem ? 'Os indicadores do iFood vão só até ontem (D-1). Escolha um início até ' + ontem.split('-').reverse().join('/') + '.' : 'A data inicial é depois da final.' };
  const dias = Math.round((Date.parse(a) - Date.parse(d)) / 86400_000) + 1;
  if (dias > MAX_DIAS) return { erro: `Período grande demais (máximo ${MAX_DIAS} dias).` };
  return { de: d, ate: a, dias, ajustado, gte: `${d} 00:00:00`, lte: `${a} 23:59:59` };
}

/** Campos do agrupamento da tela (os mesmos do exemplo da doc de homologação). */
export const CAMPOS_TELA = ['dayOfWeek', 'orderStatus', 'deliveredBy', 'paymentMethod', 'salesChannel'] as const;

/**
 * Consulta da tela: UMA chamada agrupada por dia da semana × status × logística × pagamento × canal, paginada, e o
 * resumo é somado aqui. Motivo (teste 2026-09-30): com x-request-homologation o iFood ignora o corpo e devolve
 * sempre o payload do exemplo da doc (esse mesmo agrupamento, sem `terms`) — assim a tela funciona igual em teste e
 * em produção e o payload da homologação é exatamente o que a tela mostra.
 */
export function consultaKpis(gte: string, lte: string, page: number, size = 1000) {
  return {
    agg: {
      metrics: { gmv: ['sum'], gmvWithoutDelivery: ['sum', 'avg'] },
      groupBy: { fields: [...CAMPOS_TELA] },
    },
    filter: { referenceDate: { gte, lte } },
    page, size,
    sort: { groupByKey: 'desc' },
  };
}

/** Corpo do exemplo da doc de homologação (mesmos campos e página de 20), com o período escolhido. */
export function corpoHomologacao(gte: string, lte: string) {
  return consultaKpis(gte, lte, 1, 20);
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const DIAS_NOME: Record<string, string> = { MONDAY: '1', TUESDAY: '2', WEDNESDAY: '3', THURSDAY: '4', FRIDAY: '5', SATURDAY: '6', SUNDAY: '7' };
/** Dia da semana como '1'..'7' (1 = segunda). A doc diz número; o ambiente de teste manda o nome (WEDNESDAY). */
export const diaSemana = (v: unknown) => (v === null || v === undefined ? '' : DIAS_NOME[String(v).toUpperCase()] ?? String(v));

/**
 * Soma as linhas agrupadas nas KPIs da tela.
 * - Quantidade de cada linha = groupByKey.count; status pela chave orderStatus.
 * - GMV / GMV sem entrega = soma das linhas CONCLUDED (se a resposta não trouxer status, soma tudo).
 * - Ticket médio = GMV ÷ pedidos concluídos (fórmula da doc). Taxa de cancelamento = canc ÷ (concl + canc).
 * - Distribuições (canal, logística, pagamento, dia) contam todos os pedidos; a tabela canal × entrega, só concluídos.
 */
export function resumirLinhas(linhas: any[]) {
  const porStatus: Record<string, number> = {}, porCanal: Record<string, number> = {}, porLogistica: Record<string, number> = {};
  const porPagamento: Record<string, number> = {}, porDiaSemana: Record<string, number> = {};
  const tab = new Map<string, { canal: string | null; logistica: string | null; pedidos: number; gmv: number }>();
  const add = (m: Record<string, number>, k: unknown, n: number) => { if (k === null || k === undefined || k === '') return; const key = String(k); m[key] = (m[key] ?? 0) + n; };
  const temStatus = (linhas ?? []).some((l) => l?.groupByKey?.value?.orderStatus);
  let gmv: number | null = null, gmvSem: number | null = null;
  for (const l of linhas ?? []) {
    const k = l?.groupByKey?.value ?? {};
    const n = num(l?.groupByKey?.count) ?? 0;
    add(porStatus, k.orderStatus, n); add(porCanal, k.salesChannel, n); add(porLogistica, k.deliveredBy, n);
    add(porPagamento, k.paymentMethod, n); add(porDiaSemana, diaSemana(k.dayOfWeek), n);
    const concl = !temStatus || k.orderStatus === 'CONCLUDED';
    if (!concl) continue;
    const g = num(l?.gmv?.sum), gs = num(l?.gmvWithoutDelivery?.sum);
    if (g !== null) gmv = (gmv ?? 0) + g;
    if (gs !== null) gmvSem = (gmvSem ?? 0) + gs;
    const tk = `${k.salesChannel ?? ''}|${k.deliveredBy ?? ''}`;
    const t = tab.get(tk) ?? { canal: k.salesChannel ?? null, logistica: k.deliveredBy ?? null, pedidos: 0, gmv: 0 };
    t.pedidos += n; t.gmv += g ?? 0; tab.set(tk, t);
  }
  const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
  const qConcl = temStatus ? porStatus.CONCLUDED ?? 0 : Object.values(porStatus).reduce((a, b) => a + b, 0) || [...tab.values()].reduce((a, t) => a + t.pedidos, 0);
  const qCanc = porStatus.CANCELLED ?? 0;
  return {
    gmv: r2(gmv), gmvSemEntrega: r2(gmvSem),
    taxaEntrega: gmv !== null && gmvSem !== null ? r2(gmv - gmvSem) : null,
    ticket: gmv !== null && qConcl > 0 ? r2(gmv / qConcl) : null,
    pedidosConcluidos: qConcl, pedidosCancelados: qCanc,
    taxaCancelamento: qConcl + qCanc > 0 ? qCanc / (qConcl + qCanc) : null,
    porStatus, porCanal, porLogistica, porPagamento, porDiaSemana,
    porCanalEntrega: [...tab.values()].sort((a, b) => b.gmv - a.gmv).map((t) => ({ ...t, gmv: r2(t.gmv), ticket: t.pedidos ? r2(t.gmv / t.pedidos) : null })),
  };
}

/** Mensagem amigável por status HTTP (critério: tratar 400/401/403/404/429/500/503). */
export function mensagemErroKpis(status: number, detalhe = ''): string {
  const d = detalhe ? ` (${detalhe.slice(0, 200)})` : '';
  if (status === 400) return `O iFood recusou a consulta dos indicadores${d}. Confira o período e tente de novo.`;
  if (status === 401) return 'O acesso ao iFood expirou e não foi possível renovar. Autorize o app ERPOS PDV de novo no Portal do Parceiro.';
  if (status === 403) return 'Esta loja do iFood não liberou os Indicadores (Analytics) para o app ERPOS PDV. Confira a autorização no Portal do Parceiro.';
  if (status === 404) return 'O iFood não encontrou os indicadores dessa loja (loja errada ou endereço da API mudou).';
  if (status === 429) return 'Muitas consultas ao iFood agora. Espere cerca de 1 minuto e tente de novo.';
  if (status >= 500) return 'O iFood está instável agora (tentamos algumas vezes). Tente de novo em alguns minutos.';
  if (status === 0) return 'Sem resposta do iFood (falha de conexão). Tente de novo.';
  return `O iFood respondeu ${status}${d}.`;
}
