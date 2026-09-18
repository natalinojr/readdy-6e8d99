import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabase } from '@/lib/supabase';
import { kioskRetryDelayMs } from '@/lib/kioskRetry';

const STORAGE_KEY = 'erpos_kiosk_session';
// Token permanente do totem (o mesmo de /totem/:token). Fica só neste aparelho e serve
// para reautenticar sozinho quando a sessão venceu (tablet desligado, internet caiu).
const TOKEN_STORAGE_KEY = 'erpos_kiosk_token';

function isKioskRoute(): boolean {
  const pathname = window.location.pathname;
  return pathname.includes('/autoatendimento') || pathname.includes('/totem/');
}

interface KioskAuthResponse {
  access_token: string;
  refresh_token?: string;
  tenant_id: string;
  kiosk_label?: string;
  kiosk_user_id: string;
  session_id?: string | null;
}

async function callKioskAuth(token: string): Promise<KioskAuthResponse> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/kiosk-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data?.access_token) throw new Error('Resposta inválida do servidor');
  return data as KioskAuthResponse;
}

export interface KioskSession {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  kioskLabel: string;
  kioskUserId: string;
  sessionId: string | null;
  authenticatedAt: number;
}

interface KioskAuthContextData {
  kioskSession: KioskSession | null;
  loading: boolean;
  error: string | null;
  authenticateWithToken: (token: string) => Promise<boolean>;
  refreshKioskSession: () => Promise<boolean>;
  clearKioskSession: () => void;
  isKioskMode: boolean;
}

const KioskAuthContext = createContext<KioskAuthContextData | null>(null);

// JWT expira em 1h — refresca se faltar menos de 10min
const REFRESH_THRESHOLD_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutos

function loadStoredSession(): KioskSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KioskSession;
    // Não descarta pela idade: sessão velha é renovada (refresh ou kiosk-auth com o
    // token guardado) pelo efeito de auto-refresh logo ao montar.
    // Fora das rotas de totem mantém o comportamento antigo (descarta velha), para uma
    // sessão de totem esquecida no PC do admin não sequestrar o tenant das outras telas.
    if (!parsed?.tenantId) return null;
    if (!isKioskRoute() && Date.now() - parsed.authenticatedAt > TOKEN_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Injeta a sessão do kiosk no cliente Supabase global.
 * Isso garante que chamadas como supabase.rpc() incluam o JWT do kiosk,
 * permitindo que fn_get_full_menu e outras RPCs autentiquem corretamente.
 */
async function injectSupabaseSession(accessToken: string, refreshToken: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error || !data?.session) {
      console.warn('[KioskAuth] injectSupabaseSession: setSession falhou:', error?.message);
      return false;
    }
    console.log('[KioskAuth] Sessão do Supabase atualizada com token do kiosk');
    return true;
  } catch (e) {
    console.warn('[KioskAuth] injectSupabaseSession: exceção:', e);
    return false;
  }
}

