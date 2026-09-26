// mp-conciliation — conciliação da maquininha Mercado Pago (vendas, taxas e saques).
//
// Duas fontes, cada uma com um papel bem separado — de propósito, para nada ser contado duas vezes:
//
//   • VENDAS — GET /v1/payments/search (por dia de aprovação). Cada venda aprovada vira:
//       – uma linha de extrato na conta "Mercado Pago" da loja (fin_bank_statement_imports,
//         source='mercadopago', raw.kind='release'), crédito do LÍQUIDO na data de liberação;
//       – lançamento no financeiro (opcional, fin_mp_config.post_to_ledger): receita bruta
//         (origin `stone_sale` — nome histórico de "venda no cartão da maquininha") e taxa
//         (origin `auto_card_fee`), agrupadas por dia de liberação. DRE, Receitas e Visão Geral
//         já leem essas origins: nada muda no resto do sistema.
//     Diferente da Stone, aqui a TAXA REAL vem por venda (fee_details) junto com a bandeira
//     (payment_method_id) e as parcelas — não é estimativa.
//
//   • EXTRATO DA CONTA MP — Relatório de Liberações (released money, CSV). Só os movimentos que
//     payments/search NÃO dá: SAQUE (payout), disputa, reserva, contracargo, tarifas soltas.
//     Linhas de `payment`/`refund` do relatório são ignoradas justamente porque já entraram
//     pelas vendas. raw.kind = 'payout' | 'movement'.
//
// Por que isso importa: a Stone repassa todo dia; o Mercado Pago acumula saldo e o dono saca
// quando quer. Então o casamento com o banco é 1 SAQUE × 1 crédito (fn_match_mp_payouts), não
// grupo-do-dia × crédito-do-dia (fn_match_card_deposits, que segue sendo da Stone).
//
// Token: NÃO é guardado aqui. Sai de fin_payment_provider_config (provider `mp_point` por
// padrão, ou `mercadopago`) — a mesma conta do Mercado Pago que já cobra no autoatendimento.
//
// Ações (POST JSON { action, tenant_id, ... }):
//   get_config       {}
//   save_config      { bank_account_id, token_provider?, auto_sync?, post_to_ledger?, release_report?, release_prefix? }
//   delete_config    {}
//   import           { reference_date }              vendas de um dia (AAAA-MM-DD)
//   import_range     { date_from, date_to }          até 31 dias
//   get_history      {}                              dias importados + relatórios baixados
//   release_request  { date_from, date_to }          pede o Relatório de Liberações ao MP
//   release_schedule { frequency? }                  programa o relatório diário no MP
//   release_fetch    { reprocess? }                  baixa e importa os relatórios prontos (reprocess: também os já importados)
//   sync             { date_from? }                  dias sem sucesso + release_fetch
//   sync_all         {}                              (interno) todas as lojas — cron 07h20
//
// Autenticação: JWT do usuário (vínculo em user_tenants) OU x-internal-key = FISCAL_INTERNAL_KEY.
// Escrita de configuração exige admin/gerente/financeiro.
// deno-lint-ignore-file no-explicit-any

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { isFinanceiroRole } from '../_shared/tenant-auth.ts';

type Admin = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
};
const MP_API = 'https://api.mercadopago.com';
const TIMEOUT_MS = 30_000;
const PAGE = 50;
const MAX_PAGES = 60;            // 3.000 vendas num dia é folga suficiente
const MAX_RANGE_DAYS = 31;
const MAX_REPORTS_PER_RUN = 5;   // baixar tudo de uma vez estoura o tempo da Edge
const MATCH_WINDOW_DAYS = 20;
const SEARCH_TRIES = 6;          // a busca do MP devolve vazio às vezes: repete antes de aceitar "dia sem venda"
const LATE_EVENT_DAYS = 5;      // estorno/contestação alterados nesses dias reimportam o dia da venda

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'mp-conciliation', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  if (v == null || v === '') return 0;
  // o CSV do MP pode vir com vírgula decimal, dependendo do idioma da conta
  const s = String(v).trim().replace(/\s/g, '');
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const isoDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));
const todayBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400_000);
/** Data do MP (com offset) → dia em Brasília. Sem isso, venda das 22h cai no dia seguinte. */
function brDate(v: unknown): string | null {
  const s = String(v ?? '');
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return isoDate(s.slice(0, 10)) ? s.slice(0, 10) : null;
  return new Date(t - 3 * 3600_000).toISOString().slice(0, 10);
}
/** Data do MP (com offset) → 'HH:MM' em Brasília; null quando não tem hora. */
function brTime(v: unknown): string | null {
  const s = String(v ?? '');
  if (!/T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(s)) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t - 3 * 3600_000).toISOString().slice(11, 16);
}
/** Início/fim do dia em Brasília no formato que a busca do MP aceita. */
const dayStart = (d: string) => `${d}T00:00:00.000-03:00`;
const dayEnd = (d: string) => `${d}T23:59:59.999-03:00`;
const money = (n: number) => n.toFixed(2).replace('.', ',');
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

// ── Cliente do Mercado Pago ──────────────────────────────────────────────────
async function mpFetch(token: string, path: string, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${MP_API}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { ok: res.ok, status: res.status, body, text };
  } finally { clearTimeout(timer); }
}
/** Erro do MP em português, dizendo o que dá para fazer. */
function mpError(r: { status: number; body: any }): string {
  const msg = String(r.body?.message ?? r.body?.error ?? '').slice(0, 200);
  if (r.status === 401 || r.status === 403) {
    return `O Mercado Pago recusou o token (${r.status}). Confira em Configurações › Formas de pagamento se a maquininha está com o Access Token de produção da conta certa.${msg ? ` [${msg}]` : ''}`;
  }
  return `Mercado Pago respondeu ${r.status}${msg ? `: ${msg}` : ''}`;
}

// ── Token: vem da configuração da maquininha, não é copiado aqui ─────────────
async function loadToken(admin: Admin, tenantId: string, provider: string) {
  const { data } = await admin.from('fin_payment_provider_config')
    .select('access_token, is_active, environment, account_label')
    .eq('tenant_id', tenantId).eq('provider', provider).maybeSingle();
  return {
    token: String(data?.access_token ?? ''),
    active: data?.is_active === true,
    environment: String(data?.environment ?? 'production'),
    label: (data?.account_label as string | null) ?? null,
  };
}

