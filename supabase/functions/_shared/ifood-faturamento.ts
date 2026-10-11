// Faturamento do iFood para o assistente (assistente-cron e assistente-brain) — a MESMA conta das telas, para o
// assistente não dizer número diferente do Dashboard/Hoje/Financeiro (auditoria de números, 2026-10-10).
//
// Regra do dono (2026-10-10): faturamento do iFood = o que o Portal chama de "vendas" MENOS a promoção que a própria
// loja pagou. O pedido do iFood nunca entra pelo PDV (orders.ifood_order_id is null nas contas do PDV): ele vem só daqui.
// Fontes, na ordem da tela (src/lib/ifoodVendas.ts › fetchIfoodVendas):
//   1) conciliação importada (fin_ifood_entries) — a que fecha com o Portal;
//   2) API de Vendas (fin_ifood_sales) para o pedido que ainda não está na conciliação — traduzida para as mesmas
//      linhas da conciliação (src/lib/ifoodDashboard.ts › montarPedidosApi). O gross_bag da API vem 0 em vários pedidos,
//      por isso o valor sai dos lançamentos (billing_entries), não do gross_bag;
//   3) pedido ao vivo do módulo Pedidos (ifood_orders) que nem a API trouxe ainda (_shared/ifood-valores.ts).
// Dia da loja (regra de 2026-10-04): o pedido do iFood entra no dia da sessão aberta na hora dele; fora de sessão, na
// data do pedido (src/lib/diaLoja.ts). As funções de dia da loja abaixo são cópia fiel dessa lib.
// Testado em src/test/edge/ifoodFaturamentoAssistente.test.ts (confere contra as funções do front).

import { valorVendaIfood } from './ifood-valores.ts';

/** Cliente do Supabase (service_role) — só o `from` que este arquivo usa; evita importar o tipo por URL (o tsc do projeto não resolve esm.sh). */
// deno-lint-ignore no-explicit-any
export type ClienteDb = { from: (tabela: string) => any };

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

// ── Conta do pedido (cópia de src/lib/ifoodVendas.ts) ───────────────────────
export interface PortalEntry {
  tipo_lancamento: string | null;
  descricao: string | null;
  valor: number;
  impacto_repasse: boolean;
}

export function portalBucket(e: PortalEntry) {
  const t = (e.tipo_lancamento ?? '').toLowerCase();
  const d = (e.descricao ?? '').toLowerCase();
  const v = e.valor;
  const z = { vendas: 0, taxas: 0, servicos: 0, ajustes: 0, loja: 0 };
  if (t.includes('entrada')) { z.vendas = v; if (!e.impacto_repasse) z.loja = v; }
  else if (t.includes('subs')) { if (/custeada pela loja/.test(d)) { z.vendas = -v; z.servicos = -v; } else z.vendas = v; }
  else if (t.includes('reten')) z.vendas = v;
  else if (t.includes('cobran')) { if (/comiss|transa|mensalidade/.test(d)) z.taxas = -v; else z.servicos = -v; }
  else z.ajustes = v;
  return z;
}

export interface FaturamentoPedido { vendas: number; promoLojaItens: number; promoLojaEntrega: number; entregaIfood: boolean }
/** Vendas do Portal − promoção paga pela loja (a da entrega só sai quando é a loja que entrega). */
export const faturamentoIfood = (p: FaturamentoPedido) =>
  p.vendas - p.promoLojaItens - (p.entregaIfood ? 0 : p.promoLojaEntrega);

/** Soma uma linha da conciliação nas partes que o faturamento usa. */
export function acumularFaturamento(acc: FaturamentoPedido, e: PortalEntry) {
  const t = (e.tipo_lancamento ?? '').toLowerCase();
  const d = (e.descricao ?? '').toLowerCase();
  acc.vendas += portalBucket(e).vendas;
  if (t.includes('subs') && /custeada pela loja/.test(d)) {
    if (/delivery|entrega/.test(d)) acc.promoLojaEntrega += -e.valor; else acc.promoLojaItens += -e.valor;
  }
  if ((t.includes('reten') && /taxa entrega/.test(d)) || /entrega ifood|sob demanda|on_demand/.test(d)) acc.entregaIfood = true;
  return acc;
}

