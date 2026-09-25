// inter-bank — integração com a API Banking do Banco Inter (conta PJ).
//
// O que faz: puxa o EXTRATO e o SALDO da conta do Inter e grava as linhas em
// fin_bank_statement_imports (mesma tabela do OFX/Stone), conciliando
// automaticamente com fin_bank_transactions / fin_cash_flow quando bate valor,
// tipo e data (±3 dias). O saldo real vai para fin_bank_accounts.synced_balance
// (a projeção de caixa usa esse número como saldo inicial).
//
// Ações (POST JSON { action, tenant_id, ... }):
//   get_config     {}                              config sem segredos (client_id mascarado)
//   save_config    { client_id, client_secret, cert_pem, key_pem, conta_corrente?, environment?,
//                    bank_account_id, sync_from?, auto_sync? }   admin/manager; valida no Inter antes de gravar
//   test_config    { ...mesmos campos opcionais }  testa token + saldo (usa o que estiver gravado se omitido)
//   delete_config  {}                              admin/manager
//   sync           { days? }                       extrato + saldo desde o último sync (ou N dias)
//   sync_all       {}                              (interno) todas as lojas com auto_sync — cron diário 07h (inter-bank-sync);
//                                                  o front também chama `sync` ao abrir a Conciliação, e o pagamento pago dispara `sync` na hora
//   probe_mtls     { cert_pem, key_pem }           (interno) diagnóstico do suporte a mTLS no runtime
//   ── Pagamentos (2026-09-12) — só o assistente (x-internal-key), depois do botão Pagar + PIN no Telegram:
//   prepare_payment  { tipo: 'boleto'|'pix', linha?, chave?, valor?, instrucoes?, descricao?, bill_id?, requested_by?, channel?, chat_id? }
//                    valida (DV do boleto, fornecedor do Pix, limites) e grava fin_inter_payments em 'draft'
//                    boleto vencido sem valor informado: valor = código + multa + juros das `instrucoes` (texto do boleto)
//   decode_boleto    { linha }        só decodifica e confere os DVs (valor, vencimento, digitável) — nada é gravado
//   reprepare_payment { payment_id }  remonta um pedido expirado/falhado como pedido NOVO (revalida tudo)
//   execute_payment  { payment_id }   envia ao Inter (x-id-idempotente = idempotency_key da linha)
//   cancel_payment   { payment_id }   rascunho → cancelado; boleto agendado/aguardando → DELETE no Inter
//   payment_status   { payment_id }   (interno ou admin/gerente) atualiza o status no Inter
//   list_payments    { limit? }       (interno ou admin/gerente)
//   check_payment_scopes {}           (admin/gerente ou interno) token com escopos de pagamento + consulta só leitura
//   save_pay_credentials { client_id, client_secret, cert_pem, key_pem, conta_corrente? }  (admin/gerente) credencial PRÓPRIA de
//                    pagamento; só grava se o Inter der token com os escopos de pagamento · delete_pay_credentials {}
//   (Pix permitidos: fin_pix_favorecidos é gerenciada na tela Assistente — assistente-config, com PIN próprio)
//
// Autenticação: JWT do usuário (membership em user_tenants) OU chamada interna
// (outra função) com header x-internal-key = FISCAL_INTERNAL_KEY.
//
// API do Inter: OAuth2 client_credentials em /oauth/v2/token (escopo extrato.read),
// TODA chamada exige o certificado mTLS emitido no Internet Banking PJ
// ("Soluções para sua empresa › Nova integração"). Extrato: máx. 90 dias por consulta.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { copiaValida, lerCopia } from '../_shared/guias.ts';
// Leitura/validação de boleto: mora em _shared porque a caixa de boletos por e-mail usa a
// MESMA conferência de dígitos. Movido daqui em 2026-09-22, sem mudança de comportamento.
import { boletoVencido, decodeBoleto, encargosAtraso } from '../_shared/boleto.ts';
import { isFinanceiroRole } from '../_shared/tenant-auth.ts';

type Admin = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
};
const BASE: Record<string, string> = {
  production: 'https://cdpj.partners.bancointer.com.br',
  sandbox: 'https://cdpj-sandbox.partners.uatinter.co',
};
const SCOPE = 'extrato.read';
const PROVIDER_TIMEOUT_MS = 45_000;
const PAGE_SIZE = 100;
const MAX_WINDOW_DAYS = 89;      // a API limita a 90 dias por consulta
const MATCH_TOLERANCE = 0.02;    // R$ 0,02 (igual ao import OFX)
const MATCH_DAYS = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'inter-bank', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function todayBR(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400_000);
}
function normalizePem(s: unknown): string {
  // Aceita PEM colado com \r\n, espaços nas bordas ou com "\n" literal (vindo de JSON/env).
  return String(s ?? '').replace(/\\n/g, '\n').replace(/\r/g, '').trim() + '\n';
}

// ── mTLS ─────────────────────────────────────────────────────────────────────
// Deno.createHttpClient({ cert, key }) + fetch(url, { client }). Testado no runtime
// supabase-edge-runtime-1.76.0 (Deno 2.1.4) em 2026-09-10: o certificado É apresentado
// no handshake. Os nomes antigos (certChain/privateKey) são ignorados em silêncio — não usar.
type HttpClient = { close?: () => void };
function makeClient(certPem: string, keyPem: string): HttpClient {
  const D = Deno as unknown as { createHttpClient?: (opts: Record<string, unknown>) => HttpClient };
  if (typeof D.createHttpClient !== 'function') throw new Error('Runtime sem Deno.createHttpClient — mTLS indisponível');
  return D.createHttpClient({ cert: certPem, key: keyPem });
}

interface InterCreds { environment: string; client_id: string; client_secret: string; cert_pem: string; key_pem: string; conta_corrente?: string | null }

async function interFetch(creds: InterCreds, client: HttpClient, path: string, init: RequestInit & { token?: string } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (creds.conta_corrente) headers['x-conta-corrente'] = String(creds.conta_corrente).replace(/\D/g, '');
  try {
    const res = await fetch(`${BASE[creds.environment] ?? BASE.production}${path}`, {
      ...init, headers, signal: ctrl.signal, client,
    } as RequestInit);
    const raw = await res.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data, raw };
  } finally { clearTimeout(timer); }
}

function providerError(r: { status: number; data: any; raw: string }, what: string): string {
  const d = r.data;
  let detail = d?.detail ?? d?.message ?? d?.error_description ?? d?.error ?? d?.title
    ?? (Array.isArray(d?.violacoes) ? d.violacoes.map((v: any) => v.razao ?? v.propriedade).join('; ') : null)
    ?? (r.raw ? r.raw.slice(0, 200) : '');
  // As violações trazem o porquê (ex.: faixa de valor aceita) e sumiam atrás do título (2026-09-22:
  // boleto vencido recusado 3× só com "Campo(s) inválido(s): Valor a pagar").
  if (Array.isArray(d?.violacoes) && d.violacoes.length) {
    const extra = d.violacoes.map((v: any) => [v.propriedade, v.razao, v.valor].filter((x) => x != null && x !== '').join(' ')).filter(Boolean).join('; ');
    if (extra && !String(detail).includes(extra)) detail = `${detail} (${extra})`;
  }
  if (r.status === 401 || r.status === 403) return `${what}: credenciais recusadas pelo Inter (${r.status}). Confira client_id/secret, escopo "extrato.read" e o certificado. ${detail}`.trim();
  return `${what}: Inter respondeu ${r.status}. ${detail}`.trim();
}

// Erros de rede/TLS viram mensagem que o gerente entende
function friendlyError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (/UnknownCA|certificate|CertificateUnknown|BadCertificate|HandshakeFailure/i.test(msg)) {
    return `O Inter não aceitou o certificado: use o .crt e o .key baixados na MESMA integração do Internet Banking (Soluções para sua empresa › Integrações) e confira se ela não expirou. Detalhe: ${msg}`;
  }
  if (/invalid.*(pem|key|cert)|InvalidData|no private key|PrivateKey/i.test(msg)) {
    return `Certificado ou chave privada em formato inválido (cole o conteúdo completo dos arquivos .crt e .key, em PEM). Detalhe: ${msg}`;
  }
  if (/error sending request|dns|timed out|AbortError|Connect/i.test(msg)) {
    return `Não foi possível falar com a API do Inter (rede/TLS). Detalhe: ${msg}`;
  }
  return msg;
}

async function getToken(creds: InterCreds, client: HttpClient, scope = SCOPE): Promise<string> {
  const body = new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, grant_type: 'client_credentials', scope });
  const r = await interFetch(creds, client, '/oauth/v2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  if (!r.ok || !r.data?.access_token) throw new Error(providerError(r, 'Token'));
  return String(r.data.access_token);
}

async function getBalance(creds: InterCreds, client: HttpClient, token: string, date: string) {
  const r = await interFetch(creds, client, `/banking/v2/saldo?dataSaldo=${date}`, { token });
  if (!r.ok) throw new Error(providerError(r, 'Saldo'));
  const d = r.data ?? {};
  return { disponivel: Number(d.disponivel ?? 0), raw: d };
}

interface InterTx { idTransacao?: string; dataInclusao?: string; dataTransacao?: string; tipoTransacao?: string; tipoOperacao?: string; valor?: string | number; titulo?: string; descricao?: string; detalhes?: Record<string, unknown> }

async function getStatement(creds: InterCreds, client: HttpClient, token: string, from: string, to: string): Promise<InterTx[]> {
  const out: InterTx[] = [];
  for (let page = 0; page < 500; page++) {
    const r = await interFetch(creds, client, `/banking/v2/extrato/completo?dataInicio=${from}&dataFim=${to}&pagina=${page}&tamanhoPagina=${PAGE_SIZE}`, { token });
    if (!r.ok) throw new Error(providerError(r, 'Extrato'));
    const txs: InterTx[] = Array.isArray(r.data?.transacoes) ? r.data.transacoes : [];
    out.push(...txs);
    if (r.data?.ultimaPagina === true || txs.length === 0 || (r.data?.totalPaginas != null && page + 1 >= Number(r.data.totalPaginas))) break;
  }
  return out;
}

