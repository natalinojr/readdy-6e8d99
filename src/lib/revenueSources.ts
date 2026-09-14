import { supabase } from '@/lib/supabase';

// ─── Fontes dos "recebidos" por loja (fin_revenue_settings) ─────────────────
// Uma única regra para Receitas, DRE, DRE Comparativo e Visão Geral: cada loja
// escolhe o que conta como receita recebida. Sem linha na tabela vale o
// comportamento antigo (pedidos do sistema + manuais).
//
// A chave 'stone' é nome histórico: significa "vendas no cartão da maquininha
// configurada" (hoje o único conector de maquininha é o da Stone). Não renomear no
// banco: o front publicado e a edge ifood-financial gravam/leem essas chaves.
export type RevenueSettingSource = 'orders' | 'stone' | 'pix' | 'ifood' | 'manual';

export const DEFAULT_REVENUE_SOURCES: RevenueSettingSource[] = ['orders', 'manual'];

// ─── Como o dinheiro entra (mesma linha de fin_revenue_settings) ─────────────
// O papel de cada banco/maquininha é configuração da loja (Conciliação › ⚙ ›
// Como o dinheiro entra). As funções do banco (fin_pix_recebidos,
// fn_match_card_deposits, fn_match_ifood_inter) leem isto via fn_money_flow;
// coluna vazia = comportamento anterior (Inter + Stone).
export type CardProvider = 'stone' | 'mercadopago' | 'outra' | 'nenhuma';
export type BankProvider = 'inter' | 'ofx' | 'outro';
/** transfer = Pix da maquininha fica na conta dela e é transferido (a transferência conta como Pix recebido);
 *  direct = cai direto no banco principal; none = não vende Pix na maquininha. */
export type CardPixMode = 'transfer' | 'direct' | 'none';

export const CARD_PROVIDERS: Record<CardProvider, { label: string; conector: boolean; depositMatch: string; hint: string }> = {
  stone: { label: 'Stone', conector: true, depositMatch: 'stone', hint: 'Vendas, taxas e repasses entram sozinhos pela API de Conciliação da Stone.' },
  mercadopago: { label: 'Mercado Pago', conector: false, depositMatch: 'mercado pago', hint: 'O conector do Mercado Pago ainda não foi feito: até lá as vendas no cartão não entram sozinhas.' },
  outra: { label: 'Outra maquininha', conector: false, depositMatch: '', hint: 'Sem integração: as vendas no cartão só entram por pedidos do sistema ou lançamento manual.' },
  nenhuma: { label: 'Não uso maquininha', conector: false, depositMatch: '', hint: '' },
};

export const BANK_PROVIDERS: Record<BankProvider, { label: string; hint: string }> = {
  inter: { label: 'Banco Inter (API)', hint: 'Extrato e saldo entram sozinhos todo dia.' },
  ofx: { label: 'Outro banco (arquivo OFX/CSV)', hint: 'Extrato entra pelo arquivo baixado no banco (Conciliação › Importar › Arquivo OFX ou CSV).' },
  outro: { label: 'Outro banco (sem extrato)', hint: 'Sem extrato no sistema: o Pix recebido não entra como receita.' },
};

export const CARD_PIX_MODES: Record<CardPixMode, { label: string; hint: string }> = {
  transfer: { label: 'Fica na conta da maquininha e eu transfiro', hint: 'A transferência da própria empresa para o banco principal conta como Pix recebido (no dia da transferência). Atenção: qualquer transferência de outra conta da empresa também conta.' },
  direct: { label: 'Cai direto no banco principal', hint: 'Transferências entre contas da própria empresa não contam como receita.' },
  none: { label: 'Não vendo Pix na maquininha', hint: 'Transferências entre contas da própria empresa não contam como receita.' },
};

export interface MoneyFlowSettings {
  bank_provider: BankProvider | null;
  bank_account_id: string | null;
  card_provider: CardProvider | null;
  card_deposit_account_id: string | null;
  card_deposit_match: string | null;
  card_pix_mode: CardPixMode | null;
  ifood_deposit_account_id: string | null;
}

