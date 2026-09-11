// stone-conciliation — API de Conciliação da Stone (arquivo diário da maquininha).
//
// O que entra no extrato da conta (fin_bank_statement_imports, source='stone'):
//   • cada PARCELA LIQUIDADA no dia (FinancialTransactionsAccounts › Installment):
//     crédito do NetAmount na PaymentDate — é o dinheiro que a Stone depositou;
//   • cada EVENTO cobrado/pago no dia (FinancialEventsAccounts › Event): Amount com sinal
//     (negativo = débito: aluguel, ajuste, retenção, antecipação...);
//   • cada CHARGEBACK liquidado (Installment › Chargebacks › Chargeback): débito.
// As vendas do dia (FinancialTransactions) e os depósitos (Payments) vão só para o resumo
// em fin_stone_imports. A soma das linhas do dia bate com Σ Payment.TotalAmount.
//
// Ações (POST JSON { action, tenant_id, ... }):
//   get_config    {}                                          sem a chave
//   save_config   { stone_code, api_key?, bank_account_id, auto_sync? }   admin/manager; valida na Stone
//   delete_config {}
//   import        { reference_date }                          um dia (AAAA-MM-DD)
//   import_range  { date_from, date_to }                      até 31 dias
//   get_history   {}
//   sync          {}                                          ontem + dias sem sucesso dos últimos 3 (ao abrir a Conciliação)
//   sync_all      {}                                          (interno) o mesmo para todas as lojas
//
// Autenticação: JWT do usuário (membership em user_tenants) OU header x-internal-key = FISCAL_INTERNAL_KEY.
// Stone: HTTP Basic com a Chave Secreta como usuário e senha vazia + x-user-type: client.
// O arquivo do dia D só existe a partir das 05h de D+1.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type Admin = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
};
const STONE_BASE = 'https://conciliation.stone.com.br';
const TIMEOUT_MS = 110_000; // a Stone pode levar até 2 min
const MATCH_TOLERANCE = 0.02;
const MATCH_DAYS = 3;
const MAX_RANGE_DAYS = 31;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'stone-conciliation', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const todayBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400_000);
const isoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
// aaaammdd ou aaaammddHHmmss → AAAA-MM-DD
function stoneDate(s: string | null | undefined, fallback: string): string {
  const d = String(s ?? '').replace(/\D/g, '');
  if (d.length >= 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return fallback;
}
// Valores da Stone vêm em reais com ponto decimal ("8732.020500")
const money = (s: string | null | undefined) => {
  const n = Number(String(s ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// ── Mini-parser de XML (o arquivo é simples: sem atributos relevantes, sem CDATA) ──
// Elementos DIRETOS com um nome, dentro de um trecho — respeita aninhamento do mesmo nome.
function children(xml: string, tag: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml)) !== null) {
    if (m[0].endsWith('/>')) { out.push(''); continue; } // <Tag /> vazio
    let depth = 1;
    const i = m.index + m[0].length;
    const tagRe = new RegExp(`<(/?)${tag}(\\s[^>]*)?(/?)>`, 'g');
    tagRe.lastIndex = i;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(xml)) !== null) {
      if (t[3] === '/') continue;
      depth += t[1] === '/' ? -1 : 1;
      if (depth === 0) { out.push(xml.slice(i, t.index)); open.lastIndex = tagRe.lastIndex; break; }
    }
    if (depth !== 0) break;
  }
  return out;
}
function section(xml: string, tag: string): string {
  return children(xml, tag)[0] ?? '';
}
// Valor de uma tag simples (primeira ocorrência, sem descer em containers com o mesmo nome)
function val(block: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(block);
  return m ? m[1].trim() : '';
}
// Remove sub-containers para ler só os campos do nível atual
function stripContainers(block: string, tags: string[]): string {
  let s = block;
  for (const t of tags) for (const c of children(s, t)) s = s.replace(`<${t}>${c}</${t}>`, '');
  return s;
}

// AccountType da Stone: 1 débito, 2 crédito, 3 pré-pago débito, 4 pré-pago crédito
const ACCOUNT_TYPE: Record<string, string> = { '1': 'debit', '2': 'credit', '3': 'prepaid_debit', '4': 'prepaid_credit' };
const ACCOUNT_LABEL: Record<string, string> = { debit: 'Débito', credit: 'Crédito', prepaid_debit: 'Pré-pago Débito', prepaid_credit: 'Pré-pago Crédito' };
const BRAND: Record<string, string> = { '1': 'Visa', '2': 'Mastercard', '3': 'Amex', '171': 'Elo', '5': 'Hipercard', '9': 'Hiper', '10': 'Cabal' };
const EVENT_TYPE: Record<string, string> = {
  '2': 'Transferência interna', '5': 'Ajuste financeiro', '8': 'Split', '10': 'Cobrança (aluguel/tarifa)', '11': 'CrossBalance',
  '12': 'Retenção de empréstimo', '13': 'Transferência entre StoneCodes', '14': 'Garantia', '15': 'Cessão de recebíveis',
  '17': 'Antecipação Stone', '18': 'Saque antecipação', '19': 'Depósito antecipação', '20': 'Taxa de antecipação',
};

