// ── pix-payment · Pix do autoatendimento (tablet) ────────────────────────────
// Por loja, o Pix do tablet sai de um provedor que CONFIRMA o pagamento:
//   • inter_pix   → cobrança imediata (cob) na API Pix do Banco Inter, com mTLS
//   • mercadopago → Pix dinâmico do Mercado Pago (mesma conta do pagamento online)
// Sem nenhum dos dois o tablet esconde o Pix (`kiosk_provider` devolve null).
// O status só vira "confirmed" consultando o provedor (check_status / cancel) ou por
// confirmação manual de admin/gerente — nunca pelo toque do cliente no tablet.
// `generate` (BR Code estático com a chave de system_settings) ficou só para a prévia
// de Configurações › PIX.
//
// Credenciais do Inter: fin_payment_provider_config (provider = 'inter_pix'). A integração
// de EXTRATO do Inter (Financeiro › Conciliação, edge inter-bank, fin_inter_config) é OUTRA
// integração no Internet Banking — separadas de propósito, cada uma só com o próprio escopo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type Admin = ReturnType<typeof createClient>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kiosk-token',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const log = (level: string, scope: string, msg: string, extra?: unknown) =>
  console.log(JSON.stringify({ level, scope: `pix-payment/${scope}`, msg, ...(extra ? { extra } : {}) }));
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const PROVIDERS = ['inter_pix', 'mercadopago'];
const PIX_EXPIRATION_SEC = 600;
// O tablet consulta a cada 3 s; o provedor é consultado no máximo a cada 4 s por cobrança.
const RECONCILE_EVERY_MS = 4000;

// ── EMV Payload Builder (PIX BR Code) ──────────────────────────────────────
function pad(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

function buildPixPayload(params: {
  pixKey: string;
  pixKeyType: string;
  amount: number;
  txid: string;
  beneficiaryName: string;
  city: string;
  description?: string;
}): string {
  const { pixKey, amount, txid, beneficiaryName, city, description } = params;

  // Normaliza nome e cidade (máx 25 e 15 chars, sem acentos)
  const normName = beneficiaryName
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '').substring(0, 25).toUpperCase();
  const normCity = city
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '').substring(0, 15).toUpperCase();

  // Merchant Account Info (tag 26)
  const gui = pad('00', 'br.gov.bcb.pix');
  const keyField = pad('01', pixKey);
  const descField = description ? pad('02', description.substring(0, 72)) : '';
  const merchantAccountInfo = pad('26', gui + keyField + descField);

  // Additional Data (tag 62) — txid
  const safeTxid = txid.replace(/[^A-Za-z0-9]/g, '').substring(0, 25) || '***';
  const additionalData = pad('62', pad('05', safeTxid));

  // Amount (tag 54)
  const amountField = pad('54', amount.toFixed(2));

  // Build payload sem CRC
  const payload =
    pad('00', '01') +           // Payload Format Indicator
    pad('01', '12') +           // Point of Initiation Method (12 = dynamic)
    merchantAccountInfo +
    pad('52', '0000') +         // Merchant Category Code
    pad('53', '986') +          // Transaction Currency (BRL)
    amountField +
    pad('58', 'BR') +           // Country Code
    pad('59', normName) +       // Merchant Name
    pad('60', normCity) +       // Merchant City
    additionalData +
    '6304';                     // CRC placeholder

  return payload + crc16(payload);
}

// ── Supabase Admin Client ──────────────────────────────────────────────────
function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

// ── Auth ─────────────────────────────────────────────────────────────────────
// JWT de quem é da loja: o tablet (kiosk-auth → user_tenants.role = 'tablet') ou a equipe.
async function requireMember(req: Request, admin: Admin, tenantId: string) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !tenantId) return { error: json({ error: 'Não autenticado' }, 401), userId: '', role: '' };
  const { data: u, error } = await admin.auth.getUser(token);
  if (error || !u?.user) return { error: json({ error: 'Sessão inválida' }, 401), userId: '', role: '' };
  const { data: m } = await admin.from('user_tenants').select('role')
    .eq('user_id', u.user.id).eq('tenant_id', tenantId).limit(1).maybeSingle();
  if (!m) return { error: json({ error: 'Sem acesso a esta loja' }, 403), userId: '', role: '' };
  return { error: null, userId: u.user.id, role: String(m.role ?? '') };
}
const isManager = (role: string) => role === 'admin' || role === 'manager';

