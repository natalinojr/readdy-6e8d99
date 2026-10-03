// /lancar — o começo único "O que aconteceu?" em tela cheia (2026-10-03): celular, atalho do app e
// ação rápida ⚡. Mesmo componente do botão Lançar do Financeiro (src/components/feature/lancar).
import { useNavigate } from 'react-router-dom';
import { OQueAconteceu } from '@/components/feature/lancar';

export default function LancarPage() {
  const navigate = useNavigate();
  const sair = () => (window.history.length > 1 ? navigate(-1) : navigate('/modulos'));
  return (
    <OQueAconteceu
      telaCheia
      onFechar={() => undefined}
      onNavegar={(rota) => navigate(rota, { replace: true })}
      onSair={sair}
    />
  );
}