interface StmtLine {
  external_id: string; transaction_date: string; amount: number; transaction_type: 'credit' | 'debit';
  description: string; category: string; stone_transaction_id: string | null; stone_payment_type: string | null;
  stone_installment_info: Record<string, unknown> | null; raw: Record<string, unknown>;
  gross?: number; // parcela: valor bruto (para casar com recebível gravado pelo bruto)
}
interface ParsedFile {
  stoneCode: string; referenceDate: string; layout: string;
  lines: StmtLine[];
  sales: { count: number; gross: number };
  payments: { count: number; total: number; ids: string[] };
}

function parseConciliation(xml: string, referenceDate: string): ParsedFile {
  const header = section(xml, 'Header');
  const refDate = stoneDate(val(header, 'ReferenceDate'), referenceDate);
  const lines: StmtLine[] = [];

  // Vendas do dia (só resumo)
  const ft = section(xml, 'FinancialTransactions');
  let salesCount = 0, salesGross = 0;
  for (const tx of children(ft, 'Transaction')) {
    const top = stripContainers(tx, ['Events', 'Installments', 'Cancellations', 'Chargebacks', 'ChargebackRefunds', 'Poi']);
    const captured = money(val(top, 'CapturedAmount'));
    if (captured > 0) { salesCount++; salesGross += captured; }
  }

  // Parcelas liquidadas no dia → créditos
  const fta = section(xml, 'FinancialTransactionsAccounts');
  for (const tx of children(fta, 'Transaction')) {
    const top = stripContainers(tx, ['Events', 'Installments', 'Cancellations', 'Chargebacks', 'ChargebackRefunds', 'Poi']);
    const atk = val(top, 'AcquirerTransactionKey');
    const itk = val(top, 'InitiatorTransactionKey');
    const acct = ACCOUNT_TYPE[val(top, 'AccountType')] ?? 'card';
    const brand = BRAND[val(top, 'BrandId')] ?? (val(top, 'BrandId') ? `Bandeira ${val(top, 'BrandId')}` : '');
    const nInst = Number(val(top, 'NumberOfInstallments') || '1') || 1;
    const capture = stoneDate(val(top, 'CaptureLocalDateTime'), '');
    const cardNumber = val(top, 'CardNumber');
    const authCode = val(top, 'IssuerAuthorizationCode');

    const instBlock = section(tx, 'Installments');
    for (const inst of children(instBlock, 'Installment')) {
      const instTop = stripContainers(inst, ['Chargebacks', 'Chargeback', 'ChargebackRefunds', 'ChargebackRefund']);
      const num = val(instTop, 'InstallmentNumber') || '1';
      const net = money(val(instTop, 'NetAmount'));
      const gross = money(val(instTop, 'GrossAmount'));
      const payDate = stoneDate(val(instTop, 'PaymentDate'), refDate);
      const paymentId = val(instTop, 'PaymentId');
      const advFee = money(val(instTop, 'AdvanceRateAmount'));
      if (net !== 0) {
        const desc = [`Stone ${ACCOUNT_LABEL[acct] ?? 'Cartão'}`, brand, nInst > 1 ? `${num}/${nInst}x` : null, capture ? `venda ${capture.split('-').reverse().join('/')}` : null, authCode ? `aut ${authCode}` : null]
          .filter(Boolean).join(' · ');
        lines.push({
          external_id: `stone_${atk || itk}_${num}_${paymentId || payDate}`,
          transaction_date: payDate, amount: round2(Math.abs(net)), transaction_type: net >= 0 ? 'credit' : 'debit',
          description: desc.slice(0, 250), category: `Recebimento Stone ${ACCOUNT_LABEL[acct] ?? 'Cartão'}`,
          stone_transaction_id: atk || itk || null, stone_payment_type: acct,
          stone_installment_info: { installment_number: Number(num), total_installments: nInst, card_brand: brand || null, authorization_code: authCode || null, gross_amount: round2(gross), net_amount: round2(net), fee_amount: round2(gross - net), advance_fee: round2(advFee), payment_id: paymentId || null, capture_date: capture || null, card_number: cardNumber || null },
          raw: { kind: 'installment', atk, itk, account_type: acct, brand, installment: Number(num), installments: nInst, gross, net, payment_date: payDate, payment_id: paymentId, advance_fee: advFee, capture_date: capture },
          gross: round2(gross),
        });
      }
      // Chargebacks descontados
      for (const cbWrap of children(inst, 'Chargebacks')) {
        for (const cb of children(cbWrap, 'Chargeback')) {
          const amt = money(val(cb, 'Amount'));
          if (!amt) continue;
          const id = val(cb, 'Id');
          lines.push({
            external_id: `stone_cb_${id || `${atk}_${num}`}`,
            transaction_date: stoneDate(val(cb, 'ChargeDate') || val(cb, 'Date'), refDate),
            amount: round2(Math.abs(amt)), transaction_type: 'debit',
            description: `Stone chargeback · ${brand || 'cartão'} · NSU ${atk}${val(cb, 'ReasonCode') ? ` · motivo ${val(cb, 'ReasonCode')}` : ''}`.slice(0, 250),
            category: 'Chargeback Stone', stone_transaction_id: atk || null, stone_payment_type: acct, stone_installment_info: null,
            raw: { kind: 'chargeback', atk, id, amount: amt, reason: val(cb, 'ReasonCode'), payment_id: val(cb, 'PaymentId') },
          });
        }
      }
      for (const crWrap of children(inst, 'ChargebackRefunds')) {
        for (const cr of children(crWrap, 'ChargebackRefund')) {
          const amt = money(val(cr, 'Amount'));
          if (!amt) continue;
          const id = val(cr, 'Id');
          lines.push({
            external_id: `stone_cbr_${id || `${atk}_${num}`}`,
            transaction_date: stoneDate(val(cr, 'ChargeDate') || val(cr, 'Date'), refDate),
            amount: round2(Math.abs(amt)), transaction_type: 'credit',
            description: `Stone reapresentação de chargeback · NSU ${atk}`.slice(0, 250),
            category: 'Chargeback Stone', stone_transaction_id: atk || null, stone_payment_type: acct, stone_installment_info: null,
            raw: { kind: 'chargeback_refund', atk, id, amount: amt },
          });
        }
      }
    }
  }

  // Eventos pagos/cobrados no dia
  const fea = section(xml, 'FinancialEventsAccounts');
  for (const ev of children(section(fea, 'Events') || fea, 'Event')) {
    const amt = money(val(ev, 'Amount'));
    if (!amt) continue;
    const id = val(ev, 'EventId');
    const type = val(ev, 'Type') || val(ev, 'Tipo');
    const label = val(ev, 'Description') || EVENT_TYPE[type] || `Evento ${type}`;
    lines.push({
      external_id: `stone_ev_${id || `${type}_${amt}_${refDate}`}`,
      transaction_date: stoneDate(val(ev, 'PaymentDate'), refDate),
      amount: round2(Math.abs(amt)), transaction_type: amt >= 0 ? 'credit' : 'debit',
      description: `Stone · ${label}`.slice(0, 250), category: amt >= 0 ? 'Crédito Stone' : 'Tarifas Stone',
      stone_transaction_id: val(ev, 'AcquirerTransactionKey') || null, stone_payment_type: 'event', stone_installment_info: null,
      raw: { kind: 'event', id, type, type_label: EVENT_TYPE[type] ?? null, description: val(ev, 'Description'), amount: amt },
    });
  }

  // Depósitos (resumo)
  const pays = children(section(xml, 'Payments'), 'Payment');
  let payTotal = 0;
  const payIds: string[] = [];
  for (const p of pays) {
    payTotal += money(val(p, 'TotalAmount'));
    const id = val(p, 'Id');
    if (id) payIds.push(id);
  }

  return {
    stoneCode: val(header, 'StoneCode'), referenceDate: refDate, layout: val(header, 'LayoutVersion'),
    lines, sales: { count: salesCount, gross: round2(salesGross) }, payments: { count: pays.length, total: round2(payTotal), ids: payIds },
  };
}

