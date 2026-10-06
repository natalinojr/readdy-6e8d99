import type { PedidoIfood } from '@/lib/ifoodDashboard';

// Área iFood (2026-10-05, protótipo docs/prototipos/ifood-proposta.html): junta, por pedido, o que o
// módulo Pedidos do iFood traz NA HORA (ifood_orders/ifood_order_items: itens, situação, cliente,
// promoções e quem pagou cada uma) com o dinheiro que o iFood fecha DEPOIS (conciliação/API de Vendas,
// PedidoIfood de ifoodDashboard.ts) e com o custo da comida pela ficha (ifoodCusto.ts).
//
// Regras (uma só, para todas as lojas):
// - "Chega na loja" = PedidoIfood.liquido (mesma divisão do Portal do Parceiro). Pedido que o iFood
//   ainda não fechou: estimativa = itens − promoção paga pela loja (do próprio pedido) − taxas pela
//   média da loja do iFood nos últimos 30 dias (taxaMedia). Marca `estimado`.
// - "Comida" = soma do custo da ficha de cada item e complemento. Um item sem ficha deixa a comida e a
//   sobra do pedido em aberto (null) — nunca conta como custo zero.
// - "Sobra" = chega − comida. Indicador gerencial: não entra na DRE.
// - Item dentro do pedido: recebe a parte do "chega" proporcional ao valor dele no pedido.

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

// ── Pedido do módulo Pedidos do iFood (ifood_orders) ─────────────────────────

export interface ComplementoIfood { nome: string; grupo: string | null; qtd: number; preco: number }
export interface ItemPedidoIfood {
  nome: string;
  qtd: number;
  /** R$ do item com os complementos (total_price). */
  total: number;
  obs: string | null;
  complementos: ComplementoIfood[];
}

export type SituacaoIfood = 'placed' | 'confirmed' | 'preparing' | 'ready' | 'dispatched' | 'concluded' | 'cancelled' | 'cancel_requested' | string;

export interface PedidoOrder {
  /** id do pedido no iFood (uuid) — o mesmo order_id da conciliação e sale_id da API de Vendas. */
  id: string;
  rowId: string;
  numero: string | null;
  loja: string;
  at: Date;
  status: SituacaoIfood;
  tipo: string | null; // DELIVERY, TAKEOUT, DINE_IN, INDOOR
  entregaPor: string | null; // IFOOD | MERCHANT
  cliente: string | null;
  /** Pedidos anteriores do cliente nesta loja (o iFood manda 0 no primeiro). */
  pedidosAntes: number | null;
  subTotal: number;
  entregaCliente: number;
  taxaServico: number;
  desconto: number;
  /** Desconto pago pela loja (itens + entrega grátis). */
  promoLoja: number;
  /** Parte de promoLoja que é entrega grátis paga pela loja. */
  promoLojaEntrega: number;
  promoIfood: number;
  clientePagou: number;
  pagamento: string | null;
  itens: ItemPedidoIfood[];
  timeline: Record<string, string>;
  motivoCancelamento: string | null;
  /** Pedido que entrou na cozinha do ERPOS (modo "entrar na cozinha"): id em orders. */
  pedidoErpos: string | null;
  teste: boolean;
}

export interface OrderRow {
  id: string;
  ifood_order_id: string;
  display_id: string | null;
  merchant_id: string;
  status: string;
  order_type: string | null;
  delivered_by: string | null;
  is_test: boolean | null;
  ordered_at: string | null;
  created_at: string;
  customer_name: string | null;
  customer_orders_count: number | null;
  total: { subTotal?: number; deliveryFee?: number; additionalFees?: number; benefits?: number; orderAmount?: number } | null;
  benefits: Array<{ value?: number; target?: string; sponsorshipValues?: Array<{ name?: string; value?: number }> }> | null;
  payments: { methods?: Array<{ method?: string; type?: string; value?: number; card?: { brand?: string } }> } | null;
  timeline: Record<string, string> | null;
  cancel_reason: string | null;
  order_id: string | null;
}