// ── Config dos provedores ────────────────────────────────────────────────────
type ProviderCfg = {
  id: string; provider: string; is_active: boolean; access_token: string | null; account_label: string | null;
  client_id: string | null; client_secret: string | null; cert_pem: string | null; key_pem: string | null;
  pix_key: string | null; environment: string | null; conta_corrente: string | null;
  cert_expires_at: string | null; last_test_at: string | null; updated_at: string;
};
async function loadProviderCfgs(admin: Admin, tenantId: string) {
  const { data } = await admin.from('fin_payment_provider_config')
    .select('id, provider, is_active, access_token, account_label, client_id, client_secret, cert_pem, key_pem, pix_key, environment, conta_corrente, cert_expires_at, last_test_at, updated_at')
    .eq('tenant_id', tenantId).in('provider', PROVIDERS);
  const rows = (data ?? []) as ProviderCfg[];
  return { inter: rows.find((r) => r.provider === 'inter_pix') ?? null, mp: rows.find((r) => r.provider === 'mercadopago') ?? null };
}
const interReady = (c: ProviderCfg | null) => Boolean(c && c.is_active && c.client_id && c.client_secret && c.cert_pem && c.key_pem && c.pix_key);
const mpReady = (c: ProviderCfg | null) => Boolean(c && c.is_active && c.access_token);
const pickProvider = (p: { inter: ProviderCfg | null; mp: ProviderCfg | null }) =>
  interReady(p.inter) ? 'inter_pix' : mpReady(p.mp) ? 'mercadopago' : null;

// ── Banco Inter (API Pix, mTLS) ──────────────────────────────────────────────
const INTER_BASE: Record<string, string> = {
  production: 'https://cdpj.partners.bancointer.com.br',
  sandbox: 'https://cdpj-sandbox.partners.uatinter.co',
};
const INTER_SCOPE = 'cob.write cob.read pix.read';
const INTER_TIMEOUT_MS = 30_000;
type HttpClient = { close?: () => void };
// deno-lint-ignore no-explicit-any
type InterResp = { ok: boolean; status: number; data: any; raw: string };

function normalizePem(s: unknown): string {
  // Aceita PEM colado com \r\n, espaços nas bordas ou "\n" literal.
  return String(s ?? '').replace(/\\n/g, '\n').replace(/\r/g, '').trim() + '\n';
}

async function interFetch(cfg: ProviderCfg, path: string, init: RequestInit & { token?: string } = {}): Promise<InterResp> {
  const D = Deno as unknown as { createHttpClient?: (o: Record<string, unknown>) => HttpClient };
  if (typeof D.createHttpClient !== 'function') throw new Error('Runtime sem Deno.createHttpClient — mTLS indisponível');
  // Nomes do Deno 2 (cert/key). Os antigos certChain/privateKey são ignorados em silêncio.
  const client = D.createHttpClient({ cert: cfg.cert_pem, key: cfg.key_pem });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), INTER_TIMEOUT_MS);
  const { token, ...rest } = init;
  const headers: Record<string, string> = { Accept: 'application/json', ...((rest.headers as Record<string, string>) ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cfg.conta_corrente) headers['x-conta-corrente'] = String(cfg.conta_corrente).replace(/\D/g, '');
  try {
    const res = await fetch(`${INTER_BASE[cfg.environment ?? 'production'] ?? INTER_BASE.production}${path}`,
      { ...rest, headers, signal: ctrl.signal, client } as RequestInit);
    const raw = await res.text();
    let data: unknown = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data, raw };
  } finally {
    clearTimeout(timer);
    try { client.close?.(); } catch { /* noop */ }
  }
}

