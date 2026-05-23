import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import type { PermissaoKey } from '@/hooks/usePermissoes';

/**
 * Mapeamento de rota → permissão necessária.
 * Rotas não listadas aqui são acessíveis a todos os usuários autenticados.
 */
const ROTA_PERMISSAO: Record<string, PermissaoKey> = {
  '/cardapio': 'cardapio_editar',
  '/estoque': 'estoque_movimentar',
  '/relatorios': 'relatorio_financeiro',
  '/financeiro': 'relatorio_financeiro',
  '/usuarios': 'usuarios_gerenciar',
  '/configuracoes': 'configuracoes_editar',
  '/auditoria': 'auditoria_ver',
  '/clientes': 'clientes_ver',
  '/aprovacoes': 'usuarios_gerenciar',
  '/promocoes': 'cardapio_editar',
  '/vouchers': 'pdv_desconto',
};

/**
 * Papéis que têm acesso irrestrito a todas as rotas.
 */
const PAPEIS_ADMIN = ['admin', 'gerente'];

interface Props {
  children: ReactNode;
}

/**
 * Wrapper que verifica se o usuário tem permissão para acessar a rota atual.
 * Se não tiver, redireciona para /modulos com uma mensagem de acesso negado.
 */
export default function RotaProtegida({ children }: Props) {
  const { user } = useAuth();
  const { hasPermissao, loading } = usePermissoes();
  const location = useLocation();

  // Enquanto carrega permissões, não bloqueia (evita flash de redirect)
  if (loading) return <>{children}</>;

  // Papéis admin/gerente têm acesso total
  if (!user || PAPEIS_ADMIN.includes(user.perfil)) return <>{children}</>;

  // Verifica se a rota atual exige alguma permissão
  const permissaoNecessaria = Object.entries(ROTA_PERMISSAO).find(([rota]) =>
    location.pathname.startsWith(rota)
  )?.[1];

  // Rota sem restrição configurada — libera
  if (!permissaoNecessaria) return <>{children}</>;

  // Verifica permissão
  if (hasPermissao(permissaoNecessaria)) return <>{children}</>;

  // Sem permissão — redireciona para módulos com state de aviso
  return (
    <Navigate
      to="/modulos"
      replace
      state={{ acessoNegado: true, rota: location.pathname }}
    />
  );
}
