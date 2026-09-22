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
  // Sem isto o navegador repete o preflight (OPTIONS) a cada ~5 s durante o polling.
  'Access-Control-Max-Age': '86400',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const log = (level: string, scope: string, msg: string, extra?: unknown) =>
  console.log(JSON.stringify({ level, scope: `pix-payment/${scope}`, msg, ...(extra ? { extra } : {}) }));
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const PROVIDERS = ['inter_pix', 'mercadopago', 'mp_point'];
const PIX_EXPIRATION_SEC = 600;
// O tablet consulta a cada 2 s; o provedor é consultado no máximo a cada 1,5 s por cobrança.
const RECONCILE_EVERY_MS = 1500;

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

// Configurar a maquininha do balcão: admin/gerente, ou o papel que o dono liberou
// em Configurações › Permissões ("Maquininha do balcão"). É a única config que a
// loja mexe sozinha — trocou de máquina, aponta a nova. Vale só para a maquininha:
// as outras ações de escrita continuam de admin/gerente.
async function podeMaquininha(admin: Admin, tenantId: string, role: string) {
  if (isManager(role)) return true;
  if (!role) return false;
  const { data } = await admin.from('permissions').select('allowed')
    .eq('tenant_id', tenantId).eq('role', role).eq('permission_key', 'cfg_maquininha_mp')
    .limit(1).maybeSingle();
  return data?.allowed === true;
}

// Tablet do autoatendimento que está chamando: o kiosk-auth cria um usuário por token
// (user_metadata.kiosk_token_id; e-mail kiosk-<token_id>@kiosk.erpos.internal).
async function kioskTokenIdOf(admin: Admin, userId: string): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin.auth.admin.getUserById(userId);
  const u = data?.user;
  const meta = String(u?.user_metadata?.kiosk_token_id ?? '');
  if (meta) return meta;
  const m = String(u?.email ?? '').match(/^kiosk-([0-9a-f-]{36})@kiosk\.erpos\.internal$/i);
  return m ? m[1] : null;
}

// Maquininha de quem está cobrando. Os tablets entram com usuário próprio (perfil 'tablet',
// criado em Usuários): mapa fin_payment_provider_config.tablet_terminals { user_id: terminal }.
// Depois o kiosk_tokens.point_terminal_id (acesso por token) e, sem vínculo, a padrão da loja.
// station='pdv' (cobrança nascida no Caixa) usa a maquininha do caixa: o operador do caixa é
// um usuário comum e cairia na máquina de um tablet se seguisse o caminho de cima.
async function terminalForCaller(admin: Admin, tenantId: string, userId: string, point: ProviderCfg, station?: string) {
  if (station === 'pdv') return point.pdv_terminal_id ?? point.terminal_id;
  const porUsuario = point.tablet_terminals?.[userId];
  if (porUsuario) return porUsuario;
  const tokenId = await kioskTokenIdOf(admin, userId);
  if (tokenId) {
    const { data } = await admin.from('kiosk_tokens').select('point_terminal_id').eq('id', tokenId).eq('tenant_id', tenantId).maybeSingle();
    if (data?.point_terminal_id) return String(data.point_terminal_id);
  }
  return point.terminal_id;
}