export interface ItemRow {
  order_row_id: string;
  idx: number | null;
  name: string | null;
  quantity: number | string | null;
  total_price: number | string | null;
  observations: string | null;
  options: Array<{ name?: string; groupName?: string; quantity?: number; price?: number; customizations?: Array<{ name?: string; groupName?: string; quantity?: number; price?: number }> }> | null;
}

const PAGAMENTO: Record<string, string> = {
  PIX: 'Pix', CREDIT: 'Crédito', DEBIT: 'Débito', MEAL_VOUCHER: 'Vale-refeição', FOOD_VOUCHER: 'Vale-alimentação',
  DIGITAL_WALLET: 'Carteira digital', CASH: 'Dinheiro', BANK_PAY: 'Banco', GIFT_CARD: 'Vale-presente',
};

/**
 * Promoção paga por quem: MERCHANT/CHAIN = loja; IFOOD/EXTERNAL = iFood ou indústria. `lojaEntrega` = a parte da
 * loja que é "entrega grátis" (benefício DELIVERY_FEE) — mesma separação de _shared/ifood-valores.ts (NFC-e):
 * com entregador do iFood ela não é desconto da mercadoria, é custo que o iFood cobra no repasse.
 */
export function promocoesDoPedido(benefits: OrderRow['benefits']): { loja: number; ifood: number; lojaEntrega: number } {
  let loja = 0, ifood = 0, lojaEntrega = 0;
  for (const b of Array.isArray(benefits) ? benefits : []) {
    const entrega = String(b.target ?? '') === 'DELIVERY_FEE';
    for (const s of b.sponsorshipValues ?? []) {
      const v = num(s.value);
      if (/^(MERCHANT|CHAIN)$/i.test(String(s.name))) { loja += v; if (entrega) lojaEntrega += v; } else ifood += v;
    }
  }
  return { loja: r2(loja), ifood: r2(ifood), lojaEntrega: r2(lojaEntrega) };
}

export function montarPedidoOrder(o: OrderRow, itens: ItemRow[]): PedidoOrder {
  const t = o.total ?? {};
  const promo = promocoesDoPedido(o.benefits);
  const m = o.payments?.methods?.[0];
  const pagamento = m ? `${PAGAMENTO[String(m.method).toUpperCase()] ?? m.method ?? ''}${m.type === 'OFFLINE' ? ' na entrega' : ''}`.trim() || null : null;
  return {
    id: o.ifood_order_id,
    rowId: o.id,
    numero: o.display_id,
    loja: o.merchant_id,
    at: new Date(o.ordered_at ?? o.created_at),
    status: o.status,
    tipo: o.order_type,
    entregaPor: o.delivered_by,
    cliente: o.customer_name ? o.customer_name.trim().split(/\s+/)[0] : null,
    pedidosAntes: o.customer_orders_count,
    subTotal: num(t.subTotal),
    entregaCliente: num(t.deliveryFee),
    taxaServico: num(t.additionalFees),
    desconto: num(t.benefits),
    promoLoja: promo.loja,
    promoLojaEntrega: promo.lojaEntrega,
    promoIfood: promo.ifood,
    clientePagou: num(t.orderAmount),
    pagamento,
    itens: itens
      // Pedido antigo relido do iFood vem sem os itens: o iFood põe uma linha "Sem itens selecionados" com o total.
      .filter((i) => i.order_row_id === o.id && !/^sem itens selecionados$/i.test((i.name ?? '').trim()))
      .sort((a, b) => num(a.idx) - num(b.idx))
      .map((i) => {
        const qtd = num(i.quantity) || 1;
        const comps: ComplementoIfood[] = [];
        for (const op of i.options ?? []) {
          const qOp = num(op.quantity) || 1;
          if (op.name) comps.push({ nome: op.name, grupo: op.groupName ?? null, qtd: qtd * qOp, preco: num(op.price) });
          for (const c of op.customizations ?? []) {
            if (c.name) comps.push({ nome: c.name, grupo: c.groupName ?? null, qtd: qtd * qOp * (num(c.quantity) || 1), preco: num(c.price) });
          }
        }
        return { nome: i.name ?? 'Item', qtd, total: num(i.total_price), obs: i.observations, complementos: comps };
      }),
    timeline: o.timeline ?? {},
    motivoCancelamento: o.cancel_reason,
    pedidoErpos: o.order_id,
    teste: !!o.is_test,
  };
}