// ── Pedido da API de Vendas (cópia de src/lib/ifoodDashboard.ts › montarPedidosApi, só a parte do faturamento) ──
const LINHA_API: Record<string, [string, string]> = {
  ORDER_PAYMENT: ['Entrada Financeira', 'Entrada Financeira'],
  IFOOD_SUBSIDY: ['Subsídio', 'Promoção custeada pelo iFood'],
  INDUSTRY_SUBSIDY: ['Subsídio', 'Promoção custeada pela Indústria'],
  ORDER_COMMISSION: ['Cobrança', 'Comissão do iFood'],
  TAKEOUT_COMMISSION: ['Cobrança', 'Comissão do iFood'],
  PAYMENT_TRANSACTION_FEE: ['Cobrança', 'Taxa de transação'],
  DELIVERY_REQUEST: ['Cobrança', 'Solicitação de entrega Sob Demanda Off'],
  SERVICE_FEE: ['Retenção', 'Taxa de serviço iFood cobrada do cliente'],
  DELIVERY_FEE_IFOOD: ['Retenção', 'Taxa entrega iFood'],
  CONVENIENCE_FEE: ['Retenção', 'Taxa de conveniência por pagamento parcelado'],
  STORE_REFUND: ['Ressarcimento', 'Ressarcimento iFood'],
};

export interface VendaApi {
  sale_id: string;
  sale_created_at: string;
  current_status: string | null;
  gross_bag: number | null;
  delivery_fee: number | null;
  payment_methods: Array<{ method?: string; liability?: string }> | null;
  billing_entries: Array<{ name?: string; value?: number }> | null;
  benefits: { benefits?: Array<{ target?: string; sponsorships?: Array<{ name?: string; value?: number }> }> } | null;
  /** raw.delivery.deliveryParameters.logisticProvider: IFOOD_LOGISTICS (entregador iFood) ou MERCHANT (loja) */
  logistica?: string | null;
}

/**
 * Faturamento de um pedido da API de Vendas. null = a API ainda não tem nem o valor (espera a conciliação ou o
 * pedido ao vivo). cancelado = status de cancelamento ou vendas zeradas (a API zera os lançamentos do cancelado).
 */
export function faturamentoDaVendaApi(s: VendaApi): { cancelado: boolean; valor: number } | null {
  const linhas: PortalEntry[] = [];
  const entradasApi = Array.isArray(s.billing_entries) ? s.billing_entries : [];
  for (const b of entradasApi) {
    const valor = n(b.value);
    if (Math.abs(valor) < 0.005) continue;
    const nome = String(b.name ?? '');
    const [tipo, descricao] = LINHA_API[nome] ?? (valor < 0 ? ['Cobrança', nome] : ['Ajuste', nome]);
    linhas.push({ tipo_lancamento: tipo, descricao, valor, impacto_repasse: true });
  }
  // Promoção paga pela loja não vem em billing_entries: sai dos patrocínios (MERCHANT/CHAIN).
  for (const bf of Array.isArray(s.benefits?.benefits) ? s.benefits!.benefits! : []) {
    const loja = (Array.isArray(bf.sponsorships) ? bf.sponsorships : [])
      .filter((sp) => /^(MERCHANT|CHAIN)$/i.test(String(sp.name))).reduce((a, sp) => a + n(sp.value), 0);
    if (loja < 0.005) continue;
    const descricao = /DELIVERY/i.test(String(bf.target)) ? 'Promoção custeada pela loja no delivery' : 'Promoção custeada pela loja';
    linhas.push({ tipo_lancamento: 'Subsídio', descricao, valor: -loja, impacto_repasse: false });
  }
  const cancelado = /CANCEL/i.test(String(s.current_status ?? ''));
  const bruto = n(s.gross_bag) + n(s.delivery_fee);
  const temPagamento = entradasApi.some((b) => b.name === 'ORDER_PAYMENT' && Math.abs(n(b.value)) >= 0.005);
  // Sem ORDER_PAYMENT (pago direto à loja ou pedido que o iFood ainda não fechou): a Entrada é o que falta para as
  // vendas darem itens + entrega; com entregador do iFood a entrega não é da loja.
  if (!cancelado && !temPagamento) {
    if (bruto < 0.005) return null;
    const entregaIfood = /IFOOD/i.test(String(s.logistica ?? ''));
    const vendido = entregaIfood ? n(s.gross_bag) : bruto;
    const jaSomado = linhas.reduce((a, l) => a + portalBucket(l).vendas, 0);
    const externo = s.payment_methods?.[0]?.liability === 'MERCHANT' || /^(EXTERNAL|CASH)$/i.test(String(s.payment_methods?.[0]?.method));
    linhas.push({ tipo_lancamento: 'Entrada Financeira', descricao: 'Entrada Financeira', valor: r2(vendido - jaSomado), impacto_repasse: !externo });
    if (entregaIfood) linhas.push({ tipo_lancamento: 'Retenção', descricao: 'Taxa entrega iFood', valor: 0, impacto_repasse: true }); // só marca a logística
  }
  let vendas = 0, promoItens = 0, promoEntrega = 0;
  let temEntregaIfood = false, temPropria = false, temSobDemanda = false;
  for (const l of linhas) {
    vendas += portalBucket(l).vendas;
    const t = (l.tipo_lancamento ?? '').toLowerCase();
    const d = (l.descricao ?? '').toLowerCase();
    if (t.includes('cobran')) {
      if (!/comiss/.test(d) && !/transa|mensalidade/.test(d) && /sob demanda|on_demand/.test(d)) temSobDemanda = true;
      if (/entrega ifood/.test(d)) temEntregaIfood = true;
      if (/entrega pr[oó]pria/.test(d)) temPropria = true;
    } else if (t.includes('subs')) {
      if (/custeada pela loja/.test(d)) { if (/delivery|entrega/.test(d)) promoEntrega += -l.valor; else promoItens += -l.valor; }
    } else if (t.includes('reten') && /taxa entrega/.test(d)) {
      temEntregaIfood = true;
    }
  }
  const entregaIfood = temSobDemanda || (temEntregaIfood && !temPropria); // logística diferente de 'propria'
  return {
    cancelado: cancelado || vendas <= 0.005,
    valor: faturamentoIfood({ vendas, promoLojaItens: promoItens, promoLojaEntrega: promoEntrega, entregaIfood }),
  };
}

