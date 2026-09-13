// ifood-financial — módulo Financeiro da API do iFood (app DISTRIBUÍDO, uma loja por config).
//
// O que faz: baixa o RELATÓRIO DE CONCILIAÇÃO do mês (o mesmo do Portal do Parceiro ›
// Financeiro › Exportar) e grava cada lançamento em fin_ifood_entries. Com isso:
//   • casa cada depósito do iFood (data_repasse + valor_transacao) com o crédito no Inter
//     (fn_match_ifood_inter → match_kind 'ifood_deposit'; some do "Pix recebido");
//   • opcional (post_to_ledger): lança no livro-razão, por dia de repasse JÁ vencido,
//     a receita (origin ifood_sale) e as comissões/taxas (origin ifood_fee).
//     receita − taxas = soma dos depósitos do dia.
// Sem credencial da API (ou antes da homologação), o arquivo baixado no portal entra
// pelo import_file com o mesmo resultado.
//
// Ações (POST JSON { action, tenant_id, ... }):
//   get_config            {}                                   sem segredos
//   save_config           { client_id, client_secret?, auto_sync? }   admin/gerente (credenciais da API)
//   set_options           { post_to_ledger, auto_sync? }       admin/gerente; relança o razão das importações já gravadas
//   request_user_code     {}                                   gera o código que a loja digita no Portal do Parceiro
//   confirm_authorization { authorization_code }               troca pelo token e descobre a(s) loja(s)
//   select_merchant       { merchant_id }
//   delete_config         {}
//   sync                  { competences?: ['AAAA-MM'] }        padrão: mês atual (+ anterior até o dia 15)
//   import_file           { file_b64, file_name }              .xlsx do portal, .csv ou .csv.gz
//   list_imports          {}
//   sync_all              {}                                   (interno) todas as lojas com auto_sync — cron 07h20
//
// Autenticação: JWT do usuário (membership em user_tenants) OU header x-internal-key = FISCAL_INTERNAL_KEY.
// API: https://merchant-api.ifood.com.br — authentication/v1.0/oauth/{userCode,token}
// (form-urlencoded; distribuído = authorization_code + refresh_token) e
// financial/v3.0/merchants/{merchantId}/reconciliation?competence=AAAA-MM
// (→ [{ downloadPath, createdAt, metadata }], arquivo CSV .gz separado por ';').

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

type Admin = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
const log = (level: string, action: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, fn: 'ifood-financial', action, msg, ...extra }));

const API = 'https://merchant-api.ifood.com.br';
const round2 = (n: number) => Math.round(n * 100) / 100;
const todayBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

// ── API do iFood ─────────────────────────────────────────────────────────────
async function ifoodForm(path: string, form: Record<string, string>) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  const raw = await r.text();
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* texto */ }
  return { ok: r.ok, status: r.status, data, raw };
}
async function ifoodGet(path: string, token: string) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const raw = await r.text();
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* texto */ }
  return { ok: r.ok, status: r.status, data, raw };
}
function apiError(r: { status: number; data: any; raw: string }, what: string) {
  const d = r.data?.error?.message ?? r.data?.message ?? r.data?.error_description ?? r.data?.error ?? r.raw;
  return `${what}: iFood respondeu ${r.status}${d ? ' — ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 200) : ''}`;
}