/** "Cliente novo" ou "já pediu 3 vezes" (o iFood manda quantos pedidos o cliente já fez nesta loja). */
export function rotuloCliente(pedidosAntes: number | null | undefined): string | null {
  if (pedidosAntes == null) return null;
  if (pedidosAntes <= 0) return 'cliente novo';
  return pedidosAntes === 1 ? 'já pediu 1 vez' : `já pediu ${pedidosAntes} vezes`;
}

/** Rótulo e tom da situação do pedido do iFood. `andando` = ainda não terminou. */
export function situacaoPedido(status: SituacaoIfood): { rotulo: string; tom: 'amber' | 'blue' | 'green' | 'red' | 'zinc'; andando: boolean } {
  switch (status) {
    case 'placed': return { rotulo: 'Esperando aceite', tom: 'red', andando: true };
    case 'confirmed': return { rotulo: 'Aceito', tom: 'amber', andando: true };
    case 'preparing': return { rotulo: 'Na cozinha', tom: 'amber', andando: true };
    case 'ready': return { rotulo: 'Pronto', tom: 'green', andando: true };
    case 'dispatched': return { rotulo: 'Saiu para entrega', tom: 'blue', andando: true };
    case 'concluded': return { rotulo: 'Entregue', tom: 'zinc', andando: false };
    case 'cancel_requested': return { rotulo: 'Cancelamento pedido', tom: 'red', andando: true };
    case 'cancelled': return { rotulo: 'Cancelado', tom: 'red', andando: false };
    default: return { rotulo: status, tom: 'zinc', andando: false };
  }
}

// ── Custo da comida ──────────────────────────────────────────────────────────

/** Mesma normalização de fn_ifood_norm (ifood_item_links.name_key/group_key). */
export const normIfood = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export interface CustoAlvo {
  /** Custo por 1 unidade; null = sem ficha (ligado a item do cardápio sem ficha, ou não ligado). */
  custo: number | null;
  /** O que está ligado: "Burrito de Frango", "Combo X", "Não usa estoque", "Custo montado à mão". */
  alvo: string | null;
  tipo: 'item' | 'combo' | 'option' | 'sem_estoque' | 'escolhas' | 'composicao' | 'ficha' | null;
  /** Preço no balcão do que está ligado (item/combo do cardápio; adicional da opção). */
  precoBalcao: number | null;
}

/** Custos por produto do iFood: chave `item|<nome>` ou `complemento|<nome>|<grupo>` (e `complemento|<nome>|*` da composição à mão). */
export type MapaCustos = Map<string, CustoAlvo>;

export const chaveItemIfood = (nome: string) => `item|${normIfood(nome)}`;
export const chaveComplementoIfood = (nome: string, grupo: string | null) => `complemento|${normIfood(nome)}|${normIfood(grupo)}`;

export function custoDoItem(mapa: MapaCustos, nome: string): CustoAlvo | null {
  return mapa.get(chaveItemIfood(nome)) ?? null;
}
export function custoDoComplemento(mapa: MapaCustos, nome: string, grupo: string | null): CustoAlvo | null {
  // Ligação é por nome + grupo; a composição à mão (CMV antigo) é só por nome.
  return mapa.get(chaveComplementoIfood(nome, grupo)) ?? mapa.get(`complemento|${normIfood(nome)}|*`) ?? null;
}

export interface CustoLinha {
  nome: string;
  qtd: number;
  total: number;
  /** Custo da linha (item × qtd + complementos); null se faltar ficha em alguma parte. */
  comida: number | null;
  semFicha: string[];
  balcao: number | null;
  alvo: string | null;
  /** Comida de cada parte (dono 06/10: ver o custo por item do pedido): o próprio item (ficha dele × qtd) e cada
   *  complemento (ficha × qtd). null = falta ficha nessa parte; 0 = parte sem custo (ex.: "sem cebola"). */
  partes: { item: number | null; complementos: (number | null)[] };
}