export function KioskAuthProvider({ children }: { children: ReactNode }) {
  const [kioskSession, setKioskSession] = useState<KioskSession | null>(loadStoredSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<KioskSession | null>(kioskSession);
  sessionRef.current = kioskSession;
  const refreshingRef = useRef<Promise<boolean> | null>(null);

  // Em rota de totem, a sessão guardada só é exposta aos contexts (Cardápio, Sessão,
  // Settings…) depois que o cliente Supabase está com o JWT do totem (setSession feito,
  // direto ou após refresh/reauth). Antes disso os contexts disparariam RPCs como anon,
  // que agora dá 42501. Fora da rota de totem nada muda.
  const [supabaseReady, setSupabaseReady] = useState<boolean>(() => !isKioskRoute());

  // Ao montar em rota de totem, injeta a sessão guardada no cliente Supabase — mas só se
  // ainda estiver fresca. Sessão velha fica para o auto-refresh (evita o setSession do
  // supabase-js girar o refresh_token em paralelo com o nosso refresh).
  //
  // IMPORTANTE: Injetar a sessão kiosk em rotas normais (ex: /configuracoes) sobrescrevia
  // o JWT do admin com o JWT do kiosk de outra loja, causando erros de 'Unauthorized'
  // nas RPCs que verificam auth.uid() contra user_tenants.
  const [mountInjectPending, setMountInjectPending] = useState<boolean>(() => {
    const stored = loadStoredSession();
    return !!stored?.accessToken && !!stored?.refreshToken && isKioskRoute()
      && Date.now() - stored.authenticatedAt <= TOKEN_TTL_MS - REFRESH_THRESHOLD_MS;
  });
  // Tentativas seguidas de renovação que falharam. Fica fora do efeito de auto-refresh
  // para o recuo (30s…5min) não zerar quando o efeito reagenda (ex.: tokens renovados
  // mas setSession falhou → authenticatedAt muda). Zera só em sucesso.
  const retryAttemptRef = useRef(0);
  useEffect(() => {
    if (!mountInjectPending) return;
    const stored = loadStoredSession();
    if (!stored?.accessToken || !stored?.refreshToken) { setMountInjectPending(false); return; }
    injectSupabaseSession(stored.accessToken, stored.refreshToken).then((ok) => {
      if (ok) setSupabaseReady(true);
      // Falhou: o auto-refresh vê !supabaseReady e tenta já, com recuo.
      setMountInjectPending(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSession = useCallback((session: KioskSession) => {
    sessionRef.current = session;
    setKioskSession(session);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, []);

  // Fonte única do refresh_token: quando o supabase-js renova a sessão do totem (ex.:
  // resolveAccessToken chamando refreshSession), copia os tokens novos para a sessão
  // guardada — senão a nossa cópia fica com um refresh_token já girado/inválido.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'TOKEN_REFRESHED' || !session) return;
      const current = sessionRef.current;
      if (!current || session.user?.id !== current.kioskUserId) return;
      if (session.access_token === current.accessToken) return;
      saveSession({
        ...current,
        accessToken: session.access_token,
        refreshToken: session.refresh_token ?? current.refreshToken,
        authenticatedAt: Date.now(),
      });
    });
    return () => subscription.unsubscribe();
  }, [saveSession]);

  const clearKioskSession = useCallback(() => {
    sessionRef.current = null;
    setKioskSession(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    // Limpa também a sessão do Supabase (logout silencioso)
    supabase.auth.signOut().catch(() => {});
  }, []);

  // Autentica no kiosk-auth, injeta no Supabase e guarda. Lança erro em falha.
  const autenticar = useCallback(async (token: string): Promise<void> => {
    const data = await callKioskAuth(token);

    // PRIMEIRO: injeta a sessão no cliente Supabase
    // Isso garante que quando o CardapioContext chamar fn_get_full_menu,
    // o JWT do kiosk já estará disponível no cliente Supabase
    const sessionInjected = await injectSupabaseSession(data.access_token, data.refresh_token ?? '');
    if (!sessionInjected) {
      // Sem o JWT no cliente as RPCs sairiam como anon (42501). Falha aqui para o
      // chamador mostrar erro / o auto-refresh tentar de novo.
      throw new Error('Não foi possível ativar a sessão do totem');
    }
    setSupabaseReady(true);

    // DEPOIS: salva no estado e localStorage (isso dispara o CardapioContext.recarregar)
    const session: KioskSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      tenantId: data.tenant_id,
      kioskLabel: data.kiosk_label ?? 'Totem',
      kioskUserId: data.kiosk_user_id,
      sessionId: data.session_id ?? null,
      authenticatedAt: Date.now(),
    };

    try { localStorage.setItem(TOKEN_STORAGE_KEY, token); } catch { /* sem storage: segue sem reauth automática */ }
    saveSession(session);
  }, [saveSession]);

  const authenticateWithToken = useCallback(async (token: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await autenticar(token);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.error('[KioskAuth] authenticateWithToken error:', msg);
      return false;
    } finally {
      setLoading(false);
    }
  }, [autenticar]);

  // Renova a sessão do totem. Ordem: (1) refresh_token do supabase-js, se a sessão ativa
  // dele é a do totem; (2) refresh_token guardado; (3) kiosk-auth com o token permanente.
  // Retorna false se tudo falhou (o chamador agenda nova tentativa).
  const refreshKioskSession = useCallback(async (): Promise<boolean> => {
    if (refreshingRef.current) return refreshingRef.current;
    const run = async (): Promise<boolean> => {
      const current = sessionRef.current;
      if (!current) return false;
      // Fora da rota de totem não mexe na sessão do Supabase (pode ser um admin logado)
      if (!isKioskRoute()) return false;

      // (1) supabase-js como fonte do refresh_token
      try {
        const { data: cur } = await supabase.auth.getSession();
        if (cur.session?.user?.id === current.kioskUserId) {
          const { data, error } = await supabase.auth.refreshSession();
          if (!error && data.session) {
            setSupabaseReady(true);
            saveSession({
              ...current,
              accessToken: data.session.access_token,
              refreshToken: data.session.refresh_token ?? current.refreshToken,
              authenticatedAt: Date.now(),
            });
            return true;
          }
          console.warn('[KioskAuth] refreshSession falhou:', error?.message);
        }
      } catch (e) {
        console.warn('[KioskAuth] refreshSession exceção:', e);
      }

      // (2) refresh_token guardado (supabase-js ainda sem a sessão do totem)
      if (current.refreshToken) {
        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ refresh_token: current.refreshToken }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.access_token) {
              const refreshToken = data.refresh_token ?? current.refreshToken;
              const injected = await injectSupabaseSession(data.access_token, refreshToken);
              saveSession({
                ...current,
                accessToken: data.access_token,
                refreshToken,
                authenticatedAt: Date.now(),
              });
              if (injected) {
                setSupabaseReady(true);
                return true;
              }
              // Tokens novos guardados, mas o cliente segue sem JWT: cai na reauth (3).
            }
          } else {
            console.warn('[KioskAuth] refresh HTTP', res.status);
          }
        } catch (e) {
          console.warn('[KioskAuth] refresh failed:', e);
        }
      }

      // (3) reautentica com o token permanente do totem
      let token: string | null = null;
      try { token = localStorage.getItem(TOKEN_STORAGE_KEY); } catch { token = null; }
      if (token) {
        try {
          await autenticar(token);
          console.log('[KioskAuth] Sessão do totem reautenticada pelo token');
          return true;
        } catch (e) {
          console.warn('[KioskAuth] reautenticação pelo token falhou:', e);
        }
      }
      return false;
    };
    const p = run()
      .then((ok) => { if (ok) retryAttemptRef.current = 0; return ok; })
      .finally(() => { refreshingRef.current = null; });
    refreshingRef.current = p;
    return p;
  }, [saveSession, autenticar]);

  // Auto-refresh: agenda para quando faltar REFRESH_THRESHOLD_MS (ou já, se velha).
  // Em falha, tenta de novo com espera crescente (30s, 60s, 120s… até 5 min), sem parar.
  // Sucesso grava sessão nova → authenticatedAt muda → este efeito reagenda.
  const authenticatedAt = kioskSession?.authenticatedAt;
  const hasSession = !!kioskSession;
  // Em rota de totem sem cliente pronto (setSession/refresh falhou ao abrir), tenta já.
  const needsReady = !supabaseReady && isKioskRoute();
  useEffect(() => {
    if (!hasSession || authenticatedAt == null) return;
    // Injeção inicial da sessão fresca em andamento: não renova em paralelo (giraria o refresh_token).
    if (mountInjectPending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tentar = async () => {
      const ok = await refreshKioskSession();
      if (ok) return; // retryAttemptRef zerado em refreshKioskSession
      const wait = kioskRetryDelayMs(retryAttemptRef.current);
      retryAttemptRef.current += 1;
      if (cancelled) return; // efeito reagendou; ele usa o recuo já incrementado
      console.warn(`[KioskAuth] renovação falhou — nova tentativa em ${Math.round(wait / 1000)}s`);
      timer = setTimeout(tentar, wait);
    };
    let delay: number;
    if (retryAttemptRef.current > 0) delay = kioskRetryDelayMs(retryAttemptRef.current - 1);
    else if (needsReady) delay = 0;
    else delay = Math.max(0, TOKEN_TTL_MS - (Date.now() - authenticatedAt) - REFRESH_THRESHOLD_MS);
    timer = setTimeout(tentar, delay);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasSession, authenticatedAt, refreshKioskSession, mountInjectPending, needsReady]);

  // Em rota de totem, só expõe a sessão (tenantId/accessToken) com o cliente Supabase pronto.
  const exposedSession = supabaseReady || !isKioskRoute() ? kioskSession : null;

  return (
    <KioskAuthContext.Provider value={{
      kioskSession: exposedSession,
      loading,
      error,
      authenticateWithToken,
      refreshKioskSession,
      clearKioskSession,
      isKioskMode: !!exposedSession,
    }}>
      {children}
    </KioskAuthContext.Provider>
  );
}

export function useKioskAuth() {
  const ctx = useContext(KioskAuthContext);
  if (!ctx) throw new Error('useKioskAuth must be used within KioskAuthProvider');
  return ctx;
}