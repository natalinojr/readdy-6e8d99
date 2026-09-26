// Contas do iFood usadas pelas ações rápidas (grupo iFood, Vendas do dia e Fechamento do dia).
// MESMAS regras da tela Financeiro › iFood › Pedidos (IfoodApiViews › PedidosView) e do
// "Fechamento do turno" (assistente-cron › ifoodResumo) — mudou lá, mude aqui:
// - vendido = itens (gross_bag) + entrega dos pedidos NÃO cancelados (taxa de serviço fica fora);
// - taxas = lançamentos negativos do pedido que não são promoção (SUBSIDY);
// - líquido = saleBalance (o que o iFood repassa), de todos os pedidos (cancelado pode ter saldo).
// O iFood não passa pelo PDV: nada disto está no faturamento do fn_get_sales_report.
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { nm } from '@/pages/financeiro/components/IfoodApiViews';

export { nm };

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
  (Array.isArray(s.billing_entries) ? s.billing_entries : []).filter((b) => n(b.value) < 0 && !/SUBSIDY/i.test(String(b.name))).reduce((a, b) => a + n(b.value), 0);

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
  const ok = vendas.filter((s) => !canceladoIfood(s));
  const cancel = vendas.filter(canceladoIfood);
  const lojas = new Map<string, { vendido: number; pedidos: number }>();
  const pags = new Map<string, { valor: number; pedidos: number }>();
  const horas = Array<number>(24).fill(0);
  for (const s of ok) {
    const v = n(s.gross_bag) + n(s.delivery_fee);
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
    pedidos: ok.length,
    cancelados: cancel.length,
    valorCancelado: cancel.reduce((a, s) => a + n(s.gross_bag) + n(s.delivery_fee), 0),
    vendido: ok.reduce((a, s) => a + n(s.gross_bag) + n(s.delivery_fee), 0),
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
