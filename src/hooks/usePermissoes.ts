import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';
import {
  DEFAULT_PERMISSOES, PAPEL_TO_DB_ROLE, DB_ROLE_TO_PAPEL, permissoesDaPessoa,
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
    // O ajuste foi calculado contra o cargo ATUAL da loja; se o dono trocou o cargo na tela de acesso,
    // user.perfil só muda quando a pessoa entra de novo — aqui usamos o cargo do banco.
    const lerCargoAtual = async (): Promise<Papel> => {
      if (!user?.id) return papel;
      const { data: v } = await supabase.from('user_tenants').select('role').eq('tenant_id', user.tenantId).eq('user_id', user.id).maybeSingle();
      const pt = v?.role ? (DB_ROLE_TO_PAPEL[String(v.role)] ?? String(v.role)) : papel;
      return (pt in DEFAULT_PERMISSOES ? pt : papel) as Papel;
    };
    try {
      // Usa o token do kiosk quando disponível para evitar Unauthorized
      const externalToken = kioskSession?.accessToken;
      const [{ data, error }, linhasDaPessoa, cargo] = await Promise.all([
        invokeWithAuth<{
          success: boolean;
          data?: { role: string; permission_key: string; allowed: boolean }[];
        }>('config-write', {
          body: { action: 'get_permissions', tenant_id: user.tenantId },
          externalToken,
        }),
        lerAjustesDaPessoa(),
        lerCargoAtual(),
      ]);
      // Admin pelo banco (promovido agora) tem tudo, como no começo desta função.
      if (cargo === 'admin') { setPermissoes(DEFAULT_PERMISSOES.admin); return; }

      if (!error && data?.success && data.data && data.data.length > 0) {
        // A tabela `permissions` grava o role em INGLÊS (enum user_role).
        // Aceitamos tanto o role-EN quanto o papel-PT, para ser robusto a
        // qualquer tradução futura na edge function.
        const dbRole = PAPEL_TO_DB_ROLE[cargo] ?? cargo;
        const linhasDoPapel = data.data.filter((r) => r.role === cargo || r.role === dbRole);
        // Padrão do papel + o que foi salvo por cima (cargo na loja, depois a pessoa). Chave que nunca
        // foi salva (ex.: as abas do Financeiro/Relatórios, criadas em 2026-09-19) fica no padrão —
        // antes, só as linhas salvas valiam e uma permissão nova sumia de quem já tinha salvo a matriz.
        setPermissoes(permissoesDaPessoa(cargo, linhasDoPapel, linhasDaPessoa));
      } else {
        // Sem dados do cargo no banco → padrão do cargo (+ ajuste da pessoa, se houver)
        setPermissoes(permissoesDaPessoa(cargo, [], linhasDaPessoa));
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

  // O dono mudou o acesso desta pessoa → vale quando ela volta para a tela (sem sair e entrar).
  // Sem realtime em user_permissions de propósito: o DELETE não passa pela RLS e mandaria as chaves
  // apagadas a qualquer assinante (revisão 2026-10-03). No máximo uma leitura a cada 30 s.
  useEffect(() => {
    if (!user?.id || !user?.tenantId || papel === 'admin') return;
    let ultima = Date.now();
    const voltar = () => {
      if (document.hidden || Date.now() - ultima < 30000) return;
      ultima = Date.now();
      carregar();
    };
    document.addEventListener('visibilitychange', voltar);
    window.addEventListener('focus', voltar);
    return () => { document.removeEventListener('visibilitychange', voltar); window.removeEventListener('focus', voltar); };
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
