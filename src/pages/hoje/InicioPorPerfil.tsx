// Primeira tela depois de entrar (2026-10-03): cada perfil cai no seu trabalho, não numa grade de
// módulos. Dono, gerente e supervisão → Hoje. Caixa → no computador, direto no PDV (é onde ele vende);
// no celular (só quando o computador deu problema), a Hoje dele. O resto continua em /modulos, que já
// manda totem, gestor de entregas e tarefas para a tela deles.
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/pages/tarefas/lib/mobile';
import { useSystemSettings } from '@/hooks/useSystemSettings';

export default function InicioPorPerfil() {
  const { user } = useAuth();
  const celular = useIsMobile();
  const { settings } = useSystemSettings();
  const p = user?.perfil;
  if (p === 'admin' || p === 'gerente' || p === 'supervisao') return <Navigate to="/hoje" replace />;
  // Loja sem o terminal de caixa ligado: o caixa fica na Hoje dele.
  const caixaLigado = settings.pdv_config?.caixa ?? true;
  if (p === 'caixa') return <Navigate to={celular || !caixaLigado ? '/hoje' : '/pdv/caixa'} replace />;
  return <Navigate to="/modulos" replace />;
}
