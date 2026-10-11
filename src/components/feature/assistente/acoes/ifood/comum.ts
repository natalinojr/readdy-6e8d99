// Contas do iFood usadas pelas ações rápidas (grupo iFood, Vendas do dia e Fechamento do dia).
// MESMAS regras da tela Financeiro › iFood › Pedidos (IfoodApiViews › PedidosView) e do
// "Fechamento do turno" (assistente-cron › ifoodResumo) — mudou lá, mude aqui:
// - vendido = itens (gross_bag) + entrega só quando NÃO é o iFood que entrega (entrega própria/sob demanda) −
//   promoção paga pela loja (regra do dono, 2026-10-10), dos pedidos NÃO cancelados (taxa de serviço fica fora).
//   Entregue pelo iFood (tem DELIVERY_FEE_IFOOD), a taxa de entrega é do iFood (regra do dono, 2026-09-26).
//   O TOTAL vendido/pedidos vem de fetchIfoodVendas (a mesma conta do Dashboard: conciliação → API → ao vivo);
//   os detalhes (por loja, hora, pagamento) são da API;
// - taxas = lançamentos negativos do pedido que não são promoção (SUBSIDY), a entrega retida pelo iFood nem a taxa
//   de serviço/conveniência (essa o CLIENTE paga ao iFood: não é custo da loja);
// - "cai no repasse" (campo `liquido`) = saleBalance (o que o iFood repassa; NÃO inclui o pago direto à loja), de todos
//   os pedidos (cancelado pode ter saldo). Nas telas leva o nome "cai no repasse", não "líquido para a loja" (esse é
//   o de Relatórios › iFood › Dinheiro, que parte das vendas inteiras, inclusive o pago direto à loja).
// O iFood não passa pelo PDV: nada disto está no faturamento do fn_get_sales_report.
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { nm, ehTaxaDoCliente } from '@/pages/financeiro/components/IfoodApiViews';
import { fetchIfoodVendas } from '@/lib/ifoodVendas';

export { nm, ehTaxaDoCliente };

interface Venda {
  merchant_id: string;
  short_id: string | null;
  sale_created_at: string;
  current_status: string | null;
  gross_bag: number | null;
  delivery_fee: number | null;
  sale_balance: number | null;
  payment_methods: Array<{ method?: string; wallet?: { name?: string }; card?: { brand?: string } }> | null;
  billing_entries: Array<{ name?: string; value?: number }> | null;
  benefits: unknown;
}

export interface ResumoIfood {
  pedidos: number;
  cancelados: number;
  valorCancelado: number;
  vendido: number;
  taxas: number;
  liquido: number;
  promoLoja: number;
  promoIfood: number;
  porLoja: { nome: string; vendido: number; pedidos: number }[];
  porHora: number[];
  porPagamento: { nome: string; valor: number; pedidos: number }[];
  vendas: Venda[];
}

const n = (v: unknown) => Number(v ?? 0);
const horaBrasilia = (ts: string) => Number(new Date(ts).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }));
export const canceladoIfood = (s: { current_status: string | null }) => /CANCEL/i.test(String(s.current_status ?? ''));
export const taxasDoPedido = (s: { billing_entries: Venda['billing_entries'] }) =>
  (Array.isArray(s.billing_entries) ? s.billing_entries : [])
    .filter((b) => n(b.value) < 0 && !/SUBSIDY/i.test(String(b.name)) && String(b.name) !== 'DELIVERY_FEE_IFOOD' && !ehTaxaDoCliente(b.name))
    .reduce((a, b) => a + n(b.value), 0);
/** Entregue pelo iFood: a taxa de entrega fica com o iFood (vem retida como DELIVERY_FEE_IFOOD). */
export const entregaDoIfood = (s: { billing_entries: Venda['billing_entries'] }) =>
  (Array.isArray(s.billing_entries) ? s.billing_entries : []).some((b) => String(b.name) === 'DELIVERY_FEE_IFOOD');
