import { reportEdgeFailure } from './errorReporter';
import { createClient, navigatorLock } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase env vars not set: VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY are required.');
}

/** URL publica do projeto Supabase — use este export em vez de import.meta.env direto */
export const SUPABASE_URL = supabaseUrl;

/**
 * Edge Functions na mesma região do banco (2026-09-17, go-live Paranaguá).
 * Sem isso a Edge roda em sa-east-1 (perto do cliente) e cada consulta ao banco
 * (us-west-1) paga ~150 ms de ida e volta: create_order fazia ~20 e levava 4–8 s.
 * Só as funções que conversam quase só com o banco; as que falam com serviços
 * brasileiros (SEFAZ, Inter, Stone, Pix) continuam no padrão.
 * Vale para qualquer fetch do app (supabase.functions.invoke e fetch direto).
 */
const EDGE_REGION = 'us-west-1';
const EDGES_NA_REGIAO_DO_BANCO = new Set([
  'order-write', 'mesa-write', 'delivery-write', 'table-write', 'session-payments',
  'kiosk-auth', 'login-pin', 'verify-manager-credentials', 'menu-write', 'stock-write',
  'voucher-write', 'voucher-claim', 'check-session-pending', 'order-edit-lock',
  'print-queue-write', 'customer-write', 'config-write', 'reservation-write',
  'production-write', 'user-write', 'audit-write', 'task-write', 'motoboy-signal',
]);