// ── Vendas de um dia ─────────────────────────────────────────────────────────
interface MpSale {
  id: string;
  status: string;
  approvedDate: string;   // dia em Brasília
  releaseDate: string;    // dia em Brasília (money_release_date, ou o de aprovação)
  /** hora (Brasília) da liberação, ou da aprovação quando o MP não informa a da liberação */
  releaseTime: string | null;
  gross: number;
  fee: number;
  net: number;
  refunded: number;
  /** Estornos com a data em que o dinheiro saiu (dia em Brasília). Soma = refunded. */
  refunds: Array<{ id: string; date: string; time: string | null; amount: number }>;
  /** Contestação perdida (status charged_back): dia em Brasília em que o MP registrou */
  chargebackDate: string | null;
  installments: number;
  brand: string;
  paymentType: string;
  operationType: string;
  /** order.type do MP: 'mercadolibre' = venda no Mercado Livre, não é venda da loja */
  orderType: string | null;
  marketplace: boolean;
  charges: Array<{ name: string; type: string; amount: number }>;
  externalReference: string | null;
  lastFour: string | null;
  description: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  credit_card: 'crédito', debit_card: 'débito', account_money: 'saldo MP',
  ticket: 'boleto', bank_transfer: 'Pix', digital_wallet: 'carteira', voucher: 'voucher',
};

// A taxa NÃO está sempre em `fee_details`: em pagamento novo do MP ela vem em
// `charges_details` (mp_processing_fee, ml_sale_fee, shp_fulfillment...), e `fee_details`
// volta vazio. Conferido na conta real em 2026-09-21: bruto 188,91 → líquido 131,35 com
// `fee_details: []`. Por isso a fonte da verdade aqui é `net_received_amount`:
// taxa = bruto − líquido. Assim bruto − taxa = líquido sempre fecha na DRE.
function parseSale(p: any): MpSale | null {
  const approved = brDate(p.date_approved) ?? brDate(p.date_created);
  if (!approved) return null;
  const gross = num(p.transaction_amount);

  const chargeList: Array<{ name: string; type: string; amount: number }> =
    (Array.isArray(p.charges_details) ? p.charges_details : [])
      .filter((c: any) => String(c?.accounts?.from ?? 'collector') === 'collector')
      .map((c: any) => ({
        name: String(c?.name ?? ''), type: String(c?.type ?? ''),
        amount: round2(num(c?.amounts?.original) - num(c?.amounts?.refunded)),
      }));
  const chargeSum = round2(chargeList.reduce((s, c) => s + c.amount, 0));
  const feeDetailSum = round2((Array.isArray(p.fee_details) ? p.fee_details : [])
    .filter((f: any) => !f?.fee_payer || String(f.fee_payer) === 'collector')
    .reduce((s: number, f: any) => s + num(f?.amount), 0));

  const netRaw = p.transaction_details?.net_received_amount;
  let net: number;
  let fee: number;
  if (netRaw != null && num(netRaw) > 0) {
    net = round2(num(netRaw));
    fee = round2(Math.max(0, gross - net));
  } else {
    fee = round2(Math.max(chargeSum, feeDetailSum));
    net = round2(gross - fee);
  }

  const orderType = p.order?.type ? String(p.order.type) : null;
  const refunded = round2(num(p.transaction_amount_refunded));
  const lastUpdate = brDate(p.date_last_updated) ?? approved;
  const refunds = (Array.isArray(p.refunds) ? p.refunds : [])
    .filter((r: any) => !r?.status || ['approved', 'processed'].includes(String(r.status)))
    .map((r: any) => ({ id: String(r?.id ?? ''), date: brDate(r?.date_created) ?? lastUpdate, time: brTime(r?.date_created ?? p.date_last_updated), amount: round2(num(r?.amount)) }))
    .filter((r: { amount: number }) => r.amount > 0.004);
  // a busca às vezes vem sem a lista: um estorno só, na data da última alteração do pagamento
  if (refunds.length === 0 && refunded > 0.004) refunds.push({ id: '', date: lastUpdate, time: brTime(p.date_last_updated), amount: refunded });
  return {
    id: String(p.id),
    status: String(p.status ?? ''),
    approvedDate: approved,
    releaseDate: brDate(p.money_release_date) ?? approved,
    releaseTime: brTime(p.money_release_date) ?? brTime(p.date_approved),
    gross, fee, net,
    refunded, refunds,
    chargebackDate: String(p.status ?? '') === 'charged_back' ? lastUpdate : null,
    installments: Number(p.installments ?? 1) || 1,
    brand: String(p.payment_method_id ?? ''),
    paymentType: String(p.payment_type_id ?? ''),
    operationType: String(p.operation_type ?? ''),
    orderType,
    // venda no Mercado Livre cai na MESMA conta do Mercado Pago, mas não é venda da loja
    marketplace: orderType === 'mercadolibre' || /marketplace/i.test(String(p.description ?? '')),
    charges: chargeList,
    externalReference: p.external_reference ? String(p.external_reference) : null,
    lastFour: p.card?.last_four_digits ? String(p.card.last_four_digits) : null,
    description: p.description ? String(p.description).slice(0, 160) : null,
  };
}

/**
 * Uma página da busca de pagamentos, repetida quando volta vazia. Medido na conta real em 2026-09-25:
 * a MESMA busca (dia 21/09, 12 pagamentos) devolveu `total: 0` em 4 de 6 chamadas seguidas — e o
 * importador gravava o dia como "sem vendas" e nunca mais olhava. Fica com a resposta de maior total.
 */
async function searchPage(token: string, qs: URLSearchParams) {
  let best: Awaited<ReturnType<typeof mpFetch>> | null = null;
  for (let i = 0; i < SEARCH_TRIES; i++) {
    const r = await mpFetch(token, `/v1/payments/search?${qs.toString()}`);
    if (!r.ok) { if (!best) best = r; continue; }
    const n = Array.isArray(r.body?.results) ? r.body.results.length : 0;
    if (!best || !best.ok || n > (Array.isArray(best.body?.results) ? best.body.results.length : 0)) best = r;
    if (n > 0) break;
  }
  return best!;
}

async function fetchSales(token: string, date: string): Promise<{ sales: MpSale[]; error?: string }> {
  const sales: MpSale[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      range: 'date_approved',
      begin_date: dayStart(date),
      end_date: dayEnd(date),
      sort: 'date_approved',
      criteria: 'asc',
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    const r = await searchPage(token, qs);
    if (!r.ok) return { sales, error: mpError(r) };
    const results: any[] = Array.isArray(r.body?.results) ? r.body.results : [];
    for (const p of results) {
      const s = parseSale(p);
      // 'rejected'/'cancelled' nunca viraram dinheiro; 'pending' entra quando aprovar
      if (!s || !['approved', 'refunded', 'charged_back', 'in_mediation'].includes(s.status)) continue;
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      sales.push(s);
    }
    const total = Number(r.body?.paging?.total ?? results.length);
    if (results.length < PAGE || (page + 1) * PAGE >= total) break;
  }
  return { sales };
}

/** Parte líquida de um valor estornado (a taxa volta na mesma proporção). */
const refundNet = (s: MpSale, amount: number) => (s.gross > 0 ? round2(amount * s.net / s.gross) : round2(amount));

