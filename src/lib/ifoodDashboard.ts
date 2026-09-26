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
  outrosServicos: number;
  ajustes: number;
  liquido: number;
  pagamento: string;
  logistica: Logistica;
  cancelado: boolean;
  parcial: boolean;
  motivo: string | null;
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
        vendas: 0, bruto: 0, comissao: 0, transacao: 0, promoLoja: 0, promoIfood: 0, entregaSobDemanda: 0, outrosServicos: 0,
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

export async function fetchPedidosIfood(tenantId: string, fromISO: string, toISO: string) {
  const [ent, imp] = await Promise.all([
    fetchAllRows<EntryRow>((from, to) => supabase
      .from('fin_ifood_entries')
      .select('import_id, order_id, order_created_at, tipo_lancamento, descricao, valor, impacto_repasse, metodo_pagamento, motivo:raw->>motivo_cancelamento')
      .eq('tenant_id', tenantId)
      .not('order_created_at', 'is', null)
      .gte('order_created_at', fromISO)
      .lte('order_created_at', toISO)
      .order('order_created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    supabase.from('fin_ifood_imports').select('id, merchant_id').eq('tenant_id', tenantId),
  ]);
  if (ent.error) return { pedidos: [] as PedidoIfood[], error: ent.error.message };
  const lojaDoImport: Record<string, string> = {};
  for (const i of (imp.data ?? []) as { id: string; merchant_id: string | null }[]) lojaDoImport[i.id] = i.merchant_id ?? '';
  return { pedidos: montarPedidos(ent.rows ?? [], lojaDoImport), error: null as string | null };
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