export const EMPTY_MONEY_FLOW: MoneyFlowSettings = {
  bank_provider: null, bank_account_id: null, card_provider: null, card_deposit_account_id: null,
  card_deposit_match: null, card_pix_mode: null, ifood_deposit_account_id: null,
};

/** Nomes para as telas (DRE, Receitas...) a partir da configuração. */
export function moneyFlowLabels(flow?: Partial<MoneyFlowSettings> | null) {
  const cp = flow?.card_provider ?? null;
  const card = cp === 'stone' || cp === 'mercadopago' ? CARD_PROVIDERS[cp].label : 'maquininha';
  const bank = flow?.bank_provider === 'inter' ? 'Banco Inter' : 'banco principal';
  const pixMode: CardPixMode = flow?.card_pix_mode ?? 'transfer';
  return { card, bank, pixMode };
}

export function revenueSourceInfo(flow?: Partial<MoneyFlowSettings> | null): Record<RevenueSettingSource, { label: string; desc: string }> {
  const l = moneyFlowLabels(flow);
  const cardName = l.card === 'maquininha' ? 'da maquininha' : `(${l.card})`;
  return {
    orders: { label: 'Pedidos do sistema', desc: 'Pedidos pagos no ERP (livro-razão auto_sale). Não confirma que o dinheiro entrou na conta.' },
    stone: { label: `Vendas no cartão ${cardName}`, desc: `Vendas em cartão liquidadas pela maquininha (valor bruto), na data em que ela pagou. Exige a integração da maquininha com "lançar no financeiro" ligado.` },
    pix: {
      label: `Pix recebido (${l.bank})`,
      desc: `Todo Pix que entrou no ${l.bank}.` +
        (l.pixMode === 'transfer' ? ' Inclui o Pix da maquininha transferido da conta dela (e qualquer transferência de outra conta da empresa).' : ' Transferências entre contas da empresa ficam de fora.') +
        ' Repasses do iFood e da maquininha já conciliados ficam de fora. Atenção: aporte de sócio por Pix também entra.',
    },
    ifood: { label: 'Vendas iFood', desc: 'Vendas do iFood (antes das comissões e taxas), na data do repasse. Exige a integração iFood com "lançar no financeiro" ligado; as comissões entram como Taxas iFood.' },
    manual: { label: 'Lançamentos manuais', desc: 'Receitas lançadas à mão pelo botão "Nova Receita" (eventos, aluguel etc.).' },
  };
}

/** Rótulos genéricos (sem a configuração da loja). */
export const REVENUE_SOURCE_INFO = revenueSourceInfo(null);

const FLOW_COLUMNS = 'bank_provider, bank_account_id, card_provider, card_deposit_account_id, card_deposit_match, card_pix_mode, ifood_deposit_account_id';

export async function fetchRevenueSettings(tenantId: string): Promise<{ sources: RevenueSettingSource[]; flow: MoneyFlowSettings; error: string | null }> {
  const { data, error } = await supabase
    .from('fin_revenue_settings')
    .select(`sources, ${FLOW_COLUMNS}`)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return { sources: DEFAULT_REVENUE_SOURCES, flow: EMPTY_MONEY_FLOW, error: error.message };
  const row = (data ?? null) as (Partial<MoneyFlowSettings> & { sources?: RevenueSettingSource[] | null }) | null;
  const flow: MoneyFlowSettings = { ...EMPTY_MONEY_FLOW };
  if (row) (Object.keys(EMPTY_MONEY_FLOW) as (keyof MoneyFlowSettings)[]).forEach(k => { (flow as unknown as Record<string, unknown>)[k] = row[k] ?? null; });
  return { sources: row?.sources ?? DEFAULT_REVENUE_SOURCES, flow, error: null };
}

export async function fetchRevenueSources(tenantId: string): Promise<{ sources: RevenueSettingSource[]; error: string | null }> {
  const { sources, error } = await fetchRevenueSettings(tenantId);
  return { sources, error };
}

export interface PixRecebidoRow {
  id: string;
  transaction_date: string;
  amount: number;
  description: string | null;
  counterpart_name: string | null;
  match_kind: string | null;
  created_at: string;
}