/** Promoção paga pela loja no pedido, separando a da entrega (alvo DELIVERY_FEE) da dos itens. */
const promoLojaDoPedido = (benefits: unknown) => {
  let itens = 0; let entrega = 0;
  const lista = (benefits as { benefits?: Array<{ target?: string; sponsorships?: Array<{ name?: string; value?: number }> }> } | null)?.benefits ?? [];
  for (const bf of lista) {
    const v = (bf?.sponsorships ?? []).filter((sp) => /^(MERCHANT|CHAIN)$/i.test(String(sp?.name ?? ''))).reduce((a, sp) => a + n(sp?.value), 0);
    if (/DELIVERY/i.test(String(bf?.target ?? ''))) entrega += v; else itens += v;
  }
  return { itens, entrega };
};
/** Vendido do pedido = faturamento (decisão do dono, 2026-10-10): itens + entrega (só quando não é o iFood que
 *  entrega) − promoção paga pela loja (a da entrega só sai quando a loja entrega). Mesma regra de src/lib/ifoodVendas.ts. */
export const vendidoDoPedido = (s: { gross_bag: number | null; delivery_fee: number | null; billing_entries: Venda['billing_entries']; benefits?: unknown }) => {
  const doIfood = entregaDoIfood(s);
  const promo = promoLojaDoPedido(s.benefits);
  return n(s.gross_bag) + (doIfood ? 0 : n(s.delivery_fee)) - promo.itens - (doIfood ? 0 : promo.entrega);
};

// Promoções por quem pagou (mesma regra de IfoodApiViews › somaPatrocinio).
const patrocinio = (benefits: unknown, quem: 'loja' | 'ifood') => {
  let v = 0;
  const lista = (benefits as { benefits?: Array<{ sponsorships?: Array<{ name?: string; value?: number }> }> } | null)?.benefits ?? [];
  for (const bf of lista) {
    for (const sp of bf?.sponsorships ?? []) {
      const nome = String(sp?.name ?? '').toUpperCase();
      const grupo = nome === 'IFOOD' ? 'ifood' : nome === 'EXTERNAL' ? 'industria' : 'loja';
      if (grupo === quem) v += n(sp?.value);
    }
  }
  return v;
};

const pagamento = (m: NonNullable<Venda['payment_methods']>[number] | undefined) => {
  if (!m) return 'Não informado';
  if (m.wallet?.name) return nm(m.wallet.name);
  const metodo = nm(m.method);
  return m.card?.brand && ['CREDIT', 'DEBIT', 'MEAL_VOUCHER', 'VOUCHER'].includes(String(m.method).toUpperCase()) ? `${metodo} ${nm(m.card.brand)}` : metodo || 'Não informado';
};

// Motivo de cancelamento pelo código que a API manda no evento REFUND (metadata.cancelCode). Textos
// iguais aos do relatório de conciliação do iFood (fin_ifood_entries.raw.motivo_cancelamento).
// Culpa: mesma regra do dashboard de Relatórios › iFood (culpaCancelamento: 5xx/902 loja, 6xx cliente).
export const MOTIVO_CANCELAMENTO: Record<number, string> = {
  406: 'O pedido foi acidental', 410: 'O pedido não foi entregue', 412: 'Itens errados / cancelamento parcial',
  419: 'Cancelado pelo atendimento / item faltando', 501: 'Problemas de sistema na loja',
  504: 'A loja está sem entregadores disponíveis', 512: 'A loja só abrirá mais tarde', 601: 'Problemas no veículo',
  609: 'Cliente escolheu outra forma de pagamento', 610: 'Cliente não localizado', 902: 'O pedido não foi confirmado pela loja',
};
export const codigoCancelamento = (eventos: Array<{ metadata?: { cancelCode?: number } | null }> | null | undefined) =>
  (eventos ?? []).map((e) => Number(e?.metadata?.cancelCode)).find((c) => c > 0) ?? null;

