import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { portalBucket } from '@/lib/ifoodVendas';

// Dashboard do iFood (Relatórios › iFood, 2026-09-25).
// Fonte principal = relatório de conciliação importado (fin_ifood_entries), datado pelo PEDIDO
// (order_created_at, Brasília) e com a mesma divisão do Portal do Parceiro (portalBucket).
// Complementos: API de Vendas (fin_ifood_sales → tempos da operação, só ~30 dias) e relatório de
// Cardápio (fin_ifood_menu_sales → produtos e conversão, só os períodos importados).
// Fora daqui: mensalidade e ajustes sem pedido (não têm data de pedido).

export interface EntryRow {
  import_id: string;
  order_id: string | null;
  order_created_at: string | null;
  tipo_lancamento: string | null;
  descricao: string | null;
  valor: number;
  impacto_repasse: boolean;
  metodo_pagamento: string | null;
  motivo: string | null;
  cesta?: string | number | null; // valor_cesta_final (Entrada − cesta = taxa de entrega paga pelo cliente)
}

export type Logistica = 'ifood' | 'propria' | 'sob_demanda';

export interface PedidoIfood {
  id: string;
  loja: string; // merchant_id (uuid da loja no iFood)
  at: Date;
  dia: string; // YYYY-MM-DD Brasília
  hora: number; // 0-23 Brasília
  semana: number; // 0 = domingo
  vendas: number;
  bruto: number; // soma das Entradas (antes de cancelar) — valor perdido no cancelamento
  comissao: number;
  transacao: number;
  promoLoja: number;
  promoIfood: number;
  entregaSobDemanda: number;
  entregaCliente: number; // taxa de entrega que o cliente pagou no pedido
  outrosServicos: number;
  ajustes: number;
  liquido: number;
  pagamento: string;
  logistica: Logistica;
  cancelado: boolean;
  parcial: boolean;
  motivo: string | null;
  /** Pedido da API de Vendas que o iFood ainda não fechou (sem comissão/taxa calculadas): o "líquido" dele
   * ainda não desconta as taxas. Quem precisa do valor final deve estimar (área iFood). */
  semTaxas?: boolean;
}