// ── Config dos provedores ────────────────────────────────────────────────────
type ProviderCfg = {
  id: string; provider: string; is_active: boolean; access_token: string | null; account_label: string | null;
  client_id: string | null; client_secret: string | null; cert_pem: string | null; key_pem: string | null;
  pix_key: string | null; environment: string | null; conta_corrente: string | null;
  cert_expires_at: string | null; last_test_at: string | null; updated_at: string; token_expires_at: string | null;
  terminal_id: string | null; pdv_terminal_id?: string | null; pdv_pix_terminal?: boolean | null;
  webhook_secret?: string | null; tablet_terminals?: Record<string, string> | null;
};
async function loadProviderCfgs(admin: Admin, tenantId: string) {
  const { data } = await admin.from('fin_payment_provider_config')
    .select('id, provider, is_active, access_token, account_label, client_id, client_secret, cert_pem, key_pem, pix_key, environment, conta_corrente, cert_expires_at, last_test_at, updated_at, token_expires_at, terminal_id, pdv_terminal_id, pdv_pix_terminal, webhook_secret, tablet_terminals')
    .eq('tenant_id', tenantId).in('provider', PROVIDERS);
  const rows = (data ?? []) as ProviderCfg[];
  return {
    inter: rows.find((r) => r.provider === 'inter_pix') ?? null,
    mp: rows.find((r) => r.provider === 'mercadopago') ?? null,
    point: rows.find((r) => r.provider === 'mp_point') ?? null,
  };
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

// Um cliente mTLS por credencial, reaproveitado entre chamadas: mantém a conexão TLS com o
// Inter aberta (criar um por chamada refazia o handshake a cada consulta do tablet).
// Nomes do Deno 2 (cert/key). Os antigos certChain/privateKey são ignorados em silêncio.
const interClients = new Map<string, HttpClient>();
function interClientFor(D: { createHttpClient?: (o: Record<string, unknown>) => HttpClient }, cfg: ProviderCfg): HttpClient {
  const key = `${cfg.id}:${cfg.updated_at}`;
  let c = interClients.get(key);
  if (!c) {
    if (interClients.size >= 20) {
      for (const old of interClients.values()) { try { old.close?.(); } catch { /* noop */ } }
      interClients.clear();
    }
    c = D.createHttpClient!({ cert: cfg.cert_pem, key: cfg.key_pem });
    interClients.set(key, c);
  }
  return c;
}

async function interFetch(cfg: ProviderCfg, path: string, init: RequestInit & { token?: string } = {}): Promise<InterResp> {
  const D = Deno as unknown as { createHttpClient?: (o: Record<string, unknown>) => HttpClient };
  if (typeof D.createHttpClient !== 'function') throw new Error('Runtime sem Deno.createHttpClient — mTLS indisponível');
  const client = interClientFor(D, cfg);
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
// Admin client da requisição corrente: guarda o token no banco pra outras instâncias reaproveitarem.
let DB: Admin | null = null;
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
async function interToken(cfg: ProviderCfg, force = false): Promise<string> {
  const key = `${cfg.id}:${cfg.updated_at}`;
  const hit = interTokens.get(key);
  if (!force && hit && hit.exp - Date.now() > 60_000) return hit.token;
  // Instância nova: reaproveita o token guardado no banco (evita pedir outro a cada cold start).
  if (!force && cfg.access_token && cfg.token_expires_at && new Date(cfg.token_expires_at).getTime() - Date.now() > 60_000) {
    interTokens.set(key, { token: cfg.access_token, exp: new Date(cfg.token_expires_at).getTime() });
    return cfg.access_token;
  }
  const body = new URLSearchParams({
    client_id: String(cfg.client_id), client_secret: String(cfg.client_secret),
    grant_type: 'client_credentials', scope: INTER_SCOPE,
  });
  const r = await interFetch(cfg, '/oauth/v2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  if (!r.ok || !r.data?.access_token) throw new Error(interError(r, 'Token'));
  const exp = Date.now() + Number(r.data.expires_in ?? 3600) * 1000;
  interTokens.set(key, { token: String(r.data.access_token), exp });
  if (DB && isUuid(cfg.id)) {
    await DB.from('fin_payment_provider_config').update({ access_token: String(r.data.access_token), token_expires_at: new Date(exp).toISOString() }).eq('id', cfg.id);
  }
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

// Devolve false só quando o provedor RECUSOU o cancelamento da maquininha (cobrança já
// capturada no terminal) — aí a linha não pode virar 'cancelled', senão um pagamento que
// o MP confirma depois (visto 2026-09-14: ~2 min de atraso) entra sem pedido e sem rastro.
async function cancelAtProvider(p: { inter: ProviderCfg | null; mp: ProviderCfg | null; point?: ProviderCfg | null }, row: PixRow): Promise<boolean> {
  try {
    if (row.provider === 'inter_pix' && p.inter?.cert_pem) {
      await interApi(p.inter, `/pix/v2/cob/${row.provider_payment_id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }),
      });
    } else if (row.provider === 'mercadopago' && p.mp?.access_token) {
      await mpFetch(p.mp.access_token, `/v1/payments/${row.provider_payment_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    } else if (row.provider === 'mp_point' && p.point?.access_token) {
      // `x-allow-cancelable-status: at_terminal` é obrigatório para cancelar uma order que o
      // terminal JÁ pegou (é o caso normal: a maquininha busca a cobrança em segundos). Sem
      // esse header o MP só cancela orders em `created` — era por isso que o valor continuava
      // no visor depois do cliente desistir no totem (2026-09-21).
      const r = await mpFetch(p.point.access_token, `/v1/orders/${row.provider_payment_id}/cancel`, {
        method: 'POST',
        headers: { 'X-Idempotency-Key': crypto.randomUUID(), 'x-allow-cancelable-status': 'at_terminal' },
      });
      if (!r.ok) {
        log('WARN', 'cancel', 'MP recusou cancelar a order Point', { id: row.id, status: r.status, body: r.body });
        return false;
      }
    }
  } catch (e) { log('WARN', 'cancel', 'cancelar no provedor falhou', { id: row.id, error: String(e) }); }
  return true;
}

// ── Mercado Pago Point (maquininha em modo PDV, API de Orders) ─────────────
// A cobrança vai pro terminal escolhido (fin_payment_provider_config provider = 'mp_point',
// token de uma aplicação "Point" — separada do Pix online). Teste: terminal virtual
// NEWLAND_N950__SBX0000001 + POST /v1/orders/{id}/events pra simular o resultado; o
// token precisa ser o de produção de uma CONTA VENDEDORA DE TESTE (token TEST- é recusado).
const POINT_EXPIRATION = 'PT15M';
const POINT_EXPIRATION_MS = 15 * 60 * 1000;
const pointReady = (c: ProviderCfg | null) => Boolean(c && c.is_active && c.access_token && c.terminal_id);
// deno-lint-ignore no-explicit-any
const pointErr = (b: any) => {
  const e = b?.errors?.[0];
  const det = Array.isArray(e?.details) && e.details.length ? ` — ${e.details.join('; ')}` : '';
  return String(e?.message ?? b?.message ?? JSON.stringify(b ?? {}).slice(0, 200)) + det;
};

// `externalRef` é o que aparece em EXTERNAL_REFERENCE no Relatório de Liberações e na busca de
// pagamentos: com o número do pedido ali, a conciliação casa venda × pedido sem adivinhar valor.
async function createPointOrder(cfg: ProviderCfg, chargeId: string, amount: number, method: string, desc: string, externalRef?: string) {
  // Formas aceitas em `config.payment_method.default_type`, ditas pelo próprio Mercado Pago
  // (erro `property_value` em 2026-09-21): 'credit_card', 'debit_card', 'qr', 'voucher_card'.
  // Pix na maquininha é **'qr'** — 'pix' é recusado. `default_type` é opcional: se a forma for
  // recusada, reenviamos sem forma definida e a própria maquininha mostra o menu ao cliente.
  const tipo = method === 'debit_card' ? 'debit_card' : method === 'pix' ? 'qr' : 'credit_card';
  const montar = (defaultType: string | null) => JSON.stringify({
      type: 'point', external_reference: (externalRef ?? chargeId).slice(0, 60), expiration_time: POINT_EXPIRATION, description: desc.slice(0, 150),
      transactions: { payments: [{ amount: amount.toFixed(2) }] },
      config: {
        point: { terminal_id: cfg.terminal_id, print_on_terminal: 'no_ticket' },
        ...(defaultType === null ? {} : { payment_method: {
          default_type: defaultType,
          // `default_installments: 1` deixa 1x pré-selecionada. MEDIDO na Point Smart da loja
          // (2026-09-21, R$ 44,00): o terminal mostra a tela "à vista ou parcelado" do mesmo
          // jeito — nem com `installments_cost` ('buyer' e 'seller', os dois testados) ele
          // pula. Tirar essa tela é configuração de parcelamento da CONTA do Mercado Pago,
          // não campo da order. Por isso `installments_cost` NÃO vai aqui: ele decide quem
          // paga os juros, e essa escolha é do dono, não um efeito colateral nosso.
          // (`default_installments_cost`, nome que a tabela de migração da doc usa, o MP
          // recusa com "additionalProperties not allowed".)
          // Pix não tem parcela; débito também não.
          ...(defaultType === 'credit_card' ? { default_installments: 1 } : {}),
        } }),
      },
    });
  let r = await mpFetch(String(cfg.access_token), '/v1/orders', {
    method: 'POST', headers: { 'X-Idempotency-Key': chargeId }, body: montar(tipo),
  });
  if (!r.ok && tipo === 'qr') {
    log('WARN', 'create_point_order', 'qr recusado como default_type; reenviando sem forma definida', { chargeId, status: r.status, body: r.body });
    r = await mpFetch(String(cfg.access_token), '/v1/orders', {
      method: 'POST', headers: { 'X-Idempotency-Key': `${chargeId}-open` }, body: montar(null),
    });
  }
  if (!r.ok || !r.body?.id) {
    log('WARN', 'create_point_order', 'recusado', { chargeId, status: r.status, body: r.body });
    throw new Error(`Mercado Pago Point ${r.status}: ${pointErr(r.body)}`);
  }
  // Guarda o `config` que o MP devolveu: é a única forma de conferir depois se ele aceitou
  // o `default_installments` (crédito à vista) ou se o terminal ignorou a preferência.
  return { providerPaymentId: String(r.body.id), raw: { id: r.body.id, status: r.body.status, config: r.body.config ?? null } };
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
  let failed = false; let detail = ''; let cardMethod: string | null = null;

  if (row.provider === 'inter_pix') {
    if (!p.inter?.cert_pem) return row.status;
    const t0 = Date.now();
    const r = await interApi(p.inter, `/pix/v2/cob/${row.provider_payment_id}`);
    if (!r.ok) { log('WARN', 'reconcile', 'GET cob falhou', { id: row.id, http: r.status, body: r.raw.slice(0, 200) }); return row.status; }
    const st = String(r.data?.status ?? '');
    const pixList = Array.isArray(r.data?.pix) ? r.data.pix : [];
    paid = st === 'CONCLUIDA';
    gone = st.startsWith('REMOVIDA');
    // Mede o tempo da consulta e, quando pago, quanto o Inter levou pra marcar a cobrança como paga.
    log('INFO', 'reconcile', 'cob', { id: row.id, st, ms: Date.now() - t0, lag_ms: paid && pixList[0]?.horario ? Date.now() - Date.parse(pixList[0].horario) : null });
    // deno-lint-ignore no-explicit-any
    got = round2(pixList.reduce((s: number, x: any) => s + Number(x?.valor ?? 0), 0));
    // deno-lint-ignore no-explicit-any
    raw = { status: st, pix: pixList.map((x: any) => ({ endToEndId: x?.endToEndId, valor: x?.valor, horario: x?.horario })) };
  } else if (row.provider === 'mp_point') {
    if (!p.point?.access_token) return row.status;
    const r = await mpFetch(p.point.access_token, `/v1/orders/${row.provider_payment_id}`);
    if (!r.ok) { log('WARN', 'reconcile', 'GET order Point falhou', { id: row.id, http: r.status }); return row.status; }
    const st = String(r.body.status ?? '');
    const pay = r.body.transactions?.payments?.[0] ?? {};
    paid = st === 'processed';
    failed = st === 'failed';
    gone = ['canceled', 'expired', 'refunded'].includes(st);
    got = round2(Number(r.body.total_paid_amount ?? pay.paid_amount ?? pay.amount ?? 0));
    // vale o que a maquininha respondeu; Pix vem como bank_transfer
    const tipoPago = String(pay.payment_method?.type ?? '');
    cardMethod = tipoPago === 'debit_card' ? 'debit_card'
      : (tipoPago === 'bank_transfer' || tipoPago === 'pix' || String(pay.payment_method?.id ?? '') === 'pix') ? 'pix'
      : 'credit_card';
    detail = String(pay.status_detail ?? r.body.status_detail ?? '');
    raw = { id: r.body.id, status: st, status_detail: detail, payment: { id: pay.id ?? null, method: pay.payment_method ?? null, reference: pay.reference ?? null } };
    log('INFO', 'reconcile', 'point', { id: row.id, st, detail });
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
    await admin.from('fin_pix_payments').update({ status: 'confirmed', confirmed_at: now, updated_at: now, raw_provider: raw, ...(cardMethod ? { method: cardMethod } : {}) })
      .eq('id', row.id).eq('status', 'pending');
    log('INFO', 'reconcile', 'confirmado pelo provedor', { id: row.id, provider: row.provider, amount: got });
    return 'confirmed';
  }
  if (failed) {
    // Cartão recusado na maquininha: o tablet mostra o motivo e oferece tentar de novo.
    await admin.from('fin_pix_payments').update({ status: 'failed', error: detail || 'failed', updated_at: now, raw_provider: raw }).eq('id', row.id).eq('status', 'pending');
    return 'failed';
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

// ── Webhook do Mercado Pago Point (tópico "Order (Mercado Pago)") ────────────
// Configurado na aplicação Point da loja: POST ?webhook=point&tenant_id=<uuid>. Sem ele só o
// polling do tablet confirmava — tablet fechado/travado = cartão cobrado sem registro.
// O corpo nunca é confiável: só pegamos o id da order e o reconcileRow pergunta ao MP.
async function hmacSha256Hex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function handlePointWebhook(req: Request, admin: Admin, url: URL) {
  const tenantId = url.searchParams.get('tenant_id') ?? '';
  const dataIdQuery = url.searchParams.get('data.id') ?? '';
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const type = String(body.type ?? url.searchParams.get('type') ?? '');
  const dataId = String((body.data as { id?: string } | undefined)?.id ?? dataIdQuery ?? '');
  log('INFO', 'webhook_point', 'recebido', { tenantId, type, action: body.action, dataId });
  if (!isValidUuidLoose(tenantId) || type !== 'order' || !dataId) return json({ ok: true, ignored: true });

  const { point } = await loadProviderCfgs(admin, tenantId);
  if (!point?.access_token) return json({ ok: true, ignored: 'no_config' });

  // Assinatura (x-signature: ts=...,v1=...) — manifesto id:{data.id};request-id:{x-request-id};ts:{ts};
  if (point.webhook_secret) {
    const sig = req.headers.get('x-signature') ?? '';
    const reqId = req.headers.get('x-request-id') ?? '';
    const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
    const rawId = dataIdQuery || dataId;
    const idForManifest = /^[a-z0-9]+$/i.test(rawId) ? rawId.toLowerCase() : rawId;
    const expected = await hmacSha256Hex(point.webhook_secret, `id:${idForManifest};request-id:${reqId};ts:${parts.ts ?? ''};`);
    if (!parts.v1 || expected !== parts.v1) {
      log('WARN', 'webhook_point', 'assinatura inválida', { tenantId, dataId });
      return json({ ok: false, error: 'invalid_signature' }, 401);
    }
  }

  const { data: row } = await admin.from('fin_pix_payments').select(PIX_COLS)
    .eq('provider', 'mp_point').eq('provider_payment_id', dataId).eq('tenant_id', tenantId).maybeSingle();
  if (!row) return json({ ok: true, ignored: 'unknown_order' });
  const status = await reconcileRow(admin, row as PixRow);
  if (status === 'confirmed') {
    // Confirmado pelo webhook: o pedido nasce no tablet. Se o tablet sumiu, fica o rastro aqui.
    const { data: fresh } = await admin.from('fin_pix_payments').select('order_id').eq('id', (row as PixRow).id).maybeSingle();
    if (!fresh?.order_id) log('WARN', 'webhook_point', 'cartão aprovado, pedido ainda não criado pelo tablet', { tenantId, pixPaymentId: (row as PixRow).id, mpOrder: dataId });
  }
  return json({ ok: true, status });
}
const isValidUuidLoose = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = getAdminClient();
  DB = supabase;

  try {
    const url = new URL(req.url);
    if (url.searchParams.get('webhook') === 'point') return await handlePointWebhook(req, supabase, url);

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

    // ── ACTION: attach_order — liga o Pix confirmado ao pedido que o tablet criou ──
    // O pedido do kiosk só nasce depois do Pix pago; isto deixa o rastro Pix → pedido
    // (e mostra na fin_pix_payments quem pagou e ficou sem pedido, se o tablet travar).
    if (action === 'attach_order') {
      const row = await loadRow(supabase, body);
      const orderId = String(body.order_id ?? '');
      if (!row || !orderId) return json({ error: 'pix_payment_id e order_id são obrigatórios' }, 400);
      const auth = await requireMember(req, supabase, row.tenant_id);
      if (auth.error) return auth.error;
      const { data: o } = await supabase.from('orders').select('id').eq('id', orderId).eq('tenant_id', row.tenant_id).maybeSingle();
      if (!o) return json({ error: 'Pedido não encontrado' }, 404);
      await supabase.from('fin_pix_payments').update({ order_id: orderId, updated_at: new Date().toISOString() }).eq('id', row.id).is('order_id', null);
      return json({ ok: true });
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
      // Cartão: qual forma o cliente usou (crédito/débito) e, se recusado, o motivo.
      const { data: fresh } = (status === 'confirmed' || status === 'failed')
        ? await supabase.from('fin_pix_payments').select('method, error').eq('id', row.id).maybeSingle()
        : { data: null };
      return json({
        status, confirmed_at: status === 'confirmed' ? (row.confirmed_at ?? new Date().toISOString()) : null, amount: row.amount, txid: row.txid,
        method: fresh?.method ?? null, error: status === 'failed' ? (fresh?.error ?? null) : null,
      });
    }

    // ── ACTION: confirm — manual, só admin/gerente ────────────────────────
    // Cobrança de provedor: primeiro pergunta ao provedor; só força com force=true.
    if (action === 'confirm') {
      const row = await loadRow(supabase, body);
      if (!row) return json({ error: (body.pix_payment_id || body.txid) ? 'Pagamento não encontrado' : 'pix_payment_id ou txid é obrigatório' }, (body.pix_payment_id || body.txid) ? 404 : 400);
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
        if (st !== 'pending') {
          const { data: f } = await supabase.from('fin_pix_payments').select('method').eq('id', row.id).maybeSingle();
          return json({ success: true, status: st, method: f?.method ?? null });
        }
        const cancelou = await cancelAtProvider(await loadProviderCfgs(supabase, row.tenant_id), row);
        // Maquininha já com a cobrança: continua pendente (o cliente pode estar pagando).
        if (!cancelou) return json({ success: false, status: 'pending', code: 'at_terminal' });
      }
      await supabase.from('fin_pix_payments').update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'pending');
      return json({ success: true, status: 'cancelled' });
    }

    // ── Maquininha (Mercado Pago Point) no autoatendimento ─────────────────
    if (action === 'kiosk_card_provider') {
      const tenantId = String(body.tenant_id ?? '');
      const auth = await requireMember(req, supabase, tenantId);
      if (auth.error) return auth.error;
      const { point } = await loadProviderCfgs(supabase, tenantId);
      // `pdv` só é true com uma maquininha ESCOLHIDA para o caixa. De propósito não cai no
      // terminal_id da loja: esse é o do tablet, e o caixa cobraria na máquina errada — a loja
      // precisa dizer qual é a do balcão antes de o caixa parar de lançar o cartão à mão.
      return json({
        point: pointReady(point), sandbox: point?.environment === 'sandbox',
        pdv: pointReady(point) && Boolean(point!.pdv_terminal_id),
        // Pix do caixa na maquininha é interruptor à parte: a loja pode querer cartão na
        // máquina e Pix na mão. No tablet nada muda — lá o QR fica na tela do próprio tablet.
        pdv_pix: pointReady(point) && Boolean(point!.pdv_terminal_id) && point!.pdv_pix_terminal === true,
      });
    }

    if (action === 'create_card_charge') {
      const tenantId = String(body.tenant_id ?? '');
      const amount = round2(Number(body.amount));
      const station = body.station === 'pdv' ? 'pdv' : 'kiosk';
      const pediuPix = body.method === 'pix';
      const method = body.method === 'debit_card' ? 'debit_card' : pediuPix ? 'pix' : 'credit_card';
      const orderId = typeof body.order_id === 'string' && body.order_id ? body.order_id : null;
      const orderNumber = typeof body.order_number === 'string' && body.order_number ? String(body.order_number).slice(0, 40) : null;
      if (!tenantId || !(amount >= 0.01)) return json({ error: 'tenant_id e amount são obrigatórios' }, 400);
      const auth = await requireMember(req, supabase, tenantId);
      if (auth.error) return auth.error;
      const { point } = await loadProviderCfgs(supabase, tenantId);
      if (!pointReady(point)) return json({ error: 'A maquininha não está configurada nesta loja.', code: 'no_point' }, 422);
      // Pix na maquininha só existe no caixa e só com a opção ligada (o tablet usa a tela dele).
      if (method === 'pix' && !(station === 'pdv' && point!.pdv_pix_terminal === true)) {
        return json({ error: 'Pix na maquininha não está ligado nesta loja.', code: 'no_pix_terminal' }, 422);
      }
      // Orders API recusa amount < 1.00 ("Must be greater than or equal to 1.00").
      if (amount < 1) return json({ error: 'Cartão na maquininha só a partir de R$ 1,00. Escolha outra forma ou pague no balcão.', code: 'min_amount' }, 422);

      const chargeId = crypto.randomUUID();
      const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).maybeSingle();
      let created: { providerPaymentId: string; raw: unknown };
      const terminalId = await terminalForCaller(supabase, tenantId, auth.userId, point!, station);
      if (!terminalId) {
        return json({ error: 'Nenhuma maquininha vinculada a este caixa. Configure em Configurações › Formas de pagamento › Maquininha Mercado Pago Point.', code: 'no_terminal' }, 422);
      }
      const desc = station === 'pdv'
        ? `${tenant?.name ?? 'Restaurante'} - Caixa${orderNumber ? ` · pedido ${orderNumber}` : ''}`
        : `${tenant?.name ?? 'Restaurante'} - Autoatendimento`;
      try {
        created = await createPointOrder({ ...point!, terminal_id: terminalId }, chargeId, amount, method, desc, orderNumber ?? undefined);
      } catch (e) {
        const detail = String((e as Error)?.message ?? e);
        log('ERROR', 'create_card_charge', 'Mercado Pago recusou', { tenantId, detail });
        return json({ error: 'Não foi possível enviar a cobrança para a maquininha. Tente de novo ou pague no balcão.', code: 'provider_error', detail }, 502);
      }
      const { data: row, error: insErr } = await supabase.from('fin_pix_payments').insert({
        id: chargeId, tenant_id: tenantId, order_id: orderId, txid: chargeId.replace(/-/g, ''), amount, method,
        pix_key: 'mp_point', pix_key_type: 'provider', beneficiary_name: 'Mercado Pago Point', city: '-', emv_payload: null,
        status: 'pending', expires_at: new Date(Date.now() + POINT_EXPIRATION_MS).toISOString(),
        provider: 'mp_point', provider_payment_id: created.providerPaymentId, raw_provider: created.raw,
      }).select('id, expires_at').single();
      if (insErr || !row) {
        // Cobrança existe na maquininha mas não aqui: cancela lá pra não receber sem rastro.
        await cancelAtProvider(await loadProviderCfgs(supabase, tenantId), { id: chargeId, provider: 'mp_point', provider_payment_id: created.providerPaymentId } as PixRow);
        throw insErr ?? new Error('insert fin_pix_payments falhou');
      }
      log('INFO', 'create_card_charge', 'criado', { chargeId, mpOrder: created.providerPaymentId, amount, method, terminalId, station, orderNumber, sandbox: point!.environment === 'sandbox' });
      return json({ pix_payment_id: row.id, expires_at: row.expires_at, provider: 'mp_point', station, sandbox: point!.environment === 'sandbox' });
    }

    // Só no modo TESTE (terminal virtual): força o resultado da cobrança no Mercado Pago,
    // como o cliente faria na maquininha. Em produção a ação é recusada.
    if (action === 'simulate_card') {
      const row = await loadRow(supabase, body);
      if (!row || row.provider !== 'mp_point') return json({ error: 'Cobrança não encontrada' }, 404);
      const auth = await requireMember(req, supabase, row.tenant_id);
      if (auth.error) return auth.error;
      const { point } = await loadProviderCfgs(supabase, row.tenant_id);
      if (point?.environment !== 'sandbox') return json({ error: 'Simulação só existe no modo teste' }, 403);
      const outcome = String(body.outcome ?? '');
      const ev = outcome === 'declined'
        ? { status: 'failed', payment_method_type: 'credit_card', installments: 1, payment_method_id: 'visa', status_detail: 'insufficient_amount' }
        : outcome === 'approved_debit'
          ? { status: 'processed', payment_method_type: 'debit_card', payment_method_id: 'debvisa', status_detail: 'accredited' }
          : { status: 'processed', payment_method_type: 'credit_card', installments: 1, payment_method_id: 'visa', status_detail: 'accredited' };
      const r = await mpFetch(String(point.access_token), `/v1/orders/${row.provider_payment_id}/events`, { method: 'POST', body: JSON.stringify(ev) });
      if (!r.ok) return json({ error: `Simulação recusada pelo Mercado Pago (${r.status}): ${pointErr(r.body)}` }, 502);
      log('INFO', 'simulate_card', 'ok', { id: row.id, outcome });
      return json({ ok: true });
    }

    // ── Config da maquininha (Configurações › Formas de pagamento) ─────────
    if (action === 'get_point_config') {
      const tenantId = String(body.tenant_id ?? '');
      const auth = await requireMember(req, supabase, tenantId);
      if (auth.error) return auth.error;
      const { point } = await loadProviderCfgs(supabase, tenantId);
      return json({
        configured: Boolean(point?.access_token), is_active: Boolean(point?.is_active),
        environment: point?.environment === 'sandbox' ? 'sandbox' : 'production', terminal_id: point?.terminal_id ?? null,
        pdv_terminal_id: point?.pdv_terminal_id ?? null, pdv_pix_terminal: point?.pdv_pix_terminal === true,
        token_hint: point?.access_token ? `…${point.access_token.slice(-6)}` : null, last_test_at: point?.last_test_at ?? null,
        has_webhook_secret: Boolean(point?.webhook_secret),
        webhook_url: `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/pix-payment?webhook=point&tenant_id=${tenantId}`,
      });
    }

    // Tablets da loja × maquininha de cada um (vários tablets, cada um com a sua Point).
    if (action === 'list_point_tablets' || action === 'set_tablet_terminal') {
      const tenantId = String(body.tenant_id ?? '');
      const auth = await requireMember(req, supabase, tenantId);
      if (auth.error) return auth.error;
      if (!await podeMaquininha(supabase, tenantId, auth.role)) return json({ error: 'Sem permissão para configurar a maquininha' }, 403);
      const { point } = await loadProviderCfgs(supabase, tenantId);
      if (action === 'set_tablet_terminal') {
        const tabletUserId = String(body.tablet_user_id ?? '');
        const terminalId = String(body.terminal_id ?? '').trim();
        if (!tabletUserId) return json({ error: 'Escolha o tablet' }, 422);
        if (!point) return json({ error: 'Salve a configuração da maquininha antes' }, 422);
        const { data: m } = await supabase.from('user_tenants').select('user_id')
          .eq('user_id', tabletUserId).eq('tenant_id', tenantId).eq('role', 'tablet').limit(1).maybeSingle();
        if (!m) return json({ error: 'Tablet não encontrado nesta loja' }, 404);
        const mapa: Record<string, string> = { ...(point.tablet_terminals ?? {}) };
        if (terminalId) mapa[tabletUserId] = terminalId; else delete mapa[tabletUserId];
        const { error: updErr } = await supabase.from('fin_payment_provider_config')
          .update({ tablet_terminals: mapa, updated_at: new Date().toISOString() }).eq('id', point.id);
        if (updErr) throw updErr;
        log('INFO', 'set_tablet_terminal', 'ok', { tenantId, tabletUserId, terminalId: terminalId || null, by: auth.userId });
        return json({ ok: true });
      }
      // Tablets = usuários com perfil 'tablet' na loja (criados em Usuários).
      const { data: vinculos, error: listErr } = await supabase.from('user_tenants')
        .select('user_id, created_at').eq('tenant_id', tenantId).eq('role', 'tablet').order('created_at', { ascending: true });
      if (listErr) throw listErr;
      const ids = (vinculos ?? []).map((v) => String(v.user_id));
      const { data: nomes } = ids.length ? await supabase.from('users').select('id, name').in('id', ids) : { data: [] };
      const nomePorId = new Map((nomes ?? []).map((u) => [String(u.id), String(u.name ?? '')]));
      const tablets = ids.map((id, i) => ({
        id, label: nomePorId.get(id) || `Tablet ${i + 1}`, last_used_at: null,
        point_terminal_id: point?.tablet_terminals?.[id] ?? null,
      }));
      return json({ tablets });
    }

    if (action === 'list_point_terminals' || action === 'set_point_mode' || action === 'save_point_config') {
      const tenantId = String(body.tenant_id ?? '');
      const auth = await requireMember(req, supabase, tenantId);
      if (auth.error) return auth.error;
      if (!await podeMaquininha(supabase, tenantId, auth.role)) return json({ error: 'Sem permissão para configurar a maquininha' }, 403);
      const { point } = await loadProviderCfgs(supabase, tenantId);
      const token = String(body.access_token ?? '').trim() || String(point?.access_token ?? '');
      if (!token) return json({ error: 'Informe o Access Token da aplicação Point' }, 422);

      if (action === 'list_point_terminals') {
        const r = await mpFetch(token, '/terminals/v1/list?limit=50');
        if (!r.ok) return json({ error: `O Mercado Pago recusou o token (${r.status}): ${pointErr(r.body)}` }, 422);
        // deno-lint-ignore no-explicit-any
        const list = ((r.body?.data?.terminals ?? []) as any[]).map((t) => ({
          id: String(t.id), operating_mode: String(t.operating_mode ?? ''),
          store_id: t.store_id ? String(t.store_id) : null, pos_id: t.pos_id ? String(t.pos_id) : null,
          external_pos_id: t.external_pos_id ? String(t.external_pos_id) : null,
        }));
        log('INFO', 'list_point_terminals', 'ok', { tenantId, terminals: list });
        return json({ terminals: list });
      }

      if (action === 'set_point_mode') {
        const terminalId = String(body.terminal_id ?? '');
        const mode = body.mode === 'STANDALONE' ? 'STANDALONE' : 'PDV';
        if (!terminalId) return json({ error: 'Escolha a maquininha' }, 422);
        const r = await mpFetch(token, '/terminals/v1/setup', { method: 'PATCH', body: JSON.stringify({ terminals: [{ id: terminalId, operating_mode: mode }] }) });
        if (!r.ok) {
          log('WARN', 'set_point_mode', 'recusado', { tenantId, terminalId, mode, status: r.status, body: r.body });
          return json({ error: `O Mercado Pago recusou (${r.status}): ${pointErr(r.body)}` }, 422);
        }
        const modoFinal = r.body?.terminals?.[0]?.operating_mode ?? r.body?.data?.terminals?.[0]?.operating_mode ?? mode;
        log('INFO', 'set_point_mode', 'ok', { tenantId, terminalId, mode, by: auth.userId });
        return json({ ok: true, operating_mode: modoFinal });
      }

      // save_point_config — valida o token listando terminais (só responde com token válido).
      const environment = body.environment === 'sandbox' ? 'sandbox' : 'production';
      const terminalId = String(body.terminal_id ?? '').trim() || String(point?.terminal_id ?? '');
      if (!terminalId) return json({ error: 'Escolha a maquininha' }, 422);
      const test = await mpFetch(token, '/terminals/v1/list?limit=1');
      if (!test.ok) return json({ error: `Token recusado pelo Mercado Pago (${test.status}): ${pointErr(test.body)}` }, 422);
      const now = new Date().toISOString();
      const isActive = typeof body.is_active === 'boolean' ? body.is_active : (point?.is_active ?? true);
      // Maquininha do caixa: string vazia desvincula (o caixa volta a usar a padrão da loja).
      const pdvTerminal = typeof body.pdv_terminal_id === 'string'
        ? (body.pdv_terminal_id.trim() || null)
        : (point?.pdv_terminal_id ?? null);
      const pdvPix = typeof body.pdv_pix_terminal === 'boolean'
        ? body.pdv_pix_terminal
        : (point?.pdv_pix_terminal === true);
      const { error } = await supabase.from('fin_payment_provider_config').upsert({
        tenant_id: tenantId, provider: 'mp_point', access_token: token, terminal_id: terminalId,
        pdv_terminal_id: pdvTerminal, pdv_pix_terminal: pdvPix && Boolean(pdvTerminal), environment, is_active: isActive,
        account_label: environment === 'sandbox' ? 'Mercado Pago Point · TESTE' : 'Mercado Pago Point', last_test_at: now, updated_at: now,
        // Chave secreta do webhook: em branco mantém a atual.
        ...(typeof body.webhook_secret === 'string' && body.webhook_secret.trim() ? { webhook_secret: body.webhook_secret.trim() } : {}),
      }, { onConflict: 'tenant_id,provider' });
      if (error) throw error;
      log('INFO', 'save_point_config', 'ok', { tenantId, environment, terminalId, pdvTerminal, pdvPix, isActive, by: auth.userId });
      return json({ ok: true, is_active: isActive });
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
        access_token: null, token_expires_at: null, // credencial nova → token novo
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
