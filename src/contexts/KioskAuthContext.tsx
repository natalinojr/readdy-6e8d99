import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabase } from '@/lib/supabase';

const STORAGE_KEY = 'erpos_kiosk_session';

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
  refreshKioskSession: () => Promise<void>;
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
    // Verifica se o token ainda é válido (menos de 55min)
    if (Date.now() - parsed.authenticatedAt > TOKEN_TTL_MS) return null;
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

  // Ao montar, só injeta a sessão do kiosk no cliente Supabase se:
  // 1. A rota atual é /autoatendimento ou /totem/ (rota de kiosk)
  // 2. Não há um admin logado normalmente (para não sobrescrever a sessão do admin)
  //
  // IMPORTANTE: Injetar a sessão kiosk em rotas normais (ex: /configuracoes) sobrescrevia
  // o JWT do admin com o JWT do kiosk de outra loja, causando erros de 'Unauthorized'
  // nas RPCs que verificam auth.uid() contra user_tenants.
  useEffect(() => {
    const stored = loadStoredSession();
    if (!stored?.accessToken || !stored?.refreshToken) return;

    // Só injeta automaticamente em rotas de kiosk
    const pathname = window.location.pathname;
    const isKioskRoute = pathname.includes('/autoatendimento') || pathname.includes('/totem/');
    if (isKioskRoute) {
      injectSupabaseSession(stored.accessToken, stored.refreshToken);
    }
  }, []);

  const saveSession = useCallback((session: KioskSession) => {
    setKioskSession(session);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, []);

  const clearKioskSession = useCallback(() => {
    setKioskSession(null);
    localStorage.removeItem(STORAGE_KEY);
    // Limpa também a sessão do Supabase (logout silencioso)
    supabase.auth.signOut().catch(() => {});
  }, []);

  const authenticateWithToken = useCallback(async (token: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
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
      if (!data.access_token) throw new Error('Resposta inválida do servidor');

      // PRIMEIRO: injeta a sessão no cliente Supabase
      // Isso garante que quando o CardapioContext chamar fn_get_full_menu,
      // o JWT do kiosk já estará disponível no cliente Supabase
      const sessionInjected = await injectSupabaseSession(data.access_token, data.refresh_token);
      if (!sessionInjected) {
        console.warn('[KioskAuth] authenticateWithToken: Não conseguiu injetar sessão no Supabase, mas continuando...');
      }

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

      saveSession(session);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.error('[KioskAuth] authenticateWithToken error:', msg);
      return false;
    } finally {
      setLoading(false);
    }
  }, [saveSession]);

  const refreshKioskSession = useCallback(async () => {
    if (!kioskSession?.refreshToken) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ refresh_token: kioskSession.refreshToken }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.access_token) {
        // Atualiza também a sessão do Supabase com o novo token
        injectSupabaseSession(data.access_token, data.refresh_token ?? kioskSession.refreshToken);
        
        saveSession({
          ...kioskSession,
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? kioskSession.refreshToken,
          authenticatedAt: Date.now(),
        });
      }
    } catch (e) {
      console.warn('[KioskAuth] refresh failed:', e);
    }
  }, [kioskSession, saveSession]);

  // Auto-refresh quando o token está prestes a expirar
  useEffect(() => {
    if (!kioskSession) return;
    const elapsed = Date.now() - kioskSession.authenticatedAt;
    const remaining = TOKEN_TTL_MS - elapsed;
    if (remaining <= REFRESH_THRESHOLD_MS) {
      refreshKioskSession();
      return;
    }
    const timer = setTimeout(() => {
      refreshKioskSession();
    }, remaining - REFRESH_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, [kioskSession, refreshKioskSession]);

  return (
    <KioskAuthContext.Provider value={{
      kioskSession,
      loading,
      error,
      authenticateWithToken,
      refreshKioskSession,
      clearKioskSession,
      isKioskMode: !!kioskSession,
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