/** Custo de um item do pedido com os complementos. Complemento sem ligação e sem preço (ex.: "sem cebola") não pede ficha. */
export function custoDaLinha(mapa: MapaCustos, it: ItemPedidoIfood): CustoLinha {
  const semFicha: string[] = [];
  const base = custoDoItem(mapa, it.nome);
  let comida: number | null = 0;
  let balcao: number | null = 0;
  const partes: CustoLinha['partes'] = { item: base?.custo == null ? null : r2(base.custo * it.qtd), complementos: [] };
  if (base?.custo == null) { semFicha.push(it.nome); comida = null; } else comida += base.custo * it.qtd;
  if (base?.precoBalcao == null) balcao = null; else balcao += base.precoBalcao * it.qtd;
  for (const c of it.complementos) {
    const cc = custoDoComplemento(mapa, c.nome, c.grupo);
    if (cc?.custo != null) { if (comida != null) comida += cc.custo * c.qtd; partes.complementos.push(r2(cc.custo * c.qtd)); }
    // Combo de escolhas: a comida é o que o cliente escolheu, então todo complemento precisa de ficha (até a Coca grátis).
    else if (cc || c.preco > 0.005 || base?.tipo === 'escolhas') { semFicha.push(c.nome); comida = null; partes.complementos.push(null); }
    else partes.complementos.push(0);
    if (balcao != null) {
      if (cc?.precoBalcao != null) balcao += cc.precoBalcao * c.qtd;
      else if (c.preco > 0.005) balcao = null;
    }
  }
  return { nome: it.nome, qtd: it.qtd, total: it.total, comida: comida == null ? null : r2(comida), semFicha, balcao: balcao == null ? null : r2(balcao), alvo: base?.alvo ?? null, partes };
}

// ── Pedido da área (pedido + dinheiro + comida) ──────────────────────────────

/**
 * Taxa do iFood SEM promoção, por loja (dono 06/10: Itens e CMV é o CMV puro, sem incidência de promoção).
 * O iFood cobra comissão e taxa de pagamento sobre o valor dos itens já com o desconto da loja (ex.: 21% + 2,6% sobre
 * 26,01 num churros de 31 com 4,99 de desconto); a entrega grátis paga pela loja não muda essa base. Então:
 *   taxa = (comissão + transação + sob demanda + outros − ajustes) ÷ (vendas − desconto da loja nos itens)
 * e um item vendido a preço cheio, sem promoção, deixa na loja preço × (1 − taxa).
 */
export function taxaTeoricaPorLoja(fin: PedidoIfood[]): Map<string, number> {
  const acc = new Map<string, { taxas: number; base: number }>();
  for (const p of fin) {
    if (p.cancelado || p.semTaxas || p.vendas <= 0.005) continue;
    const base = p.vendas - Math.max(0, p.promoLoja - (p.promoLojaEntrega ?? 0));
    if (base <= 0.005) continue;
    const a = acc.get(p.loja) ?? { taxas: 0, base: 0 };
    a.taxas += p.comissao + p.transacao + p.entregaSobDemanda + p.outrosServicos - p.ajustes;
    a.base += base;
    acc.set(p.loja, a);
  }
  const out = new Map<string, number>();
  let tt = 0, tb = 0;
  for (const [loja, a] of acc) { out.set(loja, a.taxas / a.base); tt += a.taxas; tb += a.base; }
  if (tb > 0) out.set('*', tt / tb);
  return out;
}

/** Média das taxas do iFood por loja (comissão, transação, sob demanda, outros − ajustes) ÷ vendas, pedidos não cancelados. */
export function taxaMediaPorLoja(fin: PedidoIfood[]): Map<string, number> {
  const acc = new Map<string, { taxas: number; vendas: number }>();
  for (const p of fin) {
    // Pedido que o iFood ainda não fechou não tem taxa: entraria como taxa zero e puxaria a média para baixo.
    if (p.cancelado || p.semTaxas || p.vendas <= 0.005) continue;
    const a = acc.get(p.loja) ?? { taxas: 0, vendas: 0 };
    a.taxas += p.comissao + p.transacao + p.entregaSobDemanda + p.outrosServicos - p.ajustes;
    a.vendas += p.vendas;
    acc.set(p.loja, a);
  }
  const out = new Map<string, number>();
  let tt = 0, tv = 0;
  for (const [loja, a] of acc) { out.set(loja, a.taxas / a.vendas); tt += a.taxas; tv += a.vendas; }
  if (tv > 0) out.set('*', tt / tv);
  return out;
}

