// contas-email — a caixa de e-mail que vira Contas a Pagar.
//
// Por que existe: nota fiscal já entra sozinha pela SEFAZ, extrato pelo Inter, venda pela
// maquininha. O boleto que chega por e-mail era o único documento que só existia na caixa de
// alguém — em 2026-09-22 um condomínio de R$ 2.181,55 venceu sem estar no sistema, descoberto
// por acaso no app do banco. Esta função fecha esse buraco.
//
// Gmail lido pela API do Google com OAuth do próprio dono e escopo **somente leitura**
// (`gmail.readonly`): o sistema não envia, não apaga e não marca nada na caixa dele. Sem
// domínio próprio e sem provedor de e-mail no meio.
//
// Ações (POST JSON { action, tenant_id, ... }):
//   get_config        {}                                 estado da conexão (nunca devolve segredo)
//   save_credentials  { client_id, client_secret, query? }  guarda a credencial do Google Cloud
//   oauth_url         { redirect_uri }                    monta o link de autorização
//   exchange          { code, redirect_uri }              troca o code pelo refresh_token e liga
//   test              {}                                  pergunta ao Gmail quantos e-mails o filtro pega
//   disconnect        {}                                  apaga a conexão (a caixa continua intacta)
//
// Autenticação: JWT do usuário (vínculo em user_tenants). Escrita exige admin/gerente/financeiro.
// deno-lint-ignore-file no-explicit-any

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { isFinanceiroRole } from '../_shared/tenant-auth.ts';

type Admin = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
};

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
// Somente leitura, de propósito: mesmo comprometida, a credencial não apaga nem envia e-mail.
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TIMEOUT_MS = 20_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'contas-email', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

async function httpJson(url: string, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { ok: res.ok, status: res.status, body };
  } finally { clearTimeout(timer); }
}

/** Erro do Google em português, dizendo o que dá para fazer. */
function googleError(r: { status: number; body: any }): string {
  const code = String(r.body?.error ?? '');
  const desc = String(r.body?.error_description ?? r.body?.error?.message ?? '').slice(0, 200);
  if (code === 'invalid_client') return 'O Google recusou o ID ou a chave do cliente. Confira os dois em Google Cloud › Credenciais.';
  if (code === 'redirect_uri_mismatch') return 'O endereço de retorno não está autorizado na credencial. Adicione a URL exata em "URIs de redirecionamento autorizados".';
  if (code === 'invalid_grant') return 'A autorização expirou ou foi revogada. Conecte a caixa de novo.';
  if (r.status === 403) return `O Google recusou o acesso (403). A Gmail API está ativada no projeto?${desc ? ` [${desc}]` : ''}`;
  return `Google respondeu ${r.status}${code ? `: ${code}` : ''}${desc ? ` — ${desc}` : ''}`;
}

/** Troca o refresh_token por um access_token novo (eles duram ~1h). */
async function accessToken(cfg: any): Promise<{ token?: string; error?: string }> {
  if (!cfg?.refresh_token || !cfg?.client_id || !cfg?.client_secret) return { error: 'Caixa de e-mail não conectada.' };
  const r = await httpJson(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.client_id, client_secret: cfg.client_secret,
      refresh_token: cfg.refresh_token, grant_type: 'refresh_token',
    }).toString(),
  });
  if (!r.ok || !r.body?.access_token) return { error: googleError(r) };
  return { token: String(r.body.access_token) };
}