export function withEdgeRegion(url: string): string {
  const prefix = `${supabaseUrl}/functions/v1/`;
  if (!url.startsWith(prefix) || url.includes('forceFunctionRegion=')) return url;
  const name = url.slice(prefix.length).split(/[/?#]/)[0];
  if (!EDGES_NA_REGIAO_DO_BANCO.has(name)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}forceFunctionRegion=${EDGE_REGION}`;
}

if (typeof window !== 'undefined' && typeof window.fetch === 'function' && !(window.fetch as { __edgeRegion?: boolean }).__edgeRegion) {
  const originalFetch = window.fetch.bind(window);
  const patched: typeof fetch = (input, init) => {
    try {
      if (typeof input === 'string') return originalFetch(withEdgeRegion(input), init);
      if (input instanceof URL) return originalFetch(withEdgeRegion(input.href), init);
    } catch { /* segue sem região */ }
    return originalFetch(input, init);
  };
  (patched as { __edgeRegion?: boolean }).__edgeRegion = true;
  window.fetch = patched;
}

/** Anon key publica do projeto Supabase — use este export em vez de import.meta.env direto */
export const SUPABASE_ANON_KEY = supabaseAnonKey;

/**
 * Loja ativa do app vai para o banco no header `x-tenant-id` (2026-09-12).
 * As funções de RLS (`auth_tenant_id()`, `get_user_tenant_id()`, `auth_role()`)
 * usam essa loja se o usuário for membro dela; sem isso pegavam o vínculo mais
 * recente e quem tem várias lojas (o dono) só enxergava uma. Só nas chamadas
 * REST/RPC: as Edge Functions não liberam esse header no CORS.
 */
const fetchComLoja: typeof fetch = async (input, init) => {
  let url = '';
  try { url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; } catch { /* segue */ }
  let req = init;
  try {
    const tenantId = localStorage.getItem('erpos_selected_tenant_id');
    if (tenantId && url.includes('/rest/v1/')) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('x-tenant-id', tenantId);
      req = { ...init, headers };
    }
  } catch { /* localStorage bloqueado: segue sem o header */ }
  const res = await fetch(input, req);
  return await retentarSeJwtVencido(res, url, input, req);
};

// Token de acesso vencido (2026-09-25): o autoRefreshToken está desligado e a sessão só é renovada
// pelo ping de 60 s do AuthContext — aba em segundo plano (timers estrangulados) ou PC que dormiu
// mandava consultas com o token vencido e a tela mostrava "JWT expired" (visto na aba iFood).
// Aqui, 401 "JWT expired" em /rest ou /functions → renova a sessão UMA vez (compartilhada entre
// as consultas simultâneas) e repete a requisição com o token novo. Refresh recusado: devolve o
// erro original (o AuthContext cuida do logout).
let renovando: Promise<string | null> | null = null;
export async function retentarSeJwtVencido(
  res: Response, url: string, input: RequestInfo | URL, init?: RequestInit,
  renovar: () => Promise<string | null> = async () => (await refreshSessionWithReason()).session?.access_token ?? null,
): Promise<Response> {
  if (res.status !== 401 || !(url.includes('/rest/v1/') || url.includes('/functions/v1/'))) return res;
  if (input instanceof Request || (init?.body && typeof init.body !== 'string')) return res; // corpo não reenviável
  const headers = new Headers(init?.headers);
  const auth = headers.get('Authorization') ?? '';
  if (!auth || auth === `Bearer ${supabaseAnonKey}`) return res; // chamada anônima: nada a renovar
  let texto = '';
  try { texto = await res.clone().text(); } catch { return res; }
  if (!/jwt expired/i.test(texto)) return res;
  renovando ??= (async () => {
    try {
      return await renovar();
    } finally {
      setTimeout(() => { renovando = null; }, 0);
    }
  })();
  const token = await renovando;
  if (!token) return res;
  headers.set('Authorization', `Bearer ${token}`);
  return await fetch(input, { ...init, headers });
}

/**
 * Trava do supabase-js com rede de segurança (tablet Android, 2026-09-21).
 *
 * Toda operação de sessão do supabase-js (getSession, refreshSession, verifyOtp…)
 * roda dentro de um lock do Navigator LockManager, com espera INFINITA. Se o
 * LockManager não responde — o que acontece em WebView/navegador embutido de app,
 * onde a API existe mas não segue a spec — a promise nunca resolve: no tablet da
 * loja o login por matrícula funcionava (o servidor emitia o token), mas a tela
 * ficava para sempre em "Carregando sessão...", sem nenhuma chamada seguinte.
 *
 * Aqui o lock continua sendo o do navegador (protege as abas do PC entre si), mas
 * se ele não for concedido em LOCK_TIMEOUT_MS a operação segue SEM o lock, que é
 * exatamente o que o supabase-js faz em ambientes sem LockManager. A função nunca
 * roda duas vezes: quem chega atrasado devolve o sentinela e é descartado.
 */
const LOCK_TIMEOUT_MS = 5000;
const LOCK_IGNORADO = Symbol('lock-ignorado');

async function lockResiliente<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const temLockManager = typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
  // Sem LockManager (ou na variante "pega agora ou falha", que nunca trava) usa o
  // caminho normal do supabase-js.
  if (!temLockManager) return await fn();
  if (acquireTimeout === 0) return await navigatorLock(name, acquireTimeout, fn);

  let ignorado = false;
  let comecou = false;

  return await new Promise<R>((resolve, reject) => {
    let resolvido = false;
    const timer = setTimeout(() => {
      if (comecou || resolvido) return; // o lock já foi concedido: deixa terminar
      ignorado = true;
      resolvido = true;
      console.warn(`[supabase] LockManager não concedeu "${name}" em ${LOCK_TIMEOUT_MS}ms — seguindo sem a trava`);
      fn().then(resolve, reject);
    }, LOCK_TIMEOUT_MS);

    navigatorLock(name, acquireTimeout, async () => {
      if (ignorado) return LOCK_IGNORADO as unknown as R; // já rodou fora do lock
      comecou = true;
      return await fn();
    }).then(
      (r) => {
        clearTimeout(timer);
        if (resolvido || (r as unknown) === LOCK_IGNORADO) return;
        resolvido = true;
        resolve(r);
      },
      (e) => {
        clearTimeout(timer);
        if (resolvido) return;
        resolvido = true;
        reject(e);
      },
    );
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: true,
    lock: lockResiliente,
  },
  global: { fetch: fetchComLoja },
});

// ─── Helpers seguros para evitar que "Invalid Refresh Token" estoure na UI ──

/**
 * Verifica se uma mensagem de erro indica refresh token inválido/revogado.
 * NOTE: 'jwt expired' sozinho pode ser do access token (que o refresh corrige),
 *       então só consideramos revogado se vier junto com outras palavras-chave.
 */
export function isRefreshTokenInvalidError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid refresh token') ||
    lower.includes('refresh token not found') ||
    lower.includes('token has been revoked') ||
    lower.includes('refresh token already used') ||
    lower.includes('session not found') ||
    // "jwt expired" só é fatal de refresh se vier com "refresh" ou "session"
    (lower.includes('jwt expired') && (lower.includes('refresh') || lower.includes('session')))
  );
}

/**
 * Marca que o próximo SIGNED_OUT emitido pelo supabase-js veio de um logout
 * EXPLÍCITO (botão Sair / safeSignOut), e não de uma falha de refresh dentro
 * da própria lib. Quem escuta onAuthStateChange usa isso para não confundir
 * "usuário saiu de propósito" com "a rede caiu por um instante".
 */
let logoutIntencional = false;
export function isLogoutIntencional(): boolean {
  return logoutIntencional;
}
/** Consome a flag (uso único) — chamar depois de tratar o SIGNED_OUT correspondente. */
export function clearLogoutIntencional(): void {
  logoutIntencional = false;
}

/**
 * SignOut seguro que nunca lança exceção e limpa o localStorage manualmente se necessário.
 */
export async function safeSignOut(): Promise<void> {
  logoutIntencional = true;
  try {
    // scope 'local': sai só deste aparelho. O padrão do supabase-js ('global') revoga
    // TODAS as sessões do usuário — sair num celular derrubava o tablet da loja logado
    // com o mesmo usuário (cardápio vazio no totem, 2026-09-23).
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    // Com erro de rede/servidor o supabase-js NÃO emite SIGNED_OUT: a flag ficaria pendurada e
    // o próximo SIGNED_OUT "surpresa" seria tratado como intencional, pulando a checagem.
    if (error) logoutIntencional = false;
  } catch {
    logoutIntencional = false;
    // Se signOut falhar, limpa manualmente as chaves que o supabase-js usa
  }
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('sb-') || key.includes('supabase') || key === 'erpos_selected_tenant_id') {
        localStorage.removeItem(key);
      }
    }
  } catch { /* silencioso */ }
}

/** Motivo de uma tentativa de refresh sem sessão de volta. */
export type RefreshReason = 'ok' | 'invalid' | 'transient';

export function isTransientRefreshError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('abort') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('socket') ||
    lower.includes('unreachable')
  );
}

/**
 * Faz refreshSession() distinguindo POR QUE não voltou sessão:
 * - 'invalid'   → refresh token realmente revogado/expirado/já usado — sessão local é limpa
 *                 (safeSignOut) e quem chamou deve mandar o usuário para o login.
 * - 'transient' → só falha claramente de rede/timeout/5xx/429 (ver classifyRefreshError).
 *                 A sessão local NÃO é tocada: o token de acesso atual pode ainda estar
 *                 válido por mais alguns minutos. Erro desconhecido do Auth é 'invalid'.
 * - 'ok'        → refresh funcionou, `session` vem preenchida.
 * Tem retry automático (2 tentativas) só para os casos claramente transitórios.
 */
/**
 * Classifica a falha de refresh. Fail-safe: só é "transient" o que é claramente rede/servidor
 * (sem resposta, timeout, 5xx, 429). Qualquer outra recusa do Auth (usuário desativado, banido,
 * invalid_grant, mensagem nova) é "invalid" — senão um usuário revogado ficaria "logado" para sempre.
 */
export function classifyRefreshError(err: unknown): Exclude<RefreshReason, 'ok'> {
  const e = err as { message?: string; name?: string; status?: number } | null;
  const msg = e?.message ?? String(err ?? '');
  if (isRefreshTokenInvalidError(msg)) return 'invalid';
  if (e?.name === 'AuthRetryableFetchError') return 'transient';
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status !== undefined && (status === 0 || status === 429 || status >= 500)) return 'transient';
  if (isTransientRefreshError(msg)) return 'transient';
  return 'invalid';
}

export async function refreshSessionWithReason(): Promise<{ session: Session | null; reason: RefreshReason }> {
  const MAX_REFRESH_RETRIES = 2;

  for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        if (classifyRefreshError(error) === 'invalid') {
          console.warn('[refreshSessionWithReason] Refresh recusado pelo Auth — limpando sessão local:', error.message);
          await safeSignOut();
          return { session: null, reason: 'invalid' };
        }
        const isTransient = true;
        if (isTransient && attempt < MAX_REFRESH_RETRIES - 1) {
          const delay = (attempt + 1) * 2000;
          console.warn(`[refreshSessionWithReason] Erro transitório no refresh (tentativa ${attempt + 1}/${MAX_REFRESH_RETRIES}), retry em ${delay}ms:`, error.message);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        console.warn('[refreshSessionWithReason] Falha de rede/servidor no refresh — sessão local mantida:', error.message);
        return { session: null, reason: 'transient' };
      }
      return { session: data?.session ?? null, reason: 'ok' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (classifyRefreshError(e) === 'invalid') {
        console.warn('[refreshSessionWithReason] Exceção de refresh recusado — limpando sessão local:', msg);
        await safeSignOut();
        return { session: null, reason: 'invalid' };
      }
      const isTransient = true;
      if (isTransient && attempt < MAX_REFRESH_RETRIES - 1) {
        const delay = (attempt + 1) * 2000;
        console.warn(`[refreshSessionWithReason] Exceção transitória (tentativa ${attempt + 1}/${MAX_REFRESH_RETRIES}), retry em ${delay}ms:`, msg);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.warn('[refreshSessionWithReason] Falha de rede/servidor no refresh — sessão local mantida:', msg);
      return { session: null, reason: 'transient' };
    }
  }

  return { session: null, reason: 'transient' };
}

/**
 * Wrapper seguro para refreshSession, mantido para os chamadores que só
 * precisam saber se deu certo (session) ou não (null) e não decidem nada
 * a partir do motivo. Quem precisa diferenciar "token morto" de "rede
 * caiu" usa `refreshSessionWithReason()`.
 */
export async function safeRefreshSession(): Promise<Session | null> {
  const { session } = await refreshSessionWithReason();
  return session;
}

/**
 * Garante que a sessao do Supabase esteja fresca (token nao expirado).
 * Se o token expirar em menos de 5 minutos, forca um refresh.
 * Se o token JA estiver expirado, tenta renovar igualmente.
 * Se o refresh token for invalido (sessao revogada/expirada), retorna null sem propagar erro.
 * Retorna a sessao valida ou null caso nao consiga renovar.
 */
export async function ensureFreshSession(): Promise<Session | null> {
  let session: Session | null = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session) return null;
    session = data.session;
  } catch {
    return null;
  }

  const expiresAt = session.expires_at ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);

  // Token ja expirado OU expira em menos de 5 minutos -> tenta refresh
  if (expiresAt <= nowSec || expiresAt - nowSec < 300) {
    return await safeRefreshSession();
  }

  return session;
}

/**
 * Faz o fetch para a Edge Function com o token fornecido.
 * Retorna a response para tratamento externo.
 * Agora com timeout de 60s para evitar 'Failed to fetch' em operações pesadas.
 */
async function doFetch(
  functionName: string,
  accessToken: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const payloadSize = JSON.stringify(body).length;
  console.log(`[doFetch] ${functionName} — payload size: ${payloadSize} bytes`);
  
  return fetch(
    `${supabaseUrl}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify(body),
      signal,
    },
  );
}