/**
 * Dias de venda que precisam ser reimportados porque a venda mudou depois (estorno, contestação).
 * O dia é importado pela data de APROVAÇÃO, uma vez só; um estorno 10 dias depois nunca seria visto.
 */
async function changedSaleDays(token: string, from: string, to: string): Promise<{ days: string[]; error?: string }> {
  const days = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      range: 'date_last_updated', begin_date: dayStart(from), end_date: dayEnd(to),
      sort: 'date_last_updated', criteria: 'asc', limit: String(PAGE), offset: String(page * PAGE),
    });
    const r = await searchPage(token, qs);
    if (!r.ok) return { days: [...days], error: mpError(r) };
    const results: any[] = Array.isArray(r.body?.results) ? r.body.results : [];
    for (const p of results) {
      const mexeu = ['refunded', 'charged_back', 'in_mediation'].includes(String(p.status ?? '')) || num(p.transaction_amount_refunded) > 0;
      const aprov = brDate(p.date_approved);
      if (mexeu && aprov) days.add(aprov);
    }
    const total = Number(r.body?.paging?.total ?? results.length);
    if (results.length < PAGE || (page + 1) * PAGE >= total) break;
  }
  return { days: [...days].sort() };
}

// ── Linhas de extrato das vendas ─────────────────────────────────────────────
function saleRows(tenantId: string, bankAccountId: string, importId: string | null, sales: MpSale[]) {
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const s of sales) {
    const tipo = TYPE_LABEL[s.paymentType] ?? s.paymentType ?? 'cartão';
    const parcelas = s.installments > 1 ? ` em ${s.installments}x` : '';
    const bandeira = s.brand ? ` ${s.brand}` : '';
    const cartao = s.lastFour ? ` ····${s.lastFour}` : '';
    const pedido = s.externalReference ? ` · pedido ${s.externalReference}` : '';
    rows.push({
      tenant_id: tenantId, bank_account_id: bankAccountId,
      external_id: `mp:${s.id}`,
      transaction_date: s.releaseDate,
      amount: Math.abs(s.net),
      description: s.marketplace
        ? `Venda no Mercado Livre — bruto R$ ${money(s.gross)}, taxas R$ ${money(s.fee)}${s.description ? ` · ${s.description}` : ''}`
        : `Venda ${tipo}${bandeira}${parcelas}${cartao} — bruto R$ ${money(s.gross)}, taxa R$ ${money(s.fee)}${pedido}`,
      transaction_type: s.net < 0 ? 'debit' : 'credit',
      // o extrato do Mercado Pago é a verdade do provedor: não tem contraparte para conciliar
      status: 'matched', match_kind: 'card_release', matched_at: now,
      category: s.marketplace ? 'Venda Mercado Livre (fora do caixa)' : 'Venda no cartão (Mercado Pago)',
      notes: s.marketplace
        ? `Entrou na conta do Mercado Pago em ${ddmm(s.releaseDate)}, mas é venda no Mercado Livre — NÃO entra como receita da loja.`
        : `Liberado pelo Mercado Pago em ${ddmm(s.releaseDate)} (venda de ${ddmm(s.approvedDate)}).`,
      source: 'mercadopago', provider_import_id: importId,
      raw: {
        kind: 'release', payment_id: s.id, status: s.status,
        ...(s.releaseTime ? { hora: s.releaseTime, hora_ref: 'liberação' } : {}),
        gross: s.gross, fee: s.fee, net: s.net, refunded: s.refunded,
        installments: s.installments, brand: s.brand, payment_type: s.paymentType,
        operation_type: s.operationType, order_type: s.orderType, marketplace: s.marketplace,
        charges: s.charges, description: s.description,
        external_reference: s.externalReference, approved_date: s.approvedDate, release_date: s.releaseDate,
      },
    });
    // Estorno: o MP devolve a taxa proporcional, então sai do saldo o LÍQUIDO do valor estornado,
    // no dia do estorno (visto na conta: venda de R$ 1,00 com taxa 0,01 → reserve_for_refund 0,99).
    // Contestação (charged_back) não vira linha aqui: o débito real vem no Relatório de Liberações.
    s.refunds.forEach((r, i) => {
      const liquido = refundNet(s, r.amount);
      rows.push({
        tenant_id: tenantId, bank_account_id: bankAccountId,
        external_id: i === 0 ? `mpref:${s.id}` : `mpref:${s.id}:${r.id || i}`,
        transaction_date: r.date,
        amount: liquido,
        description: `Estorno de venda${s.externalReference ? ` · pedido ${s.externalReference}` : ''} (R$ ${money(r.amount)}, taxa devolvida R$ ${money(round2(r.amount - liquido))})`,
        transaction_type: 'debit',
        status: 'matched', match_kind: 'card_refund', matched_at: now,
        category: 'Estorno (Mercado Pago)',
        source: 'mercadopago', provider_import_id: importId,
        raw: { kind: 'refund', payment_id: s.id, refund_id: r.id || null, refunded: r.amount, net: liquido, fee_returned: round2(r.amount - liquido), refund_date: r.date, status: s.status, ...(r.time ? { hora: r.time, hora_ref: 'estorno' } : {}) },
      });
    });
  }
  return rows;
}

/** Hora nas linhas que já existiam (importadas antes de guardarmos a hora): o upsert ignora duplicadas. */
async function setHora(admin: Admin, tenantId: string, bankAccountId: string, rows: Record<string, unknown>[]) {
  const comHora = rows
    .map((r) => ({ external_id: r.external_id, raw: (r.raw ?? {}) as Record<string, unknown> }))
    .filter((r) => r.raw.hora)
    .map((r) => ({ external_id: r.external_id, hora: r.raw.hora, hora_data: r.raw.hora_data ?? null, hora_ref: r.raw.hora_ref ?? null }));
  if (comHora.length === 0) return;
  const { error } = await admin.rpc('fn_statement_set_hora', { p_tenant: tenantId, p_bank_account: bankAccountId, p_rows: comHora });
  if (error) log('WARN', 'import', 'gravar hora falhou', { tenantId, error: error.message });
}

async function insertStatement(admin: Admin, rows: Record<string, unknown>[]) {
  let inserted = 0;
  // estorno é REGRAVADO (valor/data mudam com estorno parcial novo e com a correção da taxa devolvida);
  // o resto é imutável e só entra se ainda não existe
  const estornos = rows.filter((r) => String(r.external_id).startsWith('mpref:'));
  const demais = rows.filter((r) => !String(r.external_id).startsWith('mpref:'));
  for (const [lista, ignore] of [[demais, true], [estornos, false]] as const) {
    for (let i = 0; i < lista.length; i += 200) {
      const { data, error } = await admin.from('fin_bank_statement_imports')
        .upsert(lista.slice(i, i + 200), { onConflict: 'tenant_id,bank_account_id,external_id', ignoreDuplicates: ignore })
        .select('id');
      if (error) throw new Error(`Gravar extrato: ${error.message}`);
      inserted += (data ?? []).length;
    }
  }
  return inserted;
}

