import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';
import {
  DEFAULT_PERMISSOES, PAPEL_TO_DB_ROLE, permissoesDaPessoa,
  type Papel, type PermissaoKey,
} from '../../supabase/functions/_shared/permissoes-padrao';
// Papéis, chaves e padrão por cargo moram em supabase/functions/_shared/permissoes-padrao.ts (2026-10-03):
// a tela e as Edge Functions usam a mesma regra. Reexportados aqui para quem já importava deste arquivo.
export * from '../../supabase/functions/_shared/permissoes-padrao';

export interface PermissoesContextValue {
  /** Verifica se o usuário atual tem a permissão */
  hasPermissao: (key: PermissaoKey) => boolean;
  /** Mapa completo de permissões do papel atual */
  permissoes: PermissaoKey[];
  loading: boolean;
  recarregar: () => void;
}

export const PermissoesContext = createContext<PermissoesContextValue>({
  hasPermissao: () => true,
  permissoes: [],
  loading: false,
  recarregar: () => undefined,
});

export function usePermissoes(): PermissoesContextValue {
  return useContext(PermissoesContext);
}

/** Hook interno — usado apenas no Provider */
export function usePermissoesState(): PermissoesContextValue {
  const { user } = useAuth();
  const { kioskSession } = useKioskAuth();
  const papel = (user?.perfil ?? 'caixa') as Papel;
  const [permissoes, setPermissoes] = useState<PermissaoKey[]>(DEFAULT_PERMISSOES[papel] ?? []);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) { setLoading(false); return; }

    // Admin sempre tem tudo — não precisa consultar banco
    if (papel === 'admin') {
      setPermissoes(DEFAULT_PERMISSOES.admin);
      setLoading(false);
      return;
    }

    // Modo kiosk por token: não tem sessão Supabase Auth — usa defaults sem chamar config-write
    // O papel 'totem' não existe em DEFAULT_PERMISSOES, então usa defaults vazios (sem permissões admin)
    if (kioskSession?.accessToken && !user) {
      setPermissoes([]);
      setLoading(false);
      return;
    }

    // Usuário com perfil totem/kiosk/tarefas logado normalmente — não chama
    // config-write pois esses roles não têm permissão para get_permissions
    // (tarefas também não precisa: o módulo não usa PermissaoKey, e o resto
    // do app já fica bloqueado pelo hard-lock de rota em RotaProtegida)
    const papelStr: string = papel;
    if (papelStr === 'totem' || papelStr === 'kiosk' || papelStr === 'tablet' || papelStr === 'tarefas') {
      setPermissoes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    // Ajuste da PESSOA nesta loja (acesso por pessoa, 2026-10-03): vem por cima do cargo. A RLS deixa
    // cada um ler só as próprias linhas. Sem a leitura, vale o cargo (como antes da tabela existir).
    const lerAjustesDaPessoa = async () => {
      if (!user?.id) return [];
      const { data: linhas, error: erroPessoa } = await supabase.from('user_permissions')
        .select('permission_key, allowed').eq('tenant_id', user.tenantId).eq('user_id', user.id);
      if (erroPessoa) { console.error('[usePermissoes] ajuste da pessoa:', erroPessoa.message); return []; }
      return (linhas ?? []) as { permission_key: string; allowed: boolean }[];
    };
    try {
      // Usa o token do kiosk quando disponível para evitar Unauthorized
      const externalToken = kioskSession?.accessToken;
      const [{ data, error }, linhasDaPessoa] = await Promise.all([
        invokeWithAuth<{
          success: boolean;
          data?: { role: string; permission_key: string; allowed: boolean }[];
        }>('config-write', {
          body: { action: 'get_permissions', tenant_id: user.tenantId },
          externalToken,
        }),
        lerAjustesDaPessoa(),
      ]);

      if (!error && data?.success && data.data && data.data.length > 0) {
        // A tabela `permissions` grava o role em INGLÊS (enum user_role).
        // Aceitamos tanto o role-EN quanto o papel-PT, para ser robusto a
        // qualquer tradução futura na edge function.
        const dbRole = PAPEL_TO_DB_ROLE[papel] ?? papel;
        const linhasDoPapel = data.data.filter((r) => r.role === papel || r.role === dbRole);
        // Padrão do papel + o que foi salvo por cima (cargo na loja, depois a pessoa). Chave que nunca
        // foi salva (ex.: as abas do Financeiro/Relatórios, criadas em 2026-09-19) fica no padrão —
        // antes, só as linhas salvas valiam e uma permissão nova sumia de quem já tinha salvo a matriz.
        setPermissoes(permissoesDaPessoa(papel, linhasDoPapel, linhasDaPessoa));
      } else {
        // Sem dados do cargo no banco → padrão do cargo (+ ajuste da pessoa, se houver)
        setPermissoes(permissoesDaPessoa(papel, [], linhasDaPessoa));
      }
    } catch (e) {
      console.error('[usePermissoes] load error:', e);
      setPermissoes(DEFAULT_PERMISSOES[papel] ?? []);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, user?.id, papel, kioskSession?.accessToken]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: recarregar quando a tabela permissions for alterada para este tenant
  useEffect(() => {
    if (!user?.tenantId || papel === 'admin') return;
    const channel = supabase
      .channel(`permissions:${user.tenantId}:${papel}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'permissions',
        filter: `tenant_id=eq.${user.tenantId}`,
      }, () => { carregar(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.tenantId, papel, carregar]);

  // Realtime: o dono mudou o acesso desta pessoa → vale na hora, sem sair e entrar.
  useEffect(() => {
    if (!user?.id || !user?.tenantId || papel === 'admin') return;
    const channel = supabase
      .channel(`user_permissions:${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_permissions',
        filter: `user_id=eq.${user.id}`,
      }, () => { carregar(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, user?.tenantId, papel, carregar]);

  const hasPermissao = useCallback(
    (key: PermissaoKey): boolean => {
      if (papel === 'admin') return true;
      return permissoes.includes(key);
    },
    [papel, permissoes],
  );

  return { hasPermissao, permissoes, loading, recarregar: carregar };
}