/**
 * Tenta obter um token valido da sessao, fazendo refresh se necessario.
 * Retorna { accessToken, error } onde error indica falha critica de sessao.
 * Agora com retry automatico: se a primeira tentativa falhar por erro transiente
 * (rede, timeout), aguarda e tenta novamente antes de desistir.
 */
export async function resolveAccessToken(externalToken?: string): Promise<{
  accessToken: string | null;
  error: Error | null;
}> {
  if (externalToken) {
    return { accessToken: externalToken, error: null };
  }

  const MAX_RESOLVE_ATTEMPTS = 2;

  for (let attempt = 0; attempt < MAX_RESOLVE_ATTEMPTS; attempt++) {
    // ── Única chamada getSession: pega token E expiração de uma vez ─────────
    let session: import('@supabase/supabase-js').Session | null = null;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (!error && data?.session) {
        session = data.session;
      }
    } catch {
      // Ignora erro de getSession
    }

    if (!session?.access_token) {
      if (attempt === 0) {
        console.warn('[resolveAccessToken] Token ausente — tentando refresh imediato...');
      } else {
        console.warn(`[resolveAccessToken] Token ausente (tentativa ${attempt + 1}/${MAX_RESOLVE_ATTEMPTS}) — tentando refresh...`);
      }
      const refreshed = await safeRefreshSession();
      if (refreshed?.access_token) {
        return { accessToken: refreshed.access_token, error: null };
      }
      // Refresh falhou — se ainda tem tentativas, espera e tenta de novo
      if (attempt < MAX_RESOLVE_ATTEMPTS - 1) {
        const delay = (attempt + 1) * 2500;
        console.warn(`[resolveAccessToken] Refresh falhou — retry em ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return {
        accessToken: null,
        error: new Error('Sessao invalida ou expirada. Faca login novamente.'),
      };
    }

    const token = session.access_token;
    const expiresAt = session.expires_at ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);
    const secondsLeft = expiresAt - nowSec;

    // Token expirado OU expira em menos de 5 minutos → força refresh
    if (secondsLeft < 300) {
      console.warn(`[resolveAccessToken] Token expira em ${secondsLeft}s — forçando refresh...`);
      const refreshed = await safeRefreshSession();
      if (refreshed?.access_token) {
        return { accessToken: refreshed.access_token, error: null };
      }
      // Refresh falhou — se o token ainda tem > 0s de vida, usa como último recurso
      if (secondsLeft > 0) {
        console.warn('[resolveAccessToken] Refresh falhou — usando token atual como fallback');
        return { accessToken: token, error: null };
      }
      // Token expirado e refresh falhou — se ainda tem tentativas, espera e tenta
      if (attempt < MAX_RESOLVE_ATTEMPTS - 1) {
        const delay = (attempt + 1) * 2500;
        console.warn(`[resolveAccessToken] Token expirado e refresh falhou — retry em ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      // Todas as tentativas esgotadas
      return {
        accessToken: null,
        error: new Error('Sessao expirada. Por favor, faca login novamente.'),
      };
    }

    return { accessToken: token, error: null };
  }

  // Fallback final (nunca deveria chegar aqui, mas por segurança)
  return {
    accessToken: null,
    error: new Error('Nao foi possivel obter token de acesso apos multiplas tentativas.'),
  };
}

/** Erro HTTP de Edge Function: carrega o status para o chamador decidir se retenta. */
export type EdgeHttpError = Error & { status?: number; code?: string };

/**
 * Ações que não podem ser reenviadas automaticamente após erro de rede/timeout
 * (sem chave de idempotência no servidor). create_order fica de fora: é idempotente
 * por client_request_id.
 */
export const NON_IDEMPOTENT_ACTIONS = new Set([
  'record_payment',
  'close_cash_register',
  'add_cash_movement',
  'register_partial_refund',
  'enviar_guia', // contabilidade: repetir pode preparar o pagamento da guia duas vezes
]);

/**
 * Invoca uma Edge Function garantindo que o JWT mais recente da sessao
 * seja enviado no header Authorization. Se receber 401 (token rejeitado pelo
 * servidor), faz refresh do token e retenta a chamada uma unica vez.
 * Agora com timeout de 60s e retry automatico para erros de rede (Failed to fetch).
 *
 * @param functionName  Nome da Edge Function
 * @param options       Corpo da requisicao e token externo opcional
 * @param options.externalToken  Token JWT externo (ex: kiosk token). Quando fornecido,
 *                               ignora a sessao do Supabase Auth e usa este token diretamente.
 */
export async function invokeWithAuth<T = unknown>(
  functionName: string,
  options: { body?: Record<string, unknown>; externalToken?: string } = {},
): Promise<{ data: T | null; error: Error | null }> {
  let accessToken: string | null = null;

  // Primeira tentativa: resolve token e faz fetch
  const firstResolve = await resolveAccessToken(options.externalToken);
  if (firstResolve.error) {
    console.warn(`[invokeWithAuth] ${functionName} — resolveAccessToken falhou:`, firstResolve.error.message);
    return { data: null, error: firstResolve.error };
  }
  accessToken = firstResolve.accessToken;

  const MAX_RETRIES = 2;
  const TIMEOUT_MS = 60000;
  const bodyAction = typeof options.body?.action === 'string' ? options.body.action : '';
  const isNonIdempotentBody = NON_IDEMPOTENT_ACTIONS.has(bodyAction);

  async function attemptFetch(isRetry: boolean): Promise<{ data: T | null; error: Error | null }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await doFetch(functionName, accessToken!, options.body ?? {}, controller.signal);
      clearTimeout(timeoutId);
    } catch (netErr) {
      clearTimeout(timeoutId);
      const netMsg = netErr instanceof Error ? netErr.message : String(netErr);

      // Se for erro de rede (Failed to fetch, timeout, etc.) e ainda tem retries, tenta novamente.
      // Ações de dinheiro/caixa NÃO são idempotentes: o servidor pode ter gravado e só a
      // resposta se perdeu — reenviar duplicaria pagamento/sangria/fechamento.
      if (!isRetry && !isNonIdempotentBody && (netMsg.includes('Failed to fetch') || netMsg.includes('fetch') || netMsg.includes('network') || netMsg.includes('abort') || netMsg.includes('timeout'))) {
        console.warn(`[invokeWithAuth] ${functionName} — erro de rede (tentando retry em 3s):`, netMsg);
        await new Promise((r) => setTimeout(r, 3000));
        return attemptFetch(true);
      }

      // Só loga como warn se for o retry que falhou também — não é erro crítico, já tratado pelo caller
      console.warn(`[invokeWithAuth] ${functionName} — erro de rede no fetch${isRetry ? ' (retry)' : ''}:`, netMsg);

      return {
        data: null,
        error: netErr instanceof Error ? netErr : new Error('Erro de rede ao chamar funcao'),
      };
    }

    // Se recebeu 401, pode ser token revogado no servidor. Forca refresh, espera e retenta.
    // login-pin é pública (verify_jwt=false): 401 ali é PIN errado, não token — sem refresh/retry
    // (o retry contava a falha duas vezes no limite de tentativas do servidor).
    if (response.status === 401 && functionName !== 'login-pin') {
      console.warn(`[invokeWithAuth] ${functionName} returned 401 — forcing token refresh and retry`);

      const { session: refreshedSession, reason: refreshReason } = await refreshSessionWithReason();
      if (!refreshedSession?.access_token) {
        return {
          data: null,
          error: refreshReason === 'transient'
            ? new Error('Sem conexão com o servidor. Tente de novo.')
            : new Error('Sessao expirada ou revogada. Por favor, faca login novamente.'),
        };
      }
      accessToken = refreshedSession.access_token;

      // Pequeno delay antes do retry (evita race condition no Supabase Auth)
      await new Promise((r) => setTimeout(r, 500));

      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), TIMEOUT_MS);
      try {
        response = await doFetch(functionName, accessToken, options.body ?? {}, retryController.signal);
        clearTimeout(retryTimeoutId);
      } catch (netErr) {
        clearTimeout(retryTimeoutId);
        console.error(`[invokeWithAuth] ${functionName} — erro de rede no retry:`, netErr);
        return {
          data: null,
          error: netErr instanceof Error ? netErr : new Error('Erro de rede ao chamar funcao'),
        };
      }
    }

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      let raw: unknown;
      let errCode: string | undefined;
      try {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const errBody = await response.json();
          if (typeof errBody?.code === 'string') errCode = errBody.code;
          // Edge Functions retornam { error: string } ou { error: { message: string } }
          const extracted =
            errBody?.error ?? errBody?.message ?? errBody ?? errMsg;
          if (typeof extracted === 'string') {
            errMsg = extracted;
          } else if (extracted && typeof extracted === 'object') {
            const inner = (extracted as Record<string, unknown>).message;
            errMsg = typeof inner === 'string' ? inner : JSON.stringify(extracted);
          }
          raw = extracted;
        } else {
          const text = await response.text();
          errMsg = text || errMsg;
          raw = text;
        }
      } catch { /* ignore parse error */ }
      // Nao logar como erro critico status 409 (conflict de negocio) — e esperado
      if (response.status !== 409) {
        console.error(`[invokeWithAuth] ${functionName} failed [${response.status}]:`, errMsg, 'raw:', raw ?? 'n/a');
        // Fila de erros (dev_error_events): 5xx = erro, 4xx = aviso; 401/403 ficam de fora
        reportEdgeFailure(functionName, response.status, errMsg, typeof options.body?.action === 'string' ? options.body.action : undefined);
      }
      const httpErr = new Error(errMsg) as EdgeHttpError;
      httpErr.status = response.status;
      if (errCode) httpErr.code = errCode;
      return { data: null, error: httpErr };
    }

    try {
      const data = (await response.json()) as T;
      return { data, error: null };
    } catch {
      return { data: null, error: new Error('Resposta invalida da funcao') };
    }
  }

  return attemptFetch(false);
}