// ── Lançamento no financeiro (fin_mp_config.post_to_ledger) ──────────────────
// Por dia de LIBERAÇÃO: receita = bruto − estornos (origin stone_sale); despesa = taxa do MP
// (origin auto_card_fee, que a DRE já lê). Idempotente: apaga o que este dia lançou e relança.
// Venda no Mercado Livre fica FORA: cai na mesma conta do Mercado Pago, mas não é venda da loja
// (aparece no extrato para o saldo fechar, nunca na receita).
async function postLedger(admin: Admin, tenantId: string, importId: string, allSales: MpSale[]) {
  const { error: delErr } = await admin.from('fin_cash_flow')
    .delete().eq('tenant_id', tenantId).eq('reference_id', importId).in('origin', ['stone_sale', 'auto_card_fee']);
  if (delErr) throw new Error(`Limpar lançamentos: ${delErr.message}`);

  const sales = allSales.filter((s) => !s.marketplace);
  // Cada movimento no dia em que o dinheiro mexe: venda na liberação; estorno e contestação no dia
  // em que aconteceram, tirando o bruto da receita e devolvendo a taxa proporcional (como a Stone).
  type Day = { gross: number; fee: number; refund: number; cbk: number; n: number; loss: number };
  const days = new Map<string, Day>();
  const day = (d: string) => {
    let x = days.get(d);
    if (!x) { x = { gross: 0, fee: 0, refund: 0, cbk: 0, n: 0, loss: 0 }; days.set(d, x); }
    return x;
  };
  for (const s of sales) {
    const v = day(s.releaseDate);
    v.gross += s.gross; v.fee += s.fee; v.n++;
    for (const r of s.refunds) {
      const x = day(r.date);
      x.gross -= r.amount; x.fee -= round2(r.amount - refundNet(s, r.amount)); x.refund += r.amount;
    }
    // contestação perdida: sai o que sobrou da venda depois dos estornos
    if (s.chargebackDate) {
      const resto = round2(s.gross - s.refunded);
      if (resto > 0.004) {
        const x = day(s.chargebackDate);
        x.gross -= resto; x.fee -= round2(resto - refundNet(s, resto)); x.cbk += resto;
      }
    }
  }
  const rows: Record<string, unknown>[] = [];
  const base = { tenant_id: tenantId, reference_id: importId };
  for (const [d, x] of days) {
    // dia com mais estorno do que venda: nada de receita/taxa negativa — a diferença vira despesa
    if (x.fee < 0) { x.gross -= x.fee; x.fee = 0; } // taxa devolvida maior que a do dia: vira receita (gross − fee não muda)
    if (x.gross < 0) { x.loss = -x.gross; x.gross = 0; }
    const extra = [
      x.refund > 0.004 ? `R$ ${money(round2(x.refund))} estornados` : null,
      x.cbk > 0.004 ? `R$ ${money(round2(x.cbk))} em contestação perdida` : null,
    ].filter(Boolean).join(', ');
    if (x.gross > 0.004) {
      rows.push({
        ...base, date: d, type: 'income', origin: 'stone_sale', category: 'Vendas', amount: round2(x.gross),
        description: `Vendas no cartão liberadas pelo Mercado Pago em ${ddmm(d)} (${x.n} venda(s), valor bruto`
          + (extra ? `, ${extra}` : '') + ')',
      });
    }
    if (x.fee > 0.004) {
      rows.push({
        ...base, date: d, type: 'expense', origin: 'auto_card_fee', category: 'Taxas de Cartao', amount: round2(x.fee),
        description: `Taxa do Mercado Pago das vendas liberadas em ${ddmm(d)}`,
      });
    }
    if (x.loss > 0.004) {
      rows.push({
        ...base, date: d, type: 'expense', origin: 'auto_card_fee', category: 'Taxas de Cartao', amount: round2(x.loss),
        description: `Mercado Pago: estornos/contestações de ${ddmm(d)} (${extra})`,
      });
    }
  }
  if (rows.length > 0) {
    const { error } = await admin.from('fin_cash_flow').insert(rows);
    if (error) throw new Error(`Lançar no financeiro: ${error.message}`);
  }
  const sum = (o: string) => round2(rows.filter((r) => r.origin === o).reduce((s, r) => s + Number(r.amount), 0));
  return { rows: rows.length, receita: sum('stone_sale'), taxas: sum('auto_card_fee') };
}

// ── Importa as vendas de um dia ──────────────────────────────────────────────
async function importDay(admin: Admin, tenantId: string, cfg: any, token: string, date: string) {
  const now = new Date().toISOString();
  const logRow = async (fields: Record<string, unknown>) => {
    await admin.from('fin_mp_imports').upsert(
      { tenant_id: tenantId, reference_date: date, imported_at: now, ...fields },
      { onConflict: 'tenant_id,reference_date' },
    );
  };

  const { sales, error } = await fetchSales(token, date);
  if (error) {
    await logRow({ status: 'error', payments_count: 0, error_message: error.slice(0, 500) });
    return { date, error };
  }

  // o resumo do dia é o da LOJA: venda no Mercado Livre entra no extrato, não na conta do dia
  const loja = sales.filter((s) => !s.marketplace);
  const marketplace = sales.length - loja.length;
  const gross = round2(loja.reduce((s, x) => s + x.gross, 0));
  const fees = round2(loja.reduce((s, x) => s + x.fee, 0));
  const net = round2(loja.reduce((s, x) => s + x.net, 0));
  const refunds = round2(loja.reduce((s, x) => s + x.refunded, 0));

  const { data: imp, error: impErr } = await admin.from('fin_mp_imports').upsert({
    tenant_id: tenantId, reference_date: date, status: 'success', imported_at: now, error_message: null,
    payments_count: loja.length, sales_gross: gross, fees_total: fees, net_total: net, refunds_total: refunds,
  }, { onConflict: 'tenant_id,reference_date' }).select('id').single();
  if (impErr) return { date, error: `Registrar importação: ${impErr.message}` };

  let inserted = 0;
  try {
    const linhas = saleRows(tenantId, cfg.bank_account_id, imp?.id ?? null, sales);
    inserted = await insertStatement(admin, linhas);
    await setHora(admin, tenantId, cfg.bank_account_id, linhas);
  } catch (e) {
    await logRow({ status: 'error', error_message: String((e as Error)?.message ?? e).slice(0, 500) });
    return { date, error: String((e as Error)?.message ?? e) };
  }

  let ledger: unknown = null;
  if (cfg.post_to_ledger === true && imp?.id) {
    try { ledger = await postLedger(admin, tenantId, imp.id, sales); }
    catch (e) { log('WARN', 'import', 'lançamento no financeiro falhou', { tenantId, date, error: String(e) }); ledger = { error: String(e) }; }
  }

  return { date, payments: loja.length, marketplace, inserted, gross, fees, net, refunds, ledger };
}