// ── Lista de pedidos do período (cópia da cascata de fetchIfoodVendas, sem banco) ──
export interface EntradaIfood extends PortalEntry { order_id: string | null; order_created_at: string | null }
export interface PedidoVivo {
  ifood_order_id: string;
  ordered_at: string | null;
  status: string;
  delivered_by: string | null;
  order_type: string | null;
  // deno-lint-ignore no-explicit-any
  total: any;
  benefits: unknown;
}
export interface PedidoIfoodValor { at: string; valor: number; aoVivo: boolean }
export interface ListaIfood { lista: PedidoIfoodValor[]; total: number; pedidos: number; pedidosAoVivo: number }

/**
 * Junta as três fontes sem contar o mesmo pedido duas vezes. `naConciliacao` = ids da API que já estão na conciliação
 * com data fora do período (o pedido casa por id, não pela data).
 */
export function montarListaIfood(
  entradas: EntradaIfood[], vendasApi: VendaApi[], vivos: PedidoVivo[], naConciliacao: Set<string> = new Set(),
): ListaIfood {
  const porPedido = new Map<string, PedidoIfoodValor>();
  const partes = new Map<string, FaturamentoPedido & { at: string }>();
  for (const r of entradas) {
    if (!r.order_id || !r.order_created_at) continue;
    const p = partes.get(r.order_id) ?? { at: r.order_created_at, vendas: 0, promoLojaItens: 0, promoLojaEntrega: 0, entregaIfood: false };
    acumularFaturamento(p, { ...r, valor: n(r.valor) });
    partes.set(r.order_id, p);
  }
  for (const [id, p] of partes) porPedido.set(id, { at: p.at, valor: faturamentoIfood(p), aoVivo: false });

  const canceladosApi = new Set<string>();
  for (const s of vendasApi) {
    if (!s.sale_id || porPedido.has(s.sale_id) || naConciliacao.has(s.sale_id)) continue;
    const f = faturamentoDaVendaApi(s);
    if (!f) continue;
    if (f.cancelado) { canceladosApi.add(s.sale_id); continue; }
    porPedido.set(s.sale_id, { at: new Date(s.sale_created_at).toISOString(), valor: f.valor, aoVivo: true });
  }

  for (const o of vivos) {
    if (!o.ordered_at || o.status === 'cancelled' || porPedido.has(o.ifood_order_id) || canceladosApi.has(o.ifood_order_id)) continue;
    porPedido.set(o.ifood_order_id, { at: o.ordered_at, valor: valorVendaIfood(o).valorVenda, aoVivo: true });
  }

  const lista = [...porPedido.values()];
  const positivos = lista.filter((p) => p.valor > 0.005);
  return {
    lista,
    total: r2(lista.reduce((a, p) => a + p.valor, 0)),
    pedidos: positivos.length,
    pedidosAoVivo: positivos.filter((p) => p.aoVivo).length,
  };
}