/**
 * Comprime/redimensiona uma imagem no navegador antes do upload:
 * - lado maior limitado a maxSize px (mantém proporção)
 * - exporta JPEG com a qualidade dada
 * Reduz MUITO o tamanho (e o egress) — uma foto de celular de ~2 MB vira ~60-90 KB.
 * Em caso de falha (ou formato que não recomprime bem), devolve o arquivo original.
 */
export async function compressImage(file: File, maxSize = 700, quality = 0.6): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { if (bitmap.close) bitmap.close(); return file; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise<Blob | null>(function (resolve) {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (!blob) return file;
    // Se "comprimir" ficou maior que o original (ex.: PNG pequeno), mantém o original.
    return blob.size < file.size ? blob : file;
  } catch (_e) {
    return file;
  }
}

/**
 * Faz upload de uma imagem de cardápio (item ou combo).
 *
 * Comprime no cliente e envia pela Edge Function `menu-write` (multipart), que grava
 * no Storage com a SERVICE ROLE. NÃO usamos `supabase.storage.upload` direto porque o
 * client tem `autoRefreshToken: false`: quando o access token expira (~1h), o upload
 * direto chega ao Storage como `anon` e a política de INSERT (só `authenticated`) recusa
 * com "new row violates row-level security policy". Indo pela Edge, usamos um token
 * renovado (resolveAccessToken) e o service role ignora a RLS do Storage.
 */
export async function uploadMenuImage(
  file: File,
  tenantId: string,
  itemId?: string,
): Promise<{ url: string | null; error: Error | null }> {
  try {
    const compressed = await compressImage(file);
    const recomprimido = compressed !== file; // virou JPEG
    const baseName = (file.name.replace(/[^a-zA-Z0-9.\-_]/g, '') || 'foto');
    const safeName = recomprimido ? baseName.replace(/\.[^.]+$/, '') + '.jpg' : baseName;

    // Token fresco — o client não renova sozinho (autoRefreshToken:false).
    const { accessToken, error: tokenErr } = await resolveAccessToken();
    if (!accessToken) {
      return { url: null, error: tokenErr ?? new Error('Sessão expirada. Faça login novamente.') };
    }

    const form = new FormData();
    form.append('file', compressed, safeName);
    form.append('tenant_id', tenantId);
    if (itemId) form.append('item_id', itemId);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/menu-write`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
        // NÃO definir Content-Type: o browser monta o boundary do multipart sozinho.
      },
      body: form,
    });

    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || (data as Record<string, unknown>).error) {
      const msg = (data as Record<string, unknown>).error || (data as Record<string, unknown>).message || `Upload falhou (HTTP ${res.status})`;
      return { url: null, error: new Error(String(msg)) };
    }
    return { url: ((data as Record<string, unknown>).url as string) ?? null, error: null };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e : new Error('Erro ao enviar a imagem') };
  }
}

/**
 * Envia um anexo de tarefa pela Edge Function `task-write` (multipart).
 *
 * Mesmo motivo do `uploadMenuImage`: não dá para usar `supabase.storage.upload`
 * direto porque o client roda com `autoRefreshToken: false` — um token expirado
 * chega ao Storage como `anon` e a RLS recusa. O bucket `task-attachments` é
 * privado; a leitura sai por URL assinada (ação `sign_attachment`).
 */
export async function uploadTaskAttachment(
  file: File,
  tenantId: string | null,
  taskId: string,
): Promise<{ id: string | null; error: Error | null }> {
  try {
    // Imagem (inclusive foto tirada na hora pela câmera do celular) é comprimida
    // antes de sair: uma foto de 12 MP passa de 4 MB e estouraria o limite —
    // e, no 4G da loja, o upload demoraria demais. 1400px preserva leitura de
    // documento/nota fiscal, que é o uso típico de anexo aqui.
    const enviar: Blob = file.type.startsWith('image/')
      ? await compressImage(file, 1400, 0.72)
      : file;
    const nomeFinal = enviar !== file && !/\.(jpe?g)$/i.test(file.name)
      ? file.name.replace(/\.[^.]+$/, '') + '.jpg'
      : file.name;

    const MAX_BYTES = 10 * 1024 * 1024;
    if (enviar.size > MAX_BYTES) {
      return { id: null, error: new Error('Arquivo maior que 10 MB.') };
    }

    const { accessToken, error: tokenErr } = await resolveAccessToken();
    if (!accessToken) {
      return { id: null, error: tokenErr ?? new Error('Sessão expirada. Faça login novamente.') };
    }

    const form = new FormData();
    form.append('file', enviar, nomeFinal);
    if (tenantId) form.append('tenant_id', tenantId); // sem loja: o task-write resolve
    form.append('task_id', taskId);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/task-write`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
        // NÃO definir Content-Type: o browser monta o boundary do multipart sozinho.
      },
      body: form,
    });

    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || (data as Record<string, unknown>).error) {
      const msg = (data as Record<string, unknown>).error ?? `Upload falhou (HTTP ${res.status})`;
      return { id: null, error: new Error(String(msg)) };
    }
    return { id: ((data as Record<string, unknown>).id as string) ?? null, error: null };
  } catch (e) {
    return { id: null, error: e instanceof Error ? e : new Error('Erro ao enviar o anexo') };
  }
}