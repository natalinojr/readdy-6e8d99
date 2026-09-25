import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { finKeyDaAba } from '@/constants/permissoesAbas';
import { useFinanceiroAlertas } from '@/hooks/useFinanceiroAlertas';
import VisaoGeralFinTab from './components/VisaoGeralFinTab';
import FluxoCaixaTab from './components/FluxoCaixaTab';
import ContasPagarTab from './components/ContasPagarTab';
import ContasReceberTab from './components/ContasReceberTab';
import ComprasTab from './components/ComprasTab';
import CentroCustosTab from './components/CentroCustosTab';
import DREContainer from './components/DREContainer';
import ImplantacaoTab from './components/ImplantacaoTab';
import OrcamentosTab from './components/OrcamentosTab';
import ConciliacaoTab from './components/ConciliacaoTab';
import BancosContasTab from './components/BancosContasTab';
import RHTab from './components/RHTab';
import RHRelatorioTab from './components/RHRelatorioTab';
import ContasVencidasPanel from './components/ContasVencidasPanel';
import DespesasTab from './components/DespesasTab';
import ReceitasTab from './components/ReceitasTab';
import NotasEntradaTab from './components/NotasEntradaTab';
import ItensClassificacaoTab from './components/ItensClassificacaoTab';
import IfoodTab from './components/IfoodTab';
import FreelancersTab from './components/FreelancersTab';
import GuiasTab from './components/GuiasTab';

const TABS = [
  { id: 'visao', label: 'Visão Geral', icon: 'ri-dashboard-line' },
  { id: 'receitas', label: 'Receitas', icon: 'ri-arrow-down-circle-line' },
  { id: 'ifood', label: 'iFood', icon: 'ri-restaurant-2-line' },
  { id: 'despesas', label: 'Despesas', icon: 'ri-pie-chart-2-line' },
  { id: 'fluxo', label: 'Fluxo de Caixa', icon: 'ri-exchange-dollar-line' },
  { id: 'pagar', label: 'Contas a Pagar', icon: 'ri-bill-line' },
  { id: 'receber', label: 'Contas a Receber', icon: 'ri-hand-coin-line' },
  { id: 'orcamentos', label: 'Orçamentos', icon: 'ri-file-list-3-line' },
  { id: 'compras', label: 'Compras', icon: 'ri-shopping-cart-2-line' },
  { id: 'notas-entrada', label: 'Notas de Entrada', icon: 'ri-inbox-archive-line' },
  { id: 'itens', label: 'Classificação de Itens', icon: 'ri-price-tag-3-line' },
  { id: 'rh', label: 'RH / Folha', icon: 'ri-team-line' },
  { id: 'rh-relatorio', label: 'Relatório RH', icon: 'ri-bar-chart-grouped-line' },
  { id: 'guias', label: 'Guias e impostos', icon: 'ri-file-upload-line' },
  { id: 'freelancers', label: 'Freelancers', icon: 'ri-user-star-line' },
  { id: 'centros', label: 'Centro de Custos', icon: 'ri-pie-chart-line' },
  { id: 'dre', label: 'DRE', icon: 'ri-file-chart-line' },
  { id: 'contas-vencidas', label: 'Contas Vencidas', icon: 'ri-alarm-warning-line' },
  { id: 'bancos', label: 'Bancos e Contas', icon: 'ri-bank-card-line' },
  { id: 'conciliacao', label: 'Conciliação', icon: 'ri-bank-line' },
  { id: 'implantacao', label: 'Implantação', icon: 'ri-building-line' },
];

