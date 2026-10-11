import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { fetchComplementoApi } from '@/lib/ifoodDashboard';

// Vendas do iFood a partir do relatório de conciliação importado (fin_ifood_entries — Financeiro › iFood).
// Mesma divisão do Portal do Parceiro (Financeiro › Faturamento), igual à edge ifood-financial:
// vendas − taxas − serviços + ajustes = faturamento; faturamento − pago direto à loja = repasses.
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
  // "Recebido direto pela loja" = Entrada fora do repasse (não pelo responsável: há Entrada LOJA no repasse).
  if (t.includes('entrada')) { z.vendas = v; if (!e.impacto_repasse) z.loja = v; }
  else if (t.includes('subs')) { if (/custeada pela loja/.test(d)) { z.vendas = -v; z.servicos = -v; } else z.vendas = v; }
  else if (t.includes('reten')) z.vendas = v;
  else if (t.includes('cobran')) { if (/comiss|transa|mensalidade/.test(d)) z.taxas = -v; else z.servicos = -v; }
  else z.ajustes = v;
  return z;
}

/**
 * Faturamento do iFood (decisão do dono, 2026-10-10): o que o Portal chama de "vendas" MENOS a promoção que a
 * própria loja pagou — igual ao desconto do balcão e ao valor da nota (valorVendaIfood). A parte paga pelo
 * iFood continua (ele repassa). Entrega grátis paga pela loja só sai quando é a loja que entrega (aí era receita
 * de entrega dela); com entregador do iFood é custo do iFood, não desconto da venda.
 * Ex.: itens R$ 49,90 com cupom de R$ 5 bancado pela loja → R$ 44,90.
 */
export interface FaturamentoPedido { vendas: number; promoLojaItens: number; promoLojaEntrega: number; entregaIfood: boolean }
export const faturamentoIfood = (p: FaturamentoPedido) =>
  p.vendas - p.promoLojaItens - (p.entregaIfood ? 0 : p.promoLojaEntrega);

/** Soma uma linha da conciliação nas partes que o faturamento usa (mesmas regras de montarPedidos). */
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

/** Pedido ao vivo (ifood_orders): mesma conta do valorVendaIfood (supabase/functions/_shared/ifood-valores.ts). */
export function faturamentoPedidoAoVivo(o: { order_type?: string | null; delivered_by?: string | null; total?: { subTotal?: number; deliveryFee?: number } | null; benefits?: unknown }) {
  const entregaLoja = String(o.order_type ?? 'DELIVERY') === 'DELIVERY' && o.delivered_by === 'MERCHANT';
  const taxaLoja = entregaLoja ? Number(o.total?.deliveryFee ?? 0) : 0;
  let descLoja = 0;
  for (const b of Array.isArray(o.benefits) ? o.benefits as Array<{ target?: string; sponsorshipValues?: Array<{ name?: string; value?: number }> }> : []) {
    if (String(b?.target ?? '') === 'DELIVERY_FEE' && !(taxaLoja > 0)) continue;
    for (const sp of b?.sponsorshipValues ?? []) if (/^(MERCHANT|CHAIN)$/.test(String(sp?.name ?? ''))) descLoja += Number(sp?.value ?? 0);
  }
  return Math.max(0, Number(o.total?.subTotal ?? 0) + taxaLoja - descLoja);
}

interface EntryRow extends PortalEntry { order_id: string | null; order_created_at: string | null }
interface LiveRow {
  ifood_order_id: string;
  ordered_at: string | null;
  status: string;
  delivered_by: string | null;
  order_type: string | null;
  total: { subTotal?: number; deliveryFee?: number } | null;
  benefits: unknown;
}

export interface IfoodVendas {
  /** YYYY-MM-DD (Brasília) → valor das vendas e pedidos do dia */
  porDia: Record<string, { valor: number; pedidos: number }>;
  /** 'HH:MM' (Brasília, mesmo formato do gráfico por hora dos relatórios) → valor */
  porHora: Record<string, number>;
  total: number;
  pedidos: number;
  /** Pedidos que vieram da API do iFood (Vendas ou módulo Pedidos) por ainda não estarem na conciliação importada */
  pedidosAoVivo: number;
  /** Um item por pedido (hora do pedido e valor das vendas) — para encaixar no dia da loja (src/lib/diaLoja.ts) */
  lista: Array<{ at: string; valor: number; aoVivo: boolean }>;
  error: string | null;
}

/**
 * Valor das vendas do iFood por dia do PEDIDO (data_criacao_pedido_associado), somando todas as lojas
 * iFood importadas do tenant, completado pelos pedidos da API ainda não conciliados. Pedido cancelado entra
 * e sai no mesmo dia (as linhas de cancelamento são do mesmo pedido), então só conta como pedido quem terminou
 * com valor positivo.
 */
