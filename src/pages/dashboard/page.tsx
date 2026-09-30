import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import MetricCard from './components/MetricCard';
import SalesChart from './components/SalesChart';
import PedidosStatus from './components/PedidosStatus';
import MesasOverview from './components/MesasOverview';
import EstoqueAlertas from './components/EstoqueAlertas';
import AlertasEstoqueCritico from './components/AlertasEstoqueCritico';
import UltimosPedidos from './components/UltimosPedidos';
import CategoriasChart from './components/CategoriasChart';
import AlertasFinanceiros from './components/AlertasFinanceiros';
import ValidadeAlertas from './components/ValidadeAlertas';
import HorariosPico from './components/HorariosPico';
import MetasDia from './components/MetasDia';
import ResumoFinanceiro from './components/ResumoFinanceiro';
import DashboardModoToggle from './components/DashboardModoToggle';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { useVisaoGeralExtras } from '../../hooks/useVisaoGeralExtras';
import { useStockCriticalAlerts } from '../../hooks/useStockCriticalAlerts';
import { useOrdersPing } from '../../hooks/useOrdersPing';
import { useAuth } from '../../contexts/AuthContext';
import { useKDS } from '../../contexts/KDSContext';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import { useSessaoFaturamento } from '@/hooks/useSessaoFaturamento';
import { useSessao } from '@/contexts/SessaoContext';
import { useIfoodVendas } from '@/hooks/useIfoodVendas';
import { useVendasHoraComparativo } from '@/hooks/useVendasHoraComparativo';
import { todayBrasilia } from '@/lib/dateUtils';
import { diasComparacao, montarVendasHora, type Comparacao } from '@/lib/vendasHoraComparativo';
import { useComparacoesLigadas } from '@/components/feature/ComparacaoVendasHora';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const pct = (current: number, prev: number) =>
  prev > 0 ? ((current - prev) / prev) * 100 : 0;

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: m, loading, error: metricsError, reload } = useDashboardMetrics();
  const { data: extras, loading: extrasLoading, reload: reloadExtras } = useVisaoGeralExtras('Hoje');
  const { alertas: alertasCriticos, loading: alertasCriticosLoading, reload: reloadAlertas } = useStockCriticalAlerts();
  const { pedidos: kdsPedidos } = useKDS();
  const { modo } = useModoFaturamento();
  const { metrics: sessaoMetrics, loading: sessaoLoading, reload: reloadSessao } = useSessaoFaturamento();
  const { sessao } = useSessao();

  // refreshKey propaga para componentes que buscam dados por conta própria
  // (HorariosPico, ResumoFinanceiro, ValidadeAlertas).
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const reloadAll = useCallback(() => {
    reload();
    reloadExtras();
    reloadSessao();
    reloadAlertas?.();
    setRefreshKey((k) => k + 1);
    setLastUpdated(new Date());
  }, [reload, reloadExtras, reloadSessao, reloadAlertas]);

  // Tempo real: cada mudança de pedido dispara um ping; recarrega com debounce
  // de 2,5s para agrupar rajadas de eventos (mesmo canal do KDS/impressão).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useOrdersPing(user?.tenantId, () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { reloadAll(); }, 2500);
  });
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // SLA médio real da cozinha baseado nos pedidos ativos
  const slaMediaCozinha = (() => {
    const tempos = kdsPedidos
      .flatMap(p => p.itens)
      .filter(i => i.iniciouPreparoEm && i.ficouProntoEm)
      .map(i => (i.ficouProntoEm! - i.iniciouPreparoEm!) / 60000);
    if (tempos.length === 0) return null;
    return Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length);
  })();

  const hasData = !!m;

  // iFood (conciliação + API do iFood, mesma conta da Visão Geral dos Relatórios): não passa pelo PDV,
  // então soma aos totais. Hoje/ontem no modo calendário; no modo sessão, os pedidos feitos desde a abertura.
  const sessaoIntervalo = useMemo(() => (modo === 'sessao' && sessao
    ? { from: sessao.dataRef.toISOString(), to: new Date().toISOString() }
    : null), [modo, sessao?.dataRef.getTime(), refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: ifDia } = useIfoodVendas('Hoje', null, refreshKey);
  const { data: ifOntem } = useIfoodVendas(modo === 'sessao' ? '' : 'Ontem', null, refreshKey);
  const { data: ifSessao } = useIfoodVendas('', sessaoIntervalo, refreshKey);
  const ifood = modo === 'sessao' ? ifSessao : ifDia;
  const ifTot = ifood?.total ?? 0;
  const ifPed = ifood?.pedidos ?? 0;

  // Escolhe fonte de dados conforme modo
  const faturamentoHoje = (modo === 'sessao'
    ? sessaoMetrics.faturamento_sessao
    : (m?.faturamento_hoje ?? 0)) + ifTot;
  const faturamentoOntem = modo === 'sessao' ? 0 : (m?.faturamento_ontem ?? 0) + (ifOntem?.total ?? 0);
  const pedidosHoje = (modo === 'sessao'
    ? sessaoMetrics.pedidos_sessao
    : (m?.pedidos_hoje ?? 0)) + ifPed;
  const pedidosOntem = modo === 'sessao' ? 0 : (m?.pedidos_ontem ?? 0) + (ifOntem?.pedidos ?? 0);
  const ticketMedio = pedidosHoje > 0 ? faturamentoHoje / pedidosHoje : 0;
  const ticketMedioOntem = pedidosOntem > 0 ? faturamentoOntem / pedidosOntem : 0;

  // Vendas por hora do dia (PDV + iFood por cima), sempre do dia de hoje, com linhas de
  // comparação ligáveis (ontem, mesmo dia da semana passada, mesmo dia do mês passado).
  const [comparacoes, alternarComparacao] = useComparacoesLigadas('dashboard.vendasHora.comparacoes');
  const hojeBR = todayBrasilia();
  const diasComp = useMemo(() => diasComparacao(hojeBR), [hojeBR]);
  const seriesComp = useVendasHoraComparativo(diasComp, comparacoes);
  const vendasPorHora = (() => {
    const pdv: Record<string, number> = {};
    for (const h of m?.vendas_por_hora ?? []) pdv[h.hora.slice(0, 2)] = (pdv[h.hora.slice(0, 2)] ?? 0) + Number(h.valor);
    const ifoodHora: Record<string, number> = {};
    for (const [hm, v] of Object.entries(ifDia?.porHora ?? {})) ifoodHora[hm.slice(0, 2)] = (ifoodHora[hm.slice(0, 2)] ?? 0) + v;
    const ligadas = Object.fromEntries(Object.entries(seriesComp).filter(([k]) => comparacoes[k as Comparacao]));
    const horaAgora = Number(new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2));
    return montarVendasHora(pdv, ifoodHora, ligadas, horaAgora);
  })();
  const mesasOcupadas = m?.mesas_ocupadas ?? 0;
  const mesasTotal = m?.mesas_total ?? 0;
  const pedidosAbertosValor = m?.pedidos_abertos_valor ?? 0;
  const pedidosAbertosCount = m?.pedidos_abertos_count ?? 0;

  const isLoading = loading || (modo === 'sessao' && sessaoLoading);

  // Carimba o horário da última atualização quando novos dados chegam
  useEffect(() => { if (m) setLastUpdated(new Date()); }, [m]);

  // Label contextual para o período
  const periodoLabel = modo === 'sessao'
    ? sessao
      ? `Sessão ${sessao.numero} — aberta ${sessao.dataRef.toLocaleDateString('pt-BR')}`
      : 'Sem sessão ativa'
    : 'Hoje';

  const metrics = [
    {
      label: modo === 'sessao' ? 'Faturamento da Sessão' : 'Faturamento Hoje',
      value: fmt(faturamentoHoje),
      trend: hasData && faturamentoOntem > 0 ? pct(faturamentoHoje, faturamentoOntem) : undefined,
      trendLabel: modo === 'sessao' ? undefined : 'vs ontem',
      icon: 'ri-money-dollar-circle-line',
      ajuda: (modo === 'sessao'
        ? 'Tudo que a loja VENDEU desde a abertura do caixa: pedidos do sistema (mesa, balcão, delivery, totem) + iFood.\n\n'
        : 'Tudo que a loja VENDEU hoje: pedidos do sistema (mesa, balcão, delivery, totem) + iFood.\n\n') +
        'É venda, não dinheiro na conta. O que já entrou (maquininha, Pix no banco, repasse do iFood) aparece em ' +
        'Financeiro › Visão Geral › "Recebido hoje", que costuma ficar abaixo deste número até as conciliações do dia.',
    },
    {
      label: modo === 'sessao' ? 'Pedidos da Sessão' : 'Pedidos do Dia',
      value: String(pedidosHoje),
      trend: hasData && pedidosOntem > 0 ? pct(pedidosHoje, pedidosOntem) : undefined,
      trendLabel: modo === 'sessao' ? undefined : 'vs ontem',
      icon: 'ri-shopping-bag-line',
    },
    {
      label: 'Ticket Médio',
      value: fmt(ticketMedio),
      trend: hasData && ticketMedioOntem > 0 ? pct(ticketMedio, ticketMedioOntem) : undefined,
      trendLabel: modo === 'sessao' ? undefined : 'vs ontem',
      icon: 'ri-receipt-line',
    },
    {
      label: 'Pedidos em Aberto',
      value: fmt(pedidosAbertosValor),
      icon: 'ri-time-line',
      trendLabel: pedidosAbertosCount > 0
        ? `${pedidosAbertosCount} pedido${pedidosAbertosCount !== 1 ? 's' : ''} não pago${pedidosAbertosCount !== 1 ? 's' : ''}`
        : 'Nenhum pedido pendente',
      onClick: () => navigate('/gestor-pedidos', { state: { filtroPagamento: 'nao-pagos' } }),
    },
    {
      label: 'Mesas Ocupadas',
      value: mesasTotal > 0 ? `${mesasOcupadas} / ${mesasTotal}` : '—',
      trend: undefined,
      trendLabel: undefined,
      icon: 'ri-layout-grid-line',
    },
    {
      label: 'SLA Médio Cozinha',
      value: slaMediaCozinha !== null ? `${slaMediaCozinha} min` : '—',
      trend: undefined,
      trendLabel: slaMediaCozinha !== null ? (slaMediaCozinha <= 15 ? 'No prazo' : 'Acima do alvo') : undefined,
      icon: 'ri-timer-line',
      alerta: slaMediaCozinha !== null && slaMediaCozinha > 15,
    },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
            <i className="ri-dashboard-line text-white text-base md:text-lg" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold text-zinc-800">
              {greeting}, <span className="text-amber-500">{user?.nome?.split(' ')[0] ?? ''}</span>!
            </h1>
            <p className="text-xs text-zinc-400">
              {isLoading
                ? 'Carregando dados...'
                : pedidosHoje > 0
                  ? `${pedidosHoje} pedido${pedidosHoje !== 1 ? 's' : ''} — ${periodoLabel}`
                  : `Nenhum pedido — ${periodoLabel}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto max-w-full">
          <DashboardModoToggle />
          <button
            onClick={reloadAll}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm disabled:opacity-50"
          >
            <i className={`ri-refresh-line text-sm ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Modo sessão — banner informativo */}
      {modo === 'sessao' && sessao && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-medium">
          <i className="ri-store-2-line text-sm" />
          <span>
            Exibindo dados da <strong>Sessão {sessao.numero}</strong> — aberta em{' '}
            {sessao.dataRef.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} às{' '}
            {sessao.iniciadaEm}. Pedidos de dias anteriores desta sessão estão incluídos.
          </span>
        </div>
      )}

      {modo === 'sessao' && !sessao && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-500">
          <i className="ri-information-line text-sm" />
          <span>Nenhuma sessão ativa. Abra uma sessão no PDV para ver os dados por sessão.</span>
        </div>
      )}

      {/* Error banner */}
      {metricsError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          <i className="ri-error-warning-line text-sm" />
          <span>Erro ao carregar métricas: {metricsError}</span>
          <button
            onClick={reload}
            className="ml-auto text-red-600 hover:text-red-800 font-medium underline cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-2 sm:gap-3">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>
      {ifPed > 0 && (
        <p className="text-[11px] text-zinc-400 -mt-2">
          <i className="ri-restaurant-2-line text-red-500" /> Inclui iFood: <strong className="text-zinc-600">{fmt(ifTot)}</strong> em {ifPed} pedido{ifPed !== 1 ? 's' : ''}
          {(ifood?.pedidosAoVivo ?? 0) > 0 && ' (valor provisório pela API do iFood até importar a conciliação)'} — detalhes em Relatórios › iFood.
        </p>
      )}

      {/* Chart + Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 min-w-0">
          <SalesChart data={vendasPorHora} lastUpdated={lastUpdated}
            comparacoes={comparacoes} diasComparacao={diasComp} onAlternarComparacao={alternarComparacao} />
        </div>
        <div>
          <PedidosStatus
            novos={m?.pedidos_new ?? 0}
            emPreparo={m?.pedidos_preparing ?? 0}
            prontos={m?.pedidos_ready ?? 0}
            entregues={m?.pedidos_delivered_today ?? 0}
          />
        </div>
      </div>

      {/* Metas do Dia + Estoque */}
      {/* Alertas críticos de estoque — pedidos em aberto */}
      {alertasCriticos.length > 0 && (
        <AlertasEstoqueCritico alertas={alertasCriticos} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 min-w-0">
          <MesasOverview mesas={m?.mesas_mapa ?? []} />
        </div>
        <div className="space-y-4 min-w-0">
          <MetasDia
            faturamentoHoje={faturamentoHoje}
            pedidosHoje={pedidosHoje}
            ticketMedio={ticketMedio}
          />
          <ResumoFinanceiro refreshKey={refreshKey} />
          <EstoqueAlertas alertas={m?.alertas_estoque ?? []} />
          <ValidadeAlertas refreshKey={refreshKey} />
        </div>
      </div>

      {/* Últimos Pedidos + Categorias */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 min-w-0">
          <UltimosPedidos pedidos={m?.ultimos_pedidos ?? []} />
        </div>
        <div>
          <CategoriasChart
            data={extras?.by_category ?? []}
            loading={extrasLoading}
          />
        </div>
      </div>

      {/* Horários de Pico */}
      <HorariosPico refreshKey={refreshKey} />

      {/* Alertas Financeiros */}
      <AlertasFinanceiros />
    </div>
  );
}
