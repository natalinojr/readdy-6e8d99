import { useState, useEffect, useCallback } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { PerfilUsuario } from '@/constants/usuarios';

const ROLE_MAP: Record<string, PerfilUsuario> = {
  admin: 'admin',
  manager: 'gerente',
  cashier: 'caixa',
  waiter: 'garcom',
  kitchen: 'cozinha',
  delivery_manager: 'gestor_entregas',
  tablet: 'totem',
};

const ROLE_MAP_REVERSE: Record<PerfilUsuario, string> = {
  admin: 'admin',
  gerente: 'manager',
  caixa: 'cashier',
  garcom: 'waiter',
  cozinha: 'kitchen',
  gestor_entregas: 'delivery_manager',
  totem: 'tablet',
};

export interface UsuarioReal {
  id: string;
  nome: string;
  email: string;
  matricula: string;
  perfil: PerfilUsuario;
  loja: string;
  ativo: boolean;
  modoTreino: boolean;
  ultimoAcesso: string | null;
  diasDesdeAcesso: number | null;
  kioskOnline: boolean;
  criadoEm: string;
}

export interface CriarUsuarioPayload {
  nome: string;
  email?: string;
  senha?: string;
  perfil: PerfilUsuario;
  training_mode: boolean;
  matricula?: string;
  pin?: string;
}

export function useUsuarios() {
  const { user } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioReal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('fn_get_users_list', {
        p_tenant_id: user.tenantId,
      });
      if (rpcError) throw rpcError;

      const lista: UsuarioReal[] = ((data as Record<string, unknown>[]) ?? []).map((u) => ({
        id: u.id as string,
        nome: u.nome as string,
        email: u.email as string,
        matricula: (u.matricula as string) ?? '',
        perfil: ROLE_MAP[u.perfil as string] ?? 'garcom',
        loja: u.loja as string,
        ativo: u.ativo as boolean,
        modoTreino: (u.modoTreino as boolean) ?? false,
        ultimoAcesso: u.ultimoAcesso as string | null,
        diasDesdeAcesso: (u.diasDesdeAcesso as number | null) ?? null,
        kioskOnline: (u.kioskOnline as boolean) ?? false,
        criadoEm: u.criadoEm as string,
      }));

      setUsuarios(lista);
    } catch (e) {
      setError('Erro ao carregar usuários');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const toggleAtivo = useCallback(
    async (userId: string) => {
      const { data } = await supabase.rpc('fn_toggle_user_active', { p_user_id: userId });
      const novoEstado = data as boolean;
      setUsuarios((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, ativo: novoEstado } : u)),
      );
    },
    [],
  );

  const editarUsuario = useCallback(
    async (
      userId: string,
      payload: { nome: string; perfil: PerfilUsuario; modoTreino: boolean; ativo: boolean },
    ) => {
      if (!user?.tenantId) return false;
      const { data } = await supabase.rpc('fn_update_user', {
        p_user_id: userId,
        p_tenant_id: user.tenantId,
        p_nome: payload.nome,
        p_role: ROLE_MAP_REVERSE[payload.perfil],
        p_training_mode: payload.modoTreino,
        p_is_active: payload.ativo,
      });
      if (data) {
        setUsuarios((prev) =>
          prev.map((u) =>
            u.id === userId
              ? { ...u, nome: payload.nome, perfil: payload.perfil, modoTreino: payload.modoTreino, ativo: payload.ativo }
              : u,
          ),
        );
      }
      return !!data;
    },
    [user?.tenantId],
  );

  const criarUsuario = useCallback(
    async (payload: CriarUsuarioPayload): Promise<{ success: boolean; error?: string; matricula?: string }> => {
      if (!user?.tenantId) return { success: false, error: 'Tenant não encontrado' };
      try {
        const { data, error: fnError } = await invokeWithAuth('user-write', {
          body: {
            action: 'create_user',
            nome: payload.nome,
            email: payload.email ?? undefined,
            senha: payload.senha ?? undefined,
            perfil: payload.perfil,
            tenant_id: user.tenantId,
            training_mode: payload.training_mode,
            matricula: payload.matricula,
            pin: payload.pin,
          },
        });
        if (fnError || (data as Record<string, unknown>)?.error) {
          return { success: false, error: String((data as Record<string, unknown>)?.error ?? fnError) };
        }
        await carregar();
        return { success: true, matricula: (data as Record<string, unknown>)?.matricula as string };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
    [user?.tenantId, carregar],
  );

  const excluirUsuario = useCallback(
    async (userId: string): Promise<{ success: boolean; error?: string }> => {
      if (!user?.tenantId) return { success: false, error: 'Tenant não encontrado' };
      try {
        const { data, error: fnError } = await invokeWithAuth('user-write', {
          body: { action: 'delete_user', user_id: userId, tenant_id: user.tenantId },
        });
        if (fnError || (data as Record<string, unknown>)?.error) {
          return { success: false, error: String((data as Record<string, unknown>)?.error ?? fnError) };
        }
        setUsuarios((prev) => prev.filter((u) => u.id !== userId));
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
    [user?.tenantId],
  );

  const redefinirSenha = useCallback(
    async (userId: string, novaSenha: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { data, error: fnError } = await invokeWithAuth('user-write', {
          body: { action: 'reset_password', user_id: userId, nova_senha: novaSenha },
        });
        if (fnError || (data as Record<string, unknown>)?.error) {
          return { success: false, error: String((data as Record<string, unknown>)?.error ?? fnError) };
        }
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
    [],
  );

  const definirPIN = useCallback(
    async (userId: string, pin: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { data, error: fnError } = await invokeWithAuth('user-write', {
          body: { action: 'set_pin', user_id: userId, pin },
        });
        if (fnError || (data as Record<string, unknown>)?.error) {
          return { success: false, error: String((data as Record<string, unknown>)?.error ?? fnError) };
        }
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
    [],
  );

  const limparPIN = useCallback(
    async (userId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { data, error: fnError } = await invokeWithAuth('user-write', {
          body: { action: 'clear_pin', user_id: userId },
        });
        if (fnError || (data as Record<string, unknown>)?.error) {
          return { success: false, error: String((data as Record<string, unknown>)?.error ?? fnError) };
        }
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
    [],
  );

  return { usuarios, loading, error, recarregar: carregar, toggleAtivo, editarUsuario, criarUsuario, excluirUsuario, redefinirSenha, definirPIN, limparPIN };
}
