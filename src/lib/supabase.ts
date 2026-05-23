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
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Garante que a sessao do Supabase esteja fresca (token nao expirado).
 * Se o token expirar em menos de 2 minutos, forca um refresh.
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

  // Token ja expirado OU expira em menos de 2 minutos -> tenta refresh
  if (expiresAt <= nowSec || expiresAt - nowSec < 120) {
    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData?.session) {
        return null;
      }
      return refreshData.session;
    } catch {
      return null;
    }
  }

  return session;
}

/**
 * Faz o fetch para a Edge Function com o token fornecido.
 * Retorna a response para tratamento externo.
 */
async function doFetch(
  functionName: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
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
    },
  );
}

/**
 * Tenta obter um token valido da sessao, fazendo refresh se necessario.
 * Retorna { accessToken, error } onde error indica falha critica de sessao.
 */
async function resolveAccessToken(externalToken?: string): Promise<{
  accessToken: string | null;
  error: Error | null;
}> {
  if (externalToken) {
    return { accessToken: externalToken, error: null };
  }

  let session: { session?: Session | null } | null = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error) session = data;
  } catch {
    session = null;
  }

  if (!session?.session?.access_token) {
    return {
      accessToken: null,
      error: new Error('Sessao invalida ou expirada. Faca login novamente.'),
    };
  }

  const s = session.session;
  const expiresAt = s.expires_at ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);

  // Token expirado ou expira em menos de 60s -> forca refresh
  if (expiresAt - nowSec < 60) {
    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshData?.session?.access_token) {
        return { accessToken: refreshData.session.access_token, error: null };
      }
      console.error('[invokeWithAuth] Token refresh failed');
      return {
        accessToken: null,
        error: new Error('Sessao expirada. Por favor, faca login novamente.'),
      };
    } catch {
      console.error('[invokeWithAuth] Token refresh threw');
      return {
        accessToken: null,
        error: new Error('Sessao expirada. Por favor, faca login novamente.'),
      };
    }
  }

  return { accessToken: s.access_token, error: null };
}

/**
 * Invoca uma Edge Function garantindo que o JWT mais recente da sessao
 * seja enviado no header Authorization. Se receber 401 (token rejeitado pelo
 * servidor), faz refresh do token e retenta a chamada uma unica vez.
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
    return { data: null, error: firstResolve.error };
  }
  accessToken = firstResolve.accessToken;

  let response: Response;
  try {
    response = await doFetch(functionName, accessToken!, options.body ?? {});
  } catch (netErr) {
    return {
      data: null,
      error: netErr instanceof Error ? netErr : new Error('Erro de rede ao chamar funcao'),
    };
  }

  // Se recebeu 401, pode ser token revogado no servidor. Forca refresh e retenta.
  if (response.status === 401) {
    console.warn(`[invokeWithAuth] ${functionName} returned 401 — forcing token refresh and retry`);

    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData?.session?.access_token) {
        return {
          data: null,
          error: new Error('Sessao expirada ou revogada. Por favor, faca login novamente.'),
        };
      }
      accessToken = refreshData.session.access_token;
    } catch {
      return {
        data: null,
        error: new Error('Sessao expirada ou revogada. Por favor, faca login novamente.'),
      };
    }

    try {
      response = await doFetch(functionName, accessToken, options.body ?? {});
    } catch (netErr) {
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

/**
 * Faz upload de uma imagem de cardápio (item ou combo) para o Supabase Storage.
 * Retorna a URL pública da imagem.
 */
export async function uploadMenuImage(
  file: File,
  tenantId: string,
  itemId?: string,
): Promise<{ url: string | null; error: Error | null }> {
  const bucket = 'menu-images';
  const path = `${tenantId}/${itemId ?? 'temp'}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;

  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  });

  if (uploadError) {
    return { url: null, error: new Error(uploadError.message) };
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data?.publicUrl ?? null, error: null };
}