export default function FinanceiroPage() {
  const { user } = useAuth();
  const location = useLocation();
  // Abas liberadas para o papel (Configurações › Permissões; admin vê todas).
  const { hasPermissao } = usePermissoes();
  const podeAba = (t: string) => { const k = finKeyDaAba(t); return !!k && hasPermissao(k); };
  const abas = TABS.filter((t) => podeAba(t.id));
  // Mesmo número do menu lateral (contas vencidas + vencendo em 7 dias + folha pendente),
  // quebrado nas abas onde cada parte se resolve — antes só o menu mostrava o total.
  const { contasVencidas, contasVencendo, folhaPendente } = useFinanceiroAlertas();
  const avisoDaAba: Record<string, { n: number; cor: string; dica: string }> = {
    pagar: { n: contasVencidas + contasVencendo, cor: contasVencidas > 0 ? 'bg-red-500' : 'bg-amber-500', dica: `${contasVencidas} vencida(s) e ${contasVencendo} vencendo em 7 dias` },
    'contas-vencidas': { n: contasVencidas, cor: 'bg-red-500', dica: `${contasVencidas} conta(s) vencida(s)` },
    rh: { n: folhaPendente, cor: 'bg-amber-500', dica: `${folhaPendente} pagamento(s) da folha do mês pendente(s)` },
  };
  // Aba na URL (?tab=dre), como no Estoque e nas Configurações. Antes era só useState com
  // location.state: quem chegava por link — inclusive o botão "Abrir DRE" do assistente
  // (2026-09-16) — caía sempre na Visão Geral, e navegar já estando em /financeiro não fazia nada.
  const [searchParams, setSearchParams] = useSearchParams();
  const daUrl = searchParams.get('tab');
  const doState = (location.state as { activeTab?: string } | null)?.activeTab;
  const valida = (t: string | null | undefined) => (t && (TABS.some((x) => x.id === t) || t === 'previsao') && podeAba(t) ? t : null);
  const activeTab = valida(daUrl) ?? valida(doState) ?? abas[0]?.id ?? 'visao';
  const setActiveTab = (t: string) => setSearchParams({ tab: t }, { replace: true });
  // ?foco=<id da compra> abre a aba Compras já piscando naquela linha — usado pelo Rastreamento
  // da Conciliação (2026-09-20), para o botão cair na compra certa e não só na lista.
  const [highlightPurchaseId, setHighlightPurchaseId] = useState<string | undefined>(
    () => searchParams.get('foco') ?? undefined,
  );

  // Chegou por location.state (telas antigas que navegam assim): passa para a URL uma vez, senão
  // trocar de aba depois voltaria para a do state.
  useEffect(() => {
    if (!daUrl && valida(doState)) setSearchParams({ tab: String(doState) }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Link externo (?tab=compras&foco=...) chegando com a tela já montada
  useEffect(() => {
    const foco = searchParams.get('foco');
    if (foco) setHighlightPurchaseId(foco);
  }, [searchParams]);

  const handleNavigateToCompras = (purchaseId?: string) => {
    setHighlightPurchaseId(purchaseId);
    setActiveTab('compras');
  };

  const handleClearHighlight = () => {
    setHighlightPurchaseId(undefined);
  };

  if (!user || !['admin', 'gerente', 'financeiro', 'contabilidade'].includes(user.perfil)) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-red-100 rounded-full mx-auto mb-4">
            <i className="ri-lock-line text-red-500 text-2xl" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-800">Acesso Restrito</h2>
          <p className="text-zinc-500 text-sm mt-1">Apenas administradores e gerentes podem acessar o módulo financeiro.</p>
        </div>
      </div>
    );
  }

  if (abas.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-red-100 rounded-full mx-auto mb-4">
            <i className="ri-lock-line text-red-500 text-2xl" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-800">Acesso Restrito</h2>
          <p className="text-zinc-500 text-sm mt-1">Nenhuma aba do Financeiro está liberada para o seu perfil. Fale com o administrador.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 pt-4 md:pt-5 pb-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center gap-3 mb-3 md:mb-4">
          <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
            <i className="ri-money-dollar-circle-line text-white text-base md:text-lg" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold text-zinc-800">Financeiro</h1>
            <p className="text-xs text-zinc-400 hidden sm:block">Gestão financeira completa do restaurante</p>
          </div>
        </div>
        {/* Tabs — scroll horizontal no mobile; a partir de md quebram em linhas
            (com a barra de rolagem escondida, as abas da direita ficavam
            inalcançáveis no desktop quando a janela era estreita) */}
        <div className="flex md:flex-wrap gap-0.5 overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 md:mx-0 px-4 md:px-0" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
          {abas.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 md:gap-1.5 px-2.5 md:px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer flex-shrink-0 ${
                activeTab === tab.id
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-zinc-400 hover:text-zinc-700'
              }`}
            >
              <i className={tab.icon} />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
              {(avisoDaAba[tab.id]?.n ?? 0) > 0 && (
                <span title={avisoDaAba[tab.id].dica} className={`text-[9px] font-black px-1.5 py-0.5 rounded-full text-white ${avisoDaAba[tab.id].cor}`}>
                  {avisoDaAba[tab.id].n}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'visao' && <VisaoGeralFinTab />}
        {activeTab === 'receitas' && <ReceitasTab />}
        {activeTab === 'ifood' && <IfoodTab />}
        {activeTab === 'despesas' && <DespesasTab />}
        {/* 'previsao' era uma aba separada; a projeção virou a visão PADRÃO do
            Fluxo de Caixa. O id antigo continua roteando para cá por causa de
            links salvos e de navegações por `location.state`. */}
        {(activeTab === 'fluxo' || activeTab === 'previsao') && <FluxoCaixaTab />}
        {activeTab === 'pagar' && <ContasPagarTab onNavigateToCompras={handleNavigateToCompras} />}
        {activeTab === 'receber' && <ContasReceberTab />}
        {activeTab === 'orcamentos' && <OrcamentosTab />}
        {activeTab === 'notas-entrada' && <NotasEntradaTab />}
        {activeTab === 'itens' && <ItensClassificacaoTab />}
        {activeTab === 'compras' && <ComprasTab highlightId={highlightPurchaseId} onHighlightConsumed={handleClearHighlight} />}
        {activeTab === 'rh' && <RHTab />}
        {activeTab === 'rh-relatorio' && <RHRelatorioTab />}
        {activeTab === 'guias' && <GuiasTab />}
        {activeTab === 'freelancers' && <FreelancersTab />}
        {activeTab === 'centros' && <CentroCustosTab />}
        {activeTab === 'dre' && <DREContainer />}
        {activeTab === 'contas-vencidas' && <ContasVencidasPanel />}
        {activeTab === 'bancos' && <BancosContasTab />}
        {activeTab === 'conciliacao' && <ConciliacaoTab />}
        {activeTab === 'implantacao' && <ImplantacaoTab />}
      </div>
    </div>
  );
}