function interError(r: InterResp, what: string): string {
  const d = r.data;
  const detail = d?.detail ?? d?.message ?? d?.error_description ?? d?.error ?? d?.title
    // deno-lint-ignore no-explicit-any
    ?? (Array.isArray(d?.violacoes) ? d.violacoes.map((v: any) => v.razao ?? v.propriedade).join('; ') : null)
    ?? (r.raw ? r.raw.slice(0, 200) : '');
  if (r.status === 401 || r.status === 403) {
    return `${what}: o Inter recusou as credenciais (${r.status}). Confira client_id/secret, o certificado e se a integração tem as permissões de Pix (emitir/consultar cobrança imediata e consultar Pix recebidos). ${detail}`.trim();
  }
  return `${what}: Inter respondeu ${r.status}. ${detail}`.trim();
}

// Erros de rede/TLS viram mensagem que o gerente entende.
function friendlyError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (/UnknownCA|CertificateUnknown|BadCertificate|HandshakeFailure|certificate/i.test(msg)) {
    return `O Inter não aceitou o certificado: use o .crt e o .key baixados na MESMA integração ("ERPOS - Pix Autoatendimento") e confira se ela não expirou. Detalhe: ${msg}`;
  }
  if (/invalid.*(pem|key|cert)|InvalidData|no private key|PrivateKey/i.test(msg)) {
    return `Certificado ou chave privada em formato inválido (use o conteúdo completo dos arquivos .crt e .key). Detalhe: ${msg}`;
  }
  if (/error sending request|dns|timed out|AbortError|Connect/i.test(msg)) {
    return `Não foi possível falar com a API do Inter (rede/TLS). Detalhe: ${msg}`;
  }
  return msg;
}

// Token OAuth por instância (em memória). Não usa o cache da fin_inter_config: aquele é do
// escopo de extrato (outra integração) e não serve para Pix.
const interTokens = new Map<string, { token: string; exp: number }>();
async function interToken(cfg: ProviderCfg, force = false): Promise<string> {
  const key = `${cfg.id}:${cfg.updated_at}`;
  const hit = interTokens.get(key);
  if (!force && hit && hit.exp - Date.now() > 60_000) return hit.token;
  const body = new URLSearchParams({
    client_id: String(cfg.client_id), client_secret: String(cfg.client_secret),
    grant_type: 'client_credentials', scope: INTER_SCOPE,
  });
  const r = await interFetch(cfg, '/oauth/v2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  if (!r.ok || !r.data?.access_token) throw new Error(interError(r, 'Token'));
  interTokens.set(key, { token: String(r.data.access_token), exp: Date.now() + Number(r.data.expires_in ?? 3600) * 1000 });
  return String(r.data.access_token);
}
async function interApi(cfg: ProviderCfg, path: string, init: RequestInit = {}): Promise<InterResp> {
  let r = await interFetch(cfg, path, { ...init, token: await interToken(cfg) });
  if (r.status === 401) r = await interFetch(cfg, path, { ...init, token: await interToken(cfg, true) });
  return r;
}

async function certNotAfter(pem: string): Promise<string | null> {
  try {
    const { X509Certificate } = await import('node:crypto');
    const d = new Date(new X509Certificate(pem).validTo);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

// ── Mercado Pago ─────────────────────────────────────────────────────────────
const MP_API = 'https://api.mercadopago.com';
async function mpFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
  });
  const text = await res.text();
  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}
// MP exige "yyyy-MM-dd'T'HH:mm:ss.SSSXXX" com offset; Brasil = -03:00.
function mpDate(d: Date): string {
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00');
}

// ── Cobrança no provedor ─────────────────────────────────────────────────────
type Charge = { providerPaymentId: string; emv: string; raw: unknown; beneficiary: string };

