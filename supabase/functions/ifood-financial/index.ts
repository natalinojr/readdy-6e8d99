// ifood-financial — módulo Financeiro da API do iFood (app DISTRIBUÍDO; várias lojas do iFood por loja do ERPOS).
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
//   set_merchant_api      { merchant_id, on }                  liga/desliga a busca pela API de uma loja do iFood
//                         (fin_ifood_merchants.api_sync; tokens por autorização em fin_ifood_auths)
//   delete_config         {}
//   sync                  { competences?: ['AAAA-MM'] }        padrão: mês atual (+ anterior até o dia 15)
//   import_file           { file_b64, file_name }              .xlsx do portal, .csv ou .csv.gz
//   request_ondemand      { competence }                       POST reconciliation/on-demand (409 → reutiliza o requestId)
//   ondemand_status       { request_id }                       GET do pedido; pronto → baixa e importa o arquivo
//   (a busca diária também grava Sales, Financial Events, Settlements e Anticipations em fin_ifood_*)
//   homologation_mode (set_options) → header x-request-homologation: true em toda chamada (ambiente de teste)
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
import { isFinanceiroRole } from '../_shared/tenant-auth.ts';

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
// Toda chamada: header de homologação (ambiente de teste, exigido na homologação) e
// retentativa com backoff exponencial em 429/5xx (respeita Retry-After).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ifoodFetch(path: string, init: RequestInit, homolog: boolean) {
  const headers = new Headers(init.headers);
  if (homolog) headers.set('x-request-homologation', 'true');
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API + path, { ...init, headers });
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      const ra = Number(r.headers.get('retry-after'));
      await sleep(ra > 0 ? Math.min(ra * 1000, 15_000) : Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250);
      continue;
    }
    const raw = await r.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { /* texto */ }
    return { ok: r.ok, status: r.status, data, raw };
  }
}
const ifoodForm = (path: string, form: Record<string, string>, homolog = false) =>
  ifoodFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }, homolog);
const ifoodGet = (path: string, token: string, homolog = false) =>
  ifoodFetch(path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, homolog);
const ifoodPostJson = (path: string, token: string, body: unknown, homolog = false) =>
  ifoodFetch(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, homolog);
function apiError(r: { status: number; data: any; raw: string }, what: string) {
  const d = r.data?.error?.message ?? r.data?.message ?? r.data?.error_description ?? r.data?.error ?? r.raw;
  return `${what}: iFood respondeu ${r.status}${d ? ' — ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 200) : ''}`;
}

