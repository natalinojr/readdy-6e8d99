// Microsoft Graph (OneDrive/SharePoint) — login OAuth, renovação do token e chamadas.
// Usado pela Edge ms-graph e, nas próximas etapas, pelo task-write e pelo webhook.
// Ver BRIEFING-ONEDRIVE-TAREFAS.md. Tokens ficam em ms_graph_connections (só service role)
// e nunca saem para o navegador.
// deno-lint-ignore-file no-explicit-any

export const GRAPH = 'https://graph.microsoft.com/v1.0';

/** `offline_access` = refresh token; `openid profile` = id_token com o tid da organização. */
export const MS_SCOPES = 'offline_access openid profile User.Read Files.ReadWrite.All Sites.ReadWrite.All';

export function msConfig() {
  const clientId = Deno.env.get('MS_CLIENT_ID')?.trim() ?? '';
  const clientSecret = Deno.env.get('MS_CLIENT_SECRET')?.trim() ?? '';
  // "organizations" = qualquer conta corporativa (Microsoft 365 Business). O app é
  // registrado como multi-organização para o módulo poder ser vendido depois.
  const authTenant = Deno.env.get('MS_AUTH_TENANT')?.trim() || 'organizations';
  return { clientId, clientSecret, authTenant, configured: !!(clientId && clientSecret) };
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const { clientId, authTenant } = msConfig();
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: MS_SCOPES,
    state,
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${authTenant}/oauth2/v2.0/authorize?${p}`;
}

interface TokenResp {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResp> {
  const { clientId, clientSecret, authTenant } = msConfig();
  const resp = await fetch(`https://login.microsoftonline.com/${authTenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: MS_SCOPES, ...params }),
  });
  return await resp.json().catch(() => ({ error: `http_${resp.status}` }));
}

export function exchangeCode(code: string, redirectUri: string) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

/** Payload do id_token sem verificar assinatura: veio direto do endpoint de token por TLS. */
export function idTokenClaims(idToken?: string): Record<string, any> {
  try {
    const part = (idToken ?? '').split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(b64));
  } catch {
    return {};
  }
}

export class MsReconnectError extends Error {}

/**
 * Access token válido da conexão do usuário, renovando quando falta < 5 min.
 * A Microsoft pode devolver um refresh token novo a cada renovação — sempre guardar.
 */
export async function accessTokenFor(admin: any, userId: string): Promise<string> {
  const { data: conn, error } = await admin
    .from('ms_graph_connections')
    .select('access_token, refresh_token, token_expires_at, needs_reconnect')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conn) throw new MsReconnectError('Conta Microsoft não conectada.');
  if (conn.needs_reconnect) throw new MsReconnectError('A conexão com a Microsoft expirou. Conecte de novo.');

  if (new Date(conn.token_expires_at).getTime() - Date.now() > 5 * 60_000) return conn.access_token;

  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: conn.refresh_token });
  if (!t.access_token) {
    const motivo = t.error_description?.split('\r\n')[0] ?? t.error ?? 'falha ao renovar';
    // invalid_grant = consentimento revogado, senha trocada, 90 dias sem uso… só reconectando.
    if (t.error === 'invalid_grant' || t.error === 'interaction_required') {
      await admin.from('ms_graph_connections')
        .update({ needs_reconnect: true, last_error: motivo, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      throw new MsReconnectError('A conexão com a Microsoft expirou. Conecte de novo.');
    }
    throw new Error(`Microsoft recusou a renovação: ${motivo}`);
  }
  await admin.from('ms_graph_connections').update({
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? conn.refresh_token,
    token_expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
  return t.access_token;
}

export class GraphError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

/** Chamada à Graph com o token do usuário. `path` começa com "/" (relativo a v1.0) ou é URL completa. */
export async function graphFetch(admin: any, userId: string, path: string, init: RequestInit = {}): Promise<any> {
  const token = await accessTokenFor(admin, userId);
  const url = path.startsWith('https://') ? path : `${GRAPH}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers ?? {}) },
  });
  if (resp.status === 204) return null;
  const body = await resp.json().catch(() => null);
  if (!resp.ok) {
    const e = body?.error ?? {};
    throw new GraphError(resp.status, e.message ?? `Microsoft respondeu ${resp.status}`, e.code);
  }
  return body;
}