// Pix que entrou no banco principal da loja (configuração "Como o dinheiro entra").
// Inclui a transferência da conta da maquininha (match_kind internal_transfer) quando
// o Pix da maquininha está como "fica na conta dela e eu transfiro".
// Via RPC: fin_bank_statement_imports não tem GRANT para o app (o extrato só é
// lido pelas Edge Functions); a função expõe apenas os créditos Pix, por vínculo.
export async function fetchPixRecebidos(tenantId: string, startDate: string, endDate: string) {
  const { data, error } = await supabase.rpc('fin_pix_recebidos', {
    p_tenant: tenantId, p_start: startDate, p_end: endDate,
  });
  return { rows: ((data ?? []) as PixRecebidoRow[]).map(r => ({ ...r, amount: Number(r.amount) })), error: error?.message ?? null };
}

// Vendas em cartão liquidadas pela maquininha (fin_cash_flow origin stone_sale —
// nome histórico do conector Stone).
export async function fetchStoneSales(tenantId: string, startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('fin_cash_flow')
    .select('date, amount')
    .eq('tenant_id', tenantId)
    .eq('type', 'income')
    .eq('origin', 'stone_sale')
    .gte('date', startDate)
    .lte('date', endDate);
  return { rows: ((data ?? []) as { date: string; amount: number }[]).map(r => ({ ...r, amount: Number(r.amount) })), error: error?.message ?? null };
}

// Vendas do iFood por dia de repasse (fin_cash_flow origin ifood_sale, lançadas
// pela edge ifood-financial com post_to_ledger ligado).
export async function fetchIfoodSales(tenantId: string, startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('fin_cash_flow')
    .select('date, amount')
    .eq('tenant_id', tenantId)
    .eq('type', 'income')
    .eq('origin', 'ifood_sale')
    .gte('date', startDate)
    .lte('date', endDate);
  return { rows: ((data ?? []) as { date: string; amount: number }[]).map(r => ({ ...r, amount: Number(r.amount) })), error: error?.message ?? null };
}

export const sumAmount = (rows: { amount: number }[]) => rows.reduce((s, r) => s + Number(r.amount), 0);

// Fontes da loja + totais de Pix e iFood do período (só busca o que estiver ligado).
export async function loadRevenueExtras(tenantId: string, startDate: string, endDate: string) {
  const { sources, flow } = await fetchRevenueSettings(tenantId);
  const [pix, ifood] = await Promise.all([
    sources.includes('pix') ? fetchPixRecebidos(tenantId, startDate, endDate).then(r => sumAmount(r.rows)) : Promise.resolve(0),
    sources.includes('ifood') ? fetchIfoodSales(tenantId, startDate, endDate).then(r => sumAmount(r.rows)) : Promise.resolve(0),
  ]);
  return { sources, pix, ifood, labels: moneyFlowLabels(flow) };
}

// Aplica a regra dos recebidos a um snapshot de DRE: zera o que a loja não
// escolheu e acrescenta Pix e iFood. Pedidos = as linhas por destino (auto_sale).
export function applyRevenueSources<T extends {
  receitaBalcao: number; receitaDelivery: number; receitaMesa: number; receitaAutoatendimento: number;
  receitaStone: number; receitaManual?: number; receitaPix?: number; receitaIfood?: number;
}>(d: T, sources: RevenueSettingSource[], pix: number, ifood = 0): T {
  const on = (s: RevenueSettingSource) => sources.includes(s);
  return {
    ...d,
    receitaBalcao: on('orders') ? d.receitaBalcao : 0,
    receitaDelivery: on('orders') ? d.receitaDelivery : 0,
    receitaMesa: on('orders') ? d.receitaMesa : 0,
    receitaAutoatendimento: on('orders') ? d.receitaAutoatendimento : 0,
    receitaStone: on('stone') ? d.receitaStone : 0,
    ...(d.receitaManual !== undefined ? { receitaManual: on('manual') ? d.receitaManual : 0 } : {}),
    receitaPix: on('pix') ? pix : 0,
    receitaIfood: on('ifood') ? ifood : 0,
  };
}
