import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { SUPABASE_URL } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import VisaoGeralFinTab from './components/VisaoGeralFinTab';
import FluxoCaixaTab from './components/FluxoCaixaTab';
import ContasPagarTab from './components/ContasPagarTab';
import ContasReceberTab from './components/ContasReceberTab';
import ComprasTab from './components/ComprasTab';
import CentroCustosTab from './components/CentroCustosTab';
import DREContainer from './components/DREContainer';
import ImplantacaoTab from './components/ImplantacaoTab';
import OrcamentosTab from './components/OrcamentosTab';
import PrevisaoCaixaTab from './components/PrevisaoCaixaTab';
import ConciliacaoTab from './components/ConciliacaoTab';
import BancosContasTab from './components/BancosContasTab';
import RHTab from './components/RHTab';
import RHRelatorioTab from './components/RHRelatorioTab';
import ContasVencidasPanel from './components/ContasVencidasPanel';
import DespesasTab from './components/DespesasTab';
import ReceitasTab from './components/ReceitasTab';

const TABS = [
  { id: 'visao', label: 'Visão Geral', icon: 'ri-dashboard-line' },
  { id: 'receitas', label: 'Receitas', icon: 'ri-arrow-down-circle-line' },
  { id: 'despesas', label: 'Despesas', icon: 'ri-pie-chart-2-line' },
  { id: 'fluxo', label: 'Fluxo de Caixa', icon: 'ri-exchange-dollar-line' },
  { id: 'previsao', label: 'Previsão', icon: 'ri-line-chart-line' },
  { id: 'pagar', label: 'Contas a Pagar', icon: 'ri-bill-line' },
  { id: 'receber', label: 'Contas a Receber', icon: 'ri-hand-coin-line' },
  { id: 'orcamentos', label: 'Orçamentos', icon: 'ri-file-list-3-line' },
  { id: 'compras', label: 'Compras', icon: 'ri-shopping-cart-2-line' },
  { id: 'rh', label: 'RH / Folha', icon: 'ri-team-line' },
  { id: 'rh-relatorio', label: 'Relatório RH', icon: 'ri-bar-chart-grouped-line' },
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
  const initialTab = (location.state as { activeTab?: string } | null)?.activeTab ?? 'visao';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [highlightPurchaseId, setHighlightPurchaseId] = useState<string | undefined>();

  const handleNavigateToCompras = (purchaseId?: string) => {
    setHighlightPurchaseId(purchaseId);
    setActiveTab('compras');
  };

  const handleClearHighlight = () => {
    setHighlightPurchaseId(undefined);
  };

  // Garante permissões nas tabelas financeiras ao abrir o módulo
  useEffect(() => {
    const grantPermissions = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        await fetch(`${SUPABASE_URL}/functions/v1/grant-permissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
        });
      } catch {
        // silencioso — não bloqueia o módulo
      }
    };
    grantPermissions();
  }, []);

  if (!user || !['admin', 'gerente'].includes(user.perfil)) {
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
        {/* Tabs — scroll horizontal no mobile */}
        <div className="flex gap-0.5 overflow-x-auto scrollbar-hide -mx-4 md:mx-0 px-4 md:px-0" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
          {TABS.map(tab => (
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
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'visao' && <VisaoGeralFinTab />}
        {activeTab === 'receitas' && <ReceitasTab />}
        {activeTab === 'despesas' && <DespesasTab />}
        {activeTab === 'fluxo' && <FluxoCaixaTab />}
        {activeTab === 'previsao' && <PrevisaoCaixaTab />}
        {activeTab === 'pagar' && <ContasPagarTab onNavigateToCompras={handleNavigateToCompras} />}
        {activeTab === 'receber' && <ContasReceberTab />}
        {activeTab === 'orcamentos' && <OrcamentosTab />}
        {activeTab === 'compras' && <ComprasTab highlightId={highlightPurchaseId} onHighlightConsumed={handleClearHighlight} />}
        {activeTab === 'rh' && <RHTab />}
        {activeTab === 'rh-relatorio' && <RHRelatorioTab />}
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
