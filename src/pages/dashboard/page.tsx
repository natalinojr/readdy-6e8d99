import { DollarSign, ShoppingBag, Receipt, LayoutGrid, Timer } from 'lucide-react';
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
import { useAuth } from '../../contexts/AuthContext';
import { useKDS } from '../../contexts/KDSContext';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import { useSessaoFaturamento } from '@/hooks/useSessaoFaturamento';
import { useSessao } from '@/contexts/SessaoContext';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const pct = (current: number, prev: number) =>
  prev > 0 ? ((current - prev) / prev) * 100 : 0;

export default function Dashboard() {
  const { user } = useAuth();
  const { data: m, loading, reload } = useDashboardMetrics();
  const { data: extras, loading: extrasLoading } = useVisaoGeralExtras('Hoje');
  const { alertas: alertasCriticos, loading: alertasCriticosLoading } = useStockCriticalAlerts();
  const { pedidos: kdsPedidos } = useKDS();
  const { modo } = useModoFaturamento();
  const { metrics: sessaoMetrics, loading: sessaoLoading } = useSessaoFaturamento();
  const { sessao } = useSessao();

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

  // Escolhe fonte de dados conforme modo
  const faturamentoHoje = modo === 'sessao'
    ? sessaoMetrics.faturamento_sessao
    : (m?.faturamento_hoje ?? 0);
  const faturamentoOntem = modo === 'sessao' ? 0 : (m?.faturamento_ontem ?? 0);
  const pedidosHoje = modo === 'sessao'
    ? sessaoMetrics.pedidos_sessao
    : (m?.pedidos_hoje ?? 0);
  const pedidosOntem = modo === 'sessao' ? 0 : (m?.pedidos_ontem ?? 0);
  const ticketMedio = modo === 'sessao'
    ? sessaoMetrics.ticket_medio_sessao
    : (m?.ticket_medio ?? 0);
  const ticketMedioOntem = modo === 'sessao' ? 0 : (m?.ticket_medio_ontem ?? 0);
  const mesasOcupadas = m?.mesas_ocupadas ?? 0;
  const mesasTotal = m?.mesas_total ?? 0;

  const isLoading = loading || (modo === 'sessao' && sessaoLoading);

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
      icon: DollarSign,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-500',
    },
    {
      label: modo === 'sessao' ? 'Pedidos da Sessão' : 'Pedidos do Dia',
      value: String(pedidosHoje),
      trend: hasData && pedidosOntem > 0 ? pct(pedidosHoje, pedidosOntem) : undefined,
      trendLabel: modo === 'sessao' ? undefined : 'vs ontem',
      icon: ShoppingBag,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-500',
    },
    {
      label: 'Ticket Médio',
      value: fmt(ticketMedio),
      trend: hasData && ticketMedioOntem > 0 ? pct(ticketMedio, ticketMedioOntem) : undefined,
      trendLabel: modo === 'sessao' ? undefined : 'vs ontem',
      icon: Receipt,
      iconBg: 'bg-zinc-100',
      iconColor: 'text-zinc-600',
    },
    {
      label: 'Mesas Ocupadas',
      value: mesasTotal > 0 ? `${mesasOcupadas} / ${mesasTotal}` : '—',
      trend: undefined,
      trendLabel: undefined,
      icon: LayoutGrid,
      iconBg: 'bg-orange-50',
      iconColor: 'text-orange-500',
    },
    {
      label: 'SLA Médio Cozinha',
      value: slaMediaCozinha !== null ? `${slaMediaCozinha} min` : '—',
      trend: undefined,
      trendLabel: slaMediaCozinha !== null ? (slaMediaCozinha <= 15 ? 'No prazo' : 'Acima do alvo') : undefined,
      icon: Timer,
      iconBg: slaMediaCozinha !== null && slaMediaCozinha > 15 ? 'bg-red-50' : 'bg-zinc-100',
      iconColor: slaMediaCozinha !== null && slaMediaCozinha > 15 ? 'text-red-500' : 'text-zinc-500',
    },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">
            {greeting}, <span className="text-amber-500">{user?.nome.split(' ')[0]}</span>!
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {isLoading
              ? 'Carregando dados...'
              : pedidosHoje > 0
                ? `${pedidosHoje} pedido${pedidosHoje !== 1 ? 's' : ''} — ${periodoLabel}`
                : `Nenhum pedido — ${periodoLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DashboardModoToggle />
          <button
            onClick={reload}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer disabled:opacity-50"
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

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      {/* Chart + Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SalesChart data={m?.vendas_por_hora ?? []} />
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <MesasOverview mesas={m?.mesas_mapa ?? []} />
        </div>
        <div className="space-y-4">
          <MetasDia
            faturamentoHoje={faturamentoHoje}
            pedidosHoje={pedidosHoje}
            ticketMedio={ticketMedio}
          />
          <ResumoFinanceiro />
          <EstoqueAlertas alertas={m?.alertas_estoque ?? []} />
          <ValidadeAlertas />
        </div>
      </div>

      {/* Últimos Pedidos + Categorias */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
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
      <HorariosPico />

      {/* Alertas Financeiros */}
      <AlertasFinanceiros />
    </div>
  );
}