// ── Leitura no banco (service_role) ─────────────────────────────────────────
type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** O PostgREST corta em ~1000 linhas por request: lê em lotes até acabar (teto de 20 mil, como o front). */
async function lerTudo<T>(pagina: (de: number, ate: number) => Pagina<T>): Promise<{ rows: T[]; truncado: boolean }> {
  const lote = 1000, teto = 20000;
  const rows: T[] = [];
  for (let de = 0; de < teto; de += lote) {
    const { data, error } = await pagina(de, de + lote - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < lote) return { rows, truncado: false };
  }
  return { rows, truncado: true };
}

/**
 * Pedidos do iFood da loja entre `fromISO` e `toISO` (data do PEDIDO), com o valor do faturamento de cada um.
 * Falha na conciliação sobe o erro; falha na API de Vendas ou nos pedidos ao vivo segue só com o que deu (como a tela).
 */
export async function ifoodVendasDoPeriodo(
  admin: ClienteDb, tenantId: string, fromISO: string, toISO: string,
): Promise<ListaIfood & { truncado: boolean }> {
  const de = new Date(fromISO).toISOString(), ate = new Date(toISO).toISOString();
  let truncado = false;
  const lidas = await lerTudo<EntradaIfood>((a, b) => admin.from('fin_ifood_entries')
    .select('order_id, order_created_at, tipo_lancamento, descricao, valor, impacto_repasse')
    .eq('tenant_id', tenantId).not('order_created_at', 'is', null)
    .gte('order_created_at', de).lte('order_created_at', ate)
    .order('order_created_at', { ascending: true }).order('id', { ascending: true })
    .range(a, b) as unknown as Pagina<EntradaIfood>);
  const entradas = lidas.rows;
  truncado ||= lidas.truncado;
  const jaTem = new Set(entradas.map((e) => e.order_id).filter(Boolean) as string[]);

  let vendasApi: VendaApi[] = [];
  const naConciliacao = new Set<string>();
  try {
    const lida = await lerTudo<VendaApi>((a, b) => admin.from('fin_ifood_sales')
      .select('sale_id, sale_created_at, current_status, gross_bag, delivery_fee, payment_methods, billing_entries, benefits:raw->benefits, logistica:raw->delivery->deliveryParameters->>logisticProvider')
      .eq('tenant_id', tenantId).gte('sale_created_at', de).lte('sale_created_at', ate)
      .order('sale_created_at', { ascending: true }).order('sale_id', { ascending: true })
      .range(a, b) as unknown as Pagina<VendaApi>);
    vendasApi = lida.rows;
    truncado ||= lida.truncado;
    // O pedido pode estar na conciliação com data um pouco diferente (fora do período): confere pelo id.
    const novas = vendasApi.filter((s) => s.sale_id && !jaTem.has(s.sale_id));
    for (let i = 0; i < novas.length; i += 150) {
      const { data } = await admin.from('fin_ifood_entries').select('order_id').eq('tenant_id', tenantId)
        .in('order_id', novas.slice(i, i + 150).map((s) => s.sale_id));
      for (const d of (data ?? []) as Array<{ order_id: string }>) naConciliacao.add(d.order_id);
    }
  } catch { /* sem a API de Vendas, segue com a conciliação e os pedidos ao vivo */ }

  let vivos: PedidoVivo[] = [];
  try {
    const lida = await lerTudo<PedidoVivo>((a, b) => admin.from('ifood_orders')
      .select('ifood_order_id, ordered_at, status, delivered_by, order_type, total, benefits')
      .eq('tenant_id', tenantId).not('ordered_at', 'is', null)
      .gte('ordered_at', de).lte('ordered_at', ate)
      .order('ordered_at', { ascending: true }).order('ifood_order_id', { ascending: true })
      .range(a, b) as unknown as Pagina<PedidoVivo>);
    vivos = lida.rows;
    truncado ||= lida.truncado;
  } catch { /* idem */ }

  return { ...montarListaIfood(entradas, vendasApi, vivos, naConciliacao), truncado };
}