export interface Resumo {
  pedidos: number;
  vendas: number;
  liquido: number;
  comissao: number;
  transacao: number;
  promoLoja: number;
  promoIfood: number;
  entregaSobDemanda: number;
  outrosServicos: number;
  ajustes: number;
  cancelados: number;
  valorCancelado: number;
  ticket: number;
  custoPct: number; // (taxas + serviços − ajustes) / vendas
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Nome curto do motivo de cancelamento (o iFood às vezes cola o laudo inteiro do atendimento). */
export function motivoCurto(m: string): string {
  const t = m.replace(/Cancelamento realizado pelo motivo de:\s*/i, '').split(/Cliente considerado fraudulento\?/i)[0].trim();
  return t.length > 70 ? t.slice(0, 68) + '…' : t;
}

/** Responsável pelo cancelamento pelo código do iFood: 5xx e 902 = loja (sem sistema, sem entregador, não confirmou). */
export function culpaCancelamento(m: string): 'loja' | 'cliente' | 'ifood' {
  const cod = Number(m.match(/^(\d{3})/)?.[1] ?? 0);
  if ((cod >= 500 && cod < 600) || cod === 902) return 'loja';
  if (cod >= 600 && cod < 700) return 'cliente';
  return 'ifood';
}

/** Agrupa as linhas da conciliação por pedido. `lojaDoImport` = import_id → merchant_id. */
export function montarPedidos(rows: EntryRow[], lojaDoImport: Record<string, string>): PedidoIfood[] {
  const map = new Map<string, PedidoIfood & { _temEntregaIfood: boolean; _temPropria: boolean; _temSobDemanda: boolean }>();
  for (const r of rows) {
    if (!r.order_id || !r.order_created_at) continue;
    let p = map.get(r.order_id);
    if (!p) {
      const at = new Date(r.order_created_at);
      const dia = at.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const hora = Number(at.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }));
      const [y, m, d] = dia.split('-').map(Number);
      p = {
        id: r.order_id, loja: lojaDoImport[r.import_id] ?? '', at, dia, hora, semana: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
        vendas: 0, bruto: 0, comissao: 0, transacao: 0, promoLoja: 0, promoIfood: 0, entregaSobDemanda: 0, entregaCliente: 0, outrosServicos: 0,
        ajustes: 0, liquido: 0, pagamento: '', logistica: 'propria', cancelado: false, parcial: false, motivo: null,
        _temEntregaIfood: false, _temPropria: false, _temSobDemanda: false,
      };
      map.set(r.order_id, p);
    }
    const valor = Number(r.valor) || 0;
    const b = portalBucket({ tipo_lancamento: r.tipo_lancamento, descricao: r.descricao, valor, impacto_repasse: r.impacto_repasse });
    const t = (r.tipo_lancamento ?? '').toLowerCase();
    const d = (r.descricao ?? '').toLowerCase();
    p.vendas += b.vendas;
    p.ajustes += b.ajustes;
    if (t.includes('entrada')) {
      if (valor > 0) p.bruto += valor;
      const cesta = r.cesta == null || r.cesta === '' ? NaN : Number(r.cesta);
      if (valor > 0 && Number.isFinite(cesta)) p.entregaCliente += Math.max(0, r2(valor - cesta));
      if (r.metodo_pagamento && !p.pagamento) p.pagamento = r.metodo_pagamento;
    }
    if (t.includes('cobran')) {
      if (/comiss/.test(d)) p.comissao += -valor;
      else if (/transa|mensalidade/.test(d)) p.transacao += -valor;
      else if (/sob demanda|on_demand/.test(d)) { p.entregaSobDemanda += -valor; p._temSobDemanda = true; }
      else p.outrosServicos += -valor;
      if (/entrega ifood/.test(d)) p._temEntregaIfood = true;
      if (/entrega pr[oó]pria/.test(d)) p._temPropria = true;
    } else if (t.includes('subs')) {
      if (/custeada pela loja/.test(d)) p.promoLoja += -valor; else p.promoIfood += valor;
    } else if (t.includes('reten') && /taxa entrega/.test(d)) {
      p._temEntregaIfood = true;
    }
    if (r.motivo) {
      if (/parcial/i.test(r.motivo)) p.parcial = true;
      p.motivo = p.motivo ?? r.motivo;
    }
  }
  const out: PedidoIfood[] = [];
  for (const p of map.values()) {
    p.logistica = p._temSobDemanda ? 'sob_demanda' : p._temEntregaIfood && !p._temPropria ? 'ifood' : 'propria';
    p.cancelado = p.vendas <= 0.005;
    p.liquido = p.vendas - p.comissao - p.transacao - p.promoLoja - p.entregaSobDemanda - p.outrosServicos + p.ajustes;
    if (!p.pagamento) p.pagamento = 'Não informado';
    const { _temEntregaIfood: _a, _temPropria: _b, _temSobDemanda: _c, ...limpo } = p;
    out.push(limpo);
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function resumir(pedidos: PedidoIfood[]): Resumo {
  const z: Resumo = {
    pedidos: 0, vendas: 0, liquido: 0, comissao: 0, transacao: 0, promoLoja: 0, promoIfood: 0, entregaSobDemanda: 0,
    outrosServicos: 0, ajustes: 0, cancelados: 0, valorCancelado: 0, ticket: 0, custoPct: 0,
  };
  for (const p of pedidos) {
    z.vendas += p.vendas; z.liquido += p.liquido; z.comissao += p.comissao; z.transacao += p.transacao;
    z.promoLoja += p.promoLoja; z.promoIfood += p.promoIfood; z.entregaSobDemanda += p.entregaSobDemanda;
    z.outrosServicos += p.outrosServicos; z.ajustes += p.ajustes;
    if (p.cancelado) { z.cancelados += 1; z.valorCancelado += p.bruto; } else z.pedidos += 1;
  }
  z.ticket = z.pedidos > 0 ? z.vendas / z.pedidos : 0;
  const custo = z.comissao + z.transacao + z.promoLoja + z.entregaSobDemanda + z.outrosServicos - z.ajustes;
  z.custoPct = z.vendas > 0 ? (custo / z.vendas) * 100 : 0;
  for (const k of Object.keys(z) as (keyof Resumo)[]) if (k !== 'pedidos' && k !== 'cancelados') z[k] = r2(z[k]);
  return z;
}

// ── Complemento pela API de Vendas (2026-09-26) ──────────────────────────────
// A conciliação só chega quando alguém importa o relatório (dias depois); a API de Vendas
// (fin_ifood_sales, a mesma do "Vendas do dia") tem o pedido na hora. Pedido que ainda não está na
// conciliação entra pela API, traduzido para as MESMAS linhas da conciliação (billing_entries ↔
// Cobrança/Retenção/Subsídio) e somado por montarPedidos — mesma divisão do Portal. Quando a
// conciliação é importada, ela assume o pedido (casam por sale_id = order_id).

export interface SaleFinRow {
  sale_id: string;
  merchant_id: string;
  sale_created_at: string;
  current_status: string | null;
  gross_bag: number | null;
  delivery_fee: number | null;
  payment_methods: Array<{ method?: string; liability?: string }> | null;
  billing_entries: Array<{ name?: string; value?: number }> | null;
  benefits: { benefits?: Array<{ target?: string; sponsorships?: Array<{ name?: string; value?: number }> }> } | null;
  events: Array<{ metadata?: { cancelCode?: number } | null }> | null;
}

// Nome da API → [tipo_lancamento, descricao] da conciliação.
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

// Meio de pagamento da API → nome usado na conciliação.
const PAGAMENTO_API: Record<string, string> = {
  PIX: 'Pix', CREDIT: 'Crédito', DEBIT: 'Débito', DIGITAL_WALLET: 'Carteira digital', BANK_PAY: 'Banco',
  EXTERNAL: 'Pagamento externo', CASH: 'Dinheiro', MEAL_VOUCHER: 'Vale refeição', FOOD_VOUCHER: 'Vale refeição', OTHER_VOUCHER: 'Outros vales',
};

// Motivos pelo código (mesmos textos da conciliação: "501 - Problemas de sistema na loja").
const MOTIVO_API: Record<number, string> = {
  406: 'O pedido foi acidental', 410: 'O pedido não foi entregue', 411: 'O pedido está atrasado', 412: 'O pedido veio com todos os itens errados',
  419: 'Cancelamento realizado via atendimento', 501: 'Problemas de sistema na loja', 504: 'A loja está sem entregadores disponíveis',
  512: 'A loja só abrirá mais tarde', 601: 'Problemas no veículo', 609: 'Cliente escolheu outra forma de pagamento',
  610: 'Cliente não localizado', 860: 'Problema com pagamento do cliente', 902: 'O pedido não foi confirmado pela loja',
};

/** Pedidos da API de Vendas no formato do dashboard (mesmas contas da conciliação). */
export function montarPedidosApi(sales: SaleFinRow[]): PedidoIfood[] {
  const rows: EntryRow[] = [];
  const extra = new Map<string, { semTaxas: boolean; cancelado: boolean; bruto: number; motivo: string | null; pagamento: string | null; entrega: number }>();
  for (const s of sales) {
    const antes = rows.length;
    const base = { import_id: s.merchant_id, order_id: s.sale_id, order_created_at: s.sale_created_at, impacto_repasse: true, metodo_pagamento: null, motivo: null };
    for (const b of Array.isArray(s.billing_entries) ? s.billing_entries : []) {
      const valor = Number(b.value) || 0;
      if (Math.abs(valor) < 0.005) continue;
      const nome = String(b.name ?? '');
      const [tipo, descricao] = LINHA_API[nome] ?? (valor < 0 ? ['Cobrança', nome] : ['Ajuste', nome]);
      rows.push({ ...base, tipo_lancamento: tipo, descricao, valor });
    }
    // Promoção paga pela loja não vem em billing_entries: sai dos patrocínios (MERCHANT/CHAIN).
    for (const bf of s.benefits?.benefits ?? []) {
      const loja = (bf.sponsorships ?? []).filter((sp) => /^(MERCHANT|CHAIN)$/i.test(String(sp.name))).reduce((a, sp) => a + (Number(sp.value) || 0), 0);
      if (loja < 0.005) continue;
      const descricao = /DELIVERY/i.test(String(bf.target)) ? 'Promoção custeada pela loja no delivery' : 'Promoção custeada pela loja';
      rows.push({ ...base, tipo_lancamento: 'Subsídio', descricao, valor: -loja, impacto_repasse: false });
    }
    const cancelado = /CANCEL/i.test(String(s.current_status ?? ''));
    const bruto = (Number(s.gross_bag) || 0) + (Number(s.delivery_fee) || 0);
    // Sem ORDER_PAYMENT: pago direto à loja (EXTERNAL/dinheiro — a conciliação traz como Entrada fora do
    // repasse) ou pedido recente que o iFood ainda não fechou. A Entrada é o que falta para as vendas
    // darem itens + entrega (o "vendido" do Vendas do dia); taxas ainda não calculadas ficam de fora.
    const temPagamento = (s.billing_entries ?? []).some((b) => b.name === 'ORDER_PAYMENT' && Math.abs(Number(b.value) || 0) >= 0.005);
    if (!cancelado && !temPagamento) {
      if (bruto < 0.005) { rows.length = antes; continue; } // a API ainda não tem nem o valor: espera a conciliação
      const jaSomado = montarPedidos(rows.slice(antes), {})[0]?.vendas ?? 0;
      const externo = s.payment_methods?.[0]?.liability === 'MERCHANT' || /^(EXTERNAL|CASH)$/i.test(String(s.payment_methods?.[0]?.method));
      rows.push({ ...base, tipo_lancamento: 'Entrada Financeira', descricao: 'Entrada Financeira', valor: Math.round((bruto - jaSomado) * 100) / 100, impacto_repasse: !externo });
    }
    const cod = (s.events ?? []).map((e) => Number(e?.metadata?.cancelCode)).find((c) => c > 0) ?? null;
    const metodo = String(s.payment_methods?.[0]?.method ?? '').toUpperCase();
    const temTaxa = (s.billing_entries ?? []).some((b) => /COMMISSION|TRANSACTION_FEE/.test(String(b.name ?? '')) && Math.abs(Number(b.value) || 0) >= 0.005);
    extra.set(s.sale_id, {
      semTaxas: !cancelado && !temTaxa,
      cancelado,
      bruto,
      motivo: cod ? `${cod} - ${MOTIVO_API[cod] ?? 'Cancelamento'}` : null,
      pagamento: PAGAMENTO_API[metodo] ?? null,
      entrega: Number(s.delivery_fee) || 0,
    });
    // Pedido sem nenhum lançamento (ex.: cancelado sem ressarcimento) ainda precisa aparecer.
    if (rows.length === antes) rows.push({ ...base, tipo_lancamento: 'Ajuste', descricao: '', valor: 0 });
  }
  // montarPedidos acha a loja pelo import_id; aqui o "import" de cada linha é a própria loja.
  const pedidos = montarPedidos(rows, Object.fromEntries(sales.map((s) => [s.merchant_id, s.merchant_id])));
  for (const p of pedidos) {
    const x = extra.get(p.id);
    if (!x) continue;
    if (x.pagamento) p.pagamento = x.pagamento;
    p.entregaCliente = x.entrega;
    if (x.semTaxas) p.semTaxas = true;
    if (x.cancelado) {
      // A API zera os lançamentos do cancelado; a conciliação guarda o valor perdido nas Entradas.
      p.cancelado = true;
      p.bruto = x.bruto;
      p.motivo = x.motivo;
    }
  }
  return pedidos;
}

export async function fetchComplementoApi(tenantId: string, fromISO: string, toISO: string, jaTem: Set<string>) {
  const res = await fetchAllRows<SaleFinRow>((from, to) => supabase
    .from('fin_ifood_sales')
    .select('sale_id, merchant_id, sale_created_at, current_status, gross_bag, delivery_fee, payment_methods, billing_entries, benefits:raw->benefits, events:raw->orderEvents')
    .eq('tenant_id', tenantId)
    .gte('sale_created_at', fromISO)
    .lte('sale_created_at', toISO)
    .order('sale_created_at', { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: SaleFinRow[] | null; error: { message: string } | null }>);
  const novas = (res.rows ?? []).filter((s) => s.sale_id && !jaTem.has(s.sale_id));
  // O pedido pode estar na conciliação com data um pouco diferente (fora deste período): confere pelo id.
  const naConciliacao = new Set<string>();
  for (let i = 0; i < novas.length; i += 150) {
    const { data } = await supabase.from('fin_ifood_entries').select('order_id').eq('tenant_id', tenantId)
      .in('order_id', novas.slice(i, i + 150).map((s) => s.sale_id));
    for (const d of (data ?? []) as { order_id: string }[]) naConciliacao.add(d.order_id);
  }
  return montarPedidosApi(novas.filter((s) => !naConciliacao.has(s.sale_id)));
}

export async function fetchPedidosIfood(tenantId: string, fromISO: string, toISO: string) {
  const [ent, imp] = await Promise.all([
    fetchAllRows<EntryRow>((from, to) => supabase
      .from('fin_ifood_entries')
      .select('import_id, order_id, order_created_at, tipo_lancamento, descricao, valor, impacto_repasse, metodo_pagamento, motivo:raw->>motivo_cancelamento, cesta:raw->>valor_cesta_final')
      .eq('tenant_id', tenantId)
      .not('order_created_at', 'is', null)
      .gte('order_created_at', fromISO)
      .lte('order_created_at', toISO)
      .order('order_created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    supabase.from('fin_ifood_imports').select('id, merchant_id').eq('tenant_id', tenantId),
  ]);
  if (ent.error) return { pedidos: [] as PedidoIfood[], daApi: 0, error: ent.error.message };
  const lojaDoImport: Record<string, string> = {};
  for (const i of (imp.data ?? []) as { id: string; merchant_id: string | null }[]) lojaDoImport[i.id] = i.merchant_id ?? '';
  const conciliados = montarPedidos(ent.rows ?? [], lojaDoImport);
  // Falha na API não derruba o relatório: segue só com a conciliação.
  const api = await fetchComplementoApi(tenantId, fromISO, toISO, new Set(conciliados.map((p) => p.id))).catch(() => [] as PedidoIfood[]);
  const pedidos = [...conciliados, ...api].sort((a, b) => a.at.getTime() - b.at.getTime());
  return { pedidos, daApi: api.length, error: null as string | null };
}

// ── Entregas sob demanda pedidas pelo ERPOS (Gestor de Entregas › "Chamar iFood") ──
// Pedido de delivery do próprio ERPOS: iFood cobra `ifood_fee` (cotação) e o cliente pagou `merchant_fee`
// (taxa de entrega do pedido). Só as concluídas (cancelada/sem entregador não cobra).
export interface EntregaErpos {
  id: string;
  loja: string; // merchant_id do iFood que despachou
  ifoodOrderId: string | null;
  numero: string | null;
  at: Date;
  ifood: number;
  cliente: number;
}

export async function fetchEntregasSobDemandaErpos(tenantId: string, fromISO: string, toISO: string): Promise<EntregaErpos[]> {
  const { data, error } = await supabase.from('ifood_shipping_orders')
    .select('id, merchant_id, ifood_order_id, ifood_fee, merchant_fee, created_at, order:orders(number, delivery_fee)')
    .eq('tenant_id', tenantId).eq('status', 'concluded')
    .gte('created_at', fromISO).lte('created_at', toISO)
    .order('created_at', { ascending: true });
  if (error) return [];
  type Row = { id: string; merchant_id: string; ifood_order_id: string | null; ifood_fee: number | null; merchant_fee: number | null; created_at: string; order: { number: string | null; delivery_fee: number | null } | null };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id, loja: r.merchant_id, ifoodOrderId: r.ifood_order_id, numero: r.order?.number ?? null, at: new Date(r.created_at),
    ifood: Number(r.ifood_fee) || 0,
    cliente: Number(r.merchant_fee ?? r.order?.delivery_fee) || 0,
  }));
}

// ── Operação (API de Vendas) ─────────────────────────────────────────────────

export interface OperacaoPedido {
  loja: string;
  aceiteMin: number | null; // recebido → confirmado
  preparoMin: number | null; // confirmado → pronto
  esperaEntregadorMin: number | null; // pronto → entregador coletou (>0 = pedido esperando)
  entregadorEsperouMin: number | null; // entregador chegou → pronto (>0 = entregador esperando)
  rotaMin: number | null; // coletou → chegou no cliente
  totalMin: number | null; // criado → entregue
  cancelado: boolean;
}

interface SaleRow { merchant_id: string; sale_created_at: string; current_status: string | null; events: { fullCode?: string; createdAt?: string }[] | null }

const minEntre = (a?: number, b?: number) => (a != null && b != null && b >= a ? (b - a) / 60000 : null);

export function montarOperacao(rows: SaleRow[]): OperacaoPedido[] {
  return rows.map((s) => {
    const ev: Record<string, number> = {};
    for (const e of s.events ?? []) {
      if (!e.fullCode || !e.createdAt) continue;
      const t = new Date(e.createdAt).getTime();
      if (ev[e.fullCode] == null || t < ev[e.fullCode]) ev[e.fullCode] = t;
    }
    const criado = new Date(s.sale_created_at).getTime();
    const recebido = ev.RECEIVED ?? ev.PAYMENT_APPROVED ?? criado;
    const pronto = ev.READY_TO_DELIVER;
    const coletou = ev.DELIVERY_COLLECTED ?? ev.DISPATCHED;
    const chegouOrigem = ev.DELIVERY_ARRIVED_AT_ORIGIN;
    const entregue = ev.DELIVERY_DROP_CODE_VALIDATION_SUCCESS ?? ev.DELIVERY_ARRIVED_AT_DESTINATION ?? ev.CONCLUDED;
    return {
      loja: s.merchant_id,
      aceiteMin: minEntre(recebido, ev.CONFIRMED),
      preparoMin: minEntre(ev.CONFIRMED, pronto),
      esperaEntregadorMin: minEntre(pronto, coletou),
      entregadorEsperouMin: minEntre(chegouOrigem, pronto),
      rotaMin: minEntre(coletou, ev.DELIVERY_ARRIVED_AT_DESTINATION ?? entregue),
      totalMin: minEntre(criado, entregue),
      cancelado: s.current_status === 'CANCELLED',
    };
  });
}

export async function fetchOperacaoIfood(tenantId: string, fromISO: string, toISO: string) {
  const res = await fetchAllRows<SaleRow>((from, to) => supabase
    .from('fin_ifood_sales')
    .select('merchant_id, sale_created_at, current_status, events:raw->orderEvents')
    .eq('tenant_id', tenantId)
    .gte('sale_created_at', fromISO)
    .lte('sale_created_at', toISO)
    .order('sale_created_at', { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: SaleRow[] | null; error: { message: string } | null }>);
  return montarOperacao(res.rows ?? []);
}

export function mediana(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ── Cardápio (relatório de Cardápio do Portal) ───────────────────────────────

export interface MenuLinha {
  merchant_short: string | null;
  period_start: string;
  period_end: string;
  kind: 'item' | 'complemento';
  name: string;
  visits: number | null;
  orders: number | null;
  quantity: number | null;
  promo_quantity: number | null;
  total_value: number | null;
}

/** Relatórios de cardápio que tocam o período; sem nenhum, o último importado (a tela avisa o período real). */
export async function fetchCardapioIfood(tenantId: string, fromDia: string, toDia: string) {
  const cols = 'merchant_short, period_start, period_end, kind, name, visits, orders, quantity, promo_quantity, total_value';
  const noPeriodo = await supabase.from('fin_ifood_menu_sales').select(cols)
    .eq('tenant_id', tenantId).lte('period_start', toDia).gte('period_end', fromDia).limit(2000);
  let linhas = (noPeriodo.data ?? []) as MenuLinha[];
  let doPeriodo = true;
  if (!linhas.length) {
    const ult = await supabase.from('fin_ifood_menu_sales').select('period_end').eq('tenant_id', tenantId)
      .order('period_end', { ascending: false }).limit(1);
    const fim = (ult.data?.[0] as { period_end?: string } | undefined)?.period_end;
    if (fim) {
      const r = await supabase.from('fin_ifood_menu_sales').select(cols).eq('tenant_id', tenantId).eq('period_end', fim).limit(2000);
      linhas = (r.data ?? []) as MenuLinha[];
      doPeriodo = false;
    }
  }
  return { linhas, doPeriodo };
}