export async function fetchIfoodVendas(tenantId: string, fromISO: string, toISO: string): Promise<IfoodVendas> {
  const res = await fetchAllRows<EntryRow>((from, to) => supabase
    .from('fin_ifood_entries')
    .select('order_id, order_created_at, tipo_lancamento, descricao, valor, impacto_repasse')
    .eq('tenant_id', tenantId)
    .not('order_created_at', 'is', null)
    .gte('order_created_at', fromISO)
    .lte('order_created_at', toISO)
    .order('order_created_at', { ascending: true })
    .order('id', { ascending: true }) // desempate: linhas do mesmo pedido têm o mesmo horário (paginação estável)
    .range(from, to));
  const vazio: IfoodVendas = { porDia: {}, porHora: {}, total: 0, pedidos: 0, pedidosAoVivo: 0, lista: [], error: res.error?.message ?? null };
  if (res.error) return vazio;

  const porPedido = new Map<string, { at: string; valor: number; aoVivo?: boolean }>();
  const partes = new Map<string, FaturamentoPedido & { at: string }>();
  for (const r of res.rows ?? []) {
    if (!r.order_id || !r.order_created_at) continue;
    const p = partes.get(r.order_id) ?? { at: r.order_created_at, vendas: 0, promoLojaItens: 0, promoLojaEntrega: 0, entregaIfood: false };
    acumularFaturamento(p, { ...r, valor: Number(r.valor) });
    partes.set(r.order_id, p);
  }
  for (const [id, p] of partes) porPedido.set(id, { at: p.at, valor: faturamentoIfood(p) });

  // A conciliação chega dias depois; sem complemento, "Hoje" e a sessão aberta ficam sem iFood.
  // 1) API de Vendas (fin_ifood_sales, sincronizada pela ifood-financial) — mesma tradução da aba iFood
  //    (montarPedidosApi), então o valor bate com o Portal. Cancelado não entra.
  let pedidosAoVivo = 0;
  const api = await fetchComplementoApi(tenantId, fromISO, toISO, new Set(porPedido.keys())).catch(() => []);
  const canceladosApi = new Set<string>();
  for (const p of api) {
    if (p.cancelado) { canceladosApi.add(p.id); continue; }
    if (porPedido.has(p.id)) continue;
    const promoEntrega = p.promoLojaEntrega ?? 0;
    const valor = faturamentoIfood({ vendas: p.vendas, promoLojaItens: p.promoLoja - promoEntrega, promoLojaEntrega: promoEntrega, entregaIfood: p.logistica !== 'propria' });
    porPedido.set(p.id, { at: p.at.toISOString(), valor, aoVivo: true });
    pedidosAoVivo += 1;
  }

  // 2) Pedidos ao vivo do módulo Pedidos do iFood (ifood_orders) que nem a API de Vendas trouxe ainda.
  //    Valor = itens (subTotal) + taxa de entrega só quando a própria loja entrega − promoção paga pela loja
  //    (mesma conta do valor da nota, valorVendaIfood).
  const vivos = await fetchAllRows<LiveRow>((from, to) => supabase
    .from('ifood_orders')
    .select('ifood_order_id, ordered_at, status, delivered_by, order_type, total, benefits')
    .eq('tenant_id', tenantId)
    .not('ordered_at', 'is', null)
    .gte('ordered_at', fromISO)
    .lte('ordered_at', toISO)
    .order('ordered_at', { ascending: true })
    .range(from, to));
  for (const o of vivos.rows ?? []) {
    if (!o.ordered_at || o.status === 'cancelled' || porPedido.has(o.ifood_order_id) || canceladosApi.has(o.ifood_order_id)) continue;
    const valor = faturamentoPedidoAoVivo(o);
    porPedido.set(o.ifood_order_id, { at: o.ordered_at, valor, aoVivo: true });
    pedidosAoVivo += 1;
  }

  const out: IfoodVendas = { porDia: {}, porHora: {}, total: 0, pedidos: 0, pedidosAoVivo, lista: [], error: null };
  for (const p of porPedido.values()) {
    out.lista.push({ at: p.at, valor: p.valor, aoVivo: !!p.aoVivo });
    const quando = new Date(p.at);
    const dia = quando.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const hora = quando.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const d = out.porDia[dia] ?? { valor: 0, pedidos: 0 };
    d.valor += p.valor;
    if (p.valor > 0.005) { d.pedidos += 1; out.pedidos += 1; }
    out.porDia[dia] = d;
    out.porHora[hora] = (out.porHora[hora] ?? 0) + p.valor;
    out.total += p.valor;
  }
  out.total = Math.round(out.total * 100) / 100;
  return out;
}

/** Taxa de antecipação do iFood lançada no razão (edge ifood-financial › postLedger): custo do dia do repasse. */
export const isIfoodAntecipacao = (descricao: string | null | undefined) => /^Taxa de antecipação iFood/i.test(descricao ?? '');
