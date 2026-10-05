// Página de Módulos nova (protótipo docs/prototipos/sistema-proposta.html › telas/modulos.js e casca.js
// › "mais", aprovado pelo dono em 2026-10-05). Três caras conforme quem abre (src/lib/modulosCara.ts):
//  1) aparelho da loja → "O que este aparelho faz?"   2) só outro produto → direto nele / escolha
//  3) dono, supervisor, líder e os demais com loja → "Todas as telas".
// Não grava mais o "modo" (AppModeContext): cada cartão só navega.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { escolherCara } from '@/lib/modulosCara';
import { Moldura } from './partes';
import AparelhoLoja from './AparelhoLoja';
import SoProduto from './SoProduto';
import TodasAsTelas from './TodasAsTelas';

export default function ModulosNova() {
  const { user, hasNoTenants } = useAuth();
  const navigate = useNavigate();

  // Papéis com uma tela só: mesma regra da página de antes.
  useEffect(() => {
    if (user?.perfil === 'totem') navigate('/autoatendimento', { replace: true });
    else if (user?.perfil === 'gestor_entregas') navigate('/gestor-entregas', { replace: true });
    else if (user?.perfil === 'tarefas') navigate('/tarefas', { replace: true });
  }, [user?.perfil, navigate]);

  const cara = escolherCara({ semLoja: hasNoTenants, email: user?.email, perfil: user?.perfil });
  if (cara === 'produto') return <SoProduto />;
  return (
    <Moldura>
      {cara === 'aparelho' ? <AparelhoLoja /> : <TodasAsTelas />}
    </Moldura>
  );
}