/** Nomes das lojas do iFood desta loja do ERPOS (merchant_id → nome). Vazio = loja sem iFood. */
export async function lojasIfood(tenantId: string): Promise<Record<string, string>> {
  const { data } = await supabase.from('fin_ifood_merchants').select('merchant_id, name, merchant_short').eq('tenant_id', tenantId);
  return Object.fromEntries(((data ?? []) as { merchant_id: string; name: string | null; merchant_short: string | null }[])
    .map((m) => [m.merchant_id, m.name || (m.merchant_short ? `Loja ${m.merchant_short}` : `Loja ${m.merchant_id.slice(0, 8)}`)]));
}

/** Busca leve das vendas de hoje/ontem na API do iFood (ifood-financial › sync_sales). Falha = segue com o banco. */
export async function atualizarVendasIfood(tenantId: string, dias = 2): Promise<void> {
  await invokeWithAuth('ifood-financial', { body: { action: 'sync_sales', tenant_id: tenantId, days: dias } }).catch(() => null);
}

/** Vendas do iFood entre dois instantes. null = não deu para ler; pedidos 0 e cancelados 0 = sem venda. */
export async function resumoIfood(tenantId: string, de: string, ate: string, nomes: Record<string, string> = {}): Promise<ResumoIfood | null> {
  const vendas: Venda[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase.from('fin_ifood_sales')
      .select('merchant_id, short_id, sale_created_at, current_status, gross_bag, delivery_fee, sale_balance, payment_methods, billing_entries, benefits:raw->benefits')
      .eq('tenant_id', tenantId).gte('sale_created_at', de).lte('sale_created_at', ate)
      .order('sale_created_at').range(i, i + 999);
    if (error) return null;
    vendas.push(...((data ?? []) as unknown as Venda[]));
    if ((data ?? []).length < 1000) break;
  }
  // Total igual ao do Dashboard (a API às vezes vem com o valor zerado; a conciliação corrige).
  const tela = await fetchIfoodVendas(tenantId, de, ate).catch(() => null);
  const ok = vendas.filter((s) => !canceladoIfood(s));
  const cancel = vendas.filter(canceladoIfood);
  const lojas = new Map<string, { vendido: number; pedidos: number }>();
  const pags = new Map<string, { valor: number; pedidos: number }>();
  const horas = Array<number>(24).fill(0);
  for (const s of ok) {
    const v = vendidoDoPedido(s);
    const l = lojas.get(s.merchant_id) ?? { vendido: 0, pedidos: 0 };
    l.vendido += v; l.pedidos += 1;
    lojas.set(s.merchant_id, l);
    const p = pagamento(Array.isArray(s.payment_methods) ? s.payment_methods[0] : undefined);
    const pg = pags.get(p) ?? { valor: 0, pedidos: 0 };
    pg.valor += v; pg.pedidos += 1;
    pags.set(p, pg);
    horas[horaBrasilia(s.sale_created_at)] += v;
  }
  return {
    pedidos: tela && !tela.error ? tela.pedidos : ok.length,
    cancelados: cancel.length,
    valorCancelado: cancel.reduce((a, s) => a + n(s.gross_bag) + n(s.delivery_fee), 0),
    vendido: tela && !tela.error ? tela.total : ok.reduce((a, s) => a + vendidoDoPedido(s), 0),
    taxas: vendas.reduce((a, s) => a + taxasDoPedido(s), 0),
    liquido: vendas.reduce((a, s) => a + n(s.sale_balance), 0),
    promoLoja: ok.reduce((a, s) => a + patrocinio(s.benefits, 'loja'), 0),
    promoIfood: ok.reduce((a, s) => a + patrocinio(s.benefits, 'ifood'), 0),
    porLoja: [...lojas.entries()].map(([id, v]) => ({ nome: nomes[id] ?? `Loja ${id.slice(0, 8)}`, ...v })).sort((a, b) => b.vendido - a.vendido),
    porHora: horas,
    porPagamento: [...pags.entries()].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.valor - a.valor),
    vendas,
  };
}
