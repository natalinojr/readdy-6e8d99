import { useState, useMemo } from 'react';
import { BarChart3, Download, RefreshCw } from 'lucide-react';
import ModoFaturamentoToggle from '@/components/feature/ModoFaturamentoToggle';
import FiltroRelatorio from './components/FiltroRelatorio';
import VisaoGeralTab from './components/VisaoGeralTab';
import CaixaTab from './components/CaixaTab';
import ProdutosTab from './components/ProdutosTab';
import SLACozinhaTab from './components/SLACozinhaTab';
import OrigemTab from './components/OrigemTab';
import CancelamentosTab from './components/CancelamentosTab';
import ClientesTab from './components/ClientesTab';
import CalendarioFaturamentoTab from './components/CalendarioFaturamentoTab';
import CMVTab from './components/CMVTab';
import DeliveryTab from './components/DeliveryTab';
import SessaoSelector from '@/components/feature/SessaoSelector';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import type { SessionInfo } from '@/hooks/useSessions';

type Tab = 'geral' | 'caixa' | 'produtos' | 'cmv' | 'sla' | 'origem' | 'delivery' | 'cancelamentos' | 'clientes' | 'calendario';

const tabs: { id: Tab; label: string; icon: string; shortLabel: string }[] = [
  { id: 'geral',          label: 'Visão Geral',           shortLabel: 'Geral',        icon: 'ri-dashboard-line' },
  { id: 'calendario',     label: 'Calendário',            shortLabel: 'Calendário',   icon: 'ri-calendar-2-line' },
  { id: 'produtos',       label: 'Produtos & Ranking',    shortLabel: 'Produtos',     icon: 'ri-star-line' },
  { id: 'origem',         label: 'Origem dos Pedidos',    shortLabel: 'Origem',       icon: 'ri-route-line' },
  { id: 'cmv',            label: 'CMV & Margem',          shortLabel: 'CMV',          icon: 'ri-scales-line' },
  { id: 'delivery',       label: 'Delivery',              shortLabel: 'Delivery',     icon: 'ri-motorbike-line' },
  { id: 'sla',            label: 'SLA da Cozinha',        shortLabel: 'SLA',          icon: 'ri-timer-line' },
  { id: 'caixa',          label: 'Relatório de Caixa',    shortLabel: 'Caixa',        icon: 'ri-safe-line' },
  { id: 'cancelamentos',  label: 'Cancelamentos',         shortLabel: 'Cancelam.',    icon: 'ri-close-circle-line' },
  { id: 'clientes',       label: 'Clientes / CRM',        shortLabel: 'Clientes',     icon: 'ri-user-heart-line' },
];

export default function RelatoriosPage() {
  const [periodo, setPeriodo] = useState('Hoje');
  const [tab, setTab] = useState<Tab>('geral');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);

  const { modo } = useModoFaturamento();
  const isSessao = modo === 'sessao';

  // Quando no modo sessão e houver sessão selecionada, deriva um período custom
  // baseado nas datas da sessão para usar nas abas que filtram por data
  const periodoEfetivo = useMemo(() => {
    if (isSessao && selectedSession) {
      const from = selectedSession.opened_at.slice(0, 10);
      const to = selectedSession.closed_at
        ? selectedSession.closed_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      return `custom:${from}:${to}`;
    }
    return periodo;
  }, [isSessao, selectedSession, periodo]);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 md:px-6 py-3 md:py-4" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 md:gap-3">
          {/* Título */}
          <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
            <div className="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center rounded-lg flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
              <BarChart3 size={14} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm md:text-base font-bold text-zinc-800">Relatórios</h1>
              <p className="text-[10px] md:text-xs text-zinc-400 hidden sm:block">Análises de vendas, caixa, SLA e desempenho</p>
            </div>
          </div>

          {/* Controles do header — ordem fixa */}
          <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">

            {/* 1. Toggle Calendário/Sessão — SEMPRE VISÍVEL E FIXO */}
            <ModoFaturamentoToggle size="sm" showLabel={false} />

            {/* 2. Filtro dinâmico — muda conforme o modo, mas posição é sempre aqui */}
            <div className="flex-1 sm:flex-none min-w-0">
              {!isSessao ? (
                <FiltroRelatorio periodo={periodo} onPeriodo={setPeriodo} />
              ) : (
                <SessaoSelector
                  selectedId={selectedSession?.id ?? null}
                  onSelect={setSelectedSession}
                  size="sm"
                />
              )}
            </div>

            {/* 3. Botão refresh */}
            <button
              onClick={handleRefresh}
              className="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center rounded-lg border border-amber-200/60 bg-white/60 hover:bg-white/90 transition-colors cursor-pointer text-zinc-500 flex-shrink-0"
              title="Atualizar dados"
            >
              <div className={`w-3.5 h-3.5 flex items-center justify-center ${refreshing ? 'animate-spin' : ''}`}>
                <RefreshCw size={13} />
              </div>
            </button>

            {/* 4. Botão exportar */}
            <button className="flex items-center gap-1 md:gap-1.5 px-2.5 md:px-3 py-1.5 md:py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors whitespace-nowrap cursor-pointer flex-shrink-0">
              <div className="w-3.5 h-3.5 flex items-center justify-center">
                <Download size={12} />
              </div>
              <span className="hidden sm:inline">Exportar</span>
              <span className="sm:hidden">Export</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 mt-3 md:mt-4 -mb-3 md:-mb-4 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1 md:gap-1.5 px-2.5 md:px-3 py-2 md:py-2.5 text-[11px] md:text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
                tab === t.id
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-zinc-400 hover:text-zinc-600'
              }`}
            >
              <i className={`${t.icon} text-[10px] md:text-[11px]`} />
              <span className="hidden md:inline">{t.label}</span>
              <span className="md:hidden">{t.shortLabel}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6">
        <div className="max-w-7xl mx-auto">
          {tab === 'geral'         && (
            <VisaoGeralTab
              periodo={periodoEfetivo}
              externalSession={selectedSession}
              onSessionChange={setSelectedSession}
            />
          )}
          {tab === 'calendario'    && <CalendarioFaturamentoTab />}
          {tab === 'caixa'         && <CaixaTab />}
          {tab === 'produtos'      && <ProdutosTab periodo={periodoEfetivo} externalSession={selectedSession} />}
          {tab === 'cmv'           && <CMVTab periodo={periodoEfetivo} />}
          {tab === 'sla'           && <SLACozinhaTab periodo={periodoEfetivo} />}
          {tab === 'origem'        && <OrigemTab periodo={periodoEfetivo} externalSession={selectedSession} />}
          {tab === 'delivery'      && <DeliveryTab periodo={periodoEfetivo} />}
          {tab === 'cancelamentos' && <CancelamentosTab periodo={periodoEfetivo} />}
          {tab === 'clientes'      && <ClientesTab periodo={periodoEfetivo} />}
        </div>
      </div>
    </div>
  );
}