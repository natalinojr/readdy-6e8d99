import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';
import { FIN_KEYS, REL_KEYS, CFG_KEYS, CFG_KEYS_GERENTE, type FinPermissaoKey, type RelPermissaoKey, type CfgPermissaoKey } from '@/constants/permissoesAbas';
import { GESTAO_KEYS, type GestaoPermissaoKey } from '@/constants/permissoesGestao';

export type Papel = 'admin' | 'gerente' | 'caixa' | 'garcom' | 'cozinha' | 'gestor_entregas' | 'tarefas' | 'financeiro';

export type PermissaoKey =
  | 'pdv_abrir_caixa'
  | 'pdv_fechar_caixa'
  | 'pdv_sangria'
  | 'pdv_desconto'
  | 'pdv_cancelar_pedido'
  | 'pdv_cancelar_item'
  | 'pdv_editar_item_pos_kds'
  | 'pdv_estornar_pagamento'
  | 'garcom_fechar_mesa'
  | 'garcom_transferir_mesa'
  | 'cardapio_editar'
  | 'cardapio_alterar_preco'
  | 'estoque_movimentar'
  | 'estoque_inventario'
  | 'kds_acessar'
  | 'gestor_pedidos_acessar'
  | 'gestor_pedidos_entregar'
  | 'gestor_entregas_acessar'
  | 'relatorio_financeiro'
  | 'relatorio_estoque'
  | 'clientes_ver'
  | 'usuarios_gerenciar'
  | 'configuracoes_editar'
  | 'auditoria_ver'
  | FinPermissaoKey
  | RelPermissaoKey
  | CfgPermissaoKey
  | GestaoPermissaoKey;

/** Papel do frontend (PT) → role no banco (enum user_role, em inglês).
 *  A tabela `permissions` grava o role em inglês (manager/cashier/waiter/kitchen),
 *  então o filtro precisa traduzir antes de comparar. */
export const PAPEL_TO_DB_ROLE: Record<string, string> = {
  admin: 'admin',
  gerente: 'manager',
  caixa: 'cashier',
  garcom: 'waiter',
  cozinha: 'kitchen',
  gestor_entregas: 'delivery_manager',
  tarefas: 'tasks_only',
  financeiro: 'financeiro',
};

/** Permissões padrão por papel (fallback quando não há dados no banco) */
export const DEFAULT_PERMISSOES: Record<Papel, PermissaoKey[]> = {
  admin: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_desconto',
    'pdv_cancelar_pedido', 'pdv_cancelar_item', 'pdv_editar_item_pos_kds', 'pdv_estornar_pagamento',
    'garcom_fechar_mesa', 'garcom_transferir_mesa', 'cardapio_editar', 'cardapio_alterar_preco',
    'estoque_movimentar', 'estoque_inventario', 'kds_acessar', 'gestor_pedidos_acessar',
    'gestor_pedidos_entregar', 'gestor_entregas_acessar', 'relatorio_financeiro', 'relatorio_estoque', 'clientes_ver',
    'usuarios_gerenciar', 'configuracoes_editar', 'auditoria_ver',
    ...FIN_KEYS, ...REL_KEYS, ...CFG_KEYS, ...GESTAO_KEYS,
  ],
  gerente: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_desconto',
    'pdv_cancelar_pedido', 'pdv_cancelar_item', 'pdv_estornar_pagamento',
    'garcom_fechar_mesa', 'garcom_transferir_mesa', 'cardapio_editar',
    'estoque_movimentar', 'estoque_inventario', 'kds_acessar', 'gestor_pedidos_acessar',
    'gestor_pedidos_entregar', 'gestor_entregas_acessar', 'relatorio_financeiro', 'relatorio_estoque', 'clientes_ver', 'auditoria_ver',
    // As abas de Configurações só entram em cena se o dono ligar
    // `configuracoes_editar` para o Gerente — a tela inteira depende dela.
    ...FIN_KEYS, ...REL_KEYS, ...CFG_KEYS_GERENTE, ...GESTAO_KEYS,
  ],
  caixa: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_cancelar_item',
  ],
  garcom: [
    'garcom_fechar_mesa', 'garcom_transferir_mesa',
  ],
  cozinha: [
    'kds_acessar', 'gestor_pedidos_acessar', 'gestor_pedidos_entregar',
  ],
  gestor_entregas: [
    'gestor_entregas_acessar',
  ],
  // Sem PermissaoKey nenhuma — o módulo de Tarefas não usa esse sistema, e o
  // resto do app fica bloqueado pelo hard-lock de rota (RotaProtegida).
  tarefas: [],
  // Nasce com todas as abas do Financeiro e nada além — o papel é preso ao
  // módulo pelo hard-lock de rota (RotaProtegida / acessoRota.ts).
  financeiro: [...FIN_KEYS],
};

/** Padrão + linhas salvas (allowed true acrescenta, false tira). */
export function mesclarComPadrao<K extends string>(padrao: readonly K[], linhas: { permission_key: string; allowed: boolean }[]): K[] {
  const set = new Set<string>(padrao);
  for (const r of linhas) {
    if (r.allowed) set.add(r.permission_key);
    else set.delete(r.permission_key);
  }
  return [...set] as K[];
}

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
    try {
      // Usa o token do kiosk quando disponível para evitar Unauthorized
      const externalToken = kioskSession?.accessToken;
      const { data, error } = await invokeWithAuth<{
        success: boolean;
        data?: { role: string; permission_key: string; allowed: boolean }[];
      }>('config-write', {
        body: { action: 'get_permissions', tenant_id: user.tenantId },
        externalToken,
      });

      if (!error && data?.success && data.data && data.data.length > 0) {
        // A tabela `permissions` grava o role em INGLÊS (enum user_role).
        // Aceitamos tanto o role-EN quanto o papel-PT, para ser robusto a
        // qualquer tradução futura na edge function.
        const dbRole = PAPEL_TO_DB_ROLE[papel] ?? papel;
        const linhasDoPapel = data.data.filter((r) => r.role === papel || r.role === dbRole);
        // Padrão do papel + o que foi salvo por cima. Chave que nunca foi salva (ex.: as abas
        // do Financeiro/Relatórios, criadas em 2026-09-19) fica no padrão — antes, só as linhas
        // salvas valiam e uma permissão nova sumia de quem já tinha salvo a matriz.
        setPermissoes(mesclarComPadrao(DEFAULT_PERMISSOES[papel] ?? [], linhasDoPapel));
      } else {
        // Sem dados no banco → usa defaults
        setPermissoes(DEFAULT_PERMISSOES[papel] ?? []);
      }
    } catch (e) {
      console.error('[usePermissoes] load error:', e);
      setPermissoes(DEFAULT_PERMISSOES[papel] ?? []);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, papel, kioskSession?.accessToken]);

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

  const hasPermissao = useCallback(
    (key: PermissaoKey): boolean => {
      if (papel === 'admin') return true;
      return permissoes.includes(key);
    },
    [papel, permissoes],
  );

  return { hasPermissao, permissoes, loading, recarregar: carregar };
}
