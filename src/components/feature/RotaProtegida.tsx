import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import type { PermissaoKey } from '@/hooks/usePermissoes';
import { FIN_KEYS, REL_KEYS, CFG_MAQUININHA_KEY } from '@/constants/permissoesAbas';
import { rotaForcada } from '@/lib/acessoRota';

/**
 * Mapeamento de rota → permissão necessária.
 * Rotas não listadas aqui são acessíveis a todos os usuários autenticados.
 * Lista = basta ter uma delas (Financeiro/Relatórios: permissão por aba).
 */
const ROTA_PERMISSAO: Record<string, PermissaoKey | readonly PermissaoKey[]> = {
  '/cardapio': 'cardapio_editar',
  '/estoque': 'estoque_movimentar',
  // estoque_receber abre só esta tela; quem movimenta estoque continua entrando
  '/receber': ['estoque_receber', 'estoque_movimentar'],
  '/relatorios': REL_KEYS,
  '/financeiro': FIN_KEYS,
  '/usuarios': 'usuarios_gerenciar',
  // A maquininha é a exceção: quem tem só ela entra em Configurações e vê
  // apenas a aba Maquininha.
  '/configuracoes': ['configuracoes_editar', CFG_MAQUININHA_KEY],
  '/auditoria': 'auditoria_ver',
  '/clientes': 'clientes_ver',
  '/aprovacoes': 'gestao_aprovacoes',
  '/promocoes': 'gestao_promocoes',
  '/vouchers': 'gestao_vouchers',
  '/pedidos': 'gestao_pedidos',
  '/mesas': 'gestao_mesas',
  '/config-delivery': 'gestao_delivery',
  '/dashboard': 'gestao_dashboard',
  '/kds': 'kds_acessar',
  '/gestor-pedidos': 'gestor_pedidos_acessar',
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

  // Papéis presos a uma única área (Gestor de Entregas, Tarefas, Financeiro):
  // qualquer outra rota interna devolve pra área deles, independe das permissões.
  const forcada = rotaForcada(user?.perfil, location.pathname);
  if (forcada) return <Navigate to={forcada} replace />;

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
  const lista = typeof permissaoNecessaria === 'string' ? [permissaoNecessaria] : permissaoNecessaria;
  if (lista.some((k) => hasPermissao(k))) return <>{children}</>;

  // Sem permissão — redireciona para módulos com state de aviso
  return (
    <Navigate
      to="/modulos"
      replace
      state={{ acessoNegado: true, rota: location.pathname }}
    />
  );
}
