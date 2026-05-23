import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { ensureFreshSession } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type UserPerfil = 'admin' | 'gerente' | 'caixa' | 'garcom' | 'cozinha' | 'totem';

export interface TenantOption {
  tenantId: string;
  tenantName: string;
  role: UserPerfil;
  trainingMode: boolean;
}

export interface AuthUser {
  id: string;
  nome: string;
  email: string;
  perfil: UserPerfil;
  loja: string;
  tenantId: string;
  modoTreino: boolean;
}

/** Kept for backward compatibility with onboarding page */
export interface DynamicUserRecord {
  id: string;
  nome: string;
  email: string;
  matricula: string;
  senha: string;
  perfil: UserPerfil;
  loja: string;
  modoTreino: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, senha: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  isFirstSetup: boolean;
  // Multi-tenant
  needsTenantSelection: boolean;
  availableTenants: TenantOption[];
  canSwitchTenant: boolean;
  selectTenant: (tenantId: string) => Promise<void>;
  switchTenant: () => void;
  /** true quando o usuário está autenticado mas não tem nenhum tenant vinculado */
  hasNoTenants: boolean;
  // Legacy compat
  saveDynamicUser: (data: Omit<DynamicUserRecord, 'id'>) => void;
  completeOnboarding: (adminUser: AuthUser, lojaName: string) => void;
}

// ─── Role mapping ─────────────────────────────────────────────────────────────

const DB_TO_FRONTEND_ROLE: Record<string, UserPerfil> = {
  admin: 'admin',
  manager: 'gerente',
  cashier: 'caixa',
  waiter: 'garcom',
  kitchen: 'cozinha',
  tablet: 'totem',
};

// ─── Profile fetcher for specific tenant ─────────────────────────────────────