// Token válido (renova com refresh_token 5 min antes de expirar).
async function getToken(admin: Admin, cfg: any): Promise<string> {
  if (cfg.access_token && cfg.token_expires_at && new Date(cfg.token_expires_at).getTime() - Date.now() > 5 * 60_000) return cfg.access_token;
  if (!cfg.refresh_token) throw new Error('A loja ainda não autorizou o app no Portal do Parceiro (gere o código na configuração do iFood).');
  const r = await ifoodForm('/authentication/v1.0/oauth/token', {
    grantType: 'refresh_token', clientId: cfg.client_id, clientSecret: cfg.client_secret, refreshToken: cfg.refresh_token,
  });
  if (!r.ok || !r.data?.accessToken) throw new Error(apiError(r, 'Renovar acesso'));
  const upd = {
    access_token: r.data.accessToken,
    refresh_token: r.data.refreshToken ?? cfg.refresh_token,
    token_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 21600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await admin.from('fin_ifood_config').update(upd).eq('id', cfg.id);
  Object.assign(cfg, upd);
  return upd.access_token;
}

// ── Leitura do relatório (xlsx do portal, csv ou csv.gz da API) ──────────────
type Row = Record<string, unknown>;

function parseCsv(text: string): Row[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const delim = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (line: string) => {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => { const v = split(l); const o: Row = {}; head.forEach((h, i) => { o[h] = v[i] ?? null; }); return o; });
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readReport(bytes: Uint8Array, fileName: string): Promise<Row[]> {
  let b = bytes;
  if (b[0] === 0x1f && b[1] === 0x8b) b = await gunzip(b); // gzip
  const isZip = b[0] === 0x50 && b[1] === 0x4b; // xlsx = zip
  if (isZip || /\.xlsx?$/i.test(fileName)) {
    const wb = XLSX.read(b, { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
    return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v])));
  }
  return parseCsv(new TextDecoder('utf-8').decode(b));
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const dateOnly = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') { // serial do Excel
    const d = new Date(Math.round((v - 25569) * 86400_000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const tsOrNull = (v: unknown): string | null => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  if (!s || s.startsWith('1969') || s.startsWith('1970')) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null;
};
const str = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());

function toEntry(r: Row) {
  const impacto = String(r['impacto_no_repasse'] ?? 'SIM').trim().toUpperCase();
  return {
    competence: str(r['competencia']),
    fato_gerador: str(r['fato_gerador']),
    tipo_lancamento: str(r['tipo_lancamento']),
    descricao: str(r['descricao_lancamento']),
    valor: num(r['valor']) ?? 0,
    base_calculo: num(r['base_calculo']),
    percentual_taxa: num(r['percentual_taxa']),
    order_id: str(r['pedido_associado_ifood']),
    order_short: str(r['pedido_associado_ifood_curto']),
    order_created_at: tsOrNull(r['data_criacao_pedido_associado']),
    data_repasse: dateOnly(r['data_repasse_esperada']),
    valor_transacao: num(r['valor_transacao']),
    data_apuracao_inicio: dateOnly(r['data_apuracao_inicio']),
    data_apuracao_fim: dateOnly(r['data_apuracao_fim']),
    metodo_pagamento: str(r['metodo_pagamento']),
    bandeira: str(r['bandeira_pagamento']),
    responsavel: str(r['responsavel_transacao']),
    canal: str(r['canal_vendas']),
    impacto_repasse: !impacto.startsWith('N'),
    merchant_id: str(r['loja_id']) ?? str(r['loja_id_curto']),
    merchant_short: str(r['loja_id_curto']),
    raw: r,
  };
}
type Entry = ReturnType<typeof toEntry>;

// Receita = entradas e subsídios que afetam o repasse; taxas = cobranças e retenções.
type LedgerEntry = Pick<Entry, 'data_repasse' | 'valor' | 'tipo_lancamento' | 'impacto_repasse' | 'order_id'>;
const isRevenue = (e: Pick<Entry, 'tipo_lancamento' | 'valor'>) => /entrada|subs[ií]dio/i.test(e.tipo_lancamento ?? '') || (!/cobran|reten/i.test(e.tipo_lancamento ?? '') && e.valor > 0);

// Livro-razão de uma importação: apaga o que ela lançou e relança (se ligado), por dia de
// repasse JÁ vencido — o que ainda vai cair entra quando a data chegar (rotina diária).
async function postLedger(admin: Admin, tenantId: string, importId: string, on: boolean, entries: LedgerEntry[]) {
  const { error: cfErr } = await admin.from('fin_cash_flow').delete().eq('tenant_id', tenantId).eq('reference_id', importId).in('origin', ['ifood_sale', 'ifood_fee']);
  if (cfErr) throw new Error('Limpar lançamentos: ' + cfErr.message);
  if (!on) return { rows: 0, receita: 0, taxas: 0 };
  const today = todayBR();
  const days = new Map<string, { rev: number; fee: number; n: Set<string> }>();
  for (const e of entries) {
    if (!e.impacto_repasse || !e.data_repasse || e.data_repasse > today) continue;
    const d = days.get(e.data_repasse) ?? { rev: 0, fee: 0, n: new Set<string>() };
    if (isRevenue(e)) d.rev += e.valor; else d.fee += -e.valor;
    if (e.order_id) d.n.add(e.order_id);
    days.set(e.data_repasse, d);
  }
  const cf: Record<string, unknown>[] = [];
  for (const [d, x] of days) {
    const dd = d.slice(8, 10) + '/' + d.slice(5, 7);
    if (Math.abs(x.rev) > 0.004) cf.push({ tenant_id: tenantId, reference_id: importId, date: d, type: x.rev > 0 ? 'income' : 'expense', origin: x.rev > 0 ? 'ifood_sale' : 'ifood_fee', category: x.rev > 0 ? 'Vendas' : 'Taxas iFood', amount: round2(Math.abs(x.rev)), description: `Vendas iFood do repasse de ${dd} (${x.n.size} pedido(s), valor antes das taxas)` });
    if (Math.abs(x.fee) > 0.004) cf.push({ tenant_id: tenantId, reference_id: importId, date: d, type: x.fee > 0 ? 'expense' : 'income', origin: x.fee > 0 ? 'ifood_fee' : 'ifood_sale', category: x.fee > 0 ? 'Taxas iFood' : 'Vendas', amount: round2(Math.abs(x.fee)), description: `Comissões e taxas iFood do repasse de ${dd}` });
  }
  if (cf.length > 0) {
    const { error } = await admin.from('fin_cash_flow').insert(cf);
    if (error) throw new Error('Lançar no financeiro: ' + error.message);
  }
  const sum = (o: string) => round2(cf.filter((r) => r.origin === o).reduce((s, r) => s + Number(r.amount), 0));
  return { rows: cf.length, receita: sum('ifood_sale'), taxas: sum('ifood_fee') };
}

// Classifica no extrato do Inter os créditos do iFood do período coberto pelas importações.
async function matchInter(admin: Admin, tenantId: string) {
  const [{ data: lo }, { data: hi }] = await Promise.all([
    admin.from('fin_ifood_entries').select('data_repasse').eq('tenant_id', tenantId).not('data_repasse', 'is', null).order('data_repasse', { ascending: true }).limit(1),
    admin.from('fin_ifood_entries').select('data_repasse').eq('tenant_id', tenantId).not('data_repasse', 'is', null).order('data_repasse', { ascending: false }).limit(1),
  ]);
  const from = lo?.[0]?.data_repasse; const to = hi?.[0]?.data_repasse;
  if (!from || !to) return 0;
  const { data, error } = await admin.rpc('fn_match_ifood_inter', { p_tenant: tenantId, p_from: from, p_to: to });
  if (error) { log('WARN', 'match', 'fn_match_ifood_inter falhou', { tenantId, error: error.message }); return 0; }
  return Number(data ?? 0);
}

// Relança o razão das importações já gravadas (ligar/desligar a opção, repasses que venceram).
async function repostImports(admin: Admin, tenantId: string, on: boolean, minCompetence?: string) {
  let q = admin.from('fin_ifood_imports').select('id, competence').eq('tenant_id', tenantId);
  if (minCompetence) q = q.gte('competence', minCompetence);
  const { data: imps, error } = await q;
  if (error) throw new Error('Ler importações: ' + error.message);
  const tot = { imports: 0, rows: 0, receita: 0, taxas: 0 };
  for (const imp of imps ?? []) {
    const { data: ents, error: eErr } = await admin.from('fin_ifood_entries')
      .select('data_repasse, valor, tipo_lancamento, impacto_repasse, order_id').eq('import_id', imp.id).limit(50000);
    if (eErr) throw new Error('Ler linhas: ' + eErr.message);
    const l = await postLedger(admin, tenantId, imp.id, on, (ents ?? []).map((e: any) => ({ ...e, valor: Number(e.valor) })));
    tot.imports++; tot.rows += l.rows; tot.receita = round2(tot.receita + l.receita); tot.taxas = round2(tot.taxas + l.taxas);
  }
  return { ...tot, matched: await matchInter(admin, tenantId) };
}

async function sha256Hex(bytes: Uint8Array) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Grava uma loja + competência (substitui a anterior da mesma loja), lança no razão e casa com o Inter.
async function saveCompetence(admin: Admin, tenantId: string, cfg: any | null, competence: string, entries: Entry[], meta: { source: 'api' | 'file'; merchant_id: string; file_name?: string | null; sha256?: string | null; userId?: string | null }) {
  const valid = entries.filter((e) => e.data_repasse || e.valor);
  const sig = valid.filter((e) => e.impacto_repasse);
  const gross = round2(sig.filter(isRevenue).reduce((s, e) => s + e.valor, 0));
  const fees = round2(-sig.filter((e) => !isRevenue(e)).reduce((s, e) => s + e.valor, 0));
  const orders = new Set(valid.map((e) => e.order_id).filter(Boolean)).size;
  const now = new Date().toISOString();

  const { data: imp, error: impErr } = await admin.from('fin_ifood_imports').upsert({
    tenant_id: tenantId, merchant_id: meta.merchant_id, merchant_short: valid.find((e) => e.merchant_short)?.merchant_short ?? null,
    competence, source: meta.source, file_name: meta.file_name ?? null, sha256: meta.sha256 ?? null,
    lines: valid.length, orders, gross, fees, net: round2(gross - fees), created_by: meta.userId ?? null, updated_at: now,
  }, { onConflict: 'tenant_id,merchant_id,competence' }).select('id').single();
  if (impErr || !imp) throw new Error('Registrar importação: ' + (impErr?.message ?? 'sem id'));

  const { error: delErr } = await admin.from('fin_ifood_entries').delete().eq('import_id', imp.id);
  if (delErr) throw new Error('Limpar linhas anteriores: ' + delErr.message);
  const rows = valid.map((e) => ({ ...e, competence: e.competence ?? competence, tenant_id: tenantId, import_id: imp.id }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('fin_ifood_entries').insert(rows.slice(i, i + 500));
    if (error) throw new Error('Gravar linhas: ' + error.message);
  }

  const ledger = await postLedger(admin, tenantId, imp.id, cfg?.post_to_ledger === true, valid);
  const matched = await matchInter(admin, tenantId);
  return { competence, import_id: imp.id, lines: valid.length, orders, gross, fees, net: round2(gross - fees), ledger, matched_deposits: matched };
}

// Baixa e grava uma competência pela API.
async function syncCompetence(admin: Admin, cfg: any, competence: string) {
  const token = await getToken(admin, cfg);
  const r = await ifoodGet(`/financial/v3.0/merchants/${encodeURIComponent(cfg.merchant_id)}/reconciliation?competence=${competence}`, token);
  if (r.status === 404) return { competence, skipped: true, reason: 'sem arquivo para a competência' };
  if (!r.ok) throw new Error(apiError(r, `Conciliação ${competence}`));
  const list: any[] = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
  const last = list.filter((x) => x?.downloadPath).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0];
  if (!last) return { competence, skipped: true, reason: 'iFood ainda não gerou o arquivo' };
  const sha = String(last.metadata?.sha256 ?? '');
  const { data: prev } = await admin.from('fin_ifood_imports').select('sha256').eq('tenant_id', cfg.tenant_id).eq('merchant_id', cfg.merchant_id).eq('competence', competence).maybeSingle();
  if (sha && prev?.sha256 === sha) return { competence, unchanged: true };
  const f = await fetch(last.downloadPath);
  if (!f.ok) throw new Error(`Baixar arquivo ${competence}: HTTP ${f.status}`);
  const bytes = new Uint8Array(await f.arrayBuffer());
  const rows = await readReport(bytes, 'reconciliation.csv.gz');
  const entries = rows.map(toEntry).filter((e) => !e.competence || e.competence === competence);
  return await saveCompetence(admin, cfg.tenant_id, cfg, competence, entries, { source: 'api', merchant_id: cfg.merchant_id, sha256: sha || await sha256Hex(bytes) });
}

function defaultCompetences() {
  const t = todayBR();
  const cur = t.slice(0, 7);
  const d = new Date(t + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
  const prev = d.toISOString().slice(0, 7);
  return Number(t.slice(8, 10)) <= 15 ? [prev, cur] : [cur];
}

async function syncTenant(admin: Admin, cfg: any, competences?: string[]) {
  if (!cfg.client_id || !cfg.client_secret) return { tenant_id: cfg.tenant_id, not_configured: true };
  if (!cfg.merchant_id) return { tenant_id: cfg.tenant_id, error: 'A loja ainda não autorizou o app (falta o código no Portal do Parceiro).' };
  const results = [];
  let lastErr: string | null = null;
  for (const c of competences?.length ? competences : defaultCompetences()) {
    try { results.push(await syncCompetence(admin, cfg, c)); }
    catch (e) { lastErr = String((e as Error)?.message ?? e); results.push({ competence: c, error: lastErr }); }
  }
  await admin.from('fin_ifood_config').update({ last_sync_at: new Date().toISOString(), last_sync_error: lastErr, updated_at: new Date().toISOString() }).eq('id', cfg.id);
  return { tenant_id: cfg.tenant_id, results, error: lastErr ?? undefined };
}

function safeConfig(cfg: any) {
  if (!cfg) return null;
  return {
    client_id: cfg.client_id ? String(cfg.client_id).slice(0, 4) + '…' + String(cfg.client_id).slice(-4) : null,
    has_secret: Boolean(cfg.client_secret),
    merchant_id: cfg.merchant_id, merchant_name: cfg.merchant_name,
    authorized: Boolean(cfg.refresh_token), authorized_at: cfg.authorized_at,
    user_code: cfg.user_code_expires_at && new Date(cfg.user_code_expires_at).getTime() > Date.now() ? cfg.user_code : null,
    user_code_expires_at: cfg.user_code_expires_at, verification_url: cfg.verification_url,
    is_active: cfg.is_active, auto_sync: cfg.auto_sync, post_to_ledger: cfg.post_to_ledger,
    last_sync_at: cfg.last_sync_at, last_sync_error: cfg.last_sync_error,
  };
}

Deno.serve(async (req) => {
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
    if (action === 'sync_all') {
      if (!internal) return errResp('Unauthorized', 401);
      const { data: lojas } = await admin.from('fin_ifood_config').select('*').eq('is_active', true);
      const out = [];
      const minComp = defaultCompetences()[0];
      for (const cfg of lojas ?? []) {
        const r: Record<string, unknown> = { tenant_id: cfg.tenant_id };
        try {
          if (cfg.auto_sync !== false && cfg.refresh_token && cfg.merchant_id) r.sync = await syncTenant(admin, cfg);
          // Arquivo importado à mão também: repasses que venceram desde ontem entram no razão.
          if (cfg.post_to_ledger) r.ledger = await repostImports(admin, cfg.tenant_id, true, minComp);
        } catch (e) { r.error = String((e as Error)?.message ?? e); }
        out.push(r);
      }
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
    const { data: cfg } = await admin.from('fin_ifood_config').select('*').eq('tenant_id', tenantId).maybeSingle();

    if (action === 'get_config') return json({ success: true, config: safeConfig(cfg) });

    if (action === 'list_imports') {
      const { data } = await admin.from('fin_ifood_imports').select('id, merchant_id, merchant_short, competence, source, file_name, lines, orders, gross, fees, net, updated_at').eq('tenant_id', tenantId).order('competence', { ascending: false }).limit(48);
      return json({ success: true, imports: data ?? [] });
    }

    if (action === 'sync') {
      if (!cfg || !cfg.client_id) return json({ success: false, not_configured: true });
      if (!cfg.refresh_token || !cfg.merchant_id) return json({ success: true, skipped: true });
      if (!cfg.is_active || cfg.auto_sync === false) return json({ success: true, skipped: true });
      const comps = Array.isArray(body.competences) ? body.competences.map(String).filter((c: string) => /^\d{4}-\d{2}$/.test(c)).slice(0, 12) : undefined;
      const r = await syncTenant(admin, cfg, comps);
      const inserted = (r.results ?? []).reduce((s: number, x: any) => s + Number(x.lines ?? 0), 0);
      return json({ success: !r.error, inserted, ...r });
    }

    if (action === 'import_file') {
      if (!isManager) return errResp('Apenas admin/gerente', 403);
      const b64 = String(body.file_b64 ?? '');
      if (!b64) return errResp('Envie o arquivo do relatório de conciliação.');
      if (b64.length > 14_000_000) return errResp('Arquivo muito grande (máx. 10 MB).');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const fileName = String(body.file_name ?? 'relatorio.xlsx');
      let rows: Row[];
      try { rows = await readReport(bytes, fileName); }
      catch (e) { return errResp('Não consegui ler o arquivo: ' + String((e as Error)?.message ?? e).slice(0, 150)); }
      if (rows.length === 0 || !('valor' in rows[0]) || !('data_repasse_esperada' in rows[0])) {
        return errResp('Esse arquivo não parece o "Relatório de Conciliação" do iFood (faltam as colunas valor e data_repasse_esperada).');
      }
      const entries = rows.map(toEntry);
      // Uma importação por loja + competência (o arquivo pode ter mais de uma loja).
      const groups = new Map<string, { merchant: string; competence: string; list: Entry[] }>();
      for (const e of entries) {
        const c = e.competence && /^\d{4}-\d{2}$/.test(e.competence) ? e.competence : (e.data_repasse ?? '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(c)) continue;
        const m = e.merchant_id ?? '';
        const k = `${m}|${c}`;
        const g = groups.get(k) ?? { merchant: m, competence: c, list: [] };
        g.list.push(e);
        groups.set(k, g);
      }
      if (groups.size === 0) return errResp('Nenhuma linha com competência válida no arquivo.');
      const sha = await sha256Hex(bytes);
      const results = [];
      for (const g of groups.values()) results.push({ merchant_short: g.list.find((e) => e.merchant_short)?.merchant_short ?? null, ...(await saveCompetence(admin, tenantId, cfg, g.competence, g.list, { source: 'file', merchant_id: g.merchant, file_name: fileName, sha256: sha, userId })) });
      log('INFO', 'import_file', 'ok', { tenantId, fileName, groups: [...groups.keys()] });
      return json({ success: true, results });
    }

    // ── Configuração ──
    if (!isManager) return errResp('Apenas admin/gerente', 403);

    // Opções que não dependem da API (vale para quem só importa o arquivo do portal).
    if (action === 'set_options') {
      const on = body.post_to_ledger === true;
      const row: Record<string, unknown> = {
        tenant_id: tenantId, post_to_ledger: on,
        auto_sync: body.auto_sync === undefined ? (cfg?.auto_sync ?? true) : body.auto_sync !== false,
        is_active: true, updated_at: new Date().toISOString(),
      };
      if (!cfg) row.created_by = userId;
      const { error } = await admin.from('fin_ifood_config').upsert(row, { onConflict: 'tenant_id' });
      if (error) return errResp('Salvar: ' + error.message, 500);
      const ledger = await repostImports(admin, tenantId, on);
      return json({ success: true, ledger });
    }

    if (action === 'save_config') {
      const clientId = String(body.client_id ?? '').trim();
      const clientSecret = String(body.client_secret ?? '').trim();
      if (!clientId) return errResp('Informe o Client ID do aplicativo do iFood.');
      if (!clientSecret && !cfg?.client_secret) return errResp('Informe o Client Secret do aplicativo do iFood.');
      const changedApp = cfg && cfg.client_id !== clientId;
      const now = new Date().toISOString();
      const row: Record<string, unknown> = {
        tenant_id: tenantId, client_id: clientId, client_secret: clientSecret || cfg?.client_secret,
        auto_sync: body.auto_sync === false ? false : true,
        is_active: true, updated_at: now,
      };
      if (!cfg) { row.created_by = userId; }
      if (changedApp) Object.assign(row, { access_token: null, refresh_token: null, token_expires_at: null, merchant_id: null, merchant_name: null, authorized_at: null, user_code: null, auth_verifier_secret: null });
      const { error } = await admin.from('fin_ifood_config').upsert(row, { onConflict: 'tenant_id' });
      if (error) return errResp('Salvar: ' + error.message, 500);
      return json({ success: true, message: changedApp || !cfg?.refresh_token ? 'Credenciais salvas. Agora gere o código e autorize no Portal do Parceiro.' : 'Configuração salva.' });
    }

    if (action === 'request_user_code') {
      if (!cfg?.client_id) return errResp('Salve primeiro o Client ID e o Client Secret.');
      const r = await ifoodForm('/authentication/v1.0/oauth/userCode', { clientId: cfg.client_id });
      if (!r.ok || !r.data?.userCode) return errResp(apiError(r, 'Gerar código'));
      await admin.from('fin_ifood_config').update({
        user_code: r.data.userCode, auth_verifier_secret: r.data.authorizationCodeVerifier,
        verification_url: r.data.verificationUrlComplete ?? r.data.verificationUrl ?? null,
        user_code_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 600) * 1000).toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', cfg.id);
      return json({ success: true, user_code: r.data.userCode, verification_url: r.data.verificationUrlComplete ?? r.data.verificationUrl ?? null, expires_in: r.data.expiresIn ?? null });
    }

    if (action === 'confirm_authorization') {
      const code = String(body.authorization_code ?? '').trim();
      if (!cfg?.client_id || !cfg.client_secret) return errResp('Salve primeiro as credenciais.');
      if (!cfg.auth_verifier_secret) return errResp('Gere o código de vínculo antes.');
      if (!code) return errResp('Cole o código de autorização que o Portal do Parceiro mostrou.');
      const r = await ifoodForm('/authentication/v1.0/oauth/token', {
        grantType: 'authorization_code', clientId: cfg.client_id, clientSecret: cfg.client_secret,
        authorizationCode: code, authorizationCodeVerifier: cfg.auth_verifier_secret,
      });
      if (!r.ok || !r.data?.accessToken) return errResp(apiError(r, 'Autorizar'));
      const access = r.data.accessToken as string;
      const upd: Record<string, unknown> = {
        access_token: access, refresh_token: r.data.refreshToken ?? null,
        token_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 21600) * 1000).toISOString(),
        authorized_at: new Date().toISOString(), user_code: null, auth_verifier_secret: null, updated_at: new Date().toISOString(),
      };
      const m = await ifoodGet('/merchant/v1.0/merchants', access);
      const merchants = (Array.isArray(m.data) ? m.data : []).map((x: any) => ({ id: String(x.id), name: String(x.name ?? x.corporateName ?? x.id) }));
      if (merchants.length === 1) { upd.merchant_id = merchants[0].id; upd.merchant_name = merchants[0].name; }
      await admin.from('fin_ifood_config').update(upd).eq('id', cfg.id);
      if (!r.data.refreshToken) log('WARN', 'confirm_authorization', 'token sem refreshToken', { tenantId });
      return json({ success: true, merchants, merchant_id: upd.merchant_id ?? null });
    }

    if (action === 'select_merchant') {
      const id = String(body.merchant_id ?? '').trim();
      if (!cfg || !id) return errResp('Escolha a loja.');
      await admin.from('fin_ifood_config').update({ merchant_id: id, merchant_name: String(body.merchant_name ?? '') || null, updated_at: new Date().toISOString() }).eq('id', cfg.id);
      return json({ success: true });
    }

    if (action === 'delete_config') {
      await admin.from('fin_ifood_config').delete().eq('tenant_id', tenantId);
      return json({ success: true });
    }

    return errResp(`Ação desconhecida: ${action}`);
  } catch (e) {
    log('ERROR', action, 'falha', { error: String((e as Error)?.stack ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});
