import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase env vars not set: VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY are required.');
}

/** URL publica do projeto Supabase — use este export em vez de import.meta.env direto */
export const SUPABASE_URL = supabaseUrl;

/** Anon key publica do projeto Supabase — use este export em vez de import.meta.env direto */
export const SUPABASE_ANON_KEY = supabaseAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: true,
  },
});

// ─── Helpers seguros para evitar que "Invalid Refresh Token" estoure na UI ──

/**
 * Verifica se uma mensagem de erro indica refresh token inválido/revogado.
 * NOTE: 'jwt expired' sozinho pode ser do access token (que o refresh corrige),
 *       então só consideramos revogado se vier junto com outras palavras-chave.
 */
function isRefreshTokenInvalidError(message: string): boolean {
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
 * SignOut seguro que nunca lança exceção e limpa o localStorage manualmente se necessário.
 */
export async function safeSignOut(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
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

/**
 * Wrapper seguro para refreshSession. Se o refresh token for inválido
 * (revogado, expirado, ou não encontrado no servidor), limpa a sessão local
 * e retorna null sem propagar o erro.
 * Se for outro erro (rede, timeout), retorna null SEM limpar a sessão local.
 * Agora com retry automático para erros transitórios de rede.
 */
export async function safeRefreshSession(): Promise<Session | null> {
  const MAX_REFRESH_RETRIES = 2;

  for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        if (isRefreshTokenInvalidError(error.message)) {
          console.warn('[safeRefreshSession] Refresh token inválido/revogado — limpando sessão local');
          await safeSignOut();
          return null;
        }
        // Erro de rede ou servidor — retry se ainda tiver tentativas
        const lower = error.message.toLowerCase();
        const isTransient =
          lower.includes('fetch') ||
          lower.includes('network') ||
          lower.includes('timeout') ||
          lower.includes('abort') ||
          lower.includes('econnrefused') ||
          lower.includes('econnreset') ||
          lower.includes('socket') ||
          lower.includes('unreachable');

        if (isTransient && attempt < MAX_REFRESH_RETRIES - 1) {
          const delay = (attempt + 1) * 2000;
          console.warn(`[safeRefreshSession] Erro transitório no refresh (tentativa ${attempt + 1}/${MAX_REFRESH_RETRIES}), retry em ${delay}ms:`, error.message);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        console.warn('[safeRefreshSession] refreshSession falhou:', error.message);
        return null;
      }
      return data?.session ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isRefreshTokenInvalidError(msg)) {
        console.warn('[safeRefreshSession] Exceção de refresh token inválido — limpando sessão local');
        await safeSignOut();
        return null;
      }
      const lower = msg.toLowerCase();
      const isTransient =
        lower.includes('fetch') ||
        lower.includes('network') ||
        lower.includes('timeout') ||
        lower.includes('abort') ||
        lower.includes('econnrefused') ||
        lower.includes('econnreset') ||
        lower.includes('socket') ||
        lower.includes('unreachable');

      if (isTransient && attempt < MAX_REFRESH_RETRIES - 1) {
        const delay = (attempt + 1) * 2000;
        console.warn(`[safeRefreshSession] Exceção transitória (tentativa ${attempt + 1}/${MAX_REFRESH_RETRIES}), retry em ${delay}ms:`, msg);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      console.warn('[safeRefreshSession] Exceção inesperada:', msg);
      return null;
    }
  }

  return null;
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
async function resolveAccessToken(externalToken?: string): Promise<{
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

      // Se for erro de rede (Failed to fetch, timeout, etc.) e ainda tem retries, tenta novamente
      if (!isRetry && (netMsg.includes('Failed to fetch') || netMsg.includes('fetch') || netMsg.includes('network') || netMsg.includes('abort') || netMsg.includes('timeout'))) {
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
    if (response.status === 401) {
      console.warn(`[invokeWithAuth] ${functionName} returned 401 — forcing token refresh and retry`);

      const refreshedSession = await safeRefreshSession();
      if (!refreshedSession?.access_token) {
        return {
          data: null,
          error: new Error('Sessao expirada ou revogada. Por favor, faca login novamente.'),
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
      try {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const errBody = await response.json();
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
      }
      return { data: null, error: new Error(errMsg) };
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
async function compressImage(file: File, maxSize = 700, quality = 0.6): Promise<Blob> {
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