// Descrição legível: "PIX RECEBIDO - Fulano da Silva" etc.
function describe(tx: InterTx): string {
  const det = tx.detalhes ?? {};
  const who = det.nomePagador ?? det.nomeRecebedor ?? det.nomeBeneficiario ?? det.nomeDestinatario ?? det.nomeRemetente ?? det.nomeEmpresa ?? det.nomeOrigem ?? det.nomeFavorecido ?? null;
  const parts = [tx.titulo, tx.descricao, who ? String(who) : null]
    .map((s) => String(s ?? '').trim()).filter(Boolean);
  const seen = new Set<string>();
  return parts.filter((p) => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join(' - ').slice(0, 250) || tx.tipoTransacao || 'Lançamento Inter';
}

async function hashId(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

// ── Regras de classificação (mesma lógica do useConciliacao.applyRules) ─────
interface Rule { id?: string; pattern: string; match_type: string; category?: string | null; cost_center_id?: string | null; transaction_type: string; bank_account_id?: string | null; match_count?: number }
function applyRule(rules: Rule[], description: string, txType: 'credit' | 'debit'): Rule | null {
  const desc = description.toLowerCase();
  for (const rule of rules) {
    if (rule.transaction_type !== 'both' && rule.transaction_type !== txType) continue;
    const pattern = String(rule.pattern ?? '').toLowerCase();
    if (!pattern) continue;
    let ok = false;
    switch (rule.match_type) {
      case 'contains': ok = desc.includes(pattern); break;
      case 'starts_with': ok = desc.startsWith(pattern); break;
      case 'ends_with': ok = desc.endsWith(pattern); break;
      case 'exact': ok = desc === pattern; break;
      case 'regex': try { ok = new RegExp(rule.pattern, 'i').test(description); } catch { ok = false; } break;
    }
    if (ok) return rule;
  }
  return null;
}

// ── Sync de uma loja ─────────────────────────────────────────────────────────
async function syncTenant(admin: Admin, tenantId: string, opts: { days?: number; date_from?: string; date_to?: string } = {}) {
  const action = 'sync';
  const { data: cfg } = await admin.from('fin_inter_config').select('*').eq('tenant_id', tenantId).maybeSingle();
  if (!cfg) return { tenant_id: tenantId, error: 'Banco Inter não configurado nesta loja' };
  if (!cfg.is_active) return { tenant_id: tenantId, error: 'Integração com o Inter desativada' };
  if (!cfg.bank_account_id) return { tenant_id: tenantId, error: 'Configure a conta bancária do ERP que representa a conta do Inter' };

  const creds: InterCreds = { environment: cfg.environment, client_id: cfg.client_id, client_secret: cfg.client_secret, cert_pem: cfg.cert_pem, key_pem: cfg.key_pem, conta_corrente: cfg.conta_corrente };
  const today = todayBR();
  let from: string;
  // Período escolhido na tela (De/Até): vale como está, inclusive antes do
  // sync_from da config — o usuário pediu aquele intervalo explicitamente.
  const explicit = Boolean(opts.date_from);
  if (explicit) from = String(opts.date_from);
  else if (opts.days && opts.days > 0) from = addDays(today, -Math.min(opts.days, 365));
  else if (cfg.last_sync_at) from = addDays(String(cfg.last_sync_at).slice(0, 10), -MATCH_DAYS);
  else from = String(cfg.sync_from ?? addDays(today, -30));
  if (!explicit && from < String(cfg.sync_from ?? from)) from = String(cfg.sync_from);
  if (from > today) from = today;
  const to = opts.date_to && opts.date_to < today ? opts.date_to : today;
  if (from > to) from = to;

  let client: HttpClient | null = null;
  try {
    client = makeClient(creds.cert_pem, creds.key_pem);

    // Token (cache de 1 h na própria config)
    let token: string | null = null;
    if (cfg.access_token && cfg.token_expires_at && new Date(cfg.token_expires_at).getTime() - Date.now() > 5 * 60_000) token = cfg.access_token;
    if (!token) {
      token = await getToken(creds, client);
      await admin.from('fin_inter_config').update({ access_token: token, token_expires_at: new Date(Date.now() + 55 * 60_000).toISOString() }).eq('id', cfg.id);
    }

    // Extrato em janelas de ≤ 90 dias
    const txs: InterTx[] = [];
    let cursor = from;
    while (cursor <= to) {
      const end = daysBetween(cursor, to) > MAX_WINDOW_DAYS ? addDays(cursor, MAX_WINDOW_DAYS) : to;
      let chunk: InterTx[];
      try {
        chunk = await getStatement(creds, client, token, cursor, end);
      } catch (e) {
        // token expirado no meio do caminho → renova uma vez
        if (/\(401\)/.test(String(e))) {
          token = await getToken(creds, client);
          await admin.from('fin_inter_config').update({ access_token: token, token_expires_at: new Date(Date.now() + 55 * 60_000).toISOString() }).eq('id', cfg.id);
          chunk = await getStatement(creds, client, token, cursor, end);
        } else throw e;
      }
      txs.push(...chunk);
      cursor = addDays(end, 1);
    }

    // Linhas → fin_bank_statement_imports
    const rows = [];
    for (const tx of txs) {
      const date = String(tx.dataTransacao ?? tx.dataInclusao ?? '').slice(0, 10);
      const amount = round2(Math.abs(Number(String(tx.valor ?? '0').replace(',', '.')) || 0));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || amount <= 0) continue;
      const type: 'credit' | 'debit' = String(tx.tipoOperacao ?? '').toUpperCase().startsWith('D') ? 'debit' : 'credit';
      const description = describe(tx);
      const externalId = tx.idTransacao ? `inter_${tx.idTransacao}` : `inter_${await hashId(`${date}|${amount}|${type}|${tx.tipoTransacao}|${tx.titulo}|${tx.descricao}`)}`;
      rows.push({ tenant_id: tenantId, bank_account_id: cfg.bank_account_id, external_id: externalId, transaction_date: date, amount, description, transaction_type: type, status: 'pending', source: 'inter', raw: tx });
    }

    let inserted: any[] = [];
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await admin.from('fin_bank_statement_imports')
        .upsert(rows.slice(i, i + 200), { onConflict: 'tenant_id,bank_account_id,external_id', ignoreDuplicates: true })
        .select('id, transaction_date, amount, transaction_type, description');
      if (error) throw new Error(`Gravar extrato: ${error.message}`);
      inserted = inserted.concat(data ?? []);
    }

    // Conciliação automática das linhas NOVAS: fin_bank_transactions da conta e fin_cash_flow da loja
    let matched = 0;
    let classified = 0;
    if (inserted.length > 0) {
      const dates = inserted.map((r) => r.transaction_date as string).sort();
      const dFrom = addDays(dates[0], -MATCH_DAYS);
      const dTo = addDays(dates[dates.length - 1], MATCH_DAYS);
      const [{ data: bts }, { data: cfs }, { data: used }, { data: rules }] = await Promise.all([
        admin.from('fin_bank_transactions').select('id, transaction_date, amount, type, description').eq('tenant_id', tenantId).eq('bank_account_id', cfg.bank_account_id).gte('transaction_date', dFrom).lte('transaction_date', dTo).limit(5000),
        admin.from('fin_cash_flow').select('id, date, amount, type, description').eq('tenant_id', tenantId).gte('date', dFrom).lte('date', dTo).limit(5000),
        admin.from('fin_bank_statement_imports').select('matched_transaction_id').eq('tenant_id', tenantId).not('matched_transaction_id', 'is', null).gte('transaction_date', dFrom).lte('transaction_date', dTo).limit(5000),
        admin.from('fin_reconciliation_rules').select('id, pattern, match_type, category, cost_center_id, transaction_type, bank_account_id, match_count').eq('tenant_id', tenantId).eq('is_active', true),
      ]);
      const usedIds = new Set((used ?? []).map((u) => u.matched_transaction_id as string));
      type Cand = { id: string; date: string; amount: number; type: 'credit' | 'debit'; source: 'bank_transaction' | 'cash_flow'; description: string };
      const cands: Cand[] = [
        ...(bts ?? []).map((b) => ({ id: b.id, date: b.transaction_date, amount: Number(b.amount), type: (b.type === 'credit' ? 'credit' : 'debit') as 'credit' | 'debit', source: 'bank_transaction' as const, description: b.description })),
        ...(cfs ?? []).map((c) => ({ id: c.id, date: c.date, amount: Number(c.amount), type: (c.type === 'income' ? 'credit' : 'debit') as 'credit' | 'debit', source: 'cash_flow' as const, description: c.description })),
      ].filter((c) => !usedIds.has(c.id));
      const activeRules = ((rules ?? []) as Rule[]).filter((r) => !r.bank_account_id || r.bank_account_id === cfg.bank_account_id);

      for (const row of inserted) {
        const update: Record<string, unknown> = {};
        const amt = Number(row.amount);
        let best: Cand | null = null;
        let bestScore = -1;
        for (const c of cands) {
          if (c.type !== row.transaction_type || Math.abs(c.amount - amt) > MATCH_TOLERANCE) continue;
          const dd = Math.abs(daysBetween(c.date, row.transaction_date));
          if (dd > MATCH_DAYS) continue;
          const score = (MATCH_DAYS - dd) * 10 + (c.source === 'bank_transaction' ? 5 : 0);
          if (score > bestScore) { best = c; bestScore = score; }
        }
        if (best) {
          usedIds.add(best.id);
          cands.splice(cands.indexOf(best), 1);
          Object.assign(update, { status: 'matched', matched_transaction_id: best.id, matched_at: new Date().toISOString(), notes: `Conciliado automaticamente (Inter) com ${best.source === 'bank_transaction' ? 'movimento bancário' : 'fluxo de caixa'}: ${String(best.description ?? '').slice(0, 120)}` });
          matched++;
        }
        const rule = applyRule(activeRules, row.description ?? '', row.transaction_type);
        if (rule) {
          if (rule.category) update.category = rule.category;
          if (rule.cost_center_id) update.cost_center_id = rule.cost_center_id;
          classified++;
          rule.match_count = Number(rule.match_count ?? 0) + 1;
          if (rule.id) await admin.from('fin_reconciliation_rules').update({ match_count: rule.match_count }).eq('id', rule.id);
        }
        if (Object.keys(update).length > 0) await admin.from('fin_bank_statement_imports').update(update).eq('id', row.id);
      }
    }

    // Stone × Inter: repasses da maquininha (domicílio) e transferências entre contas próprias.
    // Roda sempre (não só com linhas novas): a Stone pode ter sido importada depois do Inter.
    try {
      const { data: si, error: siErr } = await admin.rpc('fn_match_stone_inter', { p_tenant: tenantId, p_from: from < addDays(today, -20) ? from : addDays(today, -20), p_to: today });
      if (siErr) log('WARN', action, 'fn_match_stone_inter falhou', { tenantId, error: siErr.message });
      else if (si) log('INFO', action, 'stone×inter', { tenantId, ...(si as Record<string, unknown>) });
    } catch (e) {
      log('WARN', action, 'fn_match_stone_inter falhou', { tenantId, error: String(e) });
    }

    // iFood e Pix do tablet (2026-09-24): o repasse do iFood só casava no sync do iFood (07h20), antes
    // de o depósito cair no Inter — ficava "Pendente" o dia todo. O Pix do tablet casa pelo txid da cobrança.
    try {
      const d20 = from < addDays(today, -20) ? from : addDays(today, -20);
      // Só no período coberto pelo relatório do iFood da loja (mesma trava do ifood-financial › matchInter).
      const [{ data: ifLo }, { data: ifHi }] = await Promise.all([
        admin.from('fin_ifood_entries').select('data_repasse').eq('tenant_id', tenantId).not('data_repasse', 'is', null).order('data_repasse', { ascending: true }).limit(1),
        admin.from('fin_ifood_entries').select('data_repasse').eq('tenant_id', tenantId).not('data_repasse', 'is', null).order('data_repasse', { ascending: false }).limit(1),
      ]);
      const ifFrom = ifLo?.[0]?.data_repasse as string | undefined; const ifTo = ifHi?.[0]?.data_repasse as string | undefined;
      if (ifFrom && ifTo && ifTo >= d20) {
        const { data: ifd, error: ifdErr } = await admin.rpc('fn_match_ifood_inter', { p_tenant: tenantId, p_from: ifFrom > d20 ? ifFrom : d20, p_to: ifTo < today ? ifTo : today });
        if (ifdErr) log('WARN', action, 'fn_match_ifood_inter falhou', { tenantId, error: ifdErr.message });
        else if (ifd) log('INFO', action, 'ifood×inter', { tenantId, casados: ifd });
      }
      const { data: kp, error: kpErr } = await admin.rpc('fn_match_kiosk_pix', { p_tenant: tenantId, p_from: d20, p_to: today });
      if (kpErr) log('WARN', action, 'fn_match_kiosk_pix falhou', { tenantId, error: kpErr.message });
      else if (kp) log('INFO', action, 'pix tablet×inter', { tenantId, casados: kp });
    } catch (e) {
      log('WARN', action, 'fn_match_ifood_inter/kiosk_pix falhou', { tenantId, error: String(e) });
    }

    // Pagamentos × notas de entrada / contas a pagar: só SUGERE (a baixa é confirmada pelo usuário).
    try {
      const { data: mp, error: mpErr } = await admin.rpc('fn_match_payments', { p_tenant: tenantId, p_from: from < addDays(today, -120) ? from : addDays(today, -120), p_to: today });
      if (mpErr) log('WARN', action, 'fn_match_payments falhou', { tenantId, error: mpErr.message });
      else if (mp) log('INFO', action, 'pagamentos×notas', { tenantId, ...(mp as Record<string, unknown>) });
      // Pix de salário × folha pendente (2026-09-18): também só sugere.
      const { error: fpErr } = await admin.rpc('fn_match_payroll', { p_tenant: tenantId, p_from: from < addDays(today, -120) ? from : addDays(today, -120), p_to: today });
      if (fpErr) log('WARN', action, 'fn_match_payroll falhou', { tenantId, error: fpErr.message });
      // Regras de lançamento por CNPJ/chave (2026-09-18): depois de nota, conta e folha; também só sugere.
      const { error: lrErr } = await admin.rpc('fn_match_launch_rules', { p_tenant: tenantId, p_from: from < addDays(today, -120) ? from : addDays(today, -120), p_to: today });
      if (lrErr) log('WARN', action, 'fn_match_launch_rules falhou', { tenantId, error: lrErr.message });
    } catch (e) {
      log('WARN', action, 'fn_match_payments falhou', { tenantId, error: String(e) });
    }

    // Saldo real
    let balance: number | null = null;
    try {
      const b = await getBalance(creds, client, token, today);
      balance = round2(b.disponivel);
      const now = new Date().toISOString();
      await admin.from('fin_inter_config').update({ last_balance: balance, last_balance_at: now, last_balance_raw: b.raw }).eq('id', cfg.id);
      await admin.from('fin_bank_accounts').update({ synced_balance: balance, synced_balance_at: now, synced_provider: 'inter' }).eq('id', cfg.bank_account_id).eq('tenant_id', tenantId);
    } catch (e) {
      log('WARN', action, 'saldo falhou', { tenantId, error: String(e) });
    }

    // Importação de um período antigo (Até < hoje) não mexe no last_sync_at: senão o
    // próximo "desde o último sync" pularia os dias entre o sync real e hoje.
    await admin.from('fin_inter_config').update({
      ...(to === today ? { last_sync_at: new Date().toISOString() } : {}),
      last_sync_error: null, updated_at: new Date().toISOString(),
    }).eq('id', cfg.id);
    log('INFO', action, 'ok', { tenantId, from, to, fetched: txs.length, inserted: inserted.length, matched, classified, balance });
    return { tenant_id: tenantId, from, to, fetched: txs.length, inserted: inserted.length, matched, classified, balance };
  } catch (e) {
    const msg = friendlyError(e);
    log('ERROR', action, 'falhou', { tenantId, error: msg });
    await admin.from('fin_inter_config').update({ last_sync_error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', cfg.id);
    return { tenant_id: tenantId, error: msg };
  } finally {
    try { client?.close?.(); } catch { /* noop */ }
  }
}

// ── Pagamentos: boleto e Pix (2026-09-12) ─────────────────────────────────────
// Endpoints (API Banking v2): POST/GET /banking/v2/pagamento, DELETE /banking/v2/pagamento/{codigoTransacao},
// POST /banking/v2/pix, GET /banking/v2/pix/{codigoSolicitacao}. O Inter segura o pagamento até alguém
// aprovar no app (Gestão de Aprovações) — por isso o status típico logo após o envio é "aguardando aprovação".
const PAY_SCOPE = 'pagamento-boleto.read pagamento-boleto.write pagamento-pix.read pagamento-pix.write';
const PAY_LIVE = ['sending', 'sent', 'pending_approval', 'approved', 'scheduled', 'paid'];
const PAY_OPEN = ['draft', 'awaiting_pin'];
// Envio que saiu para o Inter e voltou sem resposta: status 'failed' + inter_status INCERTO. Não se
// prepara de novo sem alguém conferir no app (auditoria 2026-09-24: "Preparar de novo" pagava duas vezes).
const INCERTO = 'INCERTO';
// Inícios fixos das mensagens: pedidos-pagamento reconhece o caso e não manda "pagar pelo banco".
const ERRO_EM_ANDAMENTO = 'Já existe um pagamento em andamento para essa conta';
const ERRO_JA_PAGO = 'Essa conta já foi paga:';
const ERRO_INCERTO = 'Um envio anterior ficou sem resposta do Inter.';
const DRAFT_TTL_MS = 30 * 60_000;
// Emissores de Pix copia e cola aceitos (location do QR dinâmico): guias do governo.
const PIX_COPIA_HOSTS = new Set(['pix-qrcode.caixa.gov.br']);
const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function normPixKey(k: string): { key: string; kind: string } {
  const s = String(k ?? '').trim();
  if (/@/.test(s)) return { key: s.toLowerCase(), kind: 'email' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { key: s.toLowerCase(), kind: 'evp' };
  const dg = onlyDigits(s);
  if (/^\+/.test(s) || (dg.length === 13 && dg.startsWith('55'))) return { key: `+${dg}`, kind: 'telefone' };
  if (dg.length === 14) return { key: dg, kind: 'cnpj' };
  if (dg.length === 11) return { key: dg, kind: 'cpf' };
  return { key: s, kind: 'desconhecida' };
}
function mapPayStatus(s: unknown): string {
  const t = String(s ?? '').toUpperCase();
  if (!t) return 'sent';
  if (/CANCEL/.test(t)) return 'cancelled';
  if (/REPROVA|REJEIT|ERRO|FALHA|DEVOLV|NAO_REALIZ|EXPIRAD/.test(t)) return 'rejected';
  if (/AGUARDANDO|PENDENTE|^APROVACAO$/.test(t)) return 'pending_approval';
  if (/AGENDAD/.test(t)) return 'scheduled';
  if (/APROVADO/.test(t)) return 'approved';
  if (/PAGO|REALIZAD|PROCESSAD|EFETIVAD|CONCLU|LIQUIDAD|DEBITAD/.test(t)) return 'paid';
  return 'sent';
}

// Credenciais que podem pagar: a da conciliação (fin_inter_config, "extrato") e a do Pix do
// tablet (fin_payment_provider_config provider='inter_pix'). São integrações diferentes da MESMA
// conta; os escopos de pagamento podem ter sido liberados em qualquer uma delas. Tenta primeiro a
// que funcionou da última vez (fin_inter_config.pay_source) e guarda a que der certo.
type PaySource = 'pagamento' | 'extrato' | 'inter_pix';
// deno-lint-ignore no-explicit-any
async function payCandidates(admin: Admin, cfg: any, tenantId: string): Promise<Array<{ source: PaySource; creds: InterCreds }>> {
  const list: Array<{ source: PaySource; creds: InterCreds }> = [];
  // Integração própria de pagamento (cadastrada em Conciliação › Banco Inter › Credencial de pagamento)
  if (cfg.pay_client_id && cfg.pay_client_secret && cfg.pay_cert_pem && cfg.pay_key_pem) {
    list.push({ source: 'pagamento', creds: {
      environment: cfg.environment, client_id: String(cfg.pay_client_id), client_secret: String(cfg.pay_client_secret),
      cert_pem: String(cfg.pay_cert_pem), key_pem: String(cfg.pay_key_pem), conta_corrente: cfg.pay_conta_corrente ?? cfg.conta_corrente ?? null,
    } });
  }
  list.push({ source: 'extrato', creds: credsOf(cfg) });
  const { data: prov } = await admin.from('fin_payment_provider_config')
    .select('client_id, client_secret, cert_pem, key_pem, environment, conta_corrente')
    .eq('tenant_id', tenantId).eq('provider', 'inter_pix').maybeSingle();
  if (prov?.client_id && prov.client_secret && prov.cert_pem && prov.key_pem) {
    list.push({ source: 'inter_pix', creds: {
      environment: ['production', 'sandbox'].includes(String(prov.environment)) ? String(prov.environment) : 'production',
      client_id: String(prov.client_id), client_secret: String(prov.client_secret),
      cert_pem: normalizePem(prov.cert_pem), key_pem: normalizePem(prov.key_pem),
      conta_corrente: prov.conta_corrente ?? cfg.conta_corrente ?? null,
    } });
  }
  // A que funcionou da última vez vai primeiro
  const i = list.findIndex((c) => c.source === cfg.pay_source);
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
}
// deno-lint-ignore no-explicit-any
async function openPay(admin: Admin, cfg: any, tenantId: string, force = false): Promise<{ creds: InterCreds; client: HttpClient; token: string; source: PaySource }> {
  const cands = await payCandidates(admin, cfg, tenantId);
  const errors: string[] = [];
  for (const c of cands) {
    const client = makeClient(c.creds.cert_pem, c.creds.key_pem);
    try {
      if (!force && cfg.pay_source === c.source && cfg.pay_access_token && cfg.pay_token_expires_at && new Date(cfg.pay_token_expires_at).getTime() - Date.now() > 5 * 60_000) {
        return { creds: c.creds, client, token: String(cfg.pay_access_token), source: c.source };
      }
      const token = await getToken(c.creds, client, PAY_SCOPE);
      const exp = new Date(Date.now() + 55 * 60_000).toISOString();
      await admin.from('fin_inter_config').update({ pay_source: c.source, pay_access_token: token, pay_token_expires_at: exp }).eq('id', cfg.id);
      Object.assign(cfg, { pay_source: c.source, pay_access_token: token, pay_token_expires_at: exp });
      return { creds: c.creds, client, token, source: c.source };
    } catch (e) {
      try { client.close?.(); } catch { /* noop */ }
      errors.push(`${c.source === 'pagamento' ? 'integração de pagamento' : c.source === 'extrato' ? 'integração do extrato' : 'integração do Pix do tablet'} (…${String(c.creds.client_id).slice(-4)}): ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    }
  }
  throw new Error(`Nenhuma integração do Inter desta conta tem os escopos de pagamento (boleto/Pix). Em Minhas integrações › API Banking, marque Pagamentos em uma delas. ${errors.join(' | ')}`);
}
// deno-lint-ignore no-explicit-any
function credsOf(cfg: any): InterCreds {
  return { environment: cfg.environment, client_id: cfg.client_id, client_secret: cfg.client_secret, cert_pem: cfg.cert_pem, key_pem: cfg.key_pem, conta_corrente: cfg.conta_corrente };
}
async function loadCfg(admin: Admin, tenantId: string) {
  const { data: cfg } = await admin.from('fin_inter_config').select('*').eq('tenant_id', tenantId).maybeSingle();
  if (!cfg || !cfg.is_active) throw new Error('Esta loja não tem o Banco Inter conectado.');
  return cfg;
}
// deno-lint-ignore no-explicit-any
async function checkLimits(admin: Admin, cfg: any, tenantId: string, amount: number, excludeId?: string) {
  const perTx = Number(cfg.pay_limit_tx ?? 5000);
  const perDay = Number(cfg.pay_limit_day ?? 10000);
  if (amount > perTx + 0.001) throw new Error(`Valor acima do limite por pagamento (${brl(perTx)}). Pague pelo app do Inter ou ajuste o limite.`);
  const dayStart = new Date(`${todayBR()}T03:00:00Z`).toISOString();
  const { data } = await admin.from('fin_inter_payments').select('id, amount').eq('tenant_id', tenantId).in('status', PAY_LIVE).gte('sent_at', dayStart);
  const used = (data ?? []).filter((r) => r.id !== excludeId).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  if (used + amount > perDay + 0.001) throw new Error(`Passaria do limite do dia (${brl(perDay)}; já enviados hoje ${brl(used)}).`);
}

// deno-lint-ignore no-explicit-any
async function preparePayment(admin: Admin, tenantId: string, body: Record<string, any>) {
  const cfg = await loadCfg(admin, tenantId);
  const tipo = String(body.tipo ?? '').toLowerCase();
  // deno-lint-ignore no-explicit-any
  let bill: any = null;
  let faltaConta: number | null = null;
  if (body.bill_id) {
    const { data } = await admin.from('fin_accounts_payable').select('id, tenant_id, description, supplier, amount, paid_amount, due_date, status').eq('id', String(body.bill_id)).eq('tenant_id', tenantId).maybeSingle();
    if (!data) throw new Error('Conta a pagar não encontrada.');
    if (data.status === 'paid') throw new Error('Essa conta já está paga no ERPOS.');
    if (data.status === 'cancelled') throw new Error('Essa conta foi cancelada no ERPOS — não há o que pagar.');
    // Pix/boleto já PAGO pelo Inter mas a conta ainda não baixada (a baixa espera o débito aparecer no
    // extrato, pode levar horas): sem isto o "Mandar para pagar"/"Preparar de novo" pagava a mesma
    // conta outra vez (auditoria 2026-09-24). Vale o maior entre o baixado e o pago pelo Inter.
    const { data: pagos } = await admin.from('fin_inter_payments').select('id, amount, status, inter_status, replaced_by')
      .eq('tenant_id', tenantId).eq('bill_id', data.id).in('status', ['paid', 'failed']);
    const pagoInter = (pagos ?? []).filter((x) => x.status === 'paid').reduce((t, x) => t + Number(x.amount ?? 0), 0);
    const falta = round2(Number(data.amount) - Math.max(Number(data.paid_amount ?? 0), pagoInter));
    if (pagoInter > 0) faltaConta = falta;
    if (falta <= 0.009) {
      throw new Error(`${ERRO_JA_PAGO} ${brl(pagoInter)} pelo Inter — falta só a baixa, que sai sozinha quando o débito aparecer no extrato.`);
    }
    // Envio sem resposta ("não sei se o Inter recebeu"): até alguém conferir no app, nada novo para essa conta.
    // Só o incerto que ninguém resolveu: o conferido já tem substituto (replaced_by) e não trava mais.
    if (!body.conferido && (pagos ?? []).some((x) => x.status === 'failed' && x.inter_status === INCERTO && (!x.replaced_by || x.replaced_by === x.id))) {
      throw new Error(`${ERRO_INCERTO} Confira no app do Inter se o Pix dessa conta saiu antes de pagar de novo.`);
    }
    // Um pagamento em andamento por conta: pedido aberto (não expirado) ou já enviado
    // e ainda não finalizado. 'paid' é final (conta parcial pode receber outro).
    const { data: ativos } = await admin.from('fin_inter_payments').select('id, status, created_at')
      .eq('tenant_id', tenantId).eq('bill_id', data.id)
      .in('status', [...PAY_OPEN, ...PAY_LIVE.filter((s) => s !== 'paid')]);
    const emAndamento = (ativos ?? []).find((x) => !PAY_OPEN.includes(x.status) || Date.now() - new Date(x.created_at).getTime() <= DRAFT_TTL_MS);
    if (emAndamento) throw new Error(`${ERRO_EM_ANDAMENTO} (situação "${emAndamento.status}"). Conclua ou cancele esse antes de pedir outro.`);
    bill = data;
  }
  const row: Record<string, unknown> = {
    tenant_id: tenantId, kind: tipo, status: 'draft', bill_id: bill?.id ?? null,
    description: String(body.descricao ?? '').trim().slice(0, 140) || (bill ? String(bill.description ?? '').slice(0, 140) : null),
    requested_by: body.requested_by ?? null, channel: body.channel ?? 'assistente', chat_id: body.chat_id ?? null,
  };
  let encargos: ReturnType<typeof encargosAtraso> = null;
  if (tipo === 'boleto') {
    const dec = decodeBoleto(String(body.linha ?? ''));
    let valor = body.valor != null && Number(body.valor) > 0 ? round2(Number(body.valor)) : dec.valor;
    if (!valor || valor <= 0) throw new Error('Esse código não traz o valor: informe quanto pagar.');
    // Boleto VENCIDO (2026-09-22): o Inter recusa o valor do código ("Valor a pagar" inválido) —
    // quer o valor com multa e juros. Sem valor informado (ou informado igual ao do código), calcula
    // pelas instruções do boleto; sem instrução legível, recusa aqui pedindo o valor, em vez de
    // montar um cartão "Pagar" que o Inter vai devolver.
    const hoje = todayBR();
    const valorDoCodigo = dec.valor != null && Math.abs(valor - dec.valor) < 0.005;
    if (valorDoCodigo && dec.valor && boletoVencido(dec.vencimento, hoje)) {
      const enc = encargosAtraso(dec.valor, dec.vencimento, hoje, body.instrucoes == null ? null : String(body.instrucoes));
      const [a, m, d] = String(dec.vencimento).split('-');
      if (!enc) {
        throw new Error(`Boleto vencido em ${d}/${m}/${a}: o Inter só aceita o valor atualizado (com multa e juros) e não achei as instruções do boleto para calcular. Informe o valor a pagar — o app do Inter mostra o valor certo ao ler o código.`);
      }
      valor = enc.total;
      encargos = enc; // não é coluna: vai só na resposta (o cartão e o assistente mostram)
    }
    const { data: dup } = await admin.from('fin_inter_payments').select('id, status').eq('tenant_id', tenantId).eq('barcode', dec.barcode).in('status', PAY_LIVE).limit(1);
    if (dup?.length) throw new Error('Esse boleto já foi enviado para pagamento pelo assistente.');
    // Rascunho aberto do mesmo boleto (2026-09-18): devolve o que já existe em vez de criar outro —
    // dois cartões "Pagar" para a mesma conta é pagar em dobro com um toque a mais. Rascunho velho
    // (passou do prazo) é expirado para abrir lugar ao novo.
    const { data: abertos } = await admin.from('fin_inter_payments').select('*').eq('tenant_id', tenantId).eq('barcode', dec.barcode).in('status', PAY_OPEN);
    for (const a of abertos ?? []) {
      if (Date.now() - new Date(a.created_at).getTime() <= DRAFT_TTL_MS) return { ...a, ja_existia: true, saldo_inter: cfg.last_balance == null ? null : Number(cfg.last_balance) };
      await admin.from('fin_inter_payments').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', a.id).in('status', PAY_OPEN);
    }
    Object.assign(row, {
      amount: valor, face_value: dec.valor, barcode: dec.barcode, digitavel: dec.digitavel, due_date: dec.vencimento, bank_code: dec.banco, boleto_kind: dec.kind,
      beneficiary_name: bill?.supplier ?? null,
    });
  } else if (tipo === 'pix' && body.copia_e_cola) {
    // Pix COPIA E COLA (2026-09-18): só de guia do governo — hoje o FGTS Digital (QR dinâmico da
    // Caixa). A regra "Pix só para quem está cadastrado" continua: copia e cola de qualquer outro
    // emissor é recusado, porque o destinatário sairia do texto do documento, não do cadastro.
    const copia = String(body.copia_e_cola).trim();
    if (!copiaValida(copia)) throw new Error('Pix copia e cola inválido (o código de conferência não bate). Confira se veio inteiro.');
    const info = lerCopia(copia);
    const host = String(info.location ?? '').toLowerCase().split('/')[0];
    if (!PIX_COPIA_HOSTS.has(host)) throw new Error(`Pix copia e cola só é aceito de guia do governo (FGTS Digital). Este é de "${info.nome ?? host ?? 'emissor desconhecido'}": pague pelo app do Inter.`);
    const valor = round2(Number(body.valor ?? info.valor ?? 0));
    if (!(valor > 0)) throw new Error('Informe o valor da guia.');
    const { data: dup } = await admin.from('fin_inter_payments').select('id').eq('tenant_id', tenantId).eq('pix_copia_e_cola', copia).in('status', PAY_LIVE).limit(1);
    if (dup?.length) throw new Error('Esse Pix copia e cola já foi enviado para pagamento pelo assistente.');
    const { data: abertos } = await admin.from('fin_inter_payments').select('*').eq('tenant_id', tenantId).eq('pix_copia_e_cola', copia).in('status', PAY_OPEN);
    for (const a of abertos ?? []) {
      if (Date.now() - new Date(a.created_at).getTime() <= DRAFT_TTL_MS) return { ...a, ja_existia: true, saldo_inter: cfg.last_balance == null ? null : Number(cfg.last_balance) };
      await admin.from('fin_inter_payments').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', a.id).in('status', PAY_OPEN);
    }
    Object.assign(row, {
      amount: valor, pix_copia_e_cola: copia, beneficiary_name: bill?.supplier ?? info.nome ?? null,
      due_date: bill?.due_date ?? null,
    });
  } else if (tipo === 'pix') {
    const k = normPixKey(String(body.chave ?? ''));
    if (k.kind === 'desconhecida') throw new Error('Chave Pix não reconhecida (use CNPJ, CPF, e-mail, telefone com +55 ou chave aleatória).');
    const valor = round2(Number(body.valor ?? 0));
    if (!(valor > 0)) throw new Error('Informe o valor do Pix.');
    const { data: sups } = await admin.from('fin_suppliers').select('id, tenant_id, name, legal_name, cnpj, pix_key, is_active').eq('tenant_id', tenantId).or('pix_key.not.is.null,cnpj.not.is.null').limit(5000);
    const sup = (sups ?? []).find((x) => x.is_active !== false && (
      (x.pix_key && normPixKey(String(x.pix_key)).key === k.key) || (k.kind === 'cnpj' && onlyDigits(x.cnpj) === k.key)
    ));
    if (sup) {
      Object.assign(row, { amount: valor, pix_key: k.key, pix_key_kind: k.kind, supplier_id: sup.id, beneficiary_name: sup.legal_name || sup.name, beneficiary_doc: sup.cnpj ?? null });
    } else {
      // Pix permitidos (pessoas cadastradas na tela do Banco Inter por admin/gerente)
      const { data: fav } = await admin.from('fin_pix_favorecidos').select('id, name, pix_key, pix_key_kind').eq('tenant_id', tenantId).eq('pix_key', k.key).eq('is_active', true).maybeSingle();
      if (!fav) throw new Error('Essa chave Pix não é de fornecedor cadastrado nem está nos Pix permitidos. Por segurança só pago Pix para quem foi cadastrado no ERPOS (Fornecedores ou Assistente › Pix permitidos).');
      Object.assign(row, { amount: valor, pix_key: k.key, pix_key_kind: k.kind, favorecido_id: fav.id, beneficiary_name: fav.name, beneficiary_doc: ['cpf', 'cnpj'].includes(fav.pix_key_kind) ? fav.pix_key : null });
    }
  } else {
    throw new Error("tipo deve ser 'boleto' ou 'pix'");
  }
  // Pix de conta já paga EM PARTE pelo Inter: não passa do que falta (boleto pode ter juros, fica de fora;
  // sem nada pago pelo Inter não há limite — copia e cola com juros continua passando).
  if (tipo === 'pix' && faltaConta != null && Number(row.amount) > faltaConta + 0.009) {
    throw new Error(`Dessa conta faltam só ${brl(faltaConta)} (o resto já foi pago pelo Inter). Peça esse valor.`);
  }
  await checkLimits(admin, cfg, tenantId, Number(row.amount));
  const { data: ins, error } = await admin.from('fin_inter_payments').insert(row).select('*').single();
  if (error?.code === '23505' && row.barcode) {
    // Corrida: outra chamada criou o rascunho deste boleto no mesmo instante (índice
    // fin_inter_payments_boleto_aberto_uq) — devolve o dela.
    const { data: outro } = await admin.from('fin_inter_payments').select('*').eq('tenant_id', tenantId).eq('barcode', String(row.barcode)).in('status', PAY_OPEN).maybeSingle();
    if (outro) return { ...outro, ja_existia: true, saldo_inter: cfg.last_balance == null ? null : Number(cfg.last_balance) };
  }
  if (error || !ins) throw new Error(`Gravar pedido: ${error?.message ?? 'sem retorno'}`);
  return { ...ins, saldo_inter: cfg.last_balance == null ? null : Number(cfg.last_balance), ...(encargos ? { encargos } : {}) };
}

// Prepara DE NOVO um pedido que expirou/falhou (2026-09-18). O rascunho vale 30 minutos
// de propósito — um toque no dia seguinte não pode disparar um Pix velho —, mas antes o
// dono tinha de remontar o pedido na mão a partir de uma mensagem perdida no grupo.
// Aqui o pedido é remontado a partir da linha antiga e passa por TODA a validação de
// novo (DV do boleto, fornecedor/Pix permitido, limites, duplicidade): é um pedido novo,
// não uma ressurreição do antigo. O vínculo com o pedido do grupo vai junto, para o
// comprovante voltar ao grupo certo e a pendência fechar sozinha.
async function reparePayment(admin: Admin, tenantId: string, id: string, conferido = false) {
  const velho = await getPayment(admin, tenantId, id);
  if (PAY_OPEN.includes(velho.status) || PAY_LIVE.includes(velho.status)) {
    throw new Error(`Esse pedido ainda está "${velho.status}" — não precisa preparar de novo.`);
  }
  if (velho.status === 'failed' && velho.inter_status === INCERTO && !conferido) {
    throw new Error(`${ERRO_INCERTO} Confira no app do Inter se esse Pix saiu. Se NÃO saiu, prepare de novo pelo cartão do pagamento no chat do ERPOS.`);
  }
  // decodeBoleto só lê linha digitável (47 dígitos, ou 48 de convênio) — o barcode de 44 não
  // serve como entrada. Todo boleto preparado aqui guardou o digitável; sem ele, não dá.
  if (velho.kind === 'boleto' && !velho.digitavel) {
    throw new Error('Esse pedido não guardou a linha digitável: mande o boleto de novo.');
  }
  // Trava contra DOIS substitutos (toque duplo, chat + Telegram, dois aparelhos): marca o antigo
  // antes de preparar, com UPDATE condicional. Só um ganha; quem perde recebe o mesmo substituto.
  // Enquanto prepara, replaced_by = o próprio id.
  const { data: claim } = await admin.from('fin_inter_payments').update({ replaced_by: velho.id })
    .eq('id', velho.id).eq('tenant_id', tenantId).is('replaced_by', null).select('id').maybeSingle();
  if (!claim) {
    const { data: cur } = await admin.from('fin_inter_payments').select('replaced_by').eq('id', velho.id).maybeSingle();
    if (cur?.replaced_by && cur.replaced_by !== velho.id) return await getPayment(admin, tenantId, cur.replaced_by);
    throw new Error('Esse pedido já está sendo preparado de novo. Aguarde um instante.');
  }
  // Boleto vencido (2026-09-22): o valor do pedido antigo ficou velho (os juros correm por dia, e o
  // pedido recusado pode ter ido pelo valor do código). Com as instruções do boleto em mãos — o texto
  // do pedido do grupo —, o valor é recalculado para hoje; sem elas, fica o valor que o pedido tinha.
  let instrucoes: string | null = null;
  let valor: number | undefined = Number(velho.amount);
  if (velho.kind === 'boleto' && velho.face_value != null && boletoVencido(velho.due_date, todayBR())) {
    if (velho.group_request_id) {
      const { data: g } = await admin.from('asst_group_requests').select('data').eq('id', velho.group_request_id).maybeSingle();
      instrucoes = g?.data?.texto ?? g?.data?.extraido?.texto ?? null;
    }
    if (encargosAtraso(Number(velho.face_value), velho.due_date, todayBR(), instrucoes)) valor = undefined;
  }
  // deno-lint-ignore no-explicit-any
  let novo: any;
  try {
    novo = await preparePayment(admin, tenantId, {
      tipo: velho.kind,
      linha: velho.digitavel ?? undefined,
      chave: velho.pix_key ?? undefined,
      copia_e_cola: velho.pix_copia_e_cola ?? undefined,
      valor,
      instrucoes: instrucoes ?? undefined,
      descricao: velho.description ?? undefined,
      bill_id: velho.bill_id ?? undefined,
      conferido: conferido || undefined,
      requested_by: velho.requested_by ?? undefined,
      channel: velho.channel ?? 'assistente',
      chat_id: velho.chat_id ?? undefined,
    });
  } catch (e) {
    await admin.from('fin_inter_payments').update({ replaced_by: null }).eq('id', velho.id).eq('replaced_by', velho.id);
    throw e;
  }
  await admin.from('fin_inter_payments').update({ replaced_by: novo.id }).eq('id', velho.id);
  if (velho.group_request_id) {
    const { data } = await admin.from('fin_inter_payments')
      .update({ group_request_id: velho.group_request_id }).eq('id', novo.id).select('group_request_id').maybeSingle();
    if (data) novo.group_request_id = data.group_request_id;
  }
  return novo;
}

async function getPayment(admin: Admin, tenantId: string, id: string) {
  const { data: p } = await admin.from('fin_inter_payments').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (!p) throw new Error('Pagamento não encontrado.');
  return p;
}

async function executePayment(admin: Admin, tenantId: string, id: string) {
  const p0 = await getPayment(admin, tenantId, id);
  if (!PAY_OPEN.includes(p0.status)) throw new Error(`Esse pagamento já está "${p0.status}".`);
  if (Date.now() - new Date(p0.created_at).getTime() > DRAFT_TTL_MS) {
    await admin.from('fin_inter_payments').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', id);
    throw new Error('Esse pedido expirou (30 minutos). Peça de novo.');
  }
  // Claim atômico: dois cliques / duas mensagens não enviam 2×
  const { data: p } = await admin.from('fin_inter_payments').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', id).in('status', PAY_OPEN).select('*').maybeSingle();
  if (!p) throw new Error('Esse pagamento já foi enviado.');
  const fail = async (msg: string, status = 'failed') => {
    await admin.from('fin_inter_payments').update({ status, error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', id);
    return new Error(msg);
  };
  // deno-lint-ignore no-explicit-any
  let cfg: any;
  try { cfg = await loadCfg(admin, tenantId); await checkLimits(admin, cfg, tenantId, Number(p.amount), p.id); }
  catch (e) { throw await fail(String((e as Error)?.message ?? e)); }
  let creds: InterCreds = credsOf(cfg);
  let client: HttpClient | null = null;
  let sentToInter = false;
  try {
    const op = await openPay(admin, cfg, tenantId);
    client = op.client; creds = op.creds;
    let token = op.token;
    // dataVencimento é OBRIGATÓRIO no POST /banking/v2/pagamento. Conta de consumo (convênio, código
    // que começa com 8) não traz a data no código: o 1º boleto desses (Claro, 2026-09-18) voltou 400.
    // Sem data no código: a da conta a pagar, a que a leitura da foto do grupo extraiu, ou hoje.
    let vencimento: string | null = p.due_date ?? null;
    if (p.kind === 'boleto' && !vencimento) {
      const iso = (x: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(String(x ?? '')) ? String(x).slice(0, 10) : null);
      if (p.bill_id) {
        const { data: b } = await admin.from('fin_accounts_payable').select('due_date').eq('id', p.bill_id).maybeSingle();
        vencimento = iso(b?.due_date);
      }
      if (!vencimento && p.group_request_id) {
        const { data: g } = await admin.from('asst_group_requests').select('data').eq('id', p.group_request_id).maybeSingle();
        vencimento = iso(g?.data?.extraido?.pagamento?.vencimento);
      }
      vencimento = vencimento ?? todayBR();
    }
    const send = async (tk: string) => {
      sentToInter = true;
      if (p.kind === 'boleto') {
        const body: Record<string, unknown> = { codBarraLinhaDigitavel: p.digitavel || p.barcode, valorPagar: Number(p.amount), dataPagamento: todayBR(), dataVencimento: vencimento };
        return await interFetch(creds, client!, '/banking/v2/pagamento', { method: 'POST', token: tk, headers: { 'Content-Type': 'application/json', 'x-id-idempotente': p.idempotency_key }, body: JSON.stringify(body) });
      }
      const destinatario = p.pix_copia_e_cola ? { tipo: 'PIX_COPIA_E_COLA', pixCopiaECola: p.pix_copia_e_cola } : { tipo: 'CHAVE', chave: p.pix_key };
      const body: Record<string, unknown> = { valor: Number(p.amount), destinatario };
      if (p.description) body.descricao = String(p.description).slice(0, 140);
      const pixPost = (b: Record<string, unknown>) => interFetch(creds, client!, '/banking/v2/pix', { method: 'POST', token: tk, headers: { 'Content-Type': 'application/json', 'x-id-idempotente': p.idempotency_key }, body: JSON.stringify(b) });
      const r1 = await pixPost(body);
      // O nome do tipo do copia e cola não está na documentação pública (o SDK do Inter deixa livre).
      // 400 = recusado sem mover dinheiro: tenta uma vez a outra grafia antes de desistir.
      if (p.pix_copia_e_cola && r1.status === 400) {
        log('WARN', 'execute_payment', 'copia e cola 400, tentando COPIA_E_COLA', { id, data: r1.data });
        return await pixPost({ ...body, destinatario: { tipo: 'COPIA_E_COLA', pixCopiaECola: p.pix_copia_e_cola } });
      }
      return r1;
    };
    let r = await send(token);
    if (r.status === 401) {
      try { client?.close?.(); } catch { /* noop */ }
      const op2 = await openPay(admin, cfg, tenantId, true);
      client = op2.client; creds = op2.creds; token = op2.token;
      r = await send(token);
    }
    if (!r.ok) {
      let msg = providerError(r, p.kind === 'boleto' ? 'Pagamento do boleto' : 'Pix');
      // O Inter só diz "Valor a pagar" inválido; o motivo quase sempre é o boleto vencido.
      if (p.kind === 'boleto' && /valor/i.test(msg) && boletoVencido(p.due_date, todayBR())) {
        msg += `. Boleto vencido: o Inter exige o valor atualizado (multa + juros). Confira o valor no app do Inter ao ler o código e peça de novo com ele.`;
      }
      // Resposta crua guardada: a recusa não move dinheiro, e sem ela não dá para saber o que o Inter quis.
      log('WARN', 'execute_payment', 'recusado', { id, status: r.status, data: r.data ?? r.raw?.slice(0, 1000), enviado: p.kind === 'boleto' ? { valorPagar: Number(p.amount), dataVencimento: vencimento } : undefined });
      await admin.from('fin_inter_payments').update({ response: r.data ?? { raw: r.raw?.slice(0, 2000) ?? null } }).eq('id', id);
      throw await fail(msg, 'rejected');
    }
    const raw = p.kind === 'boleto' ? (r.data?.statusPagamento ?? r.data?.status) : (r.data?.tipoRetorno ?? r.data?.status);
    const code = p.kind === 'boleto' ? (r.data?.codigoTransacao ?? r.data?.codigoSolicitacao) : (r.data?.codigoSolicitacao ?? r.data?.endToEndId);
    const status = mapPayStatus(raw);
    const now = new Date().toISOString();
    const { data: upd } = await admin.from('fin_inter_payments').update({
      status, inter_code: code ? String(code) : null, inter_status: raw ? String(raw) : null, response: r.data ?? null, error: null,
      sent_at: now, paid_at: status === 'paid' ? now : null, updated_at: now,
    }).eq('id', id).select('*').single();
    log('INFO', 'execute_payment', 'ok', { tenantId, id, kind: p.kind, amount: p.amount, status, raw });
    return upd;
  } catch (e) {
    const cur = await getPayment(admin, tenantId, id).catch(() => null);
    if (cur?.status === 'sending') {
      await fail(sentToInter
        ? `${friendlyError(e)} — não sei se o Inter recebeu: confira no app antes de tentar de novo.`
        : friendlyError(e));
      if (sentToInter) await admin.from('fin_inter_payments').update({ inter_status: INCERTO }).eq('id', id);
    }
    throw e instanceof Error ? e : new Error(String(e));
  } finally { try { client?.close?.(); } catch { /* noop */ } }
}

async function refreshPayment(admin: Admin, tenantId: string, id: string) {
  const p = await getPayment(admin, tenantId, id);
  if (!p.inter_code || ['cancelled', 'rejected', 'failed', 'expired', 'draft', 'awaiting_pin'].includes(p.status)) return p;
  const cfg = await loadCfg(admin, tenantId);
  let client: HttpClient | null = null;
  try {
    const op = await openPay(admin, cfg, tenantId);
    client = op.client;
    const creds = op.creds;
    const token = op.token;
    let raw: unknown = null;
    let data: unknown = null;
    if (p.kind === 'pix') {
      const r = await interFetch(creds, client, `/banking/v2/pix/${encodeURIComponent(p.inter_code)}`, { token });
      if (!r.ok) throw new Error(providerError(r, 'Status do Pix'));
      data = r.data; raw = r.data?.transacaoPix?.status ?? r.data?.status ?? r.data?.tipoRetorno;
    } else {
      // A consulta com dataFim 90 dias no FUTURO voltava 400 ("não respeita o schema") — o 1º boleto
      // (Claro, 2026-09-18) foi aprovado no app e o ERPOS nunca soube. Agora a janela termina hoje
      // (horário de Brasília) e tenta variações até uma ser aceita; a última falha vai para o log.
      const from = addDays(String(p.sent_at ?? p.created_at).slice(0, 10), -1);
      const hoje = todayBR();
      const code = encodeURIComponent(p.inter_code);
      const tentativas = [
        `/banking/v2/pagamento?codigoTransacao=${code}&dataInicio=${from}&dataFim=${hoje}`,
        `/banking/v2/pagamento?dataInicio=${from}&dataFim=${hoje}`,
        `/banking/v2/pagamento?dataInicio=${from}&dataFim=${hoje}&filtrarDataPor=INCLUSAO`,
        `/banking/v2/pagamento?dataInicio=${from}&dataFim=${addDays(hoje, 30)}&filtrarDataPor=VENCIMENTO`,
      ];
      // deno-lint-ignore no-explicit-any
      let r: any = null;
      for (const url of tentativas) {
        r = await interFetch(creds, client, url, { token });
        if (r.ok) break;
        log('WARN', 'payment_status', 'consulta de boleto recusada', { url, status: r.status, body: JSON.stringify(r.data ?? null).slice(0, 300) });
      }
      if (!r.ok) throw new Error(providerError(r, 'Status do pagamento'));
      // deno-lint-ignore no-explicit-any
      const list: any[] = Array.isArray(r.data) ? r.data : (r.data?.pagamentos ?? r.data?.content ?? r.data?.itens ?? []);
      const hit = list.find((x) => String(x?.codigoTransacao ?? x?.codigoSolicitacao ?? '') === String(p.inter_code));
      if (!hit) return p;
      data = hit; raw = hit.statusPagamento ?? hit.status;
    }
    const status = raw ? mapPayStatus(raw) : p.status;
    const now = new Date().toISOString();
    const { data: upd } = await admin.from('fin_inter_payments').update({
      status, inter_status: raw ? String(raw) : p.inter_status, response: data ?? p.response, updated_at: now,
      paid_at: status === 'paid' ? (p.paid_at ?? now) : p.paid_at,
      // Boleto de convênio chega sem recebedor (o código não diz quem é): o Inter devolve o nome.
      // deno-lint-ignore no-explicit-any
      beneficiary_name: p.beneficiary_name ?? ((data as any)?.nomeBeneficiario ? String((data as any).nomeBeneficiario) : null),
    }).eq('id', id).select('*').single();
    return upd;
  } finally { try { client?.close?.(); } catch { /* noop */ } }
}

async function cancelPayment(admin: Admin, tenantId: string, id: string) {
  const p = await getPayment(admin, tenantId, id);
  const now = new Date().toISOString();
  if (PAY_OPEN.includes(p.status)) {
    const { data } = await admin.from('fin_inter_payments').update({ status: 'cancelled', updated_at: now }).eq('id', id).in('status', PAY_OPEN).select('*').maybeSingle();
    return data ?? p;
  }
  if (p.kind !== 'boleto' || !p.inter_code || !['pending_approval', 'scheduled', 'sent', 'approved'].includes(p.status)) throw new Error(`Não dá para cancelar pelo assistente (status "${p.status}"). Use o app do Inter.`);
  const cfg = await loadCfg(admin, tenantId);
  let client: HttpClient | null = null;
  try {
    const op = await openPay(admin, cfg, tenantId);
    client = op.client;
    const creds = op.creds;
    const token = op.token;
    const r = await interFetch(creds, client, `/banking/v2/pagamento/${encodeURIComponent(p.inter_code)}`, { method: 'DELETE', token });
    if (!r.ok) throw new Error(providerError(r, 'Cancelar pagamento'));
    const { data } = await admin.from('fin_inter_payments').update({ status: 'cancelled', inter_status: 'CANCELADO', updated_at: now }).eq('id', id).select('*').single();
    return data;
  } finally { try { client?.close?.(); } catch { /* noop */ } }
}

// Só leitura: descobre qual integração tem os escopos de pagamento e lista os pagamentos.
async function checkPaymentScopes(admin: Admin, tenantId: string) {
  const cfg = await loadCfg(admin, tenantId);
  let client: HttpClient | null = null;
  try {
    // deno-lint-ignore no-explicit-any
    let op: any;
    try { op = await openPay(admin, cfg, tenantId, true); }
    catch (e) { return { ok: false, step: 'token', error: String((e as Error)?.message ?? e) }; }
    client = op.client;
    const today = todayBR();
    const l = await interFetch(op.creds, client!, `/banking/v2/pagamento?dataInicio=${addDays(today, -30)}&dataFim=${addDays(today, 30)}`, { token: op.token });
    // deno-lint-ignore no-explicit-any
    const list: any[] = Array.isArray(l.data) ? l.data : (l.data?.pagamentos ?? l.data?.content ?? []);
    return {
      ok: l.ok, source: op.source, client_id_tail: String(op.creds.client_id).slice(-4), list_status: l.status, list_count: list.length,
      sample: list.slice(0, 3).map((x) => ({ status: x?.statusPagamento ?? x?.status, valor: x?.valorPagar ?? x?.valor, codigo: x?.codigoTransacao, keys: Object.keys(x ?? {}).slice(0, 20) })),
      list_keys: l.data && !Array.isArray(l.data) ? Object.keys(l.data).slice(0, 12) : null,
      error: l.ok ? null : providerError(l, 'Consulta de pagamentos'),
    };
  } finally { try { client?.close?.(); } catch { /* noop */ } }
}

// Testa credenciais: token + saldo de hoje
async function testCreds(creds: InterCreds) {
  let client: HttpClient | null = null;
  try {
    client = makeClient(creds.cert_pem, creds.key_pem);
    const token = await getToken(creds, client);
    const b = await getBalance(creds, client, token, todayBR());
    return { ok: true as const, balance: round2(b.disponivel), raw: b.raw };
  } finally {
    try { client?.close?.(); } catch { /* noop */ }
  }
}

function safeConfig(cfg: any) {
  if (!cfg) return null;
  const cid = String(cfg.client_id ?? '');
  return {
    id: cfg.id, bank_account_id: cfg.bank_account_id, environment: cfg.environment,
    client_id_masked: cid.length > 6 ? `${cid.slice(0, 4)}…${cid.slice(-4)}` : '••••',
    conta_corrente: cfg.conta_corrente, is_active: cfg.is_active, auto_sync: cfg.auto_sync, sync_from: cfg.sync_from,
    has_cert: Boolean(cfg.cert_pem), last_sync_at: cfg.last_sync_at, last_sync_error: cfg.last_sync_error,
    last_balance: cfg.last_balance == null ? null : Number(cfg.last_balance), last_balance_at: cfg.last_balance_at,
    // Pagamentos (sem segredos)
    has_pay_credentials: Boolean(cfg.pay_client_id && cfg.pay_cert_pem),
    pay_client_id_masked: cfg.pay_client_id ? (String(cfg.pay_client_id).length > 6 ? `${String(cfg.pay_client_id).slice(0, 4)}…${String(cfg.pay_client_id).slice(-4)}` : '••••') : null,
    pay_credentials_at: cfg.pay_credentials_at ?? null, pay_source: cfg.pay_source ?? null,
    pay_limit_tx: cfg.pay_limit_tx == null ? null : Number(cfg.pay_limit_tx), pay_limit_day: cfg.pay_limit_day == null ? null : Number(cfg.pay_limit_day),
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || serviceRoleKey.length < 40) return errResp('Server misconfiguration', 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
  const internal = internalKey.length >= 20 && (req.headers.get('x-internal-key') ?? '') === internalKey;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body'); }
  const action = String(body.action ?? '');

  try {
    if (action === 'probe_mtls') {
      if (!internal) return errResp('Unauthorized', 401);
      const steps: Record<string, unknown> = { hasCreateHttpClient: typeof (Deno as any).createHttpClient === 'function', deno: (Deno as any).version ?? null };
      let client: HttpClient | null = null;
      try {
        client = makeClient(normalizePem(body.cert_pem), normalizePem(body.key_pem));
        steps.clientCreated = true;
        const creds: InterCreds = { environment: 'production', client_id: 'probe', client_secret: 'probe', cert_pem: '', key_pem: '' };
        const r = await interFetch(creds, client, '/oauth/v2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
        steps.tokenStatus = r.status; steps.tokenBody = r.raw.slice(0, 300);
      } catch (e) { steps.error = String((e as Error)?.stack ?? e); }
      finally { try { client?.close?.(); } catch { /* noop */ } }
      return json({ success: true, steps });
    }

    if (action === 'sync_all') {
      if (!internal) return errResp('Unauthorized', 401);
      const { data: lojas } = await admin.from('fin_inter_config').select('tenant_id').eq('is_active', true).eq('auto_sync', true);
      const results = [];
      for (const l of lojas ?? []) results.push(await syncTenant(admin, l.tenant_id));
      return json({ success: true, results });
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
    // Financeiro/RH é admin, gerente ou o papel financeiro (spec modulo-financeiro-sem-pdv, 2026-09-20).
    const isManager = internal || isFinanceiroRole(role);

    // ── Pagamentos ──
    const PAY_INTERNAL_ONLY = ['prepare_payment', 'execute_payment', 'cancel_payment', 'decode_boleto'];
    if (PAY_INTERNAL_ONLY.includes(action) && !internal) return errResp('Pagamento pelo Inter só pelo assistente, com botão e PIN.', 403);
    if (['payment_status', 'list_payments', 'check_payment_scopes'].includes(action) && !isManager) return errResp('Apenas admin/gerente', 403);
    // Diagnóstico (interno): pede UM escopo por vez e diz quais a integração do Inter aceita.
    if (action === 'probe_scopes') {
      if (!internal) return errResp('Unauthorized', 401);
      const cfg = await loadCfg(admin, tenantId);
      const cands = await payCandidates(admin, cfg, tenantId);
      const creds = (cands.find((c) => c.source === String(body.source ?? 'extrato')) ?? cands[0]).creds;
      const list: string[] = Array.isArray(body.scopes) && body.scopes.length ? body.scopes.map(String) : [
        'extrato.read', 'pagamento-boleto.read', 'pagamento-boleto.write', 'pagamento-pix.read', 'pagamento-pix.write',
        'pagamento-lote.read', 'pagamento-lote.write', 'pagamento-darf.write', 'boleto-cobranca.read', 'cob.read', 'pix.read',
      ];
      let client: HttpClient | null = null;
      try {
        client = makeClient(creds.cert_pem, creds.key_pem);
        const out: Array<{ scope: string; ok: boolean; status: number; granted?: string | null; error?: string }> = [];
        for (const sc of list) {
          const f = new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, grant_type: 'client_credentials', scope: sc });
          const t = await interFetch(creds, client, '/oauth/v2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
          out.push({ scope: sc, ok: t.ok && !!t.data?.access_token, status: t.status, granted: t.data?.scope ?? null, error: t.ok ? undefined : String(t.data?.error_description ?? t.data?.detail ?? t.raw ?? '').slice(0, 120) });
        }
        return json({ success: true, client_id_tail: String(creds.client_id).slice(-4), results: out });
      } finally { try { client?.close?.(); } catch { /* noop */ } }
    }
    // Pagamento confirmado → extrato do Inter na hora (o débito já aparece e concilia
    // sem esperar a rotina diária). Falha aqui não desfaz nem esconde o pagamento.
    // deno-lint-ignore no-explicit-any
    const syncAfterPayment = async (p: any, before?: string) => {
      if (p?.status !== 'paid' || before === 'paid') return;
      try {
        const r = await syncTenant(admin, tenantId, { days: 2 });
        if ('error' in r) log('WARN', action, 'sync pós-pagamento', { tenantId, error: r.error });
      } catch (e) { log('WARN', action, 'sync pós-pagamento', { tenantId, error: String((e as Error)?.message ?? e) }); }
    };
    try {
      // Só lê o boleto (DVs, valor, vencimento) — o assistente guarda na conta a pagar sem preparar
      // pagamento (2026-09-18). Mesma decodificação do prepare_payment.
      if (action === 'decode_boleto') return json({ success: true, boleto: decodeBoleto(String(body.linha ?? '')) });
      if (action === 'prepare_payment') return json({ success: true, payment: await preparePayment(admin, tenantId, body) });
      if (action === 'reprepare_payment') return json({ success: true, payment: await reparePayment(admin, tenantId, String(body.payment_id ?? ''), body.conferido === true) });
      if (action === 'execute_payment') {
        const payment = await executePayment(admin, tenantId, String(body.payment_id ?? ''));
        await syncAfterPayment(payment);
        return json({ success: true, payment });
      }
      if (action === 'cancel_payment') return json({ success: true, payment: await cancelPayment(admin, tenantId, String(body.payment_id ?? '')) });
      if (action === 'payment_status') {
        const id = String(body.payment_id ?? '');
        const before = (await getPayment(admin, tenantId, id)).status;
        const payment = await refreshPayment(admin, tenantId, id);
        await syncAfterPayment(payment, before);
        return json({ success: true, payment });
      }
      if (action === 'check_payment_scopes') return json({ success: true, ...(await checkPaymentScopes(admin, tenantId)) });
      if (action === 'list_payments') {
        const { data } = await admin.from('fin_inter_payments').select('id, kind, status, amount, due_date, beneficiary_name, pix_key, description, inter_status, error, created_at, sent_at, paid_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(Math.min(Number(body.limit ?? 20), 100));
        return json({ success: true, payments: data ?? [] });
      }
    } catch (e) {
      log('WARN', action, 'pagamento', { tenantId, error: String((e as Error)?.message ?? e) });
      return errResp(friendlyError(e));
    }

    if (action === 'get_config') {
      const { data: cfg } = await admin.from('fin_inter_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      return json({ success: true, config: safeConfig(cfg) });
    }

    // Credencial PRÓPRIA de pagamento (integração do Inter só com os escopos de pagamento).
    // Só grava depois que o Inter entrega um token com os escopos de pagamento para ela.
    if (action === 'save_pay_credentials') {
      if (!isManager) return errResp('Apenas admin/gerente', 403);
      const { data: cfg } = await admin.from('fin_inter_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (!cfg) return errResp('Configure primeiro a integração do extrato (Banco Inter) nesta loja.');
      const pick = (k: string, cur: string) => (String(body[k] ?? '').trim() ? String(body[k]).trim() : (cfg[cur] ?? ''));
      const creds: InterCreds = {
        environment: cfg.environment,
        client_id: pick('client_id', 'pay_client_id'), client_secret: pick('client_secret', 'pay_client_secret'),
        cert_pem: String(body.cert_pem ?? '').trim() ? normalizePem(body.cert_pem) : (cfg.pay_cert_pem ?? ''),
        key_pem: String(body.key_pem ?? '').trim() ? normalizePem(body.key_pem) : (cfg.pay_key_pem ?? ''),
        conta_corrente: String(body.conta_corrente ?? '').trim() || cfg.pay_conta_corrente || cfg.conta_corrente || null,
      };
      if (!creds.client_id || !creds.client_secret) return errResp('Informe o Client ID e o Client Secret da integração de pagamento.');
      if (!/-----BEGIN CERTIFICATE-----/.test(creds.cert_pem)) return errResp('Certificado inválido: carregue o arquivo .crt da integração de pagamento.');
      if (!/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(creds.key_pem)) return errResp('Chave inválida: carregue o arquivo .key da integração de pagamento.');
      let client: HttpClient | null = null;
      try {
        client = makeClient(creds.cert_pem, creds.key_pem);
        const f = new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, grant_type: 'client_credentials', scope: PAY_SCOPE });
        const t = await interFetch(creds, client, '/oauth/v2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
        if (!t.ok || !t.data?.access_token) {
          const d = String(t.data?.error_description ?? t.data?.detail ?? t.raw ?? '').slice(0, 200);
          return errResp(/No registered scope/i.test(d)
            ? 'O Inter aceitou a credencial, mas ela não tem os escopos de pagamento. Em Minhas integrações, confira se Pagamentos (boleto e Pix, leitura e escrita) está marcado nesta integração.'
            : `O Inter recusou a credencial de pagamento (${t.status}). Confira o Client ID, o Client Secret e se o .crt e o .key são desta mesma integração. ${d}`);
        }
        const now = new Date().toISOString();
        const { error } = await admin.from('fin_inter_config').update({
          pay_client_id: creds.client_id, pay_client_secret: creds.client_secret, pay_cert_pem: creds.cert_pem, pay_key_pem: creds.key_pem,
          pay_conta_corrente: String(body.conta_corrente ?? '').trim() || null, pay_credentials_at: now,
          pay_source: 'pagamento', pay_access_token: t.data.access_token, pay_token_expires_at: new Date(Date.now() + 55 * 60_000).toISOString(), updated_at: now,
        }).eq('id', cfg.id);
        if (error) return errResp(`Salvar: ${error.message}`, 500);
        log('INFO', 'save_pay_credentials', 'ok', { tenantId, userId, granted: t.data.scope ?? null });
        return json({ success: true, granted_scope: t.data.scope ?? null });
      } catch (e) {
        return errResp(friendlyError(e));
      } finally { try { client?.close?.(); } catch { /* noop */ } }
    }
    // Pix permitidos: gerenciados na tela Assistente (assistente-config), com PIN próprio do dono.
    if (['list_pix_favorecidos', 'add_pix_favorecido', 'remove_pix_favorecido'].includes(action)) {
      return errResp('A lista de Pix permitidos fica na tela Assistente do ERPOS, protegida por PIN.', 403);
    }
    if (action === 'delete_pay_credentials') {
      if (!isManager) return errResp('Apenas admin/gerente', 403);
      await admin.from('fin_inter_config').update({
        pay_client_id: null, pay_client_secret: null, pay_cert_pem: null, pay_key_pem: null, pay_conta_corrente: null, pay_credentials_at: null,
        pay_source: null, pay_access_token: null, pay_token_expires_at: null, updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId);
      return json({ success: true });
    }

    if (action === 'sync') {
      const isoOk = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      if ((body.date_from && !isoOk(body.date_from)) || (body.date_to && !isoOk(body.date_to))) return errResp('Datas inválidas (use AAAA-MM-DD)');
      if (body.date_from && body.date_to && body.date_from > body.date_to) return errResp('A data inicial é depois da final');
      if (body.date_from && daysBetween(body.date_from, body.date_to ?? todayBR()) > 366) return errResp('Máximo de 1 ano por importação');
      const r = await syncTenant(admin, tenantId, {
        days: body.days ? Number(body.days) : undefined,
        date_from: body.date_from || undefined,
        date_to: body.date_to || undefined,
      });
      return json({ success: !('error' in r), ...r });
    }

    if (action === 'delete_config') {
      if (!isManager) return errResp('Apenas admin/gerente', 403);
      const { data: cfg } = await admin.from('fin_inter_config').select('bank_account_id').eq('tenant_id', tenantId).maybeSingle();
      await admin.from('fin_inter_config').delete().eq('tenant_id', tenantId);
      if (cfg?.bank_account_id) await admin.from('fin_bank_accounts').update({ synced_balance: null, synced_balance_at: null, synced_provider: null }).eq('id', cfg.bank_account_id).eq('tenant_id', tenantId);
      return json({ success: true });
    }

    if (action === 'test_config' || action === 'save_config') {
      if (!isManager) return errResp('Apenas admin/gerente', 403);
      const { data: existing } = await admin.from('fin_inter_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      const pick = (k: string) => (String(body[k] ?? '').trim() ? String(body[k]).trim() : (existing?.[k] ?? ''));
      const creds: InterCreds = {
        environment: ['production', 'sandbox'].includes(String(body.environment)) ? String(body.environment) : (existing?.environment ?? 'production'),
        client_id: pick('client_id'), client_secret: pick('client_secret'),
        cert_pem: String(body.cert_pem ?? '').trim() ? normalizePem(body.cert_pem) : (existing?.cert_pem ?? ''),
        key_pem: String(body.key_pem ?? '').trim() ? normalizePem(body.key_pem) : (existing?.key_pem ?? ''),
        conta_corrente: String(body.conta_corrente ?? '').trim() || (body.conta_corrente === '' ? null : existing?.conta_corrente ?? null),
      };
      if (!creds.client_id || !creds.client_secret) return errResp('Informe client_id e client_secret da integração');
      if (!/-----BEGIN CERTIFICATE-----/.test(creds.cert_pem)) return errResp('Certificado inválido: cole o conteúdo do arquivo .crt (começa com -----BEGIN CERTIFICATE-----)');
      if (!/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(creds.key_pem)) return errResp('Chave privada inválida: cole o conteúdo do arquivo .key (começa com -----BEGIN PRIVATE KEY-----)');

      let test;
      try { test = await testCreds(creds); }
      catch (e) { return errResp(friendlyError(e)); }

      if (action === 'test_config') return json({ success: true, balance: test.balance, environment: creds.environment });

      const bankAccountId = String(body.bank_account_id ?? existing?.bank_account_id ?? '');
      if (!bankAccountId) return errResp('Selecione a conta bancária do ERP que representa a conta do Inter');
      const { data: acc } = await admin.from('fin_bank_accounts').select('id').eq('id', bankAccountId).eq('tenant_id', tenantId).maybeSingle();
      if (!acc) return errResp('Conta bancária não encontrada nesta loja');

      const now = new Date().toISOString();
      const rowData: Record<string, unknown> = {
        tenant_id: tenantId, bank_account_id: bankAccountId, environment: creds.environment,
        client_id: creds.client_id, client_secret: creds.client_secret, cert_pem: creds.cert_pem, key_pem: creds.key_pem,
        conta_corrente: creds.conta_corrente, is_active: body.is_active === false ? false : true,
        auto_sync: body.auto_sync === false ? false : true,
        sync_from: /^\d{4}-\d{2}-\d{2}$/.test(String(body.sync_from ?? '')) ? body.sync_from : (existing?.sync_from ?? addDays(todayBR(), -30)),
        last_balance: test.balance, last_balance_at: now, last_balance_raw: test.raw,
        access_token: null, token_expires_at: null, last_sync_error: null, updated_at: now,
        created_by: existing?.created_by ?? userId,
      };
      const { error } = await admin.from('fin_inter_config').upsert(rowData, { onConflict: 'tenant_id' });
      if (error) return errResp(`Salvar: ${error.message}`, 500);
      // Se trocou de conta, limpa o saldo sincronizado da antiga
      if (existing?.bank_account_id && existing.bank_account_id !== bankAccountId) {
        await admin.from('fin_bank_accounts').update({ synced_balance: null, synced_balance_at: null, synced_provider: null }).eq('id', existing.bank_account_id).eq('tenant_id', tenantId);
      }
      await admin.from('fin_bank_accounts').update({ synced_balance: test.balance, synced_balance_at: now, synced_provider: 'inter' }).eq('id', bankAccountId).eq('tenant_id', tenantId);
      log('INFO', 'save_config', 'ok', { tenantId, userId, environment: creds.environment });
      return json({ success: true, balance: test.balance });
    }

    return errResp(`Ação desconhecida: ${action}`);
  } catch (e) {
    log('ERROR', action, 'unhandled', { error: String((e as Error)?.stack ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});