async function fetchProfileForTenant(
  userId: string,
  tenantId: string,
): Promise<AuthUser | null> {
  // Garante token fresco antes de fazer RPC
  const session = await ensureFreshSession();
  if (!session) return null;

  const [profileRes, sessionRes] = await Promise.all([
    supabase.rpc('get_user_profile_for_tenant', {
      p_user_id: userId,
      p_tenant_id: tenantId,
    }),
    supabase.auth.getSession(),
  ]);

  const { data, error } = profileRes;

  if (error) {
    const isJwtExpired =
      (error as { code?: string; message?: string }).code === 'PGRST303' ||
      (error.message ?? '').toLowerCase().includes('jwt expired');

    if (isJwtExpired) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshData?.session) {
        const retry = await supabase.rpc('get_user_profile_for_tenant', {
          p_user_id: userId,
          p_tenant_id: tenantId,
        });
        if (!retry.error && retry.data) {
          const emailRetry = refreshData.session?.user?.email ?? '';
          return {
            id: userId,
            email: emailRetry,
            nome: retry.data.name ?? '',
            perfil: DB_TO_FRONTEND_ROLE[retry.data.role] ?? 'caixa',
            loja: retry.data.tenant_name ?? '',
            tenantId: retry.data.tenant_id,
            modoTreino: retry.data.training_mode ?? false,
          };
        }
      }
    }
    console.error('[Auth] get_user_profile_for_tenant failed:', error);
    return null;
  }

  if (!data) {
    console.error('[Auth] get_user_profile_for_tenant failed:', error);
    return null;
  }

  const email = sessionRes.data.session?.user?.email ?? '';

  return {
    id: userId,
    email,
    nome: data.name ?? '',
    perfil: DB_TO_FRONTEND_ROLE[data.role] ?? 'caixa',
    loja: data.tenant_name ?? '',
    tenantId: data.tenant_id,
    modoTreino: data.training_mode ?? false,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ONBOARDING_KEY = 'erpos_onboarding_done';
const LOJA_KEY = 'erpos_loja_nome';
const SELECTED_TENANT_KEY = 'erpos_selected_tenant_id';

export const LOJA_NOME_KEY = LOJA_KEY;

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableTenants, setAvailableTenants] = useState<TenantOption[]>([]);
  const [needsTenantSelection, setNeedsTenantSelection] = useState(false);
  const [tenantCount, setTenantCount] = useState(0);
  const [hasNoTenants, setHasNoTenants] = useState(false);
  const authUserIdRef = useRef<string | null>(null);

  // ── Resolve which tenant to use ──────────────────────────────────────────
  const resolveSession = useCallback(async (userId: string) => {
    authUserIdRef.current = userId;

    // Garante que o token esteja atualizado antes de fazer RPCs
    const session = await ensureFreshSession();
    if (!session) {
      setUser(null);
      setNeedsTenantSelection(false);
      return;
    }

    const { data: tenantsRaw, error } = await supabase.rpc('get_user_tenants', {
      p_user_id: userId,
    });

    if (error) {
      const isJwtExpired =
        (error as { code?: string; message?: string }).code === 'PGRST303' ||
        (error.message ?? '').toLowerCase().includes('jwt expired');

      if (isJwtExpired) {
        // Tenta renovar o token uma vez e refazer a chamada
        try {
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshData?.session) {
            const retry = await supabase.rpc('get_user_tenants', { p_user_id: userId });
            if (!retry.error) {
              const tenantsRetry: TenantOption[] = ((retry.data as Record<string, unknown>[]) ?? []).map(
                (t) => ({
                  tenantId: t.tenant_id as string,
                  tenantName: t.tenant_name as string,
                  role: DB_TO_FRONTEND_ROLE[t.role as string] ?? 'caixa',
                  trainingMode: (t.training_mode as boolean) ?? false,
                }),
              );
              handleTenantResolution(userId, tenantsRetry);
              return;
            }
          }
        } catch {
          // Silencioso: refresh token inválido ou sessão expirada
        }
        // Se não conseguiu renovar, desloga
        try { await supabase.auth.signOut(); } catch { /* silencioso */ }
        setUser(null);
        setNeedsTenantSelection(false);
        setAvailableTenants([]);
        localStorage.removeItem(SELECTED_TENANT_KEY);
        return;
      }

      console.error('[Auth] get_user_tenants error:', error);
      setUser(null);
      return;
    }

    const tenants: TenantOption[] = ((tenantsRaw as Record<string, unknown>[]) ?? []).map(
      (t) => ({
        tenantId: t.tenant_id as string,
        tenantName: t.tenant_name as string,
        role: DB_TO_FRONTEND_ROLE[t.role as string] ?? 'caixa',
        trainingMode: (t.training_mode as boolean) ?? false,
      }),
    );

    handleTenantResolution(userId, tenants);
  }, []);

  const handleTenantResolution = useCallback(async (userId: string, tenants: TenantOption[]) => {
    setTenantCount(tenants.length);

    if (tenants.length === 0) {
      setUser(null);
      setNeedsTenantSelection(false);
      setHasNoTenants(true);
      return;
    }
    setHasNoTenants(false);

    if (tenants.length === 1) {
      const profile = await fetchProfileForTenant(userId, tenants[0].tenantId);
      if (profile) {
        setUser(profile);
        setNeedsTenantSelection(false);
        return;
      }
      localStorage.removeItem(SELECTED_TENANT_KEY);
      setAvailableTenants(tenants);
      setNeedsTenantSelection(true);
      setUser(null);
      return;
    }

    const storedId = localStorage.getItem(SELECTED_TENANT_KEY);
    const validStored = tenants.find((t) => t.tenantId === storedId);

    if (validStored) {
      const profile = await fetchProfileForTenant(userId, validStored.tenantId);
      if (profile) {
        setUser(profile);
        setNeedsTenantSelection(false);
        return;
      }
      localStorage.removeItem(SELECTED_TENANT_KEY);
    }

    setAvailableTenants(tenants);
    setNeedsTenantSelection(true);
    setUser(null);
  }, []);

  const handleSession = useCallback(
    async (userId: string | undefined) => {
      setLoading(true);
      if (!userId) {
        setUser(null);
        setAvailableTenants([]);
        setNeedsTenantSelection(false);
        setHasNoTenants(false);
        authUserIdRef.current = null;
        localStorage.removeItem(SELECTED_TENANT_KEY);
        setLoading(false);
        return;
      }
      await resolveSession(userId);
      setLoading(false);
    },
    [resolveSession],
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session?.user?.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Ignora eventos que não requerem re-processamento da sessão
      // INITIAL_SESSION: já tratado pelo getSession() acima
      // TOKEN_REFRESHED: apenas renova o token, não muda o usuário
      //   → processar TOKEN_REFRESHED causaria loop: refresh → event → handleSession → RPCs → refresh...
      if (_event === 'INITIAL_SESSION' || _event === 'TOKEN_REFRESHED') return;

      // Se a sessão foi revogada (ban/pausa via admin), força logout local imediato
      if (_event === 'SIGNED_OUT' || !session) {
        setUser(null);
        setAvailableTenants([]);
        setNeedsTenantSelection(false);
        setHasNoTenants(false);
        authUserIdRef.current = null;
        localStorage.removeItem(SELECTED_TENANT_KEY);
        setLoading(false);
        return;
      }

      handleSession(session?.user?.id);
    });

    return () => subscription.unsubscribe();
  }, [handleSession]);

  useEffect(() => {
    // Ping ativo a cada 60 segundos — verifica se a sessão ainda é válida no servidor.
    // Usa getSession() (leve, sem round-trip ao servidor) combinado com verificação de expiração.
    // refreshSession() só é chamado se o token estiver prestes a expirar (< 5min).
    // Isso evita o loop: refreshSession → TOKEN_REFRESHED → handleSession → re-render → novo interval.
    const forceSessionCheck = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session;

        // Sem sessão local — não há nada a verificar
        if (!session) return;

        // Verifica se o token expira em menos de 5 minutos
        const expiresAt = session.expires_at ?? 0;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const secondsUntilExpiry = expiresAt - nowSeconds;

        if (secondsUntilExpiry < 300) {
          // Token prestes a expirar — faz refresh real
          const { error } = await supabase.auth.refreshSession();
          if (error) {
            // Sessão rejeitada pelo servidor (ban, pausa, revogação)
            try { await supabase.auth.signOut(); } catch { /* silencioso */ }
          }
        }
      } catch {
        // Silencioso — erro de rede não deve derrubar a sessão
      }
    };

    const interval = setInterval(forceSessionCheck, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ─── Login ─────────────────────────────────────────────────────────────────

  const login = async (identifier: string, senha: string): Promise<boolean> => {
    const trimmedId = identifier.trim();
    const trimmedSenha = senha.trim();
    const isBadge = /^\d+$/.test(trimmedId) && trimmedId.length <= 8;

    if (isBadge) {
      const { data, error } = await supabase.functions.invoke<{
        hashed_token: string;
        error?: string;
      }>('login-pin', {
        body: { badge_number: trimmedId, pin: trimmedSenha },
      });
      if (error || !data?.hashed_token) return false;
      const { error: otpError } = await supabase.auth.verifyOtp({
        token_hash: data.hashed_token,
        type: 'email',
      });
      return !otpError;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedId,
      password: trimmedSenha,
    });
    return !error;
  };

  // ─── Logout ────────────────────────────────────────────────────────────────

  const logout = () => {
    try { supabase.auth.signOut(); } catch { /* silencioso */ }
    setUser(null);
    setAvailableTenants([]);
    setNeedsTenantSelection(false);
    setTenantCount(0);
    setHasNoTenants(false);
    localStorage.removeItem(SELECTED_TENANT_KEY);
    authUserIdRef.current = null;
  };

  // ─── Select tenant ─────────────────────────────────────────────────────────

  const selectTenant = async (tenantId: string) => {
    const userId = authUserIdRef.current;
    if (!userId) return;
    localStorage.setItem(SELECTED_TENANT_KEY, tenantId);
    const profile = await fetchProfileForTenant(userId, tenantId);
    if (!profile) {
      // Se não conseguiu buscar o perfil (token expirado, etc), desloga
      try { await supabase.auth.signOut(); } catch { /* silencioso */ }
      setUser(null);
      setNeedsTenantSelection(false);
      setAvailableTenants([]);
      localStorage.removeItem(SELECTED_TENANT_KEY);
      return;
    }
    setUser(profile);
    setNeedsTenantSelection(false);
    setAvailableTenants([]);
  };

  // ─── Switch tenant (for admin users with multiple stores) ──────────────────

  const switchTenant = () => {
    const userId = authUserIdRef.current;
    if (!userId) return;
    localStorage.removeItem(SELECTED_TENANT_KEY);
    setNeedsTenantSelection(true); // Garante isAuthenticated=true ate a nova selecao
    setUser(null);
    setAvailableTenants([]);

    ensureFreshSession().then((session) => {
      if (!session) {
        setAvailableTenants([]);
        setNeedsTenantSelection(false);
        setUser(null);
        return;
      }
      supabase
        .rpc('get_user_tenants', { p_user_id: userId })
        .then(({ data, error }) => {
          if (error) {
            console.error('[Auth] switchTenant get_user_tenants error:', error);
            setAvailableTenants([]);
            setNeedsTenantSelection(false);
            return;
          }
          const tenants: TenantOption[] = (
            (data as Record<string, unknown>[]) ?? []
          ).map((t) => ({
            tenantId: t.tenant_id as string,
            tenantName: t.tenant_name as string,
            role: DB_TO_FRONTEND_ROLE[t.role as string] ?? 'caixa',
            trainingMode: (t.training_mode as boolean) ?? false,
          }));
          if (tenants.length === 0) {
            setNeedsTenantSelection(false);
            return;
          }
          if (tenants.length === 1) {
            selectTenant(tenants[0].tenantId);
            return;
          }
          setAvailableTenants(tenants);
        });
    });
  };

  // ─── Onboarding helpers (backward compat) ──────────────────────────────────

  const isFirstSetup = !localStorage.getItem(ONBOARDING_KEY);
  const saveDynamicUser = (_data: Omit<DynamicUserRecord, 'id'>) => {};
  const completeOnboarding = (adminUser: AuthUser, lojaName: string) => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    localStorage.setItem(LOJA_KEY, lojaName);
    setUser({ ...adminUser, email: adminUser.email ?? '', loja: lojaName });
  };

  // ─── Loading screen ────────────────────────────────────────────────────────
  // IMPORTANTE: não bloquear a renderização dos children durante o loading.
  // Rotas como /autoatendimento e /totem precisam dos providers filhos
  // (KDSContext, SessaoContext etc.) montados independentemente do auth.
  // O loading overlay é renderizado sobre os children, não no lugar deles.

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAuthenticated: !!user || needsTenantSelection || hasNoTenants,
        isFirstSetup,
        needsTenantSelection,
        availableTenants,
        canSwitchTenant: tenantCount > 1,
        selectTenant,
        hasNoTenants,
        switchTenant,
        saveDynamicUser,
        completeOnboarding,
      }}
    >
      {/* Sempre renderiza os children para que todos os providers filhos
          sejam montados, mesmo durante o carregamento inicial da sessão.
          Rotas públicas como /autoatendimento e /totem dependem disso. */}
      {children}
      {/* Overlay de loading sobre toda a UI enquanto verifica a sessão */}
      {loading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 flex items-center justify-center bg-amber-500 rounded-xl">
              <i className="ri-restaurant-line text-zinc-950 text-xl" />
            </div>
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-zinc-400 font-medium">Carregando sessão...</p>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