// ── Relatório de Liberações (extrato da conta do MP) ─────────────────────────
// Só os movimentos que a busca de pagamentos não dá: saque, disputa, reserva, contracargo,
// tarifa solta. `payment`/`refund` são ignorados porque já entraram pelas vendas.
const SKIP_DESCRIPTION = /^(payment|refund)/i;

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseReleaseCsv(csv: string) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { rows: [] as Record<string, string>[], header: [] as string[] };
  // o delimitador muda com o idioma da conta: escolhe o que produz mais colunas
  const delim = [';', ',', '\t'].map((d) => ({ d, n: splitCsvLine(lines[0], d).length })).sort((a, b) => b.n - a.n)[0].d;
  // Se a conta estiver em português, o MP traduz o cabeçalho. Normalizamos para as chaves
  // em inglês do glossário, que é o que o resto do código usa.
  const ALIAS: Record<string, string> = {
    'DATA': 'DATE', 'DATA_CURTA': 'DATE_SHORT', 'DATA DE LIBERAÇÃO': 'DATE',
    'DESCRIÇÃO': 'DESCRIPTION', 'DESCRICAO': 'DESCRIPTION',
    'TIPO_DE_REGISTRO': 'RECORD_TYPE', 'TIPO DE REGISTRO': 'RECORD_TYPE',
    'VALOR_BRUTO': 'GROSS_AMOUNT', 'VALOR BRUTO': 'GROSS_AMOUNT',
    'VALOR_CRÉDITO_LÍQUIDO': 'NET_CREDIT_AMOUNT', 'VALOR_DÉBITO_LÍQUIDO': 'NET_DEBIT_AMOUNT',
    'REFERÊNCIA_EXTERNA': 'EXTERNAL_REFERENCE', 'SALDO': 'BALANCE_AMOUNT',
    'TARIFA_MERCADO_PAGO': 'MP_FEE_AMOUNT',
  };
  const norm = (h: string) => {
    const up = h.replace(/^﻿/, '').trim().toUpperCase();
    return ALIAS[up] ?? up.replace(/\s+/g, '_');
  };
  const header = splitCsvLine(lines[0], delim).map(norm);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const row: Record<string, string> = {};
    header.forEach((h, j) => { row[h] = cells[j] ?? ''; });
    rows.push(row);
  }
  return { rows, header };
}

/** Nome em português das reservas do Relatório de Liberações */
function reserveLabel(description: string): string {
  const d = description.toLowerCase();
  if (d.includes('payout')) return 'reserva para saque';
  if (d.includes('refund')) return 'reserva para estorno';
  if (d.includes('dispute') || d.includes('cbk') || d.includes('chargeback')) return 'reserva por contestação';
  return `reserva (${description})`;
}

function releaseRows(tenantId: string, bankAccountId: string, reportId: string | null, csv: string) {
  const { rows: csvRows, header } = parseReleaseCsv(csv);
  const out: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of csvRows) {
    const recordType = String(r.RECORD_TYPE ?? '').toLowerCase();
    // linhas de saldo (initial_available_balance, total, available_balance) não são movimento
    if (header.includes('RECORD_TYPE') && recordType !== 'release') { skipped++; continue; }
    const description = String(r.DESCRIPTION ?? '').trim();
    if (!description || SKIP_DESCRIPTION.test(description)) { skipped++; continue; }
    const date = isoDate(r.DATE_SHORT) ? r.DATE_SHORT : brDate(r.DATE);
    if (!date) { skipped++; continue; }

    const credit = num(r.NET_CREDIT_AMOUNT);
    const debit = num(r.NET_DEBIT_AMOUNT);
    let amount = credit - debit;
    if (amount === 0) amount = num(r.GROSS_AMOUNT);
    if (Math.abs(amount) < 0.005) { skipped++; continue; }

    // reserve_for_payout/refund/dispute: o MP separa o dinheiro e devolve (par que se anula) — NÃO é o saque.
    // Antes caía no /payout/ e aparecia como "Saque do Mercado Pago para o banco" três vezes por saque.
    const reserva = /^reserve_for_/i.test(description) ? reserveLabel(description) : null;
    const isPayout = !reserva && /payout|withdraw|saque|transfer/i.test(description);
    const sourceId = String(r.SOURCE_ID ?? r.PURCHASE_ID ?? r.ORDER_ID ?? '').trim();
    // chave determinada pelo CONTEÚDO: relatórios de períodos que se sobrepõem não duplicam
    const key = `mprel:${date}:${description}:${sourceId}:${amount.toFixed(2)}`;
    out.push({
      tenant_id: tenantId, bank_account_id: bankAccountId,
      external_id: key.slice(0, 180),
      transaction_date: date,
      amount: Math.abs(round2(amount)),
      transaction_type: amount < 0 ? 'debit' : 'credit',
      description: isPayout
        ? `Saque do Mercado Pago para o banco (R$ ${money(Math.abs(round2(amount)))})`
        : reserva
        ? `Mercado Pago: ${reserva} (${amount < 0 ? 'separado' : 'devolvido ao saldo'})${sourceId ? ` · ${sourceId}` : ''}`
        : `Mercado Pago: ${description}${sourceId ? ` · ${sourceId}` : ''}`,
      status: 'pending',
      category: isPayout ? 'Repasse Mercado Pago' : reserva ? 'Reserva Mercado Pago' : 'Mercado Pago',
      source: 'mercadopago', provider_import_id: reportId,
      raw: {
        kind: isPayout ? 'payout' : 'movement',
        description, source_id: sourceId || null,
        external_reference: r.EXTERNAL_REFERENCE || null,
        gross: num(r.GROSS_AMOUNT), mp_fee: num(r.MP_FEE_AMOUNT),
        financing_fee: num(r.FINANCING_FEE_AMOUNT), shipping_fee: num(r.SHIPPING_FEE_AMOUNT),
        coupon: num(r.COUPON_AMOUNT), balance: num(r.BALANCE_AMOUNT),
        record_type: recordType || null, report: 'release',
        ...(brTime(r.DATE) ? { hora: brTime(r.DATE), hora_ref: isPayout ? 'saque' : 'movimento' } : {}),
      },
    });
  }
  return { rows: out, total: csvRows.length, skipped };
}

