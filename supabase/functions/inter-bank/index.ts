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
//   sync_all       {}                              (interno) todas as lojas com auto_sync — sem cron: o front chama `sync` ao abrir a Conciliação
//   probe_mtls     { cert_pem, key_pem }           (interno) diagnóstico do suporte a mTLS no runtime
//
// Autenticação: JWT do usuário (membership em user_tenants) OU chamada interna
// (outra função) com header x-internal-key = FISCAL_INTERNAL_KEY.
//
// API do Inter: OAuth2 client_credentials em /oauth/v2/token (escopo extrato.read),
// TODA chamada exige o certificado mTLS emitido no Internet Banking PJ
// ("Soluções para sua empresa › Nova integração"). Extrato: máx. 90 dias por consulta.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

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
  const detail = d?.detail ?? d?.message ?? d?.error_description ?? d?.error ?? d?.title
    ?? (Array.isArray(d?.violacoes) ? d.violacoes.map((v: any) => v.razao ?? v.propriedade).join('; ') : null)
    ?? (r.raw ? r.raw.slice(0, 200) : '');
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

async function getToken(creds: InterCreds, client: HttpClient): Promise<string> {
  const body = new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, grant_type: 'client_credentials', scope: SCOPE });
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
async function syncTenant(admin: Admin, tenantId: string, opts: { days?: number } = {}) {
  const action = 'sync';
  const { data: cfg } = await admin.from('fin_inter_config').select('*').eq('tenant_id', tenantId).maybeSingle();
  if (!cfg) return { tenant_id: tenantId, error: 'Banco Inter não configurado nesta loja' };
  if (!cfg.is_active) return { tenant_id: tenantId, error: 'Integração com o Inter desativada' };
  if (!cfg.bank_account_id) return { tenant_id: tenantId, error: 'Configure a conta bancária do ERP que representa a conta do Inter' };

  const creds: InterCreds = { environment: cfg.environment, client_id: cfg.client_id, client_secret: cfg.client_secret, cert_pem: cfg.cert_pem, key_pem: cfg.key_pem, conta_corrente: cfg.conta_corrente };
  const today = todayBR();
  let from: string;
  if (opts.days && opts.days > 0) from = addDays(today, -Math.min(opts.days, 365));
  else if (cfg.last_sync_at) from = addDays(String(cfg.last_sync_at).slice(0, 10), -MATCH_DAYS);
  else from = String(cfg.sync_from ?? addDays(today, -30));
  if (from < String(cfg.sync_from ?? from)) from = String(cfg.sync_from);
  if (from > today) from = today;

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
    while (cursor <= today) {
      const end = daysBetween(cursor, today) > MAX_WINDOW_DAYS ? addDays(cursor, MAX_WINDOW_DAYS) : today;
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
      const { data: si, error: siErr } = await admin.rpc('fn_match_stone_inter', { p_tenant: tenantId, p_from: addDays(today, -20), p_to: today });
      if (siErr) log('WARN', action, 'fn_match_stone_inter falhou', { tenantId, error: siErr.message });
      else if (si) log('INFO', action, 'stone×inter', { tenantId, ...(si as Record<string, unknown>) });
    } catch (e) {
      log('WARN', action, 'fn_match_stone_inter falhou', { tenantId, error: String(e) });
    }

    // Pagamentos × notas de entrada / contas a pagar: só SUGERE (a baixa é confirmada pelo usuário).
    try {
      const { data: mp, error: mpErr } = await admin.rpc('fn_match_payments', { p_tenant: tenantId, p_from: addDays(today, -120), p_to: today });
      if (mpErr) log('WARN', action, 'fn_match_payments falhou', { tenantId, error: mpErr.message });
      else if (mp) log('INFO', action, 'pagamentos×notas', { tenantId, ...(mp as Record<string, unknown>) });
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

    await admin.from('fin_inter_config').update({ last_sync_at: new Date().toISOString(), last_sync_error: null, updated_at: new Date().toISOString() }).eq('id', cfg.id);
    log('INFO', action, 'ok', { tenantId, from, to: today, fetched: txs.length, inserted: inserted.length, matched, classified, balance });
    return { tenant_id: tenantId, from, to: today, fetched: txs.length, inserted: inserted.length, matched, classified, balance };
  } catch (e) {
    const msg = friendlyError(e);
    log('ERROR', action, 'falhou', { tenantId, error: msg });
    await admin.from('fin_inter_config').update({ last_sync_error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', cfg.id);
    return { tenant_id: tenantId, error: msg };
  } finally {
    try { client?.close?.(); } catch { /* noop */ }
  }
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
    const isManager = internal || role === 'admin' || role === 'manager';

    if (action === 'get_config') {
      const { data: cfg } = await admin.from('fin_inter_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      return json({ success: true, config: safeConfig(cfg) });
    }

    if (action === 'sync') {
      const r = await syncTenant(admin, tenantId, { days: body.days ? Number(body.days) : undefined });
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