// ── Dia da loja (cópia de src/lib/diaLoja.ts) ───────────────────────────────
const TZ = 'America/Sao_Paulo';

/** Sessão de caixa (de fn_loja_janelas): `dia` = dia em que abriu; `fim` null = ainda aberta. */
export interface JanelaSessao { dia: string; ini: string; fim: string | null }

const dataBrasilia = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00-03:00`);
const somarUmDia = (dia: string) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
/** Soma dias a um 'YYYY-MM-DD'. */
export const diaMais = (dia: string, k: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};

/** Dia da loja de um pedido de fora do PDV: o da sessão aberta na hora (a mais recente, se houver duas). */
export function diaDoPedido(at: Date, janelas: JanelaSessao[]): string {
  const t = at.getTime();
  let melhor: JanelaSessao | null = null;
  for (const j of janelas) {
    const ini = new Date(j.ini).getTime();
    if (t < ini || (j.fim && t >= new Date(j.fim).getTime())) continue;
    if (!melhor || ini > new Date(melhor.ini).getTime()) melhor = j;
  }
  return melhor ? melhor.dia : dataBrasilia(at);
}

/**
 * Janela de busca para os dias [d1, d2]: da 0h de d1 até o fim da última sessão desses dias (aberta = agora),
 * no mínimo a 0h do dia seguinte a d2. `corte` limita o fim (comparação "até a mesma hora").
 */
export function janelaDeBusca(d1: string, d2: string, janelas: JanelaSessao[], corte?: Date | null, agora = new Date()) {
  let fim = inicioDoDia(somarUmDia(d2)).getTime();
  for (const j of janelas) {
    if (j.dia < d1 || j.dia > d2) continue;
    fim = Math.max(fim, j.fim ? new Date(j.fim).getTime() : agora.getTime());
  }
  if (corte) fim = Math.min(fim, Math.max(corte.getTime(), inicioDoDia(d2).getTime()));
  return { from: inicioDoDia(d1).toISOString(), to: new Date(fim).toISOString() };
}

export interface SomaDiasLoja { total: number; pedidos: number; pedidosAoVivo: number; porDia: Record<string, number> }

/**
 * Soma os pedidos que caem nos dias da loja [d1, d2]. Com `corte`, no último dia (d2) só entra o que veio antes dele.
 * Pedido só conta na quantidade com valor positivo (cancelado que entra e sai fica zero).
 */
export function somarNosDias(lista: PedidoIfoodValor[], janelas: JanelaSessao[], d1: string, d2: string, corte?: Date | null): SomaDiasLoja {
  const out: SomaDiasLoja = { total: 0, pedidos: 0, pedidosAoVivo: 0, porDia: {} };
  for (const p of lista) {
    const at = new Date(p.at);
    const dia = diaDoPedido(at, janelas);
    if (dia < d1 || dia > d2) continue;
    if (corte && dia === d2 && at.getTime() >= corte.getTime()) continue;
    out.total += p.valor;
    if (p.valor > 0.005) { out.pedidos += 1; if (p.aoVivo) out.pedidosAoVivo += 1; }
    out.porDia[dia] = (out.porDia[dia] ?? 0) + p.valor;
  }
  out.total = r2(out.total);
  return out;
}

/** iFood do dia da loja `dia` (janelas = fn_get_dashboard_painel.janelas ou fn_loja_janelas). `corte` = só até esta hora. */
export async function ifoodDoDiaDaLoja(
  admin: ClienteDb, tenantId: string, dia: string, janelas: JanelaSessao[], corte?: Date | null,
): Promise<SomaDiasLoja> {
  const { from, to } = janelaDeBusca(dia, dia, janelas, corte);
  const r = await ifoodVendasDoPeriodo(admin, tenantId, from, to);
  return somarNosDias(r.lista, janelas, dia, dia, corte);
}