function reportFileName(item: any): string {
  return String(item?.file_name ?? item?.fileName ?? item?.name ?? '').trim();
}

/** Baixa e importa os relatórios que o MP já gerou e que ainda não importamos. */
async function fetchReports(admin: Admin, tenantId: string, cfg: any, token: string, reprocess = false) {
  const list = await mpFetch(token, '/v1/account/release_report/list');
  if (!list.ok) return { error: mpError(list) };
  const items: any[] = Array.isArray(list.body) ? list.body : (Array.isArray(list.body?.results) ? list.body.results : []);
  const { data: known } = await admin.from('fin_mp_reports')
    .select('file_name, status').eq('tenant_id', tenantId).limit(2000);
  // reprocess: baixa de novo os já importados (linhas existentes não duplicam; só completa o que faltava, ex.: hora)
  const done = new Set(reprocess ? [] : (known ?? []).filter((k: any) => k.status === 'success').map((k: any) => k.file_name));

  // CUIDADO: o MP não usa o prefixo no começo do nome — ele PREFIXA o nosso prefixo. Pedimos
  // `erpos-7221d7f3` e o arquivo saiu `reserve-erpos-7221d7f3-2026-09-22-054037.csv`. Por isso
  // aqui é `includes`, não `startsWith` (com `startsWith` nenhum relatório era importado).
  const prefix = String(cfg.release_prefix ?? '').trim().toLowerCase();
  const pending = items
    .map((it) => ({ it, name: reportFileName(it) }))
    .filter(({ name }) => name && !done.has(name) && (!prefix || name.toLowerCase().includes(prefix)))
    .sort((a, b) => String(b.it?.created_at ?? b.it?.date_created ?? '').localeCompare(String(a.it?.created_at ?? a.it?.date_created ?? '')))
    .slice(0, MAX_REPORTS_PER_RUN);

  const results: unknown[] = [];
  for (const { it, name } of pending) {
    const generated = it?.created_at ?? it?.date_created ?? it?.generation_date ?? null;
    const { data: rep } = await admin.from('fin_mp_reports').upsert({
      tenant_id: tenantId, file_name: name, generated_at: generated,
      begin_date: brDate(it?.begin_date) ?? null, end_date: brDate(it?.end_date) ?? null,
      status: 'pending', error_message: null,
    }, { onConflict: 'tenant_id,file_name' }).select('id').single();

    const dl = await mpFetch(token, `/v1/account/release_report/${encodeURIComponent(name)}`);
    if (!dl.ok) {
      const msg = mpError(dl);
      await admin.from('fin_mp_reports').update({ status: 'error', error_message: msg.slice(0, 500) }).eq('id', rep?.id);
      results.push({ file: name, error: msg });
      continue;
    }
    try {
      const { rows, total, skipped } = releaseRows(tenantId, cfg.bank_account_id, rep?.id ?? null, dl.text);
      const inserted = await insertStatement(admin, rows);
      await setHora(admin, tenantId, cfg.bank_account_id, rows);
      await admin.from('fin_mp_reports').update({
        status: 'success', rows_count: total, inserted_count: inserted,
        imported_at: new Date().toISOString(), error_message: null,
      }).eq('id', rep?.id);
      results.push({ file: name, rows: total, movements: rows.length, inserted, skipped });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      await admin.from('fin_mp_reports').update({ status: 'error', error_message: msg.slice(0, 500) }).eq('id', rep?.id);
      results.push({ file: name, error: msg });
    }
  }
  return { available: items.length, imported: results.length, results };
}

async function requestReport(token: string, dateFrom: string, dateTo: string) {
  const r = await mpFetch(token, '/v1/account/release_report', {
    method: 'POST',
    body: JSON.stringify({ begin_date: `${dateFrom}T00:00:00Z`, end_date: `${dateTo}T23:59:59Z` }),
  });
  if (!r.ok) return { error: mpError(r) };
  return { requested: true, response: r.body };
}

/** Programa o relatório no painel do MP (assim o `release_fetch` só precisa baixar). */
// As colunas vão explícitas de propósito: são exatamente as que o parser lê, e assim o
// relatório não muda de forma quando o MP troca o conjunto padrão.
// Conjunto exato aceito pela API em 2026-09-21 (a conta recusa `columns` ausente com
// `invalid_columns`). DATE_SHORT/ORDER_ID/PURCHASE_ID ficaram de fora porque não foram
// validados; o parser trata a ausência deles.
const REPORT_COLUMNS = [
  'DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE',
  'RECORD_TYPE', 'DESCRIPTION', 'GROSS_AMOUNT', 'NET_CREDIT_AMOUNT', 'NET_DEBIT_AMOUNT',
  'MP_FEE_AMOUNT', 'FINANCING_FEE_AMOUNT', 'SHIPPING_FEE_AMOUNT', 'COUPON_AMOUNT', 'BALANCE_AMOUNT',
].map((key) => ({ key }));

async function scheduleReport(token: string, prefix: string, frequency: 'daily' | 'weekly' | 'monthly') {
  // Três coisas que a API exige e a doc não deixa claro (descobertas na conta real, 2026-09-21):
  //   • `execute_after_withdrawal` é OBRIGATÓRIO (sem ele: `invalid_execute_after_withdrawal`);
  //   • em `daily` o `frequency.value` NÃO pode ir (com ele: `invalid_frequency`) — nos outros vai;
  //   • `columns` é obrigatório (sem ele: `invalid_columns`).
  const freq: Record<string, unknown> = { hour: 6, type: frequency };
  if (frequency !== 'daily') freq.value = 1;
  const body = JSON.stringify({
    file_name_prefix: prefix,
    frequency: freq,
    display_timezone: 'GMT-03',
    include_withdrawal_at_end: true,
    execute_after_withdrawal: false,
    separator: ',',
    columns: REPORT_COLUMNS,
  });
  // a configuração pode não existir ainda: tenta criar e, se já existir, atualiza
  let r = await mpFetch(token, '/v1/account/release_report/config', { method: 'POST', body });
  if (!r.ok) r = await mpFetch(token, '/v1/account/release_report/config', { method: 'PUT', body });
  if (!r.ok) return { error: mpError(r) };

  // Salvar a configuração NÃO liga o agendamento — ela volta com `scheduled: false` até aqui.
  // Este POST é que agenda o relatório e já deixa o primeiro arquivo na fila.
  const s = await mpFetch(token, '/v1/account/release_report/schedule', { method: 'POST', body: '{}' });
  if (!s.ok) return { scheduled: false, config: r.body, error: `Configuração salva, mas o agendamento falhou: ${mpError(s)}` };
  return { scheduled: true, config: r.body, next: s.body };
}