function safeConfig(cfg: any) {
  if (!cfg) return null;
  return {
    configured: Boolean(cfg.client_id && cfg.client_secret),
    connected: Boolean(cfg.refresh_token),
    is_active: cfg.is_active === true,
    auto_sync: cfg.auto_sync !== false,
    email_address: cfg.email_address ?? null,
    query: cfg.query ?? '',
    // só a "cara" do client_id, para ele conferir que é o certo sem o segredo voltar
    client_id_hint: cfg.client_id ? `${String(cfg.client_id).slice(0, 12)}…` : null,
    last_check_at: cfg.last_check_at ?? null,
    last_error: cfg.last_error ?? null,
    connected_at: cfg.connected_at ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || serviceRoleKey.length < 40) return errResp('Server misconfiguration', 500);
  const admin: Admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
  const internal = internalKey.length >= 20 && (req.headers.get('x-internal-key') ?? '') === internalKey;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body'); }
  const action = String(body.action ?? '');

  try {
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
    const canWrite = internal || isFinanceiroRole(role);

    const { data: cfg } = await admin.from('fin_mail_config').select('*').eq('tenant_id', tenantId).maybeSingle();

    if (action === 'get_config') return json({ success: true, config: safeConfig(cfg) });

    if (action === 'save_credentials') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode configurar', 403);
      const clientId = String(body.client_id ?? '').trim();
      const clientSecret = String(body.client_secret ?? '').trim();
      if (!clientId || !clientSecret) return errResp('Informe o ID e a chave do cliente OAuth do Google.');
      if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
        return errResp('O ID do cliente do Google termina em ".apps.googleusercontent.com". Confira se copiou o campo certo.');
      }
      const query = String(body.query ?? '').trim() || 'has:attachment newer_than:30d';
      const { error } = await admin.from('fin_mail_config').upsert({
        tenant_id: tenantId, provider: 'gmail', client_id: clientId, client_secret: clientSecret,
        query, last_error: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });
      if (error) return errResp(`Salvar credencial: ${error.message}`);
      const { data: fresh } = await admin.from('fin_mail_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      log('INFO', 'save_credentials', 'ok', { tenantId, by: userId });
      return json({ success: true, config: safeConfig(fresh) });
    }

    if (action === 'oauth_url') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode conectar', 403);
      if (!cfg?.client_id) return errResp('Salve primeiro o ID e a chave do cliente do Google.');
      const redirectUri = String(body.redirect_uri ?? '').trim();
      if (!/^https:\/\//.test(redirectUri)) return errResp('Endereço de retorno inválido.');
      const qs = new URLSearchParams({
        client_id: cfg.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        // offline + consent é o que faz o Google devolver o refresh_token; sem isso a
        // conexão morre em 1h e ninguém entende por quê.
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state: `erpos:${tenantId.slice(0, 8)}`,
      });
      return json({ success: true, url: `${GOOGLE_AUTH}?${qs.toString()}` });
    }

    if (action === 'exchange') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode conectar', 403);
      if (!cfg?.client_id || !cfg?.client_secret) return errResp('Salve primeiro o ID e a chave do cliente do Google.');
      const code = String(body.code ?? '').trim();
      const redirectUri = String(body.redirect_uri ?? '').trim();
      if (!code || !redirectUri) return errResp('code e redirect_uri são obrigatórios');

      const r = await httpJson(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.client_id, client_secret: cfg.client_secret,
          code, redirect_uri: redirectUri, grant_type: 'authorization_code',
        }).toString(),
      });
      if (!r.ok) return errResp(googleError(r));
      const refresh = String(r.body?.refresh_token ?? '');
      if (!refresh) {
        // Acontece quando a conta já autorizou antes: o Google só manda o refresh_token na
        // primeira vez, a não ser com prompt=consent (que o oauth_url já força).
        return errResp('O Google não devolveu a autorização de longo prazo. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.');
      }

      // Confirma de qual caixa é o acesso — e já prova que o token funciona.
      const prof = await httpJson(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${r.body.access_token}` } });
      if (!prof.ok) return errResp(googleError(prof));

      const { error } = await admin.from('fin_mail_config').update({
        refresh_token: refresh,
        email_address: String(prof.body?.emailAddress ?? '') || null,
        is_active: true, last_error: null,
        connected_by: userId, connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId);
      if (error) return errResp(`Salvar conexão: ${error.message}`);

      const { data: fresh } = await admin.from('fin_mail_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      log('INFO', 'exchange', 'conectado', { tenantId, email: prof.body?.emailAddress, by: userId });
      return json({ success: true, config: safeConfig(fresh) });
    }

    if (action === 'test') {
      if (!cfg?.refresh_token) return json({ success: false, not_connected: true });
      const at = await accessToken(cfg);
      if (at.error) {
        await admin.from('fin_mail_config').update({ last_error: at.error }).eq('tenant_id', tenantId);
        return errResp(at.error);
      }
      const q = encodeURIComponent(String(cfg.query ?? ''));
      const r = await httpJson(`${GMAIL}/messages?maxResults=10&q=${q}`, { headers: { Authorization: `Bearer ${at.token}` } });
      if (!r.ok) return errResp(googleError(r));
      const ids: any[] = Array.isArray(r.body?.messages) ? r.body.messages : [];

      // Mostra os remetentes dos últimos para ele conferir que o filtro pegou o que devia.
      const remetentes: string[] = [];
      for (const m of ids.slice(0, 5)) {
        const d = await httpJson(
          `${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
          { headers: { Authorization: `Bearer ${at.token}` } },
        );
        if (!d.ok) continue;
        const h: any[] = d.body?.payload?.headers ?? [];
        const from = h.find((x) => String(x.name).toLowerCase() === 'from')?.value ?? '';
        const subj = h.find((x) => String(x.name).toLowerCase() === 'subject')?.value ?? '';
        remetentes.push(`${String(from).slice(0, 60)} — ${String(subj).slice(0, 60)}`);
      }

      await admin.from('fin_mail_config').update({
        last_check_at: new Date().toISOString(), last_error: null,
      }).eq('tenant_id', tenantId);
      return json({
        success: true, email_address: cfg.email_address ?? null,
        encontrados: Number(r.body?.resultSizeEstimate ?? ids.length), amostra: remetentes,
      });
    }

    if (action === 'disconnect') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode desconectar', 403);
      // Só solta o acesso: o histórico do que já entrou continua, e a caixa dele fica intacta.
      const { error } = await admin.from('fin_mail_config').update({
        refresh_token: null, is_active: false, email_address: null,
        connected_at: null, connected_by: null, last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId);
      if (error) return errResp(error.message);
      log('INFO', 'disconnect', 'ok', { tenantId, by: userId });
      return json({ success: true });
    }

    return errResp(`Ação desconhecida: ${action}`);
  } catch (e) {
    log('ERROR', action, 'falha inesperada', { error: String((e as Error)?.message ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});