async function createInterCob(cfg: ProviderCfg, txid: string, amount: number, desc: string): Promise<Charge> {
  const r = await interApi(cfg, `/pix/v2/cob/${txid}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendario: { expiracao: PIX_EXPIRATION_SEC },
      valor: { original: amount.toFixed(2) },
      chave: cfg.pix_key,
      solicitacaoPagador: desc.slice(0, 140),
    }),
  });
  if (!r.ok || !r.data?.pixCopiaECola) throw new Error(interError(r, 'Criar cobrança'));
  return {
    providerPaymentId: txid, emv: String(r.data.pixCopiaECola),
    raw: { txid: r.data.txid, status: r.data.status, location: r.data.location ?? null, calendario: r.data.calendario ?? null },
    beneficiary: 'Banco Inter',
  };
}

async function createMpPix(cfg: ProviderCfg, pixId: string, amount: number, desc: string, expiresAt: Date): Promise<Charge> {
  const token = String(cfg.access_token);
  const mp = await mpFetch(token, '/v1/payments', {
    method: 'POST', headers: { 'X-Idempotency-Key': pixId },
    body: JSON.stringify({
      transaction_amount: amount, description: desc, payment_method_id: 'pix',
      payer: { email: `${pixId}@cliente.erpos.app`, first_name: 'Cliente', last_name: 'Autoatendimento' },
      external_reference: pixId, date_of_expiration: mpDate(expiresAt),
      metadata: { erpos_pix_id: pixId, origin: 'kiosk' },
    }),
  });
  if (!mp.ok) throw new Error(`Mercado Pago ${mp.status}: ${String(mp.body.message ?? JSON.stringify(mp.body).slice(0, 200))}`);
  const td = (mp.body.point_of_interaction?.transaction_data ?? {}) as Record<string, string>;
  if (!td.qr_code) {
    mpFetch(token, `/v1/payments/${mp.body.id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) }).catch(() => {});
    throw new Error('Mercado Pago não devolveu o código Pix');
  }
  return {
    providerPaymentId: String(mp.body.id), emv: String(td.qr_code),
    raw: { id: mp.body.id, status: mp.body.status, date_of_expiration: mp.body.date_of_expiration },
    beneficiary: cfg.account_label ?? 'Mercado Pago',
  };
}