// ── Download do arquivo ──────────────────────────────────────────────────────
// A Stone mantém URLs diferentes conforme a geração da conta; tentamos em ordem e
// lembramos a que funcionou. 404 = sem arquivo para o dia (válido). 401/403 = chave.
type DownloadResult = { status: 'ok'; xml: string; endpoint: string } | { status: 'empty'; endpoint: string; detail?: string } | { status: 'not_ready'; detail: string } | { status: 'unauthorized'; detail: string } | { status: 'error'; detail: string };

function endpointsFor(stoneCode: string, date: string, preferred?: string | null) {
  const compact = date.replace(/-/g, '');
  const list = [
    // Documentado para cliente Stone (chave criada em Perfil › Chaves de autenticação):
    // GET /v2/merchant/{stoneCode}/conciliation-file/{YYYYMMDD}. O antigo "/v2/.../file?referenceDate="
    // não existe (404 "no Route matched"). v1 fica como reserva para chaves antigas.
    { id: 'v2-conciliation-file', url: `${STONE_BASE}/v2/merchant/${stoneCode}/conciliation-file/${compact}` },
    { id: 'v1-conciliation-file', url: `${STONE_BASE}/v1/merchant/${stoneCode}/conciliation-file/${compact}` },
  ];
  if (preferred) list.sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0));
  return list;
}