export interface PedidoArea {
  id: string;
  numero: string | null;
  loja: string;
  at: Date;
  dia: string;
  cliente: string | null;
  order: PedidoOrder | null;
  fin: PedidoIfood | null;
  cancelado: boolean;
  /** Vendas do pedido (Portal) quando fechado; itens (subTotal) quando estimado. */
  venda: number;
  comissaoETaxas: number | null;
  /** Desconto pago pela loja (cupom/promoção da loja, entrega grátis paga pela loja). */
  promoLoja: number;
  /** Parte de promoLoja que é entrega grátis paga pela loja (só quando o pedido veio pelo módulo Pedidos). */
  promoLojaEntrega: number;
  /** Desconto pago pelo iFood (ou indústria) — não sai do bolso da loja. */
  promoIfood: number;
  /** Pedidos que o cliente já tinha feito nesta loja (0 = cliente novo); null = sem a informação. */
  pedidosAntes: number | null;
  chega: number | null;
  estimado: boolean;
  linhas: CustoLinha[];
  comida: number | null;
  sobra: number | null;
  /** Os mesmos itens no balcão: preço do cardápio − comida. */
  sobraBalcao: number | null;
  semFicha: string[];
}

const diaBR = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/**
 * Junta os pedidos do módulo Pedidos com o dinheiro (por id). Pedido só com dinheiro (antes de o módulo
 * Pedidos estar ligado) entra sem itens; pedido só com itens entra com dinheiro estimado.
 */
