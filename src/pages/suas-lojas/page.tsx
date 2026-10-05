// "Suas lojas" (2026-10-05, pedido do dono): o que abre ao tocar em "Loja" no seletor Loja · Tarefas · Contratação ·
// Notas da casca nova, para quem tem 2+ lojas. Em cima o total de hoje das lojas juntas; embaixo um cartão por loja
// (aberta, R$, pedidos, o que precisa de você) com Entrar; no pé "Comparar as lojas". Mesmos dados e mesma troca da
// folha "Trocar de loja" (useSuasLojas em casca/TrocarLoja.tsx). Quem tem 1 loja só vai direto para o começo.
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { btn } from '@/components/kit';
import { ListaLojas, TotalLojasCartao, useSuasLojas } from '@/components/feature/casca/TrocarLoja';

function SuasLojas() {
  const navigate = useNavigate();
  const abrirAtual = () => navigate('/');
  const s = useSuasLojas(abrirAtual);
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-[22px] md:text-[26px] font-black leading-tight text-[#1F1A14]">Suas lojas</h1>
      <p className="text-[13px] text-[#5B5248] mt-1 mb-4">Em qual você vai trabalhar agora? As que mais precisam de você vêm primeiro.</p>
      <TotalLojasCartao s={s} />
      <ListaLojas s={s} onFicar={abrirAtual} rotuloAqui="Abrir" />
      {s.pronto && s.veComparar && (
        <button type="button" onClick={() => { void s.irComparar(); }} disabled={!!s.ocupado} className={`${btn('out')} w-full mt-1`}>
          <i className="ri-bar-chart-grouped-line" />Comparar as lojas
        </button>
      )}
    </div>
  );
}

export default function SuasLojasPage() {
  const { canSwitchTenant } = useAuth();
  if (!canSwitchTenant) return <Navigate to="/" replace />;
  return <SuasLojas />;
}