async function downloadFile(apiKey: string, stoneCode: string, date: string, preferred?: string | null): Promise<DownloadResult> {
  const headers = {
    Authorization: `Basic ${btoa(`${apiKey}:`)}`,
    'x-user-type': 'client',
    'Accept-Encoding': 'gzip',
    'X-Accept-Redirect': 'true',
    Accept: 'application/xml',
  };
  const errors: string[] = [];
  let sawNotFound: string | null = null;
  let sawUnauthorized: string | null = null;
  for (const ep of endpointsFor(stoneCode, date, preferred)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      let res = await fetch(ep.url, { headers, signal: ctrl.signal, redirect: 'manual' });
      // 307 = arquivo em cache: segue o Location SEM o header de autenticação
      if ((res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) && res.headers.get('location')) {
        const loc = new URL(res.headers.get('location')!, ep.url).toString();
        await res.body?.cancel();
        res = await fetch(loc, { signal: ctrl.signal });
      }
      const text = await res.text();
      if (res.ok && /<Conciliation[\s>]/.test(text)) return { status: 'ok', xml: text, endpoint: ep.id };
      // A Stone só gera o arquivo a partir das 04h (Brasília): chave válida, arquivo ainda não disponível.
      if (res.status === 400 && /only permitted from/i.test(text)) return { status: 'not_ready', detail: `${ep.id}: ${text.slice(0, 200)}` };
      // Chave de uma geração da API é recusada na outra: tenta o próximo endereço antes de concluir.
      if (res.status === 401 || res.status === 403) { sawUnauthorized = `${ep.id}: ${res.status} ${text.slice(0, 160)}`; errors.push(sawUnauthorized); continue; }
      if (res.status === 404 && /no route matched/i.test(text)) { errors.push(`${ep.id}: rota inexistente`); continue; }
      if (res.status === 404) { sawNotFound = ep.id; errors.push(`${ep.id}: 404 ${text.slice(0, 160)}`); continue; }
      if (res.ok) { errors.push(`${ep.id}: resposta sem <Conciliation> (${text.slice(0, 120)})`); continue; }
      errors.push(`${ep.id}: ${res.status} ${text.slice(0, 160)}`);
    } catch (e) {
      errors.push(`${ep.id}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    } finally { clearTimeout(timer); }
  }
  if (sawNotFound) return { status: 'empty', endpoint: sawNotFound, detail: errors.join(' | ').slice(0, 480) };
  if (sawUnauthorized) return { status: 'unauthorized', detail: errors.join(' | ') };
  return { status: 'error', detail: errors.join(' | ') };
}

// ── Conciliação automática das linhas novas ──────────────────────────────────
async function autoMatch(admin: Admin, tenantId: string, bankAccountId: string, rows: Array<{ id: string; transaction_date: string; amount: number; transaction_type: string; external_id: string }>, grossByExt: Map<string, number>) {
  if (rows.length === 0) return 0;
  const dates = rows.map((r) => r.transaction_date).sort();
  const dFrom = addDays(dates[0], -MATCH_DAYS - 35); // recebível pode ter vencimento previsto bem antes da liquidação (antecipação)
  const dTo = addDays(dates[dates.length - 1], MATCH_DAYS);
  const [{ data: bts }, { data: cfs }, { data: recs }, { data: used }] = await Promise.all([
    admin.from('fin_bank_transactions').select('id, transaction_date, amount, type, description').eq('tenant_id', tenantId).eq('bank_account_id', bankAccountId).gte('transaction_date', addDays(dates[0], -MATCH_DAYS)).lte('transaction_date', dTo).limit(5000),
    admin.from('fin_cash_flow').select('id, date, amount, type, description').eq('tenant_id', tenantId).gte('date', addDays(dates[0], -MATCH_DAYS)).lte('date', dTo).limit(5000),
    admin.from('fin_receivable_installments').select('id, due_date, amount, status, payment_method_name, order_number').eq('tenant_id', tenantId).gte('due_date', dFrom).lte('due_date', dTo).limit(5000),
    admin.from('fin_bank_statement_imports').select('matched_transaction_id').eq('tenant_id', tenantId).not('matched_transaction_id', 'is', null).gte('transaction_date', dFrom).lte('transaction_date', dTo).limit(10000),
  ]);
  const usedIds = new Set((used ?? []).map((u) => u.matched_transaction_id as string));
  type Cand = { id: string; date: string; amount: number; type: 'credit' | 'debit'; source: string; label: string; window: number };
  const cands: Cand[] = [
    ...(bts ?? []).map((b) => ({ id: b.id, date: b.transaction_date, amount: Number(b.amount), type: (b.type === 'credit' ? 'credit' : 'debit') as 'credit' | 'debit', source: 'movimento bancário', label: b.description, window: MATCH_DAYS })),
    ...(cfs ?? []).map((c) => ({ id: c.id, date: c.date, amount: Number(c.amount), type: (c.type === 'income' ? 'credit' : 'debit') as 'credit' | 'debit', source: 'fluxo de caixa', label: c.description, window: MATCH_DAYS })),
    ...(recs ?? []).filter((r) => r.status !== 'cancelled').map((r) => ({ id: r.id, date: r.due_date, amount: Number(r.amount), type: 'credit' as const, source: 'recebível de cartão', label: `${r.payment_method_name ?? 'Cartão'}${r.order_number ? ` · pedido #${r.order_number}` : ''}`, window: 35 })),
  ].filter((c) => !usedIds.has(c.id));

  let matched = 0;
  for (const row of rows) {
    const amt = Number(row.amount);
    const gross = grossByExt.get(row.external_id);
    let best: Cand | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      if (c.type !== row.transaction_type) continue;
      const okNet = Math.abs(c.amount - amt) <= MATCH_TOLERANCE;
      const okGross = gross != null && c.source === 'recebível de cartão' && Math.abs(c.amount - gross) <= MATCH_TOLERANCE;
      if (!okNet && !okGross) continue;
      const dd = Math.abs(daysBetween(c.date, row.transaction_date));
      if (dd > c.window) continue;
      const score = -dd * 10 + (c.source === 'movimento bancário' ? 5 : c.source === 'recebível de cartão' ? 3 : 0) + (okNet ? 1 : 0);
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (!best) continue;
    cands.splice(cands.indexOf(best), 1);
    await admin.from('fin_bank_statement_imports').update({
      status: 'matched', matched_transaction_id: best.id, matched_at: new Date().toISOString(),
      notes: `Conciliado automaticamente (Stone) com ${best.source}: ${String(best.label ?? '').slice(0, 120)}`,
    }).eq('id', row.id);
    matched++;
  }
  return matched;
}

// ── Importa um dia ───────────────────────────────────────────────────────────
// ── Lançamento no financeiro (opcional: fin_stone_config.post_to_ledger) ──────
// Por dia de pagamento: receita = bruto das parcelas liquidadas (origin stone_sale);
// despesas = MDR, antecipação e tarifas/chargebacks (origin auto_card_fee, que a DRE já lê).
// bruto − taxas = líquido depositado. Idempotente: apaga o que este arquivo lançou e relança.
async function postLedger(admin: Admin, tenantId: string, importId: string, parsed: ParsedFile) {
  const { error: delErr } = await admin.from('fin_cash_flow').delete().eq('tenant_id', tenantId).eq('reference_id', importId).in('origin', ['stone_sale', 'auto_card_fee']);
  if (delErr) throw new Error('Limpar lançamentos: ' + delErr.message);
  type Day = { gross: number; mdr: number; adv: number; n: number; otherDebit: number; otherCredit: number };
  const days = new Map<string, Day>();
  const day = (d: string) => {
    let x = days.get(d);
    if (!x) { x = { gross: 0, mdr: 0, adv: 0, n: 0, otherDebit: 0, otherCredit: 0 }; days.set(d, x); }
    return x;
  };
  for (const l of parsed.lines) {
    const x = day(l.transaction_date);
    if (l.raw.kind === 'installment' && l.transaction_type === 'credit') {
      const info = (l.stone_installment_info ?? {}) as Record<string, unknown>;
      const gross = Number(info.gross_amount ?? l.amount);
      const fee = Number(info.fee_amount ?? 0);
      const adv = Number(info.advance_fee ?? 0);
      x.gross += gross; x.adv += adv; x.mdr += fee - adv; x.n++;
    } else if (l.transaction_type === 'debit') x.otherDebit += l.amount;
    else x.otherCredit += l.amount;
  }
  const rows: Record<string, unknown>[] = [];
  const base = { tenant_id: tenantId, reference_id: importId };
  for (const [d, x] of days) {
    const dd = d.slice(8, 10) + '/' + d.slice(5, 7);
    if (x.gross > 0.004) rows.push({ ...base, date: d, type: 'income', origin: 'stone_sale', category: 'Vendas', amount: round2(x.gross), description: 'Vendas em cartão liquidadas pela Stone em ' + dd + ' (' + x.n + ' parcela(s), valor bruto)' });
    if (x.otherCredit > 0.004) rows.push({ ...base, date: d, type: 'income', origin: 'stone_sale', category: 'Vendas', amount: round2(x.otherCredit), description: 'Stone: créditos diversos de ' + dd });
    if (x.mdr > 0.004) rows.push({ ...base, date: d, type: 'expense', origin: 'auto_card_fee', category: 'Taxas de Cartao', amount: round2(x.mdr), description: 'Taxa Stone (MDR) do repasse de ' + dd });
    if (x.adv > 0.004) rows.push({ ...base, date: d, type: 'expense', origin: 'auto_card_fee', category: 'Taxas de Cartao', amount: round2(x.adv), description: 'Taxa de antecipação Stone do repasse de ' + dd });
    if (x.otherDebit > 0.004) rows.push({ ...base, date: d, type: 'expense', origin: 'auto_card_fee', category: 'Taxas de Cartao', amount: round2(x.otherDebit), description: 'Stone: tarifas, ajustes e chargebacks de ' + dd });
  }
  if (rows.length > 0) {
    const { error } = await admin.from('fin_cash_flow').insert(rows);
    if (error) throw new Error('Lançar no financeiro: ' + error.message);
  }
  const sum = (o: string) => round2(rows.filter((r) => r.origin === o).reduce((s, r) => s + Number(r.amount), 0));
  return { rows: rows.length, receita: sum('stone_sale'), taxas: sum('auto_card_fee') };
}

async function importDay(admin: Admin, tenantId: string, cfg: any, date: string) {
  const apiKey = cfg.api_key_b64 ? atob(cfg.api_key_b64) : '';
  if (!apiKey) return { date, error: 'Chave da Stone não configurada' };
  if (!cfg.bank_account_id) return { date, error: 'Conta bancária não configurada' };

  const dl = await downloadFile(apiKey, cfg.stone_code, date, cfg.endpoint);
  const now = new Date().toISOString();
  const logRow = async (fields: Record<string, unknown>) => {
    await admin.from('fin_stone_imports').upsert({ tenant_id: tenantId, reference_date: date, imported_at: now, ...fields }, { onConflict: 'tenant_id,reference_date' });
  };

  if (dl.status === 'not_ready') {
    // Não grava o dia: o sync tenta de novo na próxima abertura da Conciliação.
    return { date, skipped: true, fetched: 0, inserted: 0, matched: 0, credit: 0, debit: 0, payments_total: 0, sales_count: 0, note: 'A Stone só libera o arquivo do dia anterior a partir das 04h (Brasília).' };
  }
  if (dl.status === 'unauthorized') {
    await logRow({ status: 'error', transactions_count: 0, total_credit: 0, total_debit: 0, error_message: `Chave recusada pela Stone (${dl.detail})`.slice(0, 500) });
    return { date, error: 'A Stone recusou a chave. Gere uma nova chave no portal Stone (Perfil › Chaves de autenticação) para este StoneCode.' };
  }
  if (dl.status === 'error') {
    await logRow({ status: 'error', transactions_count: 0, total_credit: 0, total_debit: 0, error_message: dl.detail.slice(0, 500) });
    return { date, error: `Falha ao baixar o arquivo da Stone: ${dl.detail}` };
  }
  if (dl.status === 'empty') {
    await logRow({ status: 'success', transactions_count: 0, total_credit: 0, total_debit: 0, error_message: dl.detail ? `Sem arquivo: ${dl.detail}` : null, sales_count: 0, sales_gross: 0, payments_total: 0 });
    if (cfg.endpoint !== dl.endpoint) await admin.from('fin_stone_config').update({ endpoint: dl.endpoint }).eq('tenant_id', tenantId);
    return { date, empty: true, fetched: 0, inserted: 0, matched: 0, credit: 0, debit: 0, payments_total: 0, sales_count: 0 };
  }

  const parsed = parseConciliation(dl.xml, date);
  log('INFO', 'import', 'arquivo', { tenantId, date, layout: parsed.layout, lines: parsed.lines.length, sales: parsed.sales.count, payments: parsed.payments.count, hasPaymentsTag: /<Payments[\s>]/.test(dl.xml) });
  if (parsed.stoneCode && String(parsed.stoneCode) !== String(cfg.stone_code)) {
    log('WARN', 'import', 'StoneCode do arquivo diferente da config', { tenantId, file: parsed.stoneCode, cfg: cfg.stone_code });
  }
  const credit = round2(parsed.lines.filter((l) => l.transaction_type === 'credit').reduce((s, l) => s + l.amount, 0));
  const debit = round2(parsed.lines.filter((l) => l.transaction_type === 'debit').reduce((s, l) => s + l.amount, 0));

  const rows = parsed.lines.map((l) => ({
    tenant_id: tenantId, bank_account_id: cfg.bank_account_id, external_id: l.external_id, transaction_date: l.transaction_date,
    amount: l.amount, description: l.description, transaction_type: l.transaction_type, status: 'pending', category: l.category,
    stone_transaction_id: l.stone_transaction_id, stone_payment_type: l.stone_payment_type, stone_installment_info: l.stone_installment_info,
    source: 'stone', raw: l.raw,
  }));

  // Log do dia primeiro (as linhas apontam para ele)
  const { data: imp } = await admin.from('fin_stone_imports').upsert({
    tenant_id: tenantId, reference_date: date, status: 'success', imported_at: now, error_message: null,
    transactions_count: rows.length, total_credit: credit, total_debit: debit,
    sales_count: parsed.sales.count, sales_gross: parsed.sales.gross, payments_total: parsed.payments.total,
  }, { onConflict: 'tenant_id,reference_date' }).select('id').single();

  let inserted: any[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, stone_import_id: imp?.id ?? null }));
    const { data, error } = await admin.from('fin_bank_statement_imports')
      .upsert(chunk, { onConflict: 'tenant_id,bank_account_id,external_id', ignoreDuplicates: true })
      .select('id, transaction_date, amount, transaction_type, external_id');
    if (error) {
      await logRow({ status: 'error', error_message: `Gravar extrato: ${error.message}`.slice(0, 500) });
      return { date, error: `Gravar extrato: ${error.message}` };
    }
    inserted = inserted.concat(data ?? []);
  }
  const grossByExt = new Map(parsed.lines.filter((l) => l.gross != null).map((l) => [l.external_id, l.gross as number]));
  const matched = await autoMatch(admin, tenantId, cfg.bank_account_id, inserted, grossByExt);

  // Stone × Inter: casa os grupos do dia com o repasse que caiu no Inter e marca transferências entre contas próprias
  let stoneInter: unknown = null;
  const lineDates = parsed.lines.map((l) => l.transaction_date).sort();
  if (lineDates.length > 0) {
    const { data: si, error: siErr } = await admin.rpc('fn_match_stone_inter', { p_tenant: tenantId, p_from: addDays(lineDates[0], -1), p_to: addDays(lineDates[lineDates.length - 1], 1) });
    if (siErr) log('WARN', 'import', 'fn_match_stone_inter falhou', { tenantId, date, error: siErr.message }); else stoneInter = si;
  }
  // Vendas e taxas no financeiro (opcional)
  let ledger: unknown = null;
  if (cfg.post_to_ledger === true && imp?.id) {
    try { ledger = await postLedger(admin, tenantId, imp.id, parsed); }
    catch (e) { log('WARN', 'import', 'lançamento no financeiro falhou', { tenantId, date, error: String(e) }); ledger = { error: String(e) }; }
  }

  if (cfg.endpoint !== dl.endpoint) await admin.from('fin_stone_config').update({ endpoint: dl.endpoint }).eq('tenant_id', tenantId);
  // Aviso de consistência: Σ linhas do dia deveria bater com Σ depósitos
  const net = round2(credit - debit);
  const diff = parsed.payments.count > 0 ? round2(net - parsed.payments.total) : 0;
  if (Math.abs(diff) > 0.05) log('WARN', 'import', 'linhas ≠ depósitos', { tenantId, date, net, payments: parsed.payments.total });

  return { date, fetched: rows.length, inserted: inserted.length, matched, credit, debit, payments_total: parsed.payments.total, payments_count: parsed.payments.count, sales_count: parsed.sales.count, sales_gross: parsed.sales.gross, diff, stone_inter: stoneInter, ledger };
}

async function importRange(admin: Admin, tenantId: string, cfg: any, from: string, to: string) {
  const results = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = await importDay(admin, tenantId, cfg, d);
    results.push(r);
    if ('error' in r && /recusou a chave/.test(String(r.error))) break; // não martela a Stone com chave errada
  }
  const ok = results.filter((r) => !('error' in r));
  const sum = (k: string) => round2(ok.reduce((s, r: any) => s + Number(r[k] ?? 0), 0));
  await admin.from('fin_stone_config').update({
    last_sync_at: new Date().toISOString(),
    last_sync_error: results.find((r) => 'error' in r) ? String((results.find((r) => 'error' in r) as any).error).slice(0, 500) : null,
  }).eq('tenant_id', tenantId);
  return {
    days: results.length, days_ok: ok.length, days_error: results.length - ok.length,
    fetched: sum('fetched'), inserted: sum('inserted'), matched: sum('matched'), credit: sum('credit'), debit: sum('debit'),
    payments_total: sum('payments_total'), sales_count: sum('sales_count'), results,
  };
}

function safeConfig(cfg: any) {
  if (!cfg) return null;
  return {
    id: cfg.id, stone_code: cfg.stone_code, is_active: cfg.is_active, bank_account_id: cfg.bank_account_id,
    last_sync_at: cfg.last_sync_at, last_sync_error: cfg.last_sync_error ?? null, auto_sync: cfg.auto_sync ?? true,
    has_key: Boolean(cfg.api_key_b64), endpoint: cfg.endpoint ?? null,
    post_to_ledger: cfg.post_to_ledger === true,
  };
}

// Ontem + dias sem importação com sucesso nos últimos N dias. Chamado quando o usuário
// abre a Conciliação (não há rotina automática no servidor).
async function syncStoneTenant(admin: Admin, cfg: any, lookbackDays = 3) {
  const yesterday = addDays(todayBR(), -1);
  const from = addDays(yesterday, -(lookbackDays - 1));
  const { data: done } = await admin.from('fin_stone_imports').select('reference_date').eq('tenant_id', cfg.tenant_id).eq('status', 'success').gte('reference_date', from).lte('reference_date', yesterday);
  const doneSet = new Set((done ?? []).map((d) => String(d.reference_date)));
  const missing: string[] = [];
  for (let d = from; d <= yesterday; d = addDays(d, 1)) if (!doneSet.has(d)) missing.push(d);
  const results = [];
  for (const d of missing) {
    const r = await importDay(admin, cfg.tenant_id, cfg, d);
    results.push(r);
    if ('error' in r && /recusou a chave/.test(String(r.error))) break;
  }
  const err = results.find((r) => 'error' in r) as any;
  await admin.from('fin_stone_config').update({ last_sync_at: new Date().toISOString(), last_sync_error: err ? String(err.error).slice(0, 500) : null }).eq('tenant_id', cfg.tenant_id);
  const sum = (k: string) => round2(results.reduce((s, r: any) => s + Number(r[k] ?? 0), 0));
  return { days: missing.length, inserted: sum('inserted'), matched: sum('matched'), payments_total: sum('payments_total'), error: err ? String(err.error) : undefined, results };
}

// ── Handler ──────────────────────────────────────────────────────────────────
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
    // ── Interno: todas as lojas ativas ──
    if (action === 'sync_all') {
      if (!internal) return errResp('Unauthorized', 401);
      const { data: lojas } = await admin.from('fin_stone_config').select('*').eq('is_active', true).not('api_key_b64', 'is', null).not('bank_account_id', 'is', null);
      const out = [];
      for (const cfg of lojas ?? []) out.push({ tenant_id: cfg.tenant_id, ...(await syncStoneTenant(admin, cfg)) });
      return json({ success: true, results: out });
    }

    // ── Demais ações: usuário da loja (ou interno com tenant_id) ──
    const requested: string | null = body.tenant_id ?? body.active_tenant_id ?? null;
    let tenantId: string;
    let userId: string | null = null;
    let role = 'admin';
    if (internal) {
      if (!requested) return errResp('tenant_id required');
      tenantId = requested;
    } else {
      if (!token) return errResp('Unauthorized', 401);
      const { data: u, error: uErr } = await admin.auth.getUser(token);
      if (uErr || !u?.user) return errResp('Unauthorized', 401);
      userId = u.user.id;
      const { data: rows } = await admin.from('user_tenants').select('tenant_id, role').eq('user_id', userId);
      const match = requested ? (rows ?? []).find((r) => r.tenant_id === requested) : ((rows ?? []).length === 1 ? rows![0] : null);
      if (!match) return errResp('Sem acesso a esta loja', 403);
      tenantId = match.tenant_id;
      role = String(match.role ?? '');
    }
    const isManager = internal || role === 'admin' || role === 'manager';

    const { data: cfg } = await admin.from('fin_stone_config').select('*').eq('tenant_id', tenantId).maybeSingle();

    if (action === 'get_config') return json({ success: true, config: safeConfig(cfg) });

    // Ao abrir a Conciliação / botão "Atualizar bancos"
    if (action === 'sync') {
      if (!cfg || !cfg.api_key_b64 || !cfg.bank_account_id) return json({ success: false, not_configured: true });
      if (!cfg.is_active || cfg.auto_sync === false) return json({ success: true, skipped: true });
      const r = await syncStoneTenant(admin, cfg);
      // O Inter pode ter chegado depois da Stone (ou vice-versa): recasa os últimos 20 dias.
      const { error: siErr } = await admin.rpc('fn_match_stone_inter', { p_tenant: tenantId, p_from: addDays(todayBR(), -20), p_to: todayBR() });
      if (siErr) log('WARN', 'sync', 'fn_match_stone_inter falhou', { tenantId, error: siErr.message });
      return json({ success: !r.error, ...r });
    }

    if (action === 'get_history') {
      const { data: history } = await admin.from('fin_stone_imports').select('*').eq('tenant_id', tenantId).order('reference_date', { ascending: false }).limit(60);
      return json({ success: true, history: history ?? [] });
    }

    // Vendas da Stone e depósitos do Inter de um mesmo repasse (detalhe da transação na Conciliação)
    if (action === 'group_detail') {
      const group = String(body.match_group ?? '');
      if (!/^stone:\d{4}-\d{2}-\d{2}:(antecipado|normal)$/.test(group)) return errResp('Grupo inválido');
      const { data: rows, error } = await admin.from('fin_bank_statement_imports')
        .select('id, source, transaction_date, amount, transaction_type, description, match_kind, stone_installment_info')
        .eq('tenant_id', tenantId).eq('match_group', group).order('source').order('amount', { ascending: false }).limit(1000);
      if (error) return errResp(error.message, 500);
      return json({ success: true, rows: rows ?? [] });
    }

    if (action === 'save_config') {
      if (!isManager) return errResp('Apenas admin/gerente', 403);
      const stoneCode = String(body.stone_code ?? '').replace(/\D/g, '');
      const apiKey = String(body.api_key ?? '').trim() || (cfg?.api_key_b64 ? atob(cfg.api_key_b64) : '');
      const bankAccountId = String(body.bank_account_id ?? cfg?.bank_account_id ?? '');
      if (!stoneCode) return errResp('Informe o StoneCode (número de afiliação da maquininha)');
      if (!apiKey) return errResp('Informe a Chave Secreta da Stone');
      if (!bankAccountId) return errResp('Selecione a conta bancária que recebe os repasses da Stone');
      const { data: acc } = await admin.from('fin_bank_accounts').select('id').eq('id', bankAccountId).eq('tenant_id', tenantId).maybeSingle();
      if (!acc) return errResp('Conta bancária não encontrada nesta loja');

      // Valida baixando o arquivo de 2 dias atrás (ontem pode ainda não existir antes das 05h)
      let probe = await downloadFile(apiKey, stoneCode, addDays(todayBR(), -2), cfg?.endpoint);
      if (probe.status === 'not_ready') probe = { status: 'empty', endpoint: 'v2-conciliation-file' } as DownloadResult;
      if (probe.status === 'unauthorized' || probe.status === 'error') log('WARN', 'save_config', 'validação recusada', { tenantId, stoneCode, probe });
      if (probe.status === 'unauthorized') return errResp('A Stone recusou a chave. Confira a chave (portal Stone › Perfil › Chaves de autenticação, tipo "API de Conciliação Stone") e se ela foi criada para este StoneCode.');
      if (probe.status === 'error') return errResp(`Não foi possível validar na Stone: ${probe.detail}`);

      const postToLedger = typeof body.post_to_ledger === 'boolean' ? body.post_to_ledger : cfg?.post_to_ledger === true;
      const { error } = await admin.from('fin_stone_config').upsert({
        tenant_id: tenantId, stone_code: stoneCode, api_key_b64: btoa(apiKey), bank_account_id: bankAccountId,
        is_active: true, auto_sync: body.auto_sync === false ? false : true, endpoint: probe.endpoint, post_to_ledger: postToLedger,
        last_sync_error: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });
      if (error) return errResp(`Salvar: ${error.message}`, 500);
      if (cfg?.post_to_ledger === true && postToLedger === false) {
        // Desligou: remove o que a Stone lançou no financeiro
        const { data: imps } = await admin.from('fin_stone_imports').select('id').eq('tenant_id', tenantId);
        const ids = (imps ?? []).map((i) => i.id as string);
        for (let i = 0; i < ids.length; i += 200) {
          await admin.from('fin_cash_flow').delete().eq('tenant_id', tenantId).in('reference_id', ids.slice(i, i + 200)).in('origin', ['stone_sale', 'auto_card_fee']);
        }
      }
      log('INFO', 'save_config', 'ok', { tenantId, userId, endpoint: probe.endpoint, probe: probe.status });
      return json({ success: true, validated: probe.status, message: probe.status === 'ok' ? 'Chave validada: arquivo da Stone baixado com sucesso.' : 'Chave aceita pela Stone (sem movimento no dia testado).' });
    }

    if (action === 'delete_config') {
      if (!isManager) return errResp('Apenas admin/gerente', 403);
      await admin.from('fin_stone_config').delete().eq('tenant_id', tenantId);
      return json({ success: true });
    }

    if (action === 'import' || action === 'import_range') {
      if (!cfg) return errResp('Integração Stone não configurada. Configure primeiro.');
      if (!cfg.is_active) return errResp('Integração Stone desativada.');
      const yesterday = addDays(todayBR(), -1);
      let from: string, to: string;
      if (action === 'import') {
        from = to = String(body.reference_date ?? '');
      } else {
        from = String(body.date_from ?? '');
        to = String(body.date_to ?? yesterday);
      }
      if (!isoDate(from) || !isoDate(to)) return errResp('Datas no formato AAAA-MM-DD');
      if (to > yesterday) to = yesterday;
      if (from > to) return errResp('O arquivo da Stone de um dia só fica disponível a partir das 05h do dia seguinte.');
      if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return errResp(`Máximo de ${MAX_RANGE_DAYS} dias por importação`);
      const r = await importRange(admin, tenantId, cfg, from, to);
      const firstErr = r.results.find((x) => 'error' in x) as any;
      return json({ success: r.days_ok > 0 || !firstErr, ...r, error: r.days_ok === 0 && firstErr ? firstErr.error : undefined });
    }

    return errResp(`Ação desconhecida: ${action}`);
  } catch (e) {
    log('ERROR', action, 'unhandled', { error: String((e as Error)?.stack ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});