// Token válido (renova com refresh_token 5 min antes de expirar).
// O token mora em `cfg._tok`: uma linha de fin_ifood_auths (distribuído — cada autorização no Portal do
// Parceiro tem o seu) ou a própria fin_ifood_config (centralizado, client_credentials).
async function getToken(admin: Admin, cfg: any): Promise<string> {
  const t = cfg._tok ?? cfg;
  if (t.access_token && t.token_expires_at && new Date(t.token_expires_at).getTime() - Date.now() > 5 * 60_000) return t.access_token;
  const centralized = cfg.app_type === 'centralized';
  if (!centralized && !t.refresh_token) throw new Error('A loja ainda não autorizou o app no Portal do Parceiro (gere o código na configuração do iFood).');
  const r = await ifoodForm('/authentication/v1.0/oauth/token', centralized
    ? { grantType: 'client_credentials', clientId: cfg.client_id, clientSecret: cfg.client_secret }
    : { grantType: 'refresh_token', clientId: cfg.client_id, clientSecret: cfg.client_secret, refreshToken: t.refresh_token },
  cfg.homologation_mode === true);
  if (!r.ok || !r.data?.accessToken) throw new Error(apiError(r, 'Renovar acesso'));
  const upd = {
    access_token: r.data.accessToken,
    refresh_token: r.data.refreshToken ?? t.refresh_token,
    token_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 21600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (cfg._tok?.auth_id) await admin.from('fin_ifood_auths').update(upd).eq('id', cfg._tok.auth_id);
  else await admin.from('fin_ifood_config').update(upd).eq('id', cfg.id);
  Object.assign(t, upd);
  return upd.access_token;
}

// Lojas do iFood que esta loja do ERPOS busca pela API, cada uma com o token que a enxerga
// (a autorização mais recente que lista a loja). `ctx` = cfg + merchant_id + _tok.
type MerchantCtx = { merchant_id: string; name: string | null; ctx: any | null; error?: string };
async function merchantContexts(admin: Admin, cfg: any): Promise<MerchantCtx[]> {
  if (!cfg?.client_id || !cfg.client_secret) return [];
  const { data: ms } = await admin.from('fin_ifood_merchants').select('merchant_id, name').eq('tenant_id', cfg.tenant_id).eq('api_sync', true).order('name');
  if (!ms?.length) return [];
  if (cfg.app_type === 'centralized') {
    const tok = cfg; // token compartilhado, gravado na config
    return ms.map((m) => ({ merchant_id: m.merchant_id, name: m.name, ctx: { ...cfg, merchant_id: m.merchant_id, _tok: tok } }));
  }
  const { data: auths } = await admin.from('fin_ifood_auths').select('*').eq('tenant_id', cfg.tenant_id).order('authorized_at', { ascending: false });
  const toks = new Map<string, any>();
  return ms.map((m) => {
    const a = (auths ?? []).find((x) => (x.merchant_ids ?? []).includes(m.merchant_id));
    if (!a) return { merchant_id: m.merchant_id, name: m.name, ctx: null, error: 'Loja sem autorização no Portal do Parceiro (gere um código e autorize esta loja).' };
    if (!toks.has(a.id)) toks.set(a.id, { auth_id: a.id, access_token: a.access_token, refresh_token: a.refresh_token, token_expires_at: a.token_expires_at });
    return { merchant_id: m.merchant_id, name: m.name, ctx: { ...cfg, merchant_id: m.merchant_id, _tok: toks.get(a.id) } };
  });
}

// Liga a busca pela API das lojas recém-autorizadas: só as que já são desta loja do ERPOS (vieram
// no arquivo/importação) ou quando a autorização trouxe uma loja só — e nunca uma loja que outra
// loja do ERPOS já busca. As demais aparecem na lista para o gerente ligar à mão.
async function autoEnableMerchants(admin: Admin, tenantId: string, merchants: { id: string; name: string }[]) {
  if (merchants.length === 0) return;
  const now = new Date().toISOString();
  const ids = merchants.map((m) => m.id);
  const { data: known } = await admin.from('fin_ifood_merchants').select('merchant_id').eq('tenant_id', tenantId).in('merchant_id', ids);
  const { data: taken } = await admin.from('fin_ifood_merchants').select('merchant_id').neq('tenant_id', tenantId).eq('api_sync', true).in('merchant_id', ids);
  const knownSet = new Set((known ?? []).map((k) => k.merchant_id));
  const takenSet = new Set((taken ?? []).map((k) => k.merchant_id));
  await admin.from('fin_ifood_merchants').upsert(merchants.map((m) => ({ tenant_id: tenantId, merchant_id: m.id, name: m.name, updated_at: now })), { onConflict: 'tenant_id,merchant_id' });
  const on = merchants.filter((m) => !takenSet.has(m.id) && (knownSet.has(m.id) || merchants.length === 1)).map((m) => m.id);
  if (on.length) await admin.from('fin_ifood_merchants').update({ api_sync: true, updated_at: now }).eq('tenant_id', tenantId).in('merchant_id', on);
}

// GET/POST autenticados: 401 → força renovação do token e tenta uma vez mais.
async function apiGet(admin: Admin, cfg: any, path: string) {
  let r = await ifoodGet(path, await getToken(admin, cfg), cfg.homologation_mode === true);
  if (r.status === 401) { cfg.token_expires_at = null; r = await ifoodGet(path, await getToken(admin, cfg), cfg.homologation_mode === true); }
  return r;
}
async function apiPost(admin: Admin, cfg: any, path: string, body: unknown) {
  let r = await ifoodPostJson(path, await getToken(admin, cfg), body, cfg.homologation_mode === true);
  if (r.status === 401) { cfg.token_expires_at = null; r = await ifoodPostJson(path, await getToken(admin, cfg), body, cfg.homologation_mode === true); }
  return r;
}
const finPath = (cfg: any, rest: string) => `/financial/v3.0/merchants/${encodeURIComponent(cfg.merchant_id)}${rest}`;

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
    // Data do relatório. data_repasse vira a efetiva (antecipada) em saveCompetence quando a loja antecipa.
    data_repasse_original: dateOnly(r['data_repasse_esperada']),
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
type LedgerEntry = Pick<Entry, 'data_repasse' | 'valor' | 'tipo_lancamento' | 'impacto_repasse' | 'order_id' | 'descricao' | 'responsavel'>;

// Mesma divisão do Portal do Parceiro (Financeiro › Faturamento). Conferido com ago/26 (3189551):
// vendas 9.201,06 − taxas 1.660,03 − serviços 849,50 + ajustes 72,22 = faturamento 6.763,75;
// − recebido direto pela loja 1.757,80 = repasses 5.005,95.
//   vendas   = Entrada Financeira (iFood e loja) + subsídio iFood/indústria + retenções (taxa de entrega e
//              de serviço cobradas do cliente, parcelamento) + promoção da loja somada de volta
//   taxas    = cobranças de comissão, taxa de transação e mensalidade do plano
//   serviços = demais cobranças (entrega sob demanda) + promoção custeada pela loja
//   ajustes  = ressarcimentos, débitos de ocorrência e outros tipos
//   loja     = Entrada Financeira FORA do repasse (impacto_no_repasse = NÃO: pago direto à loja).
//              Não usar o responsável: em jun/26 há Entrada com responsável LOJA que entra no repasse.
// Com isso repasses = soma das linhas com impacto no repasse, sempre.
type PortalEntry = Pick<Entry, 'tipo_lancamento' | 'descricao' | 'responsavel' | 'valor' | 'impacto_repasse'>;
function portalBucket(e: PortalEntry) {
  const t = (e.tipo_lancamento ?? '').toLowerCase();
  const d = (e.descricao ?? '').toLowerCase();
  const v = e.valor;
  const z = { vendas: 0, taxas: 0, servicos: 0, ajustes: 0, loja: 0 };
  if (t.includes('entrada')) { z.vendas = v; if (!e.impacto_repasse) z.loja = v; }
  else if (t.includes('subs')) { if (/custeada pela loja/.test(d)) { z.vendas = -v; z.servicos = -v; } else z.vendas = v; }
  else if (t.includes('reten')) z.vendas = v;
  else if (t.includes('cobran')) { if (/comiss|transa|mensalidade/.test(d)) z.taxas = -v; else z.servicos = -v; }
  else z.ajustes = v;
  return z;
}
function portalTotals(list: PortalEntry[]) {
  const z = { vendas: 0, taxas: 0, servicos: 0, ajustes: 0, loja: 0 };
  for (const e of list) { const b = portalBucket(e); z.vendas += b.vendas; z.taxas += b.taxas; z.servicos += b.servicos; z.ajustes += b.ajustes; z.loja += b.loja; }
  const faturamento = z.vendas - z.taxas - z.servicos + z.ajustes;
  // No razão: receita = vendas sem o que a loja recebeu direto (esse entra por maquininha/Pix);
  // taxas = taxas + serviços − ajustes. receita − taxas = repasses.
  return { ...z, faturamento, repasse: faturamento - z.loja, receita: z.vendas - z.loja, custo: z.taxas + z.servicos - z.ajustes };
}

// Livro-razão de uma importação: apaga o que ela lançou e relança (se ligado), por dia de
// repasse JÁ vencido — o que ainda vai cair entra quando a data chegar (rotina diária).
// antecipacaoPct: taxa de antecipação da loja (fin_ifood_merchants), cobrada sobre o repasse do dia e que
// não aparece no relatório — entra junto das taxas iFood do dia (2026-09-19).
async function postLedger(admin: Admin, tenantId: string, importId: string, on: boolean, entries: LedgerEntry[], antecipacaoPct = 0) {
  const { error: cfErr } = await admin.from('fin_cash_flow').delete().eq('tenant_id', tenantId).eq('reference_id', importId).in('origin', ['ifood_sale', 'ifood_fee']);
  if (cfErr) throw new Error('Limpar lançamentos: ' + cfErr.message);
  if (!on) return { rows: 0, receita: 0, taxas: 0 };
  const today = todayBR();
  const days = new Map<string, { rev: number; fee: number; rep: number; n: Set<string> }>();
  for (const e of entries) {
    if (!e.data_repasse || e.data_repasse > today) continue;
    const d = days.get(e.data_repasse) ?? { rev: 0, fee: 0, rep: 0, n: new Set<string>() };
    const t = portalTotals([e]);
    d.rev += t.receita; d.fee += t.custo; d.rep += t.repasse;
    if (e.order_id) d.n.add(e.order_id);
    days.set(e.data_repasse, d);
  }
  const cf: Record<string, unknown>[] = [];
  for (const [d, x] of days) {
    const dd = d.slice(8, 10) + '/' + d.slice(5, 7);
    const antecip = antecipacaoPct > 0 && x.rep > 0 ? round2(round2(x.rep) * antecipacaoPct / 100) : 0;
    if (antecip > 0) cf.push({ tenant_id: tenantId, reference_id: importId, date: d, type: 'expense', origin: 'ifood_fee', category: 'Taxas iFood', amount: antecip, description: `Taxa de antecipação iFood do repasse de ${dd} (${antecipacaoPct}%)` });
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

// Antecipação configurada por loja iFood: merchant_id → { pct, days } (só as que antecipam).
async function antecipacoes(admin: Admin, tenantId: string) {
  const { data } = await admin.from('fin_ifood_merchants').select('merchant_id, anticipation_pct, anticipation_days').eq('tenant_id', tenantId);
  const m = new Map<string, { pct: number; days: number }>();
  for (const r of data ?? []) if (Number(r.anticipation_pct) > 0) m.set(String(r.merchant_id), { pct: Number(r.anticipation_pct), days: Number(r.anticipation_days ?? 21) });
  return m;
}
const menosDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

// Relança o razão das importações já gravadas (ligar/desligar a opção, repasses que venceram).
async function repostImports(admin: Admin, tenantId: string, on: boolean, minCompetence?: string) {
  let q = admin.from('fin_ifood_imports').select('id, competence, merchant_id').eq('tenant_id', tenantId);
  if (minCompetence) q = q.gte('competence', minCompetence);
  const pcts = await antecipacoes(admin, tenantId);
  const { data: imps, error } = await q;
  if (error) throw new Error('Ler importações: ' + error.message);
  const tot = { imports: 0, rows: 0, receita: 0, taxas: 0 };
  for (const imp of imps ?? []) {
    const { data: ents, error: eErr } = await admin.from('fin_ifood_entries')
      .select('data_repasse, valor, tipo_lancamento, impacto_repasse, order_id, descricao, responsavel').eq('import_id', imp.id).limit(50000);
    if (eErr) throw new Error('Ler linhas: ' + eErr.message);
    const list = (ents ?? []).map((e: any) => ({ ...e, valor: Number(e.valor) }));
    const l = await postLedger(admin, tenantId, imp.id, on, list, pcts.get(imp.merchant_id)?.pct ?? 0);
    // Resumo da importação na mesma divisão do portal.
    const t = portalTotals(list);
    await admin.from('fin_ifood_imports').update({ gross: round2(t.receita), fees: round2(t.custo), net: round2(t.repasse) }).eq('id', imp.id);
    tot.imports++; tot.rows += l.rows; tot.receita = round2(tot.receita + l.receita); tot.taxas = round2(tot.taxas + l.taxas);
  }
  return { ...tot, matched: await matchInter(admin, tenantId) };
}

async function sha256Hex(bytes: Uint8Array) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Grava uma loja + competência (substitui a anterior da mesma loja), lança no razão e casa com o Inter.
async function saveCompetence(admin: Admin, tenantId: string, cfg: any | null, competence: string, entries: Entry[], meta: { source: 'api' | 'file'; merchant_id: string; file_name?: string | null; sha256?: string | null; userId?: string | null; expected?: { lines: number | null; orders: number | null; read_lines: number; read_orders: number } }) {
  const valid = entries.filter((e) => e.data_repasse || e.valor);
  // Loja com repasse antecipado: a data efetiva é a original menos N dias (a do relatório fica em data_repasse_original).
  const ant = meta.merchant_id ? (await antecipacoes(admin, tenantId)).get(meta.merchant_id) : undefined;
  if (ant) for (const e of valid) if (e.data_repasse_original) e.data_repasse = menosDias(e.data_repasse_original, ant.days);
  const tot = portalTotals(valid);
  const gross = round2(tot.receita);
  const fees = round2(tot.custo);
  const orders = new Set(valid.map((e) => e.order_id).filter(Boolean)).size;
  const now = new Date().toISOString();
  // Integridade: contagens do metadata do iFood × o que foi lido do arquivo (null = sem metadata).
  const ex = meta.expected;
  const integrity = ex && (ex.lines != null || ex.orders != null)
    ? (ex.lines == null || ex.lines === ex.read_lines) && (ex.orders == null || ex.orders === ex.read_orders)
    : null;
  if (integrity === false) log('WARN', 'integrity', 'arquivo difere do metadata do iFood', { tenantId, competence, ...ex });

  const { data: imp, error: impErr } = await admin.from('fin_ifood_imports').upsert({
    tenant_id: tenantId, merchant_id: meta.merchant_id, merchant_short: valid.find((e) => e.merchant_short)?.merchant_short ?? null,
    competence, source: meta.source, file_name: meta.file_name ?? null, sha256: meta.sha256 ?? null,
    lines: valid.length, orders, gross, fees, net: round2(gross - fees), created_by: meta.userId ?? null, updated_at: now,
    expected_lines: meta.expected?.lines ?? null, expected_orders: meta.expected?.orders ?? null, integrity_ok: integrity,
  }, { onConflict: 'tenant_id,merchant_id,competence' }).select('id').single();
  if (impErr || !imp) throw new Error('Registrar importação: ' + (impErr?.message ?? 'sem id'));
  if (meta.merchant_id) {
    // Cadastro da loja (o nome vem da API ou é digitado na aba iFood; aqui não sobrescreve).
    await admin.from('fin_ifood_merchants').upsert({ tenant_id: tenantId, merchant_id: meta.merchant_id, merchant_short: valid.find((e) => e.merchant_short)?.merchant_short ?? null },
      { onConflict: 'tenant_id,merchant_id', ignoreDuplicates: true });
  }

  const { error: delErr } = await admin.from('fin_ifood_entries').delete().eq('import_id', imp.id);
  if (delErr) throw new Error('Limpar linhas anteriores: ' + delErr.message);
  const rows = valid.map((e) => ({ ...e, competence: e.competence ?? competence, tenant_id: tenantId, import_id: imp.id }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('fin_ifood_entries').insert(rows.slice(i, i + 500));
    if (error) throw new Error('Gravar linhas: ' + error.message);
  }

  // Modo homologação (loja de teste): nunca lança no financeiro da loja.
  const ledger = await postLedger(admin, tenantId, imp.id, cfg?.post_to_ledger === true && cfg?.homologation_mode !== true, valid, ant?.pct ?? 0);
  const matched = await matchInter(admin, tenantId);
  return { competence, import_id: imp.id, lines: valid.length, orders, gross, fees, net: round2(gross - fees), ledger, matched_deposits: matched };
}

// ── Relatório de Cardápio (Portal › Relatórios › Cardápio): abas "Funil Loja", "Itens", "Complementos" ──
// Grava produtos e complementos vendidos por loja e período (substitui o mesmo período/loja) e aproveita o
// "Nome da Loja" da aba Funil para dar nome às lojas cadastradas.
async function importCardapio(admin: Admin, tenantId: string, wb: any, fileName: string, userId: string | null) {
  const aba = (prefixo: string): Row[] => {
    const nome = (wb.SheetNames as string[]).find((n) => n.trim().toLowerCase().startsWith(prefixo));
    if (!nome) return [];
    return XLSX.utils.sheet_to_json<Row>(wb.Sheets[nome], { defval: null, raw: true })
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v])));
  };
  const funil = aba('funil'); const itens = aba('itens'); const comps = aba('complementos');
  if (itens.length === 0 && comps.length === 0) throw new Error('O relatório não tem as abas Itens/Complementos.');
  const periodo = String(itens[0]?.['período'] ?? comps[0]?.['período'] ?? funil[0]?.['período'] ?? '');
  const m = periodo.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) throw new Error(`Período não reconhecido: "${periodo}"`);
  const start = `${m[3]}-${m[2]}-${m[1]}`; const end = `${m[6]}-${m[5]}-${m[4]}`;

  // Loja: código curto e nome vêm da aba Funil; itens/complementos só trazem o nome.
  const codigoPorNome = new Map<string, string>();
  for (const f of funil) {
    const nome = str(f['nome da loja']); const cod = str(f['id da loja']);
    if (nome && cod) codigoPorNome.set(nome, cod);
  }
  const unicaLoja = codigoPorNome.size === 1 ? [...codigoPorNome.values()][0] : null;
  const lojaDe = (r: Row) => codigoPorNome.get(String(r['nome da loja'] ?? '').trim()) ?? unicaLoja;

  // Nome das lojas já cadastradas (pelo código curto), sem sobrescrever nome digitado.
  for (const [nome, cod] of codigoPorNome) {
    await admin.from('fin_ifood_merchants').update({ name: nome, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('merchant_short', cod).is('name', null);
  }

  const base = { tenant_id: tenantId, period_start: start, period_end: end, file_name: fileName, created_by: userId };
  const rows = [
    ...itens.filter((r) => str(r['nome do item'])).map((r) => ({
      ...base, kind: 'item', merchant_short: lojaDe(r), store_name: str(r['nome da loja']), group_name: str(r['categoria']),
      name: String(r['nome do item']).trim(), visits: num(r['visitas']), orders: num(r['pedidos']), conversion: num(r['conversão']),
      quantity: num(r['vendas total (quantidade)']), promo_quantity: num(r['vendas total com promoção']),
      promo_orders: num(r['pedidos total com promoção']), total_value: num(r['valor total']),
    })),
    ...comps.filter((r) => str(r['nome do complemento'])).map((r) => ({
      ...base, kind: 'complemento', merchant_short: lojaDe(r), store_name: str(r['nome da loja']), group_name: str(r['classificação']),
      name: String(r['nome do complemento']).trim(), orders: num(r['pedidos']),
      quantity: num(r['vendas total (quantidade)']), total_value: num(r['valor total']),
    })),
  ];
  const lojas = [...new Set(rows.map((r) => r.merchant_short).filter(Boolean))] as string[];
  let del = admin.from('fin_ifood_menu_sales').delete().eq('tenant_id', tenantId).eq('period_start', start).eq('period_end', end);
  if (lojas.length > 0) del = del.in('merchant_short', lojas);
  const { error: dErr } = await del;
  if (dErr) throw new Error('Limpar período anterior: ' + dErr.message);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('fin_ifood_menu_sales').insert(rows.slice(i, i + 500));
    if (error) throw new Error('Gravar produtos: ' + error.message);
  }
  return { period_start: start, period_end: end, itens: rows.filter((r) => r.kind === 'item').length, complementos: rows.filter((r) => r.kind === 'complemento').length, lojas: [...codigoPorNome.entries()].map(([nome, cod]) => ({ nome, codigo: cod })) };
}