// ── Sync de uma loja ─────────────────────────────────────────────────────────
async function syncTenant(admin: Admin, cfg: any, dateFrom?: string) {
  const tenantId = cfg.tenant_id as string;
  const tk = await loadToken(admin, tenantId, cfg.token_provider ?? 'mp_point');
  if (!tk.token) {
    await admin.from('fin_mp_config').update({
      last_sync_error: 'Sem Access Token: configure a maquininha em Configurações › Formas de pagamento.',
    }).eq('tenant_id', tenantId);
    return { error: 'Sem Access Token do Mercado Pago para esta loja.' };
  }

  const to = todayBR();
  const from = isoDate(dateFrom) ? dateFrom! : addDays(to, -3);
  const { data: ok } = await admin.from('fin_mp_imports')
    .select('reference_date').eq('tenant_id', tenantId).eq('status', 'success')
    .gte('reference_date', from).lte('reference_date', to);
  const done = new Set((ok ?? []).map((r: any) => r.reference_date));

  const days: string[] = [];
  // hoje e ontem entram sempre: venda de hoje já conta, e ontem pode ter fechado depois do sync
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) {
    if (!done.has(d) || daysBetween(d, to) <= 1) days.push(d);
  }
  // dia gravado com 0 vendas pode ter sido a busca do MP voltando vazia: confere de novo por uma semana
  const { data: vazios } = await admin.from('fin_mp_imports')
    .select('reference_date').eq('tenant_id', tenantId).eq('status', 'success').eq('payments_count', 0)
    .gte('reference_date', addDays(to, -7)).lte('reference_date', to);
  for (const v of vazios ?? []) if (!days.includes(v.reference_date)) days.push(v.reference_date);
  // vendas antigas estornadas/contestadas nos últimos dias: reimporta o dia da venda (idempotente)
  const changed = await changedSaleDays(tk.token, addDays(to, -LATE_EVENT_DAYS), to);
  if (changed.error) log('WARN', 'sync', 'busca de vendas alteradas falhou', { tenantId, error: changed.error });
  for (const d of changed.days) if (!days.includes(d)) days.push(d);

  const results = [];
  let firstError: string | null = null;
  for (const d of days.slice(0, MAX_RANGE_DAYS)) {
    const r = await importDay(admin, tenantId, cfg, tk.token, d);
    if ((r as any).error && !firstError) firstError = String((r as any).error);
    results.push(r);
  }

  let reports: unknown = null;
  if (cfg.release_report === true) {
    const rep = await fetchReports(admin, tenantId, cfg, tk.token);
    if ((rep as any).error && !firstError) firstError = String((rep as any).error);
    reports = rep;
  }

  // casa o saque do MP com o crédito no banco (o Inter do dia já rodou às 07h)
  const { data: match, error: matchErr } = await admin.rpc('fn_match_mp_payouts', {
    p_tenant: tenantId, p_from: addDays(to, -MATCH_WINDOW_DAYS), p_to: to,
  });
  if (matchErr) log('WARN', 'sync', 'fn_match_mp_payouts falhou', { tenantId, error: matchErr.message });

  await admin.from('fin_mp_config').update({
    last_sync_at: new Date().toISOString(),
    last_sync_error: firstError ? firstError.slice(0, 500) : null,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId);

  return { days: results.length, results, reports, match: matchErr ? null : match, error: firstError };
}

