// Primeira tela depois de entrar (2026-10-03): cada perfil cai no seu trabalho, não numa grade de
// módulos. Dono, gerente e supervisão → Hoje. Caixa → no computador, direto no PDV (é onde ele vende);
// no celular (só quando o computador deu problema), a Hoje dele. O resto continua em /modulos, que já
// manda totem, gestor de entregas e tarefas para a tela deles.
// Aparelho fixo (2026-10-05, página de Módulos nova): se este aparelho foi marcado "Abrir sempre este" para
// a loja aberta, o login da loja vai direto para aquele terminal — se ainda puder abri-lo.
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/pages/tarefas/lib/mobile';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { destinoAparelhoFixo, escolherCara, lerAparelhoFixo } from '@/lib/modulosCara';
import { usePaginaNovaAtiva, useTerminaisDoAparelho } from '@/pages/modulos/nova/useModulosNova';

function InicioPadrao() {
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

/** Só existe quando há um aparelho fixo para esta loja: espera a chave, as permissões e a config da loja. */
function InicioAparelhoFixo() {
  const { user } = useAuth();
  const nova = usePaginaNovaAtiva();
  const { terminais, pronto } = useTerminaisDoAparelho();
  if (!nova.pronta || !pronto) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  const aparelho = escolherCara({ semLoja: false, email: user?.email, perfil: user?.perfil }) === 'aparelho';
  const destino = nova.ativa && aparelho ? destinoAparelhoFixo(lerAparelhoFixo(), user?.tenantId, terminais) : null;
  return destino ? <Navigate to={destino} replace /> : <InicioPadrao />;
}

export default function InicioPorPerfil() {
  const { user } = useAuth();
  const fixo = lerAparelhoFixo();
  if (fixo && user?.tenantId && fixo.tenantId === user.tenantId) return <InicioAparelhoFixo />;
  return <InicioPadrao />;
}