export function montarPedidosArea(orders: PedidoOrder[], fin: PedidoIfood[], custos: MapaCustos, taxaMedia: Map<string, number>): PedidoArea[] {
  const porId = new Map(fin.map((p) => [p.id, p]));
  const out: PedidoArea[] = [];
  const vistos = new Set<string>();
  for (const o of orders) {
    vistos.add(o.id);
    out.push(montarUm(o, porId.get(o.id) ?? null, custos, taxaMedia));
  }
  for (const f of fin) if (!vistos.has(f.id)) out.push(montarUm(null, f, custos, taxaMedia));
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

function montarUm(o: PedidoOrder | null, f: PedidoIfood | null, custos: MapaCustos, taxaMedia: Map<string, number>): PedidoArea {
  const at = o?.at ?? f!.at;
  const loja = o?.loja ?? f!.loja;
  const cancelado = o ? o.status === 'cancelled' || (f?.cancelado ?? false) : f!.cancelado;
  const linhas = (o?.itens ?? []).map((it) => custoDaLinha(custos, it));
  const semFicha = [...new Set(linhas.flatMap((l) => l.semFicha))];
  const comida = !o || linhas.length === 0 || linhas.some((l) => l.comida == null) ? null : r2(linhas.reduce((s, l) => s + (l.comida ?? 0), 0));
  const balcao = !o || linhas.length === 0 || linhas.some((l) => l.balcao == null) ? null : linhas.reduce((s, l) => s + (l.balcao ?? 0), 0);

  let venda: number, chega: number | null, comissaoETaxas: number | null, promoLoja: number, promoIfood: number, estimado = false;
  if (f && f.semTaxas && !f.cancelado) {
    // A API de Vendas já tem o pedido, mas o iFood ainda não calculou comissão e taxa: estima pela média da loja.
    venda = f.vendas;
    promoLoja = f.promoLoja;
    promoIfood = f.promoIfood;
    const taxa = taxaMedia.get(loja) ?? taxaMedia.get('*');
    comissaoETaxas = taxa == null ? null : r2(f.vendas * taxa);
    chega = comissaoETaxas == null ? null : r2(f.vendas - comissaoETaxas - promoLoja);
    estimado = true;
  } else if (f) {
    venda = f.vendas;
    chega = f.liquido;
    comissaoETaxas = r2(f.comissao + f.transacao + f.entregaSobDemanda + f.outrosServicos - f.ajustes);
    promoLoja = f.promoLoja;
    promoIfood = f.promoIfood;
  } else {
    const o2 = o!;
    venda = o2.subTotal;
    promoLoja = o2.promoLoja;
    promoIfood = o2.promoIfood;
    const taxa = taxaMedia.get(loja) ?? taxaMedia.get('*');
    comissaoETaxas = taxa == null ? null : r2(o2.subTotal * taxa);
    chega = comissaoETaxas == null ? null : r2(o2.subTotal - comissaoETaxas - promoLoja);
    estimado = true;
  }
  if (cancelado) { chega = f ? f.liquido : 0; }
  const sobra = cancelado || chega == null || comida == null ? null : r2(chega - comida);
  return {
    id: o?.id ?? f!.id,
    numero: o?.numero ?? null,
    loja, at, dia: diaBR(at),
    cliente: o?.cliente ?? null,
    order: o, fin: f, cancelado, venda: r2(venda), comissaoETaxas, promoLoja: r2(promoLoja), promoIfood: r2(promoIfood), promoLojaEntrega: r2(Math.min(promoLoja, o?.promoLojaEntrega ?? f?.promoLojaEntrega ?? 0)), pedidosAntes: o?.pedidosAntes ?? null, chega: chega == null ? null : r2(chega), estimado,
    linhas, comida, sobra,
    sobraBalcao: balcao == null || comida == null ? null : r2(balcao - comida),
    semFicha,
  };
}

// ── Itens do período ─────────────────────────────────────────────────────────

export interface ItemArea {
  chave: string;
  nivel: 'item' | 'complemento';
  nome: string;
  grupo: string | null;
  qtd: number;
  faturado: number;
  precoMedio: number;
  /** Custo por unidade (ficha); null = sem ficha. */
  custoUnit: number | null;
  alvo: string | null;
  tipoLigacao: CustoAlvo['tipo'];
  /** O que chegou na loja deste item (parte do "chega" de cada pedido) por unidade. */
  chegaUnit: number | null;
  sobraUnit: number | null;
  /** sobra ÷ preço médio (%). */
  margem: number | null;
  /** Preço no balcão (cardápio) do que está ligado. */
  precoBalcao: number | null;
  /** Preço no iFood para deixar a mesma sobra do balcão = preço do balcão ÷ fator. */
  precoMesmoBalcao: number | null;
  /** Preço no iFood que empata (sobra zero) = custo ÷ fator. */
  precoEmpata: number | null;
  /** Fator usado (quanto chega de cada R$ 1 do item). */
  fator: number | null;
  /** true = fator pela média do período (relatório de cardápio), não pedido a pedido. */
  fatorMedio: boolean;
  /** Item: o que os clientes escolheram nele (complementos), do mais escolhido para o menos. */
  escolhas?: EscolhaItem[];
}

export interface EscolhaItem {
  chave: string;
  nome: string;
  grupo: string | null;
  qtd: number;
  /** Preço médio cobrado pelo complemento (0 = vem de graça no combo). */
  preco: number;
  /** Custo pela ficha por unidade; null = sem ficha. */
  custoUnit: number | null;
  alvo: string | null;
}

/**
 * Itens a partir dos pedidos (módulo Pedidos). Complementos com preço viram linhas próprias (o valor deles já está
 * no item). "Chega" do item:
 * - com `taxaTeorica` (aba Itens e CMV, cartões da Hoje — dono 06/10): conta TEÓRICA, sem promoção = valor do item ×
 *   (1 − taxa da loja sem promoção, taxaTeoricaPorLoja). Promoção é do pedido, não do item;
 * - sem ela: a parte do "chega" real de cada pedido, proporcional ao valor do item (com as promoções do pedido).
 */
export function itensDosPedidos(pedidos: PedidoArea[], custos: MapaCustos, taxaTeorica?: Map<string, number>): ItemArea[] {
  type Acc = { nivel: 'item' | 'complemento'; nome: string; grupo: string | null; qtd: number; faturado: number; chega: number; comida: number | null };
  const m = new Map<string, Acc>();
  // Por item: o que os clientes escolheram nele (chave do complemento → quantidade e valor).
  const escolhas = new Map<string, Map<string, { nome: string; grupo: string | null; qtd: number; valor: number }>>();
  for (const p of pedidos) {
    if (p.cancelado || !p.order) continue;
    const totalItens = p.order.itens.reduce((s, i) => s + i.total, 0);
    // Pedido sem "chega" (sem fechamento e sem média da loja) ainda conta quantidade e faturado.
    const taxaLoja = taxaTeorica ? taxaTeorica.get(p.loja) ?? taxaTeorica.get('*') ?? null : undefined;
    const fatorPedido = taxaLoja !== undefined
      ? (taxaLoja == null ? null : 1 - taxaLoja)
      : p.chega != null && totalItens > 0.005 ? p.chega / totalItens : null;
    p.order.itens.forEach((it, idx) => {
      const k = chaveItemIfood(it.nome);
      const a = m.get(k) ?? { nivel: 'item', nome: it.nome, grupo: null, qtd: 0, faturado: 0, chega: 0, comida: 0 };
      a.qtd += it.qtd; a.faturado += it.total;
      a.chega = fatorPedido == null || Number.isNaN(a.chega) ? NaN : a.chega + it.total * fatorPedido;
      // Comida do item = ficha do item + complementos escolhidos (a sobra do complemento fica no item).
      const linha = p.linhas[idx];
      a.comida = a.comida == null || linha?.comida == null ? null : a.comida + linha.comida;
      m.set(k, a);
      for (const c of it.complementos) {
        const kc = chaveComplementoIfood(c.nome, c.grupo);
        const doItem = escolhas.get(k) ?? new Map();
        const e = doItem.get(kc) ?? { nome: c.nome, grupo: c.grupo, qtd: 0, valor: 0 };
        e.qtd += c.qtd; e.valor += c.preco * c.qtd;
        doItem.set(kc, e); escolhas.set(k, doItem);
        const b = m.get(kc) ?? { nivel: 'complemento', nome: c.nome, grupo: c.grupo, qtd: 0, faturado: 0, chega: NaN, comida: null };
        b.qtd += c.qtd; b.faturado += c.preco * c.qtd;
        m.set(kc, b);
      }
    });
  }
  return [...m.entries()].map(([chave, a]) => {
    const cu = a.nivel === 'item' ? custoDoItem(custos, a.nome) : custoDoComplemento(custos, a.nome, a.grupo);
    const precoMedio = a.qtd > 0 ? a.faturado / a.qtd : 0;
    const fator = a.nivel === 'item' && a.faturado > 0.005 && !Number.isNaN(a.chega) ? a.chega / a.faturado : null;
    // Item: custo por unidade com os complementos escolhidos (média do período). Complemento: custo da ligação dele.
    const custoUnit = a.nivel === 'item' ? (a.comida == null || a.qtd <= 0 ? null : a.comida / a.qtd) : cu?.custo ?? null;
    const item = finalizarItem(chave, a.nivel, a.nome, a.grupo, a.qtd, a.faturado, precoMedio, cu, fator, false, custoUnit);
    const es = escolhas.get(chave);
    if (es && es.size) {
      item.escolhas = [...es.entries()].map(([ck, e]) => {
        const cc = custoDoComplemento(custos, e.nome, e.grupo);
        return { chave: ck, nome: e.nome, grupo: e.grupo, qtd: e.qtd, preco: e.qtd > 0 ? r2(e.valor / e.qtd) : 0, custoUnit: cc?.custo ?? null, alvo: cc?.alvo ?? null };
      }).sort((x, y) => y.qtd - x.qtd);
    }
    return item;
  }).sort((x, y) => y.faturado - x.faturado || y.qtd - x.qtd);
}

export interface MenuLinhaArea { kind: 'item' | 'complemento'; name: string; group_name?: string | null; quantity: number | null; total_value: number | null }

/** Itens a partir do relatório de Cardápio importado (antes do módulo Pedidos): fator = média do período. */
export function itensDoCardapio(linhas: MenuLinhaArea[], custos: MapaCustos, fatorPeriodo: number | null): ItemArea[] {
  const m = new Map<string, { nivel: 'item' | 'complemento'; nome: string; grupo: string | null; qtd: number; faturado: number }>();
  for (const l of linhas) {
    const nivel = l.kind;
    const chave = nivel === 'item' ? chaveItemIfood(l.name) : `complemento|${normIfood(l.name)}|*`;
    const a = m.get(chave) ?? { nivel, nome: l.name, grupo: l.group_name ?? null, qtd: 0, faturado: 0 };
    a.qtd += num(l.quantity); a.faturado += num(l.total_value);
    m.set(chave, a);
  }
  return [...m.entries()].map(([chave, a]) => {
    const cu = a.nivel === 'item' ? custoDoItem(custos, a.nome) : custoDoComplemento(custos, a.nome, a.grupo);
    const precoMedio = a.qtd > 0 ? a.faturado / a.qtd : 0;
    return finalizarItem(chave, a.nivel, a.nome, a.grupo, a.qtd, a.faturado, precoMedio, cu, a.nivel === 'item' ? fatorPeriodo : null, true);
  }).sort((x, y) => y.faturado - x.faturado || y.qtd - x.qtd);
}

function finalizarItem(chave: string, nivel: 'item' | 'complemento', nome: string, grupo: string | null, qtd: number, faturado: number,
  precoMedio: number, cu: CustoAlvo | null, fator: number | null, fatorMedio: boolean, custoUnitFixo?: number | null): ItemArea {
  const custoUnit = custoUnitFixo !== undefined ? custoUnitFixo : cu?.custo ?? null;
  const chegaUnit = fator == null ? null : precoMedio * fator;
  const sobraUnit = chegaUnit == null || custoUnit == null ? null : chegaUnit - custoUnit;
  const ok = fator != null && fator > 0.05;
  return {
    chave, nivel, nome, grupo, qtd, faturado: r2(faturado), precoMedio: r2(precoMedio),
    custoUnit: custoUnit == null ? null : r2(custoUnit), alvo: cu?.alvo ?? null, tipoLigacao: cu?.tipo ?? null,
    chegaUnit: chegaUnit == null ? null : r2(chegaUnit),
    sobraUnit: sobraUnit == null ? null : r2(sobraUnit),
    margem: sobraUnit == null || precoMedio <= 0.005 ? null : (sobraUnit / precoMedio) * 100,
    precoBalcao: cu?.precoBalcao ?? null,
    precoMesmoBalcao: ok && cu?.precoBalcao != null ? r2(cu.precoBalcao / fator!) : null,
    precoEmpata: ok && custoUnit != null ? r2(custoUnit / fator!) : null,
    fator, fatorMedio,
  };
}

/** Totais do período para a frase "de cada R$ 100 em itens, sobram R$ X". Só itens com ficha e fator. */
export function resumoItens(itens: ItemArea[]) {
  const so = itens.filter((i) => i.nivel === 'item');
  const faturado = so.reduce((s, i) => s + i.faturado, 0);
  const comFicha = so.filter((i) => i.custoUnit != null);
  const fatComFicha = comFicha.reduce((s, i) => s + i.faturado, 0);
  const comConta = comFicha.filter((i) => i.chegaUnit != null);
  const fatConta = comConta.reduce((s, i) => s + i.faturado, 0);
  const chega = comConta.reduce((s, i) => s + (i.chegaUnit ?? 0) * i.qtd, 0);
  const comida = comConta.reduce((s, i) => s + (i.custoUnit ?? 0) * i.qtd, 0);
  return {
    itensVendidos: so.reduce((s, i) => s + i.qtd, 0),
    faturado: r2(faturado),
    cobertura: faturado > 0 ? (fatComFicha / faturado) * 100 : 0,
    semFicha: itens.filter((i) => i.custoUnit == null && (i.nivel === 'item' || i.precoMedio > 0.005)),
    /** De cada R$ 100 (só itens com ficha): quanto fica com o iFood, quanto é comida, quanto sobra. */
    de100: fatConta > 0.005 ? { ifood: ((fatConta - chega) / fatConta) * 100, comida: (comida / fatConta) * 100, sobra: ((chega - comida) / fatConta) * 100 } : null,
    prejuizo: so.filter((i) => i.sobraUnit != null && i.sobraUnit < -0.005),
  };
}