function safeConfig(cfg: any, tk?: { token: string; active: boolean; environment: string; label: string | null }) {
  if (!cfg) return null;
  return {
    configured: true,
    bank_account_id: cfg.bank_account_id ?? null,
    token_provider: cfg.token_provider ?? 'mp_point',
    is_active: cfg.is_active !== false,
    auto_sync: cfg.auto_sync !== false,
    post_to_ledger: cfg.post_to_ledger === true,
    release_report: cfg.release_report === true,
    release_prefix: cfg.release_prefix ?? null,
    last_sync_at: cfg.last_sync_at ?? null,
    last_sync_error: cfg.last_sync_error ?? null,
    token_ready: tk ? tk.token.length > 20 && tk.active : null,
    token_environment: tk?.environment ?? null,
    token_label: tk?.label ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || serviceRoleKey.length < 40) return errResp('Server misconfiguration', 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
  const internal = internalKey.length >= 20 && (req.headers.get('x-internal-key') ?? '') === internalKey;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body'); }
  const action = String(body.action ?? '');

  try {
    // ── Interno: todas as lojas ──
    if (action === 'sync_all') {
      if (!internal) return errResp('Unauthorized', 401);
      const { data: lojas } = await admin.from('fin_mp_config').select('*')
        .eq('is_active', true).not('bank_account_id', 'is', null);
      const out = [];
      for (const cfg of lojas ?? []) {
        if (cfg.auto_sync === false) continue;
        out.push({ tenant_id: cfg.tenant_id, ...(await syncTenant(admin, cfg)) });
      }
      return json({ success: true, results: out });
    }

    // ── Demais ações: usuário da loja (ou interno com tenant_id) ──
    const requested: string | null = body.tenant_id ?? body.active_tenant_id ?? null;
    let tenantId: string;
    let role = 'admin';
    if (internal) {
      if (!requested) return errResp('tenant_id required');
      tenantId = requested;
    } else {
      if (!token) return errResp('Unauthorized', 401);
      const { data: u, error: uErr } = await admin.auth.getUser(token);
      if (uErr || !u?.user) return errResp('Unauthorized', 401);
      const { data: rows } = await admin.from('user_tenants').select('tenant_id, role').eq('user_id', u.user.id);
      const match = requested ? (rows ?? []).find((r) => r.tenant_id === requested) : ((rows ?? []).length === 1 ? rows![0] : null);
      if (!match) return errResp('Sem acesso a esta loja', 403);
      tenantId = match.tenant_id;
      role = String(match.role ?? '');
    }
    // Financeiro/RH é admin, gerente ou o papel financeiro (mesma regra da stone-conciliation).
    const canWrite = internal || isFinanceiroRole(role);

    const { data: cfg } = await admin.from('fin_mp_config').select('*').eq('tenant_id', tenantId).maybeSingle();
    const provider = String(cfg?.token_provider ?? body.token_provider ?? 'mp_point');
    const tk = await loadToken(admin, tenantId, provider);

    if (action === 'get_config') return json({ success: true, config: safeConfig(cfg, tk) });

    if (action === 'save_config') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode configurar', 403);
      const bankAccountId = String(body.bank_account_id ?? '');
      if (!bankAccountId) return errResp('Escolha a conta "Mercado Pago" onde o extrato será gravado');
      const { data: acc } = await admin.from('fin_bank_accounts').select('id')
        .eq('id', bankAccountId).eq('tenant_id', tenantId).maybeSingle();
      if (!acc) return errResp('Conta bancária não é desta loja');
      const tokenProvider = body.token_provider === 'mercadopago' ? 'mercadopago' : 'mp_point';
      const tk2 = tokenProvider === provider ? tk : await loadToken(admin, tenantId, tokenProvider);
      if (!tk2.token) {
        return errResp(tokenProvider === 'mp_point'
          ? 'Esta loja não tem a maquininha do Mercado Pago configurada (Configurações › Formas de pagamento › Maquininha Mercado Pago Point).'
          : 'Esta loja não tem o Mercado Pago do pagamento online configurado.');
      }
      // prova de que o token consulta esta conta: a própria busca que a conciliação usa
      const probe = await mpFetch(tk2.token, '/v1/payments/search?limit=1');
      if (!probe.ok) return errResp(mpError(probe));

      const prefix = String(body.release_prefix ?? '').trim().slice(0, 40) || `erpos-${tenantId.slice(0, 8)}`;
      const releaseReport = body.release_report === true;
      const { error } = await admin.from('fin_mp_config').upsert({
        tenant_id: tenantId, bank_account_id: bankAccountId, token_provider: tokenProvider,
        is_active: true, auto_sync: body.auto_sync === false ? false : true,
        post_to_ledger: body.post_to_ledger === true,
        release_report: releaseReport, release_prefix: prefix,
        last_sync_error: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });
      if (error) return errResp(`Salvar configuração: ${error.message}`);

      // desligar o lançamento no financeiro apaga o que já foi lançado
      if (cfg?.post_to_ledger === true && body.post_to_ledger !== true) {
        const { data: imps } = await admin.from('fin_mp_imports').select('id').eq('tenant_id', tenantId).limit(2000);
        const ids = (imps ?? []).map((i: any) => i.id);
        for (let i = 0; i < ids.length; i += 200) {
          await admin.from('fin_cash_flow').delete().eq('tenant_id', tenantId)
            .in('reference_id', ids.slice(i, i + 200)).in('origin', ['stone_sale', 'auto_card_fee']);
        }
      }

      let schedule: unknown = null;
      if (releaseReport) schedule = await scheduleReport(tk2.token, prefix, 'daily');

      const { data: fresh } = await admin.from('fin_mp_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      return json({ success: true, config: safeConfig(fresh, tk2), schedule });
    }

    if (action === 'delete_config') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode configurar', 403);
      const { error } = await admin.from('fin_mp_config').delete().eq('tenant_id', tenantId);
      if (error) return errResp(error.message);
      return json({ success: true });
    }

    if (action === 'get_history') {
      const [{ data: imports }, { data: reports }] = await Promise.all([
        admin.from('fin_mp_imports').select('*').eq('tenant_id', tenantId).order('reference_date', { ascending: false }).limit(90),
        admin.from('fin_mp_reports').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(30),
      ]);
      return json({ success: true, imports: imports ?? [], reports: reports ?? [] });
    }

    // as ações abaixo falam com o Mercado Pago
    if (!cfg || !cfg.bank_account_id) return json({ success: false, not_configured: true });
    if (!tk.token) return errResp('Sem Access Token do Mercado Pago. Configure a maquininha em Configurações › Formas de pagamento.');

    if (action === 'import') {
      if (!isoDate(body.reference_date)) return errResp('reference_date inválida (AAAA-MM-DD)');
      const r = await importDay(admin, tenantId, cfg, tk.token, String(body.reference_date));
      await admin.rpc('fn_match_mp_payouts', { p_tenant: tenantId, p_from: addDays(todayBR(), -MATCH_WINDOW_DAYS), p_to: todayBR() });
      return json({ success: !(r as any).error, ...r });
    }

    if (action === 'import_range') {
      const df = String(body.date_from ?? '');
      const dt = String(body.date_to ?? '');
      if (!isoDate(df) || !isoDate(dt)) return errResp('date_from/date_to inválidas (AAAA-MM-DD)');
      const span = daysBetween(df, dt);
      if (span < 0) return errResp('date_from depois de date_to');
      if (span + 1 > MAX_RANGE_DAYS) return errResp(`No máximo ${MAX_RANGE_DAYS} dias por vez`);
      const results = [];
      for (let d = df; daysBetween(d, dt) >= 0; d = addDays(d, 1)) {
        results.push(await importDay(admin, tenantId, cfg, tk.token, d));
      }
      await admin.rpc('fn_match_mp_payouts', { p_tenant: tenantId, p_from: addDays(df, -1), p_to: addDays(dt, MATCH_WINDOW_DAYS) });
      return json({ success: true, results });
    }

    if (action === 'release_request') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode pedir o relatório', 403);
      const df = String(body.date_from ?? '');
      const dt = String(body.date_to ?? '');
      if (!isoDate(df) || !isoDate(dt)) return errResp('date_from/date_to inválidas (AAAA-MM-DD)');
      if (daysBetween(df, dt) > 60) return errResp('O Mercado Pago limita o relatório a 60 dias');
      const r = await requestReport(tk.token, df, dt);
      return json({ success: !(r as any).error, ...r });
    }

    if (action === 'release_schedule') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode programar o relatório', 403);
      const freq = ['daily', 'weekly', 'monthly'].includes(String(body.frequency)) ? String(body.frequency) : 'daily';
      const prefix = String(cfg.release_prefix ?? `erpos-${tenantId.slice(0, 8)}`);
      const r = await scheduleReport(tk.token, prefix, freq as 'daily');
      return json({ success: !(r as any).error, ...r });
    }

    if (action === 'release_fetch') {
      const r = await fetchReports(admin, tenantId, cfg, tk.token, body.reprocess === true);
      if (!(r as any).error) {
        await admin.rpc('fn_match_mp_payouts', { p_tenant: tenantId, p_from: addDays(todayBR(), -60), p_to: todayBR() });
      }
      return json({ success: !(r as any).error, ...r });
    }

    if (action === 'sync') {
      if (cfg.is_active === false || cfg.auto_sync === false) return json({ success: true, skipped: true });
      // Abertura da tela (max_age_min): se a última busca (cron, outra pessoa, outra aba) foi há
      // pouco e sem erro, não vai ao banco de novo — a tela já tem o que precisa (2026-09-26).
      const maxAge = Number(body.max_age_min ?? 0);
      if (maxAge > 0 && cfg.last_sync_at && !cfg.last_sync_error && Date.now() - new Date(String(cfg.last_sync_at)).getTime() < maxAge * 60_000) {
        return json({ success: true, fresh: true, inserted: 0, last_sync_at: cfg.last_sync_at });
      }
      const r = await syncTenant(admin, cfg, isoDate(body.date_from) ? String(body.date_from) : undefined);
      return json({ success: !(r as any).error, ...r });
    }

    return errResp(`Ação desconhecida: ${action}`);
  } catch (e) {
    log('ERROR', action, 'falha inesperada', { error: String((e as Error)?.message ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});