async function cancelAtProvider(p: { inter: ProviderCfg | null; mp: ProviderCfg | null }, row: PixRow) {
  try {
    if (row.provider === 'inter_pix' && p.inter?.cert_pem) {
      await interApi(p.inter, `/pix/v2/cob/${row.provider_payment_id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }),
      });
    } else if (row.provider === 'mercadopago' && p.mp?.access_token) {
      await mpFetch(p.mp.access_token, `/v1/payments/${row.provider_payment_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    }
  } catch (e) { log('WARN', 'cancel', 'cancelar no provedor falhou', { id: row.id, error: String(e) }); }
}

// ── Reconciliação: pergunta ao provedor e aplica na nossa linha ──────────────
type PixRow = {
  id: string; tenant_id: string; status: string; amount: number; txid: string; provider: string;
  provider_payment_id: string | null; expires_at: string; confirmed_at: string | null; updated_at: string;
};
const PIX_COLS = 'id, tenant_id, status, amount, txid, provider, provider_payment_id, expires_at, confirmed_at, updated_at';

async function reconcileRow(admin: Admin, row: PixRow): Promise<string> {
  if (row.status !== 'pending' || !row.provider_payment_id || !PROVIDERS.includes(row.provider)) return row.status;
  const p = await loadProviderCfgs(admin, row.tenant_id);
  const now = new Date().toISOString();
  let paid = false; let gone = false; let got = 0; let raw: unknown = null;

  if (row.provider === 'inter_pix') {
    if (!p.inter?.cert_pem) return row.status;
    const r = await interApi(p.inter, `/pix/v2/cob/${row.provider_payment_id}`);
    if (!r.ok) { log('WARN', 'reconcile', 'GET cob falhou', { id: row.id, http: r.status, body: r.raw.slice(0, 200) }); return row.status; }
    const st = String(r.data?.status ?? '');
    const pixList = Array.isArray(r.data?.pix) ? r.data.pix : [];
    paid = st === 'CONCLUIDA';
    gone = st.startsWith('REMOVIDA');
    // deno-lint-ignore no-explicit-any
    got = round2(pixList.reduce((s: number, x: any) => s + Number(x?.valor ?? 0), 0));
    // deno-lint-ignore no-explicit-any
    raw = { status: st, pix: pixList.map((x: any) => ({ endToEndId: x?.endToEndId, valor: x?.valor, horario: x?.horario })) };
  } else {
    if (!p.mp?.access_token) return row.status;
    const r = await mpFetch(p.mp.access_token, `/v1/payments/${row.provider_payment_id}`);
    if (!r.ok) { log('WARN', 'reconcile', 'GET payment falhou', { id: row.id, http: r.status }); return row.status; }
    const st = String(r.body.status ?? '');
    paid = st === 'approved';
    gone = ['cancelled', 'rejected', 'refunded', 'charged_back'].includes(st);
    got = round2(Number(r.body.transaction_amount ?? 0));
    raw = { id: r.body.id, status: st, status_detail: r.body.status_detail ?? null };
  }

  if (paid) {
    const expected = round2(Number(row.amount));
    if (got + 0.01 < expected) {
      // Pagou menos do que foi cobrado: não libera o pedido; fica registrado pra conferência.
      log('ERROR', 'reconcile', 'valor pago menor que o cobrado', { id: row.id, expected, got });
      await admin.from('fin_pix_payments').update({ error: `Pago R$ ${got.toFixed(2)}, cobrado R$ ${expected.toFixed(2)}`, raw_provider: raw, updated_at: now }).eq('id', row.id);
      return 'pending';
    }
    await admin.from('fin_pix_payments').update({ status: 'confirmed', confirmed_at: now, updated_at: now, raw_provider: raw })
      .eq('id', row.id).eq('status', 'pending');
    log('INFO', 'reconcile', 'confirmado pelo provedor', { id: row.id, provider: row.provider, amount: got });
    return 'confirmed';
  }
  if (gone) {
    await admin.from('fin_pix_payments').update({ status: 'cancelled', updated_at: now, raw_provider: raw }).eq('id', row.id).eq('status', 'pending');
    return 'cancelled';
  }
  // Ainda aberto: marca a hora da consulta (é o que limita a frequência de chamadas ao provedor).
  await admin.from('fin_pix_payments').update({ updated_at: now }).eq('id', row.id).eq('status', 'pending');
  return 'pending';
}

async function loadRow(admin: Admin, body: Record<string, unknown>): Promise<PixRow | null> {
  const id = String(body.pix_payment_id ?? '');
  const txid = String(body.txid ?? '');
  if (!id && !txid) return null;
  const q = admin.from('fin_pix_payments').select(PIX_COLS);
  const { data } = await (id ? q.eq('id', id) : q.eq('txid', txid)).maybeSingle();
  return (data as PixRow | null) ?? null;
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = getAdminClient();

  try {
    const body = await req.json();
    const { action } = body;

    // ── ACTION: generate ──────────────────────────────────────────────────
    if (action === 'generate') {
      const { tenant_id, order_id, amount } = body;

      if (!tenant_id || !amount) {
        return new Response(JSON.stringify({ error: 'tenant_id e amount são obrigatórios' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Busca configuração PIX do tenant
      const { data: settings } = await supabase
        .from('system_settings')
        .select('pix_key, pix_key_type, pix_beneficiary_name, pix_city')
        .eq('tenant_id', tenant_id)
        .maybeSingle();

      if (!settings?.pix_key) {
        return new Response(JSON.stringify({ error: 'Chave PIX não configurada. Configure em Configurações > PIX.' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Gera txid único
      const txid = `ERPOS${Date.now()}${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // Gera payload EMV
      const emvPayload = buildPixPayload({
        pixKey: settings.pix_key,
        pixKeyType: settings.pix_key_type ?? 'email',
        amount: Number(amount),
        txid,
        beneficiaryName: settings.pix_beneficiary_name ?? 'ESTABELECIMENTO',
        city: settings.pix_city ?? 'SAO PAULO',
        description: order_id ? `Pedido ${order_id.substring(0, 8)}` : 'Pedido',
      });

      // Salva no banco
      const { data: pixRecord, error: insertErr } = await supabase
        .from('fin_pix_payments')
        .insert({
          tenant_id,
          order_id: order_id ?? null,
          txid,
          amount: Number(amount),
          pix_key: settings.pix_key,
          pix_key_type: settings.pix_key_type ?? 'email',
          beneficiary_name: settings.pix_beneficiary_name ?? 'ESTABELECIMENTO',
          city: settings.pix_city ?? 'SAO PAULO',
          emv_payload: emvPayload,
          status: 'pending',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })
        .select('id, txid, emv_payload, expires_at')
        .single();

      if (insertErr) throw insertErr;

      return new Response(JSON.stringify({
        pix_payment_id: pixRecord.id,
        txid: pixRecord.txid,
        emv_payload: pixRecord.emv_payload,
        expires_at: pixRecord.expires_at,
        pix_key: settings.pix_key,
        pix_key_type: settings.pix_key_type,
        beneficiary_name: settings.pix_beneficiary_name,
        amount: Number(amount),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    // ── ACTION: kiosk_provider — o tablet mostra Pix só se houver provedor ────
    if (action === 'kiosk_provider') {
      const tenantId = String(body.tenant_id ?? '');
      const auth = await requireMember(req, supabase, tenantId);
      if (auth.error) return auth.error;
      return json({ provider: pickProvider(await loadProviderCfgs(supabase, tenantId)) });
    }

    // ── ACTION: create_charge — Pix do tablet no provedor da loja ─────────────
    // Erros para o cliente vão em `error` (é o que o invokeWithAuth mostra).
    if (action === 'create_charge') {
      const tenantId = String(body.tenant_id ?? '');
      const amount = round2(Number(body.amount));
      if (!tenantId || !(amount >= 0.01)) return json({ error: 'tenant_id e amount são obrigatórios' }, 400);
      const auth = await requireMember(req, supabase, tenantId);
      if (auth.error) return auth.error;

      const p = await loadProviderCfgs(supabase, tenantId);
      const provider = pickProvider(p);
      if (!provider) return json({ error: 'O Pix automático não está configurado nesta loja.', code: 'no_provider' }, 422);

      const pixId = crypto.randomUUID();
      const txid = pixId.replace(/-/g, ''); // 32 alfanuméricos (a API Pix aceita 26–35)
      const expiresAt = new Date(Date.now() + PIX_EXPIRATION_SEC * 1000);
      const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).maybeSingle();
      const desc = `${tenant?.name ?? 'Restaurante'} · Autoatendimento`;

      let charge: Charge;
      try {
        charge = provider === 'inter_pix'
          ? await createInterCob(p.inter!, txid, amount, desc)
          : await createMpPix(p.mp!, pixId, amount, desc, expiresAt);
      } catch (e) {
        const detail = friendlyError(e);
        log('ERROR', 'create_charge', 'provedor recusou', { tenantId, provider, detail });
        return json({ error: 'Não foi possível gerar o Pix agora. Tente de novo ou pague no balcão.', code: 'provider_error', detail }, 502);
      }

      const { data: row, error: insErr } = await supabase.from('fin_pix_payments').insert({
        id: pixId, tenant_id: tenantId, order_id: body.order_id ?? null, txid, amount,
        pix_key: provider === 'inter_pix' ? p.inter!.pix_key : 'mercadopago', pix_key_type: 'provider',
        beneficiary_name: charge.beneficiary, city: '-', emv_payload: charge.emv, status: 'pending',
        expires_at: expiresAt.toISOString(), provider, provider_payment_id: charge.providerPaymentId, raw_provider: charge.raw,
      }).select('id, txid, emv_payload, expires_at').single();
      if (insErr || !row) {
        // Cobrança existe no provedor mas não aqui: cancela lá pra não receber dinheiro sem rastro.
        await cancelAtProvider(p, { id: pixId, provider, provider_payment_id: charge.providerPaymentId } as PixRow);
        throw insErr ?? new Error('insert fin_pix_payments falhou');
      }
      log('INFO', 'create_charge', 'criado', { pixId, provider, amount });
      return json({
        pix_payment_id: row.id, txid: row.txid, emv_payload: row.emv_payload, expires_at: row.expires_at,
        pix_key: null, pix_key_type: null, beneficiary_name: charge.beneficiary, amount, provider,
      });
    }

    // ── ACTION: check_status ──────────────────────────────────────────────
    if (action === 'check_status') {
      if (!body.pix_payment_id) return json({ error: 'pix_payment_id é obrigatório' }, 400);
      const row = await loadRow(supabase, body);
      if (!row) return json({ error: 'Pagamento não encontrado' }, 404);
      let status = row.status;
      const expired = new Date(row.expires_at) < new Date();

      if (PROVIDERS.includes(row.provider) && status === 'pending') {
        const auth = await requireMember(req, supabase, row.tenant_id);
        if (auth.error) return auth.error;
        // Vencido: ainda consulta uma última vez (pode ter pago no último segundo).
        if (expired || Date.now() - new Date(row.updated_at).getTime() >= RECONCILE_EVERY_MS) {
          try { status = await reconcileRow(supabase, row); } catch (e) { log('WARN', 'check_status', 'reconcile falhou', { id: row.id, error: friendlyError(e) }); }
        }
      }
      if (status === 'pending' && expired) {
        await supabase.from('fin_pix_payments').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'pending');
        status = 'expired';
      }
      return json({ status, confirmed_at: status === 'confirmed' ? (row.confirmed_at ?? new Date().toISOString()) : null, amount: row.amount, txid: row.txid });
    }

    // ── ACTION: confirm — manual, só admin/gerente ────────────────────────
    // Cobrança de provedor: primeiro pergunta ao provedor; só força com force=true.
    if (action === 'confirm') {
      const row = await loadRow(supabase, body);
      if (!row) return json({ error: 'pix_payment_id ou txid é obrigatório' }, 400);
      const auth = await requireMember(req, supabase, row.tenant_id);
      if (auth.error) return auth.error;
      if (!isManager(auth.role)) return json({ error: 'Somente administrador ou gerente' }, 403);
      if (row.status !== 'pending') return json({ success: true, status: row.status });
      if (PROVIDERS.includes(row.provider)) {
        const st = await reconcileRow(supabase, row);
        if (st === 'confirmed') return json({ success: true, status: 'confirmed', via: 'provider' });
        if (body.force !== true) return json({ success: false, status: st, message: 'O banco ainda não confirmou este pagamento.' });
      }
      const now = new Date().toISOString();
      await supabase.from('fin_pix_payments').update({
        status: 'confirmed', confirmed_at: now, updated_at: now, error: `Confirmado manualmente por ${auth.userId}`,
      }).eq('id', row.id).eq('status', 'pending');
      log('WARN', 'confirm', 'confirmação manual', { id: row.id, by: auth.userId });
      return json({ success: true, status: 'confirmed', via: 'manual' });
    }

    // ── ACTION: cancel ────────────────────────────────────────────────────
    if (action === 'cancel') {
      if (!body.pix_payment_id) return json({ error: 'pix_payment_id é obrigatório' }, 400);
      const row = await loadRow(supabase, body);
      if (!row) return json({ success: true, status: 'not_found' });
      if (row.status !== 'pending') return json({ success: true, status: row.status });
      if (PROVIDERS.includes(row.provider)) {
        const auth = await requireMember(req, supabase, row.tenant_id);
        if (auth.error) return auth.error;
        // Antes de cancelar, confere: se o cliente já pagou, o pedido tem que seguir.
        const st = await reconcileRow(supabase, row);
        if (st !== 'pending') return json({ success: true, status: st });
        await cancelAtProvider(await loadProviderCfgs(supabase, row.tenant_id), row);
      }
      await supabase.from('fin_pix_payments').update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'pending');
      return json({ success: true, status: 'cancelled' });
    }

    // ── Config do Pix pelo Banco Inter (Configurações › Formas de pagamento) ──
    if (action === 'get_inter_pix_config') {
      const tenantId = String(body.tenant_id ?? '');
      const auth = await requireMember(req, supabase, tenantId);
      if (auth.error) return auth.error;
      const { inter } = await loadProviderCfgs(supabase, tenantId);
      const cid = String(inter?.client_id ?? '');
      return json({
        configured: Boolean(inter?.client_id && inter?.cert_pem), is_active: Boolean(inter?.is_active),
        client_id_masked: cid ? (cid.length > 8 ? `${cid.slice(0, 4)}…${cid.slice(-4)}` : '••••') : null,
        pix_key: inter?.pix_key ?? null, environment: inter?.environment ?? 'production', conta_corrente: inter?.conta_corrente ?? null,
        has_cert: Boolean(inter?.cert_pem && inter?.key_pem), cert_expires_at: inter?.cert_expires_at ?? null,
        last_test_at: inter?.last_test_at ?? null,
      });
    }

    if (action === 'save_inter_pix_config' || action === 'test_inter_pix_config') {
      const tenantId = String(body.tenant_id ?? '');
      const auth = await requireMember(req, supabase, tenantId);
      if (auth.error) return auth.error;
      if (!isManager(auth.role)) return json({ error: 'Somente administrador ou gerente' }, 403);
      const { inter: existing } = await loadProviderCfgs(supabase, tenantId);
      const pick = (k: 'client_id' | 'client_secret' | 'pix_key') => String(body[k] ?? '').trim() || String(existing?.[k] ?? '');
      const cand: ProviderCfg = {
        ...(existing ?? ({} as ProviderCfg)),
        id: existing?.id ?? 'novo', updated_at: new Date().toISOString(), provider: 'inter_pix',
        client_id: pick('client_id'), client_secret: pick('client_secret'), pix_key: pick('pix_key'),
        cert_pem: String(body.cert_pem ?? '').trim() ? normalizePem(body.cert_pem) : (existing?.cert_pem ?? ''),
        key_pem: String(body.key_pem ?? '').trim() ? normalizePem(body.key_pem) : (existing?.key_pem ?? ''),
        environment: ['production', 'sandbox'].includes(String(body.environment)) ? String(body.environment) : (existing?.environment ?? 'production'),
        conta_corrente: body.conta_corrente === undefined ? (existing?.conta_corrente ?? null) : (String(body.conta_corrente).replace(/\D/g, '') || null),
      };
      if (!cand.client_id || !cand.client_secret) return json({ error: 'Informe o Client ID e o Client Secret da integração' }, 422);
      if (!/-----BEGIN CERTIFICATE-----/.test(String(cand.cert_pem))) return json({ error: 'Certificado inválido: envie o arquivo .crt (começa com -----BEGIN CERTIFICATE-----)' }, 422);
      if (!/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(String(cand.key_pem))) return json({ error: 'Chave privada inválida: envie o arquivo .key (começa com -----BEGIN PRIVATE KEY-----)' }, 422);
      if (action === 'save_inter_pix_config' && !cand.pix_key) return json({ error: 'Informe a chave Pix cadastrada nessa conta do Inter' }, 422);

      // Valida na hora: pede um token com os escopos de Pix (prova certificado + credenciais + permissões).
      try { await interToken(cand, true); }
      catch (e) { return json({ error: friendlyError(e) }, 422); }
      const now = new Date().toISOString();

      if (action === 'test_inter_pix_config') {
        if (existing) await supabase.from('fin_payment_provider_config').update({ last_test_at: now }).eq('id', existing.id);
        return json({ ok: true });
      }

      const isActive = typeof body.is_active === 'boolean' ? body.is_active : (existing?.is_active ?? true);
      const { error } = await supabase.from('fin_payment_provider_config').upsert({
        tenant_id: tenantId, provider: 'inter_pix', is_active: isActive,
        client_id: cand.client_id, client_secret: cand.client_secret, cert_pem: cand.cert_pem, key_pem: cand.key_pem,
        pix_key: cand.pix_key, environment: cand.environment, conta_corrente: cand.conta_corrente,
        cert_expires_at: await certNotAfter(String(cand.cert_pem)), account_label: 'Banco Inter',
        last_test_at: now, updated_at: now,
      }, { onConflict: 'tenant_id,provider' });
      if (error) throw error;
      log('INFO', 'save_inter_pix_config', 'ok', { tenantId, by: auth.userId, isActive });
      const { inter } = await loadProviderCfgs(supabase, tenantId);
      return json({ ok: true, is_active: Boolean(inter?.is_active), cert_expires_at: inter?.cert_expires_at ?? null });
    }

    return json({ error: 'Ação inválida' }, 400);

  } catch (err) {
    log('ERROR', 'handler', 'unexpected', { error: String(err) });
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