// Baixa e grava uma competência pela API.
async function syncCompetence(admin: Admin, cfg: any, competence: string) {
  const r = await apiGet(admin, cfg, finPath(cfg, `/reconciliation?competence=${competence}`));
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
  // Arquivo sem lançamentos (mês sem movimento): não cria importação vazia.
  if (entries.length === 0) return { competence, skipped: true, reason: 'relatório sem lançamentos' };
  const md = last.metadata ?? {};
  const expected = {
    lines: md.total_linhas != null ? Number(md.total_linhas) : null,
    orders: md.total_pedido_associado_ifood != null ? Number(md.total_pedido_associado_ifood) : null,
    read_lines: rows.length,
    read_orders: new Set(rows.map((r) => str(r['pedido_associado_ifood'])).filter(Boolean)).size,
  };
  return await saveCompetence(admin, cfg.tenant_id, cfg, competence, entries, { source: 'api', merchant_id: cfg.merchant_id, sha256: sha || await sha256Hex(bytes), expected });
}

// ── Demais APIs do módulo Financial (vendas, eventos, liquidações, antecipações) ──
const addDaysISO = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hashKey = async (v: unknown) => (await sha256Hex(new TextEncoder().encode(JSON.stringify(v)))).slice(0, 40);
async function upsertRows(admin: Admin, table: string, rows: Map<string, Record<string, unknown>>, onConflict: string) {
  const list = [...rows.values()];
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await admin.from(table).upsert(list.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return list.length;
}

async function syncSales(admin: Admin, cfg: any, from: string, to: string) {
  let n = 0;
  for (let page = 1, pageCount = 1; page <= pageCount && page <= 50; page++) {
    const r = await apiGet(admin, cfg, finPath(cfg, `/sales?beginSalesDate=${from}&endSalesDate=${to}&page=${page}`));
    if (r.status === 404) break;
    if (!r.ok) throw new Error(apiError(r, 'Vendas'));
    const sales: any[] = r.data?.sales ?? [];
    pageCount = Number(r.data?.pageCount ?? 1) || 1;
    const rows = new Map<string, Record<string, unknown>>();
    const now = new Date().toISOString();
    for (const s of sales) {
      if (!s?.id) continue;
      rows.set(String(s.id), {
        tenant_id: cfg.tenant_id, merchant_id: String(s.merchant?.id ?? cfg.merchant_id), sale_id: String(s.id), short_id: str(s.shortId),
        sale_created_at: tsOrNull(s.createdAt), type: str(s.type), category: str(s.category), sales_channel: str(s.salesChannel), current_status: str(s.currentStatus),
        gross_bag: num(s.saleGrossValue?.bag), delivery_fee: num(s.saleGrossValue?.deliveryFee), service_fee: num(s.saleGrossValue?.serviceFee),
        benefits_total: num(s.benefits?.totalValue), sale_balance: num(s.billingSummary?.saleBalance),
        payment_methods: s.payments?.methods ?? null, billing_entries: s.billingSummary?.billingEntries ?? null, raw: s, synced_at: now,
      });
    }
    n += await upsertRows(admin, 'fin_ifood_sales', rows, 'tenant_id,sale_id');
    if (sales.length === 0) break;
  }
  return n;
}

// Janela máxima de 33 dias por consulta (regra do iFood).
async function syncEvents(admin: Admin, cfg: any, from: string, to: string) {
  let n = 0;
  for (let page = 1; page <= 100; page++) {
    const r = await apiGet(admin, cfg, finPath(cfg, `/financial-events?beginDate=${from}&endDate=${to}&page=${page}&size=100`));
    if (r.status === 404) break;
    if (!r.ok) throw new Error(apiError(r, 'Eventos financeiros'));
    const evs: any[] = r.data?.financialEvents ?? [];
    const rows = new Map<string, Record<string, unknown>>();
    const now = new Date().toISOString();
    for (const e of evs) {
      const key = await hashKey([cfg.merchant_id, e.name, e.trigger, e.dateTime, e.reference?.id, e.amount?.value, e.product, e.payment?.method, e.settlement?.expectedDate]);
      rows.set(key, {
        // A resposta real não traz dateTime: data = do pedido (reference.date) ou início do período apurado.
        tenant_id: cfg.tenant_id, merchant_id: String(e.receiver?.merchantId ?? e.receiver?.businessId ?? cfg.merchant_id), event_key: key,
        name: str(e.name), description: str(e.description), product: str(e.product), trigger: str(e.trigger),
        event_at: tsOrNull(e.dateTime) ?? tsOrNull(e.reference?.date) ?? (dateOnly(e.period?.beginDate) ? `${dateOnly(e.period?.beginDate)}T12:00:00Z` : null),
        competence: str(e.competence), period_begin: dateOnly(e.period?.beginDate), period_end: dateOnly(e.period?.endDate),
        reference_type: str(e.reference?.type), reference_id: str(e.reference?.id), reference_date: dateOnly(e.reference?.date),
        has_transfer_impact: e.hasTransferImpact === true, amount: num(e.amount?.value), base_value: num(e.billing?.baseValue), fee_percentage: num(e.billing?.feePercentage),
        expected_settlement: dateOnly(e.settlement?.expectedDate), payment_method: str(e.payment?.method), payment_brand: str(e.payment?.brand), payment_liability: str(e.payment?.liability),
        raw: e, synced_at: now,
      });
    }
    n += await upsertRows(admin, 'fin_ifood_events', rows, 'tenant_id,event_key');
    if (!r.data?.hasNextPage || evs.length === 0) break;
  }
  return n;
}

async function syncSettlements(admin: Admin, cfg: any, from: string, to: string) {
  const r = await apiGet(admin, cfg, finPath(cfg, `/settlements?beginPaymentDate=${from}&endPaymentDate=${to}`));
  if (r.status === 404) return 0;
  if (!r.ok) throw new Error(apiError(r, 'Liquidações'));
  const rows = new Map<string, Record<string, unknown>>();
  const now = new Date().toISOString();
  for (const s of r.data?.settlements ?? []) {
    for (const it of s.closingItems ?? []) {
      const key = it.id ? String(it.id) : await hashKey([cfg.merchant_id, it.type, it.paymentDate, it.amount, s.startDateCalculation, it.transactionId]);
      rows.set(key, {
        tenant_id: cfg.tenant_id, merchant_id: String(r.data?.merchantId ?? cfg.merchant_id), item_key: key, item_id: str(it.id),
        type: str(it.type), product: str(it.product), amount: num(it.amount), status: str(it.status), transaction_id: str(it.transactionId),
        payment_date: dateOnly(it.paymentDate), calc_begin: dateOnly(s.startDateCalculation), calc_end: dateOnly(s.endDateCalculation),
        account_details: it.accountDetails ?? null, raw: it, synced_at: now,
      });
    }
  }
  return await upsertRows(admin, 'fin_ifood_settlements', rows, 'tenant_id,item_key');
}

async function syncAnticipations(admin: Admin, cfg: any, from: string, to: string) {
  const r = await apiGet(admin, cfg, finPath(cfg, `/anticipations?beginAnticipatedPaymentDate=${from}&endAnticipatedPaymentDate=${to}`));
  if (r.status === 404) return 0;
  if (!r.ok) throw new Error(apiError(r, 'Antecipações'));
  const rows = new Map<string, Record<string, unknown>>();
  const now = new Date().toISOString();
  for (const s of r.data?.settlements ?? []) {
    for (const it of s.closingItems ?? []) {
      const key = await hashKey([cfg.merchant_id, it.type, it.originalPaymentDate, it.anticipatedPaymentDate, it.originalPaymentAmount, s.startDateCalculation]);
      rows.set(key, {
        tenant_id: cfg.tenant_id, merchant_id: String(r.data?.merchantId ?? cfg.merchant_id), item_key: key, type: str(it.type),
        original_amount: num(it.originalPaymentAmount), fee_percentage: num(it.feePercentage), fee_amount: num(it.feeAmount), anticipated_amount: num(it.anticipatedPaymentAmount),
        status: str(it.status), original_date: dateOnly(it.originalPaymentDate), anticipated_date: dateOnly(it.anticipatedPaymentDate),
        calc_begin: dateOnly(s.startDateCalculation), calc_end: dateOnly(s.endDateCalculation), account_details: it.accountDetails ?? null, raw: it, synced_at: now,
      });
    }
  }
  return await upsertRows(admin, 'fin_ifood_anticipations', rows, 'tenant_id,item_key');
}

function defaultCompetences() {
  const t = todayBR();
  const cur = t.slice(0, 7);
  const d = new Date(t + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
  const prev = d.toISOString().slice(0, 7);
  return Number(t.slice(8, 10)) <= 15 ? [prev, cur] : [cur];
}

// Busca todas as lojas do iFood ligadas (api_sync) desta loja do ERPOS, uma de cada vez.
async function syncTenant(admin: Admin, cfg: any, competences?: string[]) {
  if (!cfg.client_id || !cfg.client_secret) return { tenant_id: cfg.tenant_id, not_configured: true };
  const lojas = await merchantContexts(admin, cfg);
  if (lojas.length === 0) return { tenant_id: cfg.tenant_id, error: 'Nenhuma loja do iFood autorizada/ligada para buscar pela API.' };
  const results: any[] = [];
  const apis: Record<string, unknown> = {};
  const erros: string[] = [];
  for (const l of lojas) {
    const nome = l.name ?? l.merchant_id.slice(0, 8);
    let err: string | null = l.error ?? null;
    if (l.ctx) {
      const r = await syncMerchant(admin, l.ctx, competences);
      results.push(...r.results.map((x: any) => ({ ...x, merchant_id: l.merchant_id, merchant_name: l.name })));
      apis[l.merchant_id] = r.apis;
      err = r.error;
    }
    if (err) erros.push(`${nome}: ${err}`);
    await admin.from('fin_ifood_merchants').update({ last_sync_at: new Date().toISOString(), last_sync_error: err, updated_at: new Date().toISOString() })
      .eq('tenant_id', cfg.tenant_id).eq('merchant_id', l.merchant_id);
  }
  const lastErr = erros.length ? erros.join(' · ').slice(0, 1000) : null;
  await admin.from('fin_ifood_config').update({ last_sync_at: new Date().toISOString(), last_sync_error: lastErr, updated_at: new Date().toISOString() }).eq('id', cfg.id);
  return { tenant_id: cfg.tenant_id, results, apis, error: lastErr ?? undefined };
}

async function syncMerchant(admin: Admin, cfg: any, competences?: string[]) {
  const results = [];
  let lastErr: string | null = null;
  for (const c of competences?.length ? competences : defaultCompetences()) {
    try { results.push(await syncCompetence(admin, cfg, c)); }
    catch (e) { lastErr = String((e as Error)?.message ?? e); results.push({ competence: c, error: lastErr }); }
  }
  // Demais APIs: janelas móveis (eventos: máx. 33 dias; liquidações/antecipações: passado e futuro).
  const today = todayBR();
  const apis: Record<string, unknown> = {};
  const run = async (k: string, fn: () => Promise<number>) => {
    try { apis[k] = await fn(); } catch (e) { lastErr = String((e as Error)?.message ?? e); apis[k] = { error: lastErr }; }
  };
  // Janelas máximas em produção (a loja de teste aceitava mais): Sales 8 dias (400 se passar);
  // Settlements/Anticipations ~32 dias — acima disso devolve lista VAZIA sem erro. Por isso, em blocos.
  const inWindows = async (from: string, to: string, days: number, fn: (a: string, b: string) => Promise<number>) => {
    let n = 0;
    for (let a = from; a <= to; a = addDaysISO(a, days)) {
      const b = addDaysISO(a, days - 1) < to ? addDaysISO(a, days - 1) : to;
      n += await fn(a, b);
    }
    return n;
  };
  await run('sales', () => inWindows(addDaysISO(today, -30), today, 7, (a, b) => syncSales(admin, cfg, a, b)));
  await run('events', () => syncEvents(admin, cfg, addDaysISO(today, -32), today));
  await run('settlements', () => inWindows(addDaysISO(today, -35), addDaysISO(today, 35), 30, (a, b) => syncSettlements(admin, cfg, a, b)));
  await run('anticipations', () => inWindows(addDaysISO(today, -35), addDaysISO(today, 35), 30, (a, b) => syncAnticipations(admin, cfg, a, b)));
  return { results, apis, error: lastErr };
}

// Lojas do iFood desta loja do ERPOS para a tela: ligada na API?, autorizada?, última busca.
async function merchantsForUi(admin: Admin, cfg: any, tenantId: string) {
  const { data: ms } = await admin.from('fin_ifood_merchants').select('merchant_id, merchant_short, name, api_sync, last_sync_at, last_sync_error').eq('tenant_id', tenantId).order('name');
  const { data: auths } = await admin.from('fin_ifood_auths').select('merchant_ids').eq('tenant_id', tenantId);
  const covered = new Set((auths ?? []).flatMap((a) => a.merchant_ids ?? []));
  const centralized = cfg?.app_type === 'centralized' && Boolean(cfg?.authorized_at);
  return (ms ?? []).map((m) => ({ ...m, authorized: centralized || covered.has(m.merchant_id) }));
}

function safeConfig(cfg: any, merchants: any[] = []) {
  if (!cfg) return null;
  const ligadas = merchants.filter((m) => m.api_sync && m.authorized);
  return {
    client_id: cfg.client_id ? String(cfg.client_id).slice(0, 4) + '…' + String(cfg.client_id).slice(-4) : null,
    has_secret: Boolean(cfg.client_secret),
    // Compatibilidade: 1ª loja ligada (telas antigas olham merchant_id para saber se a API está ativa).
    merchant_id: ligadas[0]?.merchant_id ?? null, merchant_name: ligadas[0]?.name ?? null,
    merchants,
    app_type: cfg.app_type ?? 'distributed',
    authorized: merchants.some((m) => m.authorized), authorized_at: cfg.authorized_at,
    user_code: cfg.user_code_expires_at && new Date(cfg.user_code_expires_at).getTime() > Date.now() ? cfg.user_code : null,
    user_code_expires_at: cfg.user_code_expires_at, verification_url: cfg.verification_url,
    is_active: cfg.is_active, auto_sync: cfg.auto_sync, post_to_ledger: cfg.post_to_ledger, homologation_mode: cfg.homologation_mode === true,
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
          if (cfg.auto_sync !== false && (await merchantContexts(admin, cfg)).some((l) => l.ctx)) r.sync = await syncTenant(admin, cfg);
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
    // Financeiro/RH é admin, gerente ou o papel financeiro (spec modulo-financeiro-sem-pdv, 2026-09-20).
    const isManager = internal || isFinanceiroRole(role);
    const { data: cfg } = await admin.from('fin_ifood_config').select('*').eq('tenant_id', tenantId).maybeSingle();

    if (action === 'get_config') return json({ success: true, config: safeConfig(cfg, cfg ? await merchantsForUi(admin, cfg, tenantId) : []) });

    if (action === 'list_imports') {
      const { data } = await admin.from('fin_ifood_imports').select('id, merchant_id, merchant_short, competence, source, file_name, lines, orders, gross, fees, net, updated_at, expected_lines, expected_orders, integrity_ok').eq('tenant_id', tenantId).order('competence', { ascending: false }).limit(48);
      return json({ success: true, imports: data ?? [] });
    }

    if (action === 'sync') {
      if (!cfg || !cfg.client_id) return json({ success: false, not_configured: true });
      if (!(await merchantContexts(admin, cfg)).some((l) => l.ctx)) return json({ success: true, skipped: true });
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
      // Relatório de Cardápio (abas Itens/Complementos) — mesmo botão de importar.
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        let wb: any = null;
        try { wb = XLSX.read(bytes, { type: 'array' }); } catch { wb = null; }
        if (wb && (wb.SheetNames as string[]).some((n) => /^itens$/i.test(n.trim()))) {
          try { return json({ success: true, cardapio: await importCardapio(admin, tenantId, wb, fileName, userId) }); }
          catch (e) { return errResp('Não consegui ler o relatório de cardápio: ' + String((e as Error)?.message ?? e).slice(0, 180)); }
        }
      }
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
      // Só altera o que veio no corpo (ligar a homologação não mexe no lançamento, e vice-versa).
      const row: Record<string, unknown> = { tenant_id: tenantId, is_active: true, updated_at: new Date().toISOString() };
      if (typeof body.post_to_ledger === 'boolean') row.post_to_ledger = body.post_to_ledger;
      if (typeof body.auto_sync === 'boolean') row.auto_sync = body.auto_sync;
      if (typeof body.homologation_mode === 'boolean') row.homologation_mode = body.homologation_mode;
      if (!cfg) row.created_by = userId;
      const { error } = await admin.from('fin_ifood_config').upsert(row, { onConflict: 'tenant_id' });
      if (error) return errResp('Salvar: ' + error.message, 500);
      const ledger = typeof body.post_to_ledger === 'boolean' ? await repostImports(admin, tenantId, body.post_to_ledger) : null;
      // Ligar o lançamento sem a fonte "ifood" em Receitas › Fontes deixava o iFood fora de Receitas/DRE
      // (caso Vila Leste, 2026-09-13). Liga a fonte junto — exceto se a loja lança pedidos iFood no PDV
      // (aí o iFood já está em "Pedidos do sistema" e somar o relatório contaria em dobro).
      let fonte: string | null = null;
      if (body.post_to_ledger === true) {
        const desde = new Date(Date.now() - 90 * 86400_000).toISOString();
        const { count: noPdv } = await admin.from('orders').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('delivery_platform', 'ifood').gte('created_at', desde);
        if ((noPdv ?? 0) > 0) fonte = 'nao_ligada_pdv_tem_ifood';
        else {
          const { data: rs } = await admin.from('fin_revenue_settings').select('sources').eq('tenant_id', tenantId).maybeSingle();
          const atuais: string[] = rs?.sources ?? ['orders', 'manual'];
          if (!atuais.includes('ifood')) {
            await admin.from('fin_revenue_settings').upsert({ tenant_id: tenantId, sources: [...atuais, 'ifood'], updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: 'tenant_id' });
            fonte = 'ligada';
          } else fonte = 'ja_estava';
        }
      }
      return json({ success: true, ledger, fonte });
    }

    if (action === 'set_merchant_name') {
      const merchantId = String(body.merchant_id ?? '').trim();
      const name = String(body.name ?? '').trim().slice(0, 120);
      if (!merchantId) return errResp('Loja não informada.');
      const { error } = await admin.from('fin_ifood_merchants').upsert({ tenant_id: tenantId, merchant_id: merchantId, name: name || null, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,merchant_id' });
      if (error) return errResp('Salvar: ' + error.message, 500);
      return json({ success: true });
    }

    // Repasse antecipado da loja iFood (2026-09-19): pct null/0 desliga. Reaplica a data efetiva nas linhas
    // já importadas da loja, relança o razão (se ligado) e casa de novo com o banco.
    if (action === 'set_anticipation') {
      if (!isManager) return errResp('Apenas admin/gerente', 403);
      const merchantId = String(body.merchant_id ?? '').trim();
      if (!merchantId) return errResp('Loja não informada.');
      const pctIn = body.pct === null || body.pct === '' || body.pct === undefined ? null : Number(String(body.pct).replace(',', '.'));
      if (pctIn !== null && (!Number.isFinite(pctIn) || pctIn < 0 || pctIn >= 20)) return errResp('Taxa de antecipação inválida (0 a 20%).');
      const days = body.days === undefined || body.days === null || body.days === '' ? 21 : Math.round(Number(body.days));
      if (!Number.isFinite(days) || days < 0 || days > 60) return errResp('Dias de antecipação inválidos (0 a 60).');
      const { error } = await admin.from('fin_ifood_merchants').upsert({ tenant_id: tenantId, merchant_id: merchantId, anticipation_pct: pctIn && pctIn > 0 ? pctIn : null, anticipation_days: days, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,merchant_id' });
      if (error) return errResp('Salvar: ' + error.message, 500);
      const { data: n, error: aErr } = await admin.rpc('fn_ifood_apply_anticipation', { p_tenant: tenantId, p_merchant: merchantId });
      if (aErr) return errResp('Aplicar nas importações: ' + aErr.message, 500);
      const ledger = await repostImports(admin, tenantId, cfg?.post_to_ledger === true && cfg?.homologation_mode !== true);
      return json({ success: true, linhas: Number(n ?? 0), ledger });
    }

    // ── Relatório de conciliação sob demanda (POST gera; GET consulta até ficar pronto) ──
    if (action === 'request_ondemand') {
      // Uma loja do iFood por pedido: a escolhida no filtro da aba iFood (ou a única ligada).
      const lojas = (await merchantContexts(admin, cfg)).filter((l) => l.ctx);
      if (lojas.length === 0) return errResp('Conecte a API do iFood antes (credenciais + autorização da loja).');
      const want = String(body.merchant_id ?? '').trim();
      const loja = want ? lojas.find((l) => l.merchant_id === want) : (lojas.length === 1 ? lojas[0] : null);
      if (!loja) return errResp(want ? 'Essa loja do iFood não está ligada na API.' : 'Escolha a loja do iFood no filtro antes de gerar o relatório.');
      const mcfg = loja.ctx;
      const competence = String(body.competence ?? '');
      if (!/^\d{4}-\d{2}$/.test(competence)) return errResp('Competência inválida (use AAAA-MM).');
      const r = await apiPost(admin, mcfg, finPath(mcfg, '/reconciliation/on-demand'), { competence });
      let requestId: string | null = r.data?.requestId ? String(r.data.requestId) : null;
      if (r.status === 409) {
        // Já existe pedido em andamento para a competência: reutiliza o requestId.
        if (!requestId) {
          const { data: prev } = await admin.from('fin_ifood_ondemand').select('request_id').eq('tenant_id', tenantId).eq('merchant_id', mcfg.merchant_id).eq('competence', competence).order('created_at', { ascending: false }).limit(1);
          requestId = prev?.[0]?.request_id ?? null;
        }
        if (!requestId) return errResp('O iFood já está gerando esse relatório. Tente de novo em alguns minutos.');
      } else if (!r.ok || !requestId) return errResp(apiError(r, 'Gerar relatório'));
      const now = new Date().toISOString();
      await admin.from('fin_ifood_ondemand').upsert({ tenant_id: tenantId, merchant_id: mcfg.merchant_id, competence, request_id: requestId, status: 'REQUESTED', requested_by: userId, updated_at: now }, { onConflict: 'tenant_id,request_id' });
      return json({ success: true, request_id: requestId, reused: r.status === 409 });
    }

    if (action === 'ondemand_status') {
      const requestId = String(body.request_id ?? '');
      const { data: od } = await admin.from('fin_ifood_ondemand').select('*').eq('tenant_id', tenantId).eq('request_id', requestId).maybeSingle();
      if (!od) return errResp('Pedido de relatório não encontrado.');
      const mcfg = (await merchantContexts(admin, cfg)).find((l) => l.ctx && l.merchant_id === od.merchant_id)?.ctx;
      if (!mcfg) return errResp('API do iFood não conectada para esta loja.');
      const r = await apiGet(admin, mcfg, finPath(mcfg, `/reconciliation/on-demand/${encodeURIComponent(requestId)}`));
      if (!r.ok) return errResp(apiError(r, 'Status do relatório'));
      const status = String(r.data?.status ?? 'PROCESSING');
      const filePath = str(r.data?.filePath);
      let imported: unknown = null;
      if (filePath && !od.imported_at && /complet|conclu|done|success|ready|finish|available|generated/i.test(status)) {
        const f = await fetch(filePath);
        if (!f.ok) return errResp(`Baixar relatório: HTTP ${f.status}`);
        const bytes = new Uint8Array(await f.arrayBuffer());
        const rows = await readReport(bytes, 'ondemand.csv.gz');
        const entries = rows.map(toEntry).filter((e) => !e.competence || e.competence === od.competence);
        imported = await saveCompetence(admin, tenantId, cfg, od.competence, entries, { source: 'api', merchant_id: od.merchant_id, sha256: await sha256Hex(bytes), userId });
      }
      const now = new Date().toISOString();
      await admin.from('fin_ifood_ondemand').update({ status, file_path: filePath, error_message: str(r.data?.errorMessage), imported_at: imported ? now : od.imported_at, updated_at: now }).eq('id', od.id);
      return json({ success: true, status, file_path: filePath, error_message: str(r.data?.errorMessage), imported });
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
        app_type: body.app_type === 'centralized' ? 'centralized' : 'distributed',
        auto_sync: body.auto_sync === false ? false : true,
        is_active: true, updated_at: now,
      };
      if (!cfg) { row.created_by = userId; }
      if (changedApp) Object.assign(row, { access_token: null, refresh_token: null, token_expires_at: null, merchant_id: null, merchant_name: null, authorized_at: null, user_code: null, auth_verifier_secret: null });
      const { error } = await admin.from('fin_ifood_config').upsert(row, { onConflict: 'tenant_id' });
      if (error) return errResp('Salvar: ' + error.message, 500);
      // Outro app: as autorizações (tokens) do app anterior não valem mais.
      if (changedApp) await admin.from('fin_ifood_auths').delete().eq('tenant_id', tenantId);
      const { count: nAuth } = await admin.from('fin_ifood_auths').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      return json({ success: true, message: (nAuth ?? 0) === 0 ? 'Credenciais salvas. Agora gere o código e autorize no Portal do Parceiro.' : 'Configuração salva.' });
    }

    if (action === 'request_user_code') {
      if (!cfg?.client_id) return errResp('Salve primeiro o Client ID e o Client Secret.');
      const r = await ifoodForm('/authentication/v1.0/oauth/userCode', { clientId: cfg.client_id }, cfg.homologation_mode === true);
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
      }, cfg.homologation_mode === true);
      if (!r.ok || !r.data?.accessToken) return errResp(apiError(r, 'Autorizar'));
      const access = r.data.accessToken as string;
      const m = await ifoodGet('/merchant/v1.0/merchants', access, cfg.homologation_mode === true);
      const merchants = (Array.isArray(m.data) ? m.data : []).map((x: any) => ({ id: String(x.id), name: String(x.name ?? x.corporateName ?? x.id) }));
      // Cada autorização guarda o próprio token: autorizar outra loja não derruba as anteriores.
      const now = new Date().toISOString();
      const { error: aErr } = await admin.from('fin_ifood_auths').insert({
        tenant_id: tenantId, access_token: access, refresh_token: r.data.refreshToken ?? null,
        token_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 21600) * 1000).toISOString(),
        merchant_ids: merchants.map((x: { id: string }) => x.id), authorized_at: now, updated_at: now,
      });
      if (aErr) return errResp('Gravar autorização: ' + aErr.message, 500);
      await admin.from('fin_ifood_config').update({ authorized_at: now, user_code: null, auth_verifier_secret: null, updated_at: now }).eq('id', cfg.id);
      await autoEnableMerchants(admin, tenantId, merchants);
      if (!r.data.refreshToken) log('WARN', 'confirm_authorization', 'token sem refreshToken', { tenantId });
      return json({ success: true, merchants: await merchantsForUi(admin, cfg, tenantId) });
    }

    // App centralizado (ex.: app de teste "C"): token por client_credentials e lista das lojas liberadas.
    if (action === 'connect_centralized') {
      if (!cfg?.client_id || !cfg.client_secret || cfg.app_type !== 'centralized') return errResp('Salve antes as credenciais de um app centralizado.');
      cfg.token_expires_at = null;
      const token = await getToken(admin, cfg);
      const m = await ifoodGet('/merchant/v1.0/merchants', token, cfg.homologation_mode === true);
      if (!m.ok) return errResp(apiError(m, 'Listar lojas'));
      const merchants = (Array.isArray(m.data) ? m.data : []).map((x: any) => ({ id: String(x.id), name: String(x.name ?? x.corporateName ?? x.id) }));
      await admin.from('fin_ifood_config').update({ authorized_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', cfg.id);
      await autoEnableMerchants(admin, tenantId, merchants);
      return json({ success: true, merchants: await merchantsForUi(admin, { ...cfg, authorized_at: new Date().toISOString() }, tenantId) });
    }

    // Liga/desliga a busca pela API de uma loja do iFood. Uma loja do iFood só pode ser buscada por
    // uma loja do ERPOS (índice único em fin_ifood_merchants) — senão entra em dobro no consolidado.
    if (action === 'set_merchant_api' || action === 'select_merchant') {
      const id = String(body.merchant_id ?? '').trim();
      const on = action === 'select_merchant' ? true : body.on === true;
      if (!cfg || !id) return errResp('Escolha a loja.');
      if (on) {
        const ui = await merchantsForUi(admin, cfg, tenantId);
        if (!ui.find((x) => x.merchant_id === id)?.authorized) return errResp('Essa loja do iFood ainda não autorizou o app: gere um código e autorize-a no Portal do Parceiro.');
        const { data: outra } = await admin.from('fin_ifood_merchants').select('tenant_id').eq('merchant_id', id).eq('api_sync', true).neq('tenant_id', tenantId).limit(1);
        if (outra?.length) {
          const { data: t } = await admin.from('tenants').select('name').eq('id', outra[0].tenant_id).maybeSingle();
          return errResp(`Essa loja do iFood já é buscada pela loja "${t?.name ?? 'outra'}" do ERPOS. Desligue lá antes, para não contar as vendas em dobro.`);
        }
      }
      const { error } = await admin.from('fin_ifood_merchants').update({ api_sync: on, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('merchant_id', id);
      if (error) return errResp('Salvar: ' + error.message, 500);
      return json({ success: true, merchants: await merchantsForUi(admin, cfg, tenantId) });
    }

    if (action === 'delete_config') {
      await admin.from('fin_ifood_auths').delete().eq('tenant_id', tenantId);
      await admin.from('fin_ifood_merchants').update({ api_sync: false, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId);
      await admin.from('fin_ifood_config').delete().eq('tenant_id', tenantId);
      return json({ success: true });
    }

    return errResp(`Ação desconhecida: ${action}`);
  } catch (e) {
    log('ERROR', action, 'falha', { error: String((e as Error)?.stack ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});
