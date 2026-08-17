import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
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

export interface LojaAdmin {
  id: string;
  nome: string;
}

export interface VinculoUsuarioLoja {
  tenantId: string;
  perfil: PerfilUsuario;
  modoTreino: boolean;
}

export interface UsuarioMultiLoja {
  id: string;
  nome: string;
  email: string;
  matricula: string;
  ativo: boolean;
  vinculos: VinculoUsuarioLoja[];
}

export function useAcessoMultiLoja() {
  const { user } = useAuth();
  const [minhasLojas, setMinhasLojas] = useState<LojaAdmin[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioMultiLoja[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [lojasRes, usuariosRes] = await Promise.all([
        supabase.rpc('fn_get_my_admin_tenants'),
        supabase.rpc('fn_get_users_for_admin_panel'),
      ]);
      if (lojasRes.error) throw lojasRes.error;
      if (usuariosRes.error) throw usuariosRes.error;

      const lojas: LojaAdmin[] = ((lojasRes.data as Record<string, unknown>[]) ?? []).map((l) => ({
        id: l.id as string,
        nome: l.nome as string,
      }));

      const lista: UsuarioMultiLoja[] = ((usuariosRes.data as Record<string, unknown>[]) ?? []).map((u) => ({
        id: u.id as string,
        nome: u.nome as string,
        email: u.email as string,
        matricula: (u.matricula as string) ?? '',
        ativo: u.ativo as boolean,
        vinculos: ((u.vinculos as Record<string, unknown>[]) ?? []).map((v) => ({
          tenantId: v.tenant_id as string,
          perfil: ROLE_MAP[v.role as string] ?? 'garcom',
          modoTreino: (v.training_mode as boolean) ?? false,
        })),
      }));

      setMinhasLojas(lojas);
      setUsuarios(lista);
    } catch (e) {
      setError('Erro ao carregar acessos entre lojas');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const concederAcesso = useCallback(
    async (usuarioId: string, tenantId: string, perfil: PerfilUsuario): Promise<boolean> => {
      const { error: rpcError } = await supabase.rpc('fn_grant_tenant_access', {
        p_target_user_id: usuarioId,
        p_tenant_id: tenantId,
        p_role: ROLE_MAP_REVERSE[perfil],
        p_training_mode: false,
      });
      if (rpcError) {
        console.error(rpcError);
        return false;
      }
      setUsuarios((prev) =>
        prev.map((u) => {
          if (u.id !== usuarioId) return u;
          const semLoja = u.vinculos.filter((v) => v.tenantId !== tenantId);
          return { ...u, vinculos: [...semLoja, { tenantId, perfil, modoTreino: false }] };
        }),
      );
      return true;
    },
    [],
  );

  const revogarAcesso = useCallback(async (usuarioId: string, tenantId: string): Promise<boolean> => {
    const { error: rpcError } = await supabase.rpc('fn_revoke_tenant_access', {
      p_target_user_id: usuarioId,
      p_tenant_id: tenantId,
    });
    if (rpcError) {
      console.error(rpcError);
      return false;
    }
    setUsuarios((prev) =>
      prev.map((u) =>
        u.id === usuarioId ? { ...u, vinculos: u.vinculos.filter((v) => v.tenantId !== tenantId) } : u,
      ),
    );
    return true;
  }, []);

  return { minhasLojas, usuarios, loading, error, recarregar: carregar, concederAcesso, revogarAcesso };
}
