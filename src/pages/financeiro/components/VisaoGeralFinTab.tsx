import { useState, useEffect, useCallback } from 'react';
import { useFinanceiroDashboard, useBankAccounts, useTopDespesas } from '@/hooks/useFinanceiro';
import { useSalesReportBySession } from '@/hooks/useSalesReport';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import ModoFaturamentoToggle from '@/components/feature/ModoFaturamentoToggle';
import SessaoSelector from '@/components/feature/SessaoSelector';
import type { SessionInfo } from '@/hooks/useSessions';
import { formatCurrency } from '@/lib/formatters';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, CartesianGrid, ComposedChart, Line,
} from 'recharts';
function fmtK(v: number) {
  if (v >= 1000) return `R$${(v / 1000).toFixed(0)}k`;
  return `R$${v.toFixed(0)}`;
}

function MetricCard({ label, value, icon, color, sub, trend }: {
  label: string; value: string; icon: string; color: string; sub?: string; trend?: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${color}`}>
          <i className={`${icon} text-sm`} />
        </div>
      </div>
      <p className="text-2xl font-bold text-zinc-900">{value}</p>
      {sub && (
        <p className={`text-xs mt-1 flex items-center gap-1 ${trend !== undefined ? (trend >= 0 ? 'text-green-600' : 'text-red-500') : 'text-zinc-400'}`}>
          {trend !== undefined && <i className={trend >= 0 ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />}
          {sub}
        </p>
      )}
    </div>
  );
}

const AreaTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs">
      <p className="font-semibold text-zinc-600 mb-1">{label}</p>
      <p className="font-bold text-amber-600">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

const BarTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs">
      <p className="font-semibold text-zinc-700 mb-1">{label}</p>
      <p className="font-bold text-zinc-800">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

interface HealthAlert {
  type: 'danger' | 'warning' | 'ok';
  icon: string;
  title: string;
  desc: string;
}

// ── Hook: Receita vs Despesa mensal ──────────────────────────────────────────
interface ReceitaDespesaMes {
  mes: string;
  receita: number;
  despesa: number;
  lucro: number;
}

function useReceitaVsDespesa(meses: number) {
  const { user } = useAuth();
  const [data, setData] = useState<ReceitaDespesaMes[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Receita: orders + entradas manuais do fluxo de caixa
      const startDateStr = new Date(new Date().setMonth(new Date().getMonth() - meses)).toISOString();
      const startDateCashFlow = startDateStr.slice(0, 10);

      const { data: ordersData } = await supabase
        .from('orders')
        .select('created_at, total_amount')
        .eq('tenant_id', user.tenantId)
        .not('status', 'in', '(cancelled,draft)')
        .eq('is_training', false)
        .eq('is_draft', false)
        .gte('created_at', startDateStr);

      // Entradas manuais do fluxo de caixa
      const { data: manualIncomeData } = await supabase
        .from('fin_cash_flow')
        .select('date, amount')
        .eq('tenant_id', user.tenantId)
        .eq('type', 'income')
        .eq('origin', 'manual')
        .gte('date', startDateCashFlow);

      // Despesas: cash_flow saídas por mês — fonte única de verdade.
      // Não somamos fin_purchases nem fin_accounts_payable separadamente para evitar
      // double-count: compras pagas geram origin='auto_purchase' e contas pagas geram
      // origin='auto_bill_payment' em fin_cash_flow, então já estão contabilizadas aqui.
      const { data: expData } = await supabase
        .from('fin_cash_flow')
        .select('date, amount')
        .eq('tenant_id', user.tenantId)
        .eq('type', 'expense')
        .gte('date', startDateCashFlow);

      const map = new Map<string, { receita: number; despesa: number }>();

      // Preenche meses
      for (let i = meses - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        map.set(key, { receita: 0, despesa: 0 });
      }

      for (const o of (ordersData ?? [])) {
        const key = o.created_at.slice(0, 7);
        if (map.has(key)) map.get(key)!.receita += Number(o.total_amount ?? 0);
      }
      for (const m of (manualIncomeData ?? [])) {
        const key = m.date.slice(0, 7);
        if (map.has(key)) map.get(key)!.receita += Number(m.amount ?? 0);
      }
      for (const e of (expData ?? [])) {
        const key = e.date.slice(0, 7);
        if (map.has(key)) map.get(key)!.despesa += Number(e.amount ?? 0);
      }

      const result: ReceitaDespesaMes[] = Array.from(map.entries()).map(([key, v]) => {
        const [year, month] = key.split('-');
        const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
        return { mes: label, receita: v.receita, despesa: v.despesa, lucro: v.receita - v.despesa };
      });

      setData(result);
    } catch (e) {
      console.error('[useReceitaVsDespesa]', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, meses]);

  useEffect(() => { load(); }, [load]);
  return { data, loading };
}

// ── Tooltip customizado Receita vs Despesa ────────────────────────────────────
const RvDTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs min-w-[160px]">
      <p className="font-semibold text-zinc-600 mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-zinc-500 capitalize">{p.name}</span>
          </div>
          <span className="font-bold" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function VisaoGeralFinTab() {
  const { modo } = useModoFaturamento();
  const isSessao = modo === 'sessao';
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);

  const { dashboard, loading, error: dashError } = useFinanceiroDashboard();
  const { accounts: bankAccounts, loading: bankLoading } = useBankAccounts();
  const [trendPeriod, setTrendPeriod] = useState<7 | 14 | 30>(30);
  const [despesasPeriod, setDespesasPeriod] = useState<1 | 3 | 6>(1);
  const [rvdMeses, setRvdMeses] = useState<3 | 6 | 12>(6);
  const { despesas: despesasFiltradas, totalGeral: totalDespesasFiltradas, loading: despesasLoading } = useTopDespesas(despesasPeriod);
  const { data: rvdData, loading: rvdLoading } = useReceitaVsDespesa(rvdMeses);

  // Dados por sessão
  const { data: sessaoReport, loading: sessaoLoading, hasRealData: sessaoHasData } = useSalesReportBySession(
    isSessao ? (selectedSession?.id ?? null) : null
  );

  if (loading) {
    return (
      <div className="p-4 md:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-zinc-200 p-5 animate-pulse h-28" />
        ))}
      </div>
    );
  }

  if (dashError) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
            <i className="ri-error-warning-line text-red-500 text-lg" />
          </div>
          <div>
            <p className="text-sm font-semibold text-red-700">Erro ao carregar dados financeiros</p>
            <p className="text-xs text-red-500 mt-1">{dashError}</p>
            <p className="text-xs text-zinc-400 mt-2">Verifique sua conexão ou contate o suporte se o problema persistir.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!dashboard) return null;

  // ─── Cabeçalho com toggle + seletor de sessão ──────────────────────────────
  const headerBar = (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 px-4 md:px-6 pt-4 md:pt-5 pb-3 md:pb-4 bg-white border-b border-zinc-100">
      <div>
        <p className="text-sm font-semibold text-zinc-800">Visão Geral Financeira</p>
        <p className="text-xs text-zinc-400">
          {isSessao
            ? selectedSession
              ? `Sessão ${selectedSession.numero} · aberta em ${new Date(selectedSession.opened_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : 'Selecione uma sessão'
            : 'Dados do mês atual'}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {isSessao && (
          <SessaoSelector
            selectedId={selectedSession?.id ?? null}
            onSelect={setSelectedSession}
            size="sm"
          />
        )}
        <ModoFaturamentoToggle size="sm" showLabel={false} />
      </div>
    </div>
  );

  // ─── MODO SESSÃO ───────────────────────────────────────────────────────────
  if (isSessao) {
    const PAYMENT_COLORS_SESS = ['#f59e0b', '#10b981', '#6366f1', '#f97316', '#06b6d4', '#ec4899'];

    return (
      <div>
        {headerBar}
        <div className="p-6 space-y-6">
          {sessaoLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-zinc-200 p-5 animate-pulse h-24" />
              ))}
            </div>
          ) : !sessaoHasData ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
              <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
                <i className="ri-store-2-line text-3xl text-zinc-300" />
              </div>
              <p className="text-sm font-semibold text-zinc-500">
                {selectedSession ? 'Nenhum pedido nesta sessão' : 'Selecione uma sessão acima'}
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                {selectedSession
                  ? 'Não há vendas registradas nesta sessão'
                  : 'Use o seletor de sessão para visualizar os dados'}
              </p>
            </div>
          ) : (
            <>
              {/* KPIs da sessão */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <MetricCard
                  label="Faturamento da Sessão"
                  value={formatCurrency(sessaoReport!.total_revenue)}
                  icon="ri-store-2-line"
                  color="bg-amber-100 text-amber-600"
                />
                <MetricCard
                  label="Pedidos"
                  value={String(sessaoReport!.total_orders)}
                  icon="ri-receipt-line"
                  color="bg-green-100 text-green-600"
                />
                <MetricCard
                  label="Ticket Médio"
                  value={formatCurrency(sessaoReport!.avg_ticket)}
                  icon="ri-money-dollar-circle-line"
                  color="bg-orange-100 text-orange-600"
                />
                <MetricCard
                  label="Data de Abertura"
                  value={new Date(sessaoReport!.opened_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  icon="ri-calendar-check-line"
                  color="bg-zinc-100 text-zinc-600"
                  sub={new Date(sessaoReport!.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                />
              </div>

              {/* Formas de pagamento + Itens vendidos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Formas de pagamento */}
                <div className="bg-white rounded-xl border border-zinc-200 p-5">
                  <h3 className="text-sm font-semibold text-zinc-800 mb-4">Formas de Pagamento</h3>
                  {sessaoReport!.by_payment.length > 0 ? (
                    <div className="space-y-3">
                      {sessaoReport!.by_payment
                        .sort((a, b) => b.total - a.total)
                        .map((pm, i) => {
                          const total = sessaoReport!.by_payment.reduce((s, p) => s + Number(p.total), 0);
                          const pct = total > 0 ? Math.round((Number(pm.total) / total) * 100) : 0;
                          const color = PAYMENT_COLORS_SESS[i % PAYMENT_COLORS_SESS.length];
                          return (
                            <div key={pm.payment_method}>
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                                  <span className="text-xs font-medium text-zinc-700 truncate max-w-[140px]">
                                    {pm.payment_method ?? 'Outros'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-zinc-400">{pct}%</span>
                                  <span className="text-xs font-bold text-zinc-800">
                                    {formatCurrency(Number(pm.total))}
                                  </span>
                                </div>
                              </div>
                              <div className="w-full bg-zinc-100 rounded-full h-1.5">
                                <div
                                  className="h-1.5 rounded-full"
                                  style={{ width: `${pct}%`, backgroundColor: color }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-zinc-300">
                      <i className="ri-bank-card-line text-2xl mb-2" />
                      <p className="text-xs">Sem pagamentos registrados</p>
                    </div>
                  )}
                </div>

                {/* Top itens */}
                <div className="bg-white rounded-xl border border-zinc-200 p-5">
                  <h3 className="text-sm font-semibold text-zinc-800 mb-4">Top Itens da Sessão</h3>
                  {sessaoReport!.top_items.length > 0 ? (
                    <div className="space-y-2">
                      {sessaoReport!.top_items.slice(0, 6).map((item, idx) => {
                        const maxQty = sessaoReport!.top_items[0]?.total_qty ?? 1;
                        return (
                          <div key={item.item_name} className="flex items-center gap-2">
                            <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-black flex-shrink-0 ${
                              idx === 0 ? 'bg-amber-100 text-amber-700' : idx === 1 ? 'bg-zinc-100 text-zinc-600' : 'bg-zinc-50 text-zinc-400'
                            }`}>{idx + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs font-medium text-zinc-700 truncate">{item.item_name}</span>
                                <span className="text-xs font-bold text-zinc-800 ml-2 whitespace-nowrap">
                                  {formatCurrency(Number(item.total_revenue))}
                                </span>
                              </div>
                              <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-amber-400 rounded-full"
                                  style={{ width: `${(item.total_qty / maxQty) * 100}%` }}
                                />
                              </div>
                            </div>
                            <span className="text-xs font-bold text-zinc-500 w-6 text-right flex-shrink-0">{item.total_qty}x</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-zinc-300">
                      <i className="ri-shopping-bag-3-line text-2xl mb-2" />
                      <p className="text-xs">Sem itens registrados</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── MODO CALENDÁRIO (original) ───────────────────────────────────────────
  const crescPos = dashboard.crescimentoMes >= 0;

  // Health score calculation
  const healthAlerts: HealthAlert[] = [];
  const margemReal = dashboard.receitaMes > 0 ? (dashboard.lucroEstimado / dashboard.receitaMes) * 100 : 0;
  const ratioAPagarReceita = dashboard.receitaMes > 0 ? (dashboard.totalAPagar / dashboard.receitaMes) * 100 : 0;

  if (dashboard.contasVencendo.length > 0) {
    healthAlerts.push({
      type: 'danger',
      icon: 'ri-alarm-warning-line',
      title: `${dashboard.contasVencendo.length} conta(s) vencendo em 7 dias`,
      desc: `Total: ${formatCurrency(dashboard.totalAPagar)} — risco de inadimplência`,
    });
  }
  if (!crescPos) {
    healthAlerts.push({
      type: 'warning',
      icon: 'ri-arrow-down-circle-line',
      title: `Receita caiu ${Math.abs(dashboard.crescimentoMes).toFixed(1)}% vs mês anterior`,
      desc: 'Monitore os custos e revise estratégias de vendas',
    });
  }
  if (ratioAPagarReceita > 40) {
    healthAlerts.push({
      type: 'danger',
      icon: 'ri-scales-line',
      title: 'Contas a pagar acima de 40% da receita',
      desc: 'Fluxo de caixa em risco — revise despesas urgentes',
    });
  } else if (ratioAPagarReceita > 25) {
    healthAlerts.push({
      type: 'warning',
      icon: 'ri-scales-line',
      title: 'Contas a pagar acima de 25% da receita',
      desc: 'Atenção ao fluxo de caixa nos próximos dias',
    });
  }
  if (dashboard.saldoCaixa < 0) {
    healthAlerts.push({
      type: 'danger',
      icon: 'ri-safe-line',
      title: 'Saldo de caixa negativo',
      desc: 'Entradas insuficientes para cobrir saídas do mês',
    });
  }
  if (healthAlerts.length === 0) {
    healthAlerts.push({
      type: 'ok',
      icon: 'ri-shield-check-line',
      title: 'Saúde financeira estável',
      desc: 'Nenhum alerta crítico identificado no momento',
    });
  }

  // Trend data filtered by period
  const trendData = dashboard.receitaDiaria.slice(-trendPeriod);

  // Horizontal bar data for payment methods
  const maxPayment = Math.max(...dashboard.receitaPorPagamento.map(p => p.value), 1);
  const PAYMENT_COLORS = ['#f59e0b', '#10b981', '#6366f1', '#f97316', '#06b6d4', '#ec4899'];

  const healthScore = healthAlerts.filter(a => a.type === 'ok').length > 0
    ? 100
    : healthAlerts.filter(a => a.type === 'danger').length > 0
      ? Math.max(20, 100 - healthAlerts.filter(a => a.type === 'danger').length * 25 - healthAlerts.filter(a => a.type === 'warning').length * 10)
      : Math.max(50, 100 - healthAlerts.filter(a => a.type === 'warning').length * 15);

  const scoreColor = healthScore >= 80 ? 'text-green-600' : healthScore >= 50 ? 'text-amber-600' : 'text-red-600';
  const scoreBg = healthScore >= 80 ? 'bg-green-50 border-green-200' : healthScore >= 50 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';

  return (
    <div>
      {headerBar}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
          <MetricCard
            label="Receita Hoje"
            value={formatCurrency(dashboard.receitaHoje)}
            icon="ri-sun-line"
            color="bg-amber-100 text-amber-600"
          />
          <MetricCard
            label="Receita do Mês"
            value={formatCurrency(dashboard.receitaMes)}
            icon="ri-calendar-line"
            color="bg-green-100 text-green-600"
            sub={`${crescPos ? '+' : ''}${dashboard.crescimentoMes.toFixed(1)}% vs mês anterior`}
            trend={dashboard.crescimentoMes}
          />
          <MetricCard
            label="Ticket Médio"
            value={formatCurrency(dashboard.ticketMedio)}
            icon="ri-receipt-line"
            color="bg-orange-100 text-orange-600"
          />
          <MetricCard
            label="Lucro Real"
            value={formatCurrency(dashboard.lucroEstimado)}
            icon="ri-arrow-up-circle-line"
            color={dashboard.lucroEstimado >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}
            sub={`${margemReal.toFixed(1)}% de margem`}
            trend={margemReal}
          />
          <MetricCard
            label="Saldo em Caixa"
            value={formatCurrency(dashboard.saldoCaixa)}
            icon="ri-safe-line"
            color={dashboard.saldoCaixa >= 0 ? 'bg-zinc-100 text-zinc-600' : 'bg-red-100 text-red-600'}
            sub={dashboard.saldoCaixa < 0 ? 'Saldo negativo' : 'Saldo positivo'}
            trend={dashboard.saldoCaixa}
          />
        </div>

        {/* Saúde Financeira + A Pagar/Receber */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Health Score */}
          <div className={`rounded-xl border p-5 ${scoreBg}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-800">Saúde Financeira</h3>
              <span className={`text-2xl font-black ${scoreColor}`}>{healthScore}</span>
            </div>
            <div className="w-full bg-zinc-200 rounded-full h-2 mb-4">
              <div
                className={`h-2 rounded-full transition-all ${healthScore >= 80 ? 'bg-green-500' : healthScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${healthScore}%` }}
              />
            </div>
            <div className="space-y-2">
              {healthAlerts.map((alert, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className={`w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0 mt-0.5 ${alert.type === 'danger' ? 'bg-red-100' : alert.type === 'warning' ? 'bg-amber-100' : 'bg-green-100'}`}>
                    <i className={`${alert.icon} text-xs ${alert.type === 'danger' ? 'text-red-600' : alert.type === 'warning' ? 'text-amber-600' : 'text-green-600'}`} />
                  </div>
                  <div>
                    <p className={`text-xs font-semibold ${alert.type === 'danger' ? 'text-red-700' : alert.type === 'warning' ? 'text-amber-700' : 'text-green-700'}`}>{alert.title}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{alert.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* A Pagar */}
          <div className="bg-white rounded-xl border border-zinc-200 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl">
                <i className="ri-arrow-up-circle-line text-red-500 text-xl" />
              </div>
              <div>
                <p className="text-xs text-zinc-500">Total a Pagar (pendente)</p>
                <p className="text-xl font-bold text-red-600">{formatCurrency(dashboard.totalAPagar)}</p>
              </div>
            </div>
            {dashboard.contasVencendo.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-zinc-500 mb-2">Vencendo em breve:</p>
                {dashboard.contasVencendo.slice(0, 3).map(b => (
                  <div key={b.id} className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-red-700 truncate max-w-[120px]">{b.description}</span>
                    <span className="text-xs font-bold text-red-600 whitespace-nowrap ml-2">{formatCurrency(b.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* A Receber */}
          <div className="bg-white rounded-xl border border-zinc-200 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center bg-green-100 rounded-xl">
                <i className="ri-arrow-down-circle-line text-green-500 text-xl" />
              </div>
              <div>
                <p className="text-xs text-zinc-500">Total a Receber</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(dashboard.totalAReceber)}</p>
              </div>
            </div>
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Saldo líquido estimado</span>
                <span className={`font-bold ${dashboard.totalAReceber - dashboard.totalAPagar >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(dashboard.totalAReceber - dashboard.totalAPagar)}
                </span>
              </div>
              <div className="w-full bg-zinc-100 rounded-full h-1.5">
                <div
                  className="bg-green-500 h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, dashboard.totalAReceber > 0 ? (dashboard.totalAReceber / (dashboard.totalAReceber + dashboard.totalAPagar)) * 100 : 0)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Saldos por Conta Bancária */}
        {!bankLoading && bankAccounts.length > 0 && (
          <div className="bg-white rounded-xl border border-zinc-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
                <i className="ri-bank-line text-zinc-400" /> Saldo por Conta Bancária
              </h3>
              <span className="text-xs text-zinc-400">
                Total: <span className="font-bold text-zinc-700">{formatCurrency(bankAccounts.reduce((s, a) => s + Number(a.current_balance), 0))}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {bankAccounts.map(acc => {
                const bal = Number(acc.current_balance);
                const total = bankAccounts.reduce((s, a) => s + Math.max(0, Number(a.current_balance)), 0);
                const pct = total > 0 ? Math.max(0, (bal / total) * 100) : 0;
                return (
                  <div key={acc.id} className="rounded-xl border border-zinc-100 p-3.5 overflow-hidden relative">
                    <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: acc.color }} />
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0" style={{ backgroundColor: acc.color + '20' }}>
                        <i className={`${acc.icon} text-xs`} style={{ color: acc.color }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-700 truncate">{acc.name}</p>
                        <p className="text-xs text-zinc-400 truncate">{acc.bank_name || 'Conta'}</p>
                      </div>
                    </div>
                    <p className={`text-base font-bold ${bal >= 0 ? 'text-zinc-900' : 'text-red-600'}`}>
                      {formatCurrency(bal)}
                    </p>
                    <div className="mt-2 w-full bg-zinc-100 rounded-full h-1">
                      <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: acc.color }} />
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">{pct.toFixed(0)}% do total</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Top Despesas ─────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-zinc-200 p-4 md:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 md:mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-100">
                <i className="ri-pie-chart-2-line text-red-500 text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-800">Top Despesas</h3>
                <p className="text-xs text-zinc-400">Total: <span className="font-semibold text-zinc-600">{formatCurrency(totalDespesasFiltradas)}</span></p>
              </div>
            </div>
            <div className="flex bg-zinc-100 rounded-lg overflow-hidden self-start">
              {([1, 3, 6] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setDespesasPeriod(m)}
                  className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${despesasPeriod === m ? 'bg-amber-500 text-white' : 'text-zinc-500 hover:text-zinc-800'}`}
                >
                  {m === 1 ? 'Este mês' : m === 3 ? '3m' : '6m'}
                </button>
              ))}
            </div>
          </div>

          {despesasLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 bg-zinc-50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : despesasFiltradas.length === 0 ? (
            <div className="py-10 text-center">
              <i className="ri-pie-chart-2-line text-3xl text-zinc-200 block mb-2" />
              <p className="text-sm text-zinc-400">Nenhuma despesa registrada no período</p>
              <p className="text-xs text-zinc-300 mt-1">Registre compras e contas a pagar para visualizar</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
              {despesasFiltradas.map((d, i) => {
                const COLORS = [
                  '#ef4444', '#f97316', '#f59e0b', '#eab308',
                  '#84cc16', '#10b981', '#06b6d4', '#8b5cf6',
                ];
                const color = COLORS[i % COLORS.length];
                return (
                  <div key={d.category}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-xs font-medium text-zinc-700 truncate">{d.category}</span>
                        <span className="text-xs text-zinc-400 whitespace-nowrap flex-shrink-0">
                          ({d.count} {d.count === 1 ? 'lançamento' : 'lançamentos'})
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-zinc-400">{d.pct.toFixed(1)}%</span>
                        <span className="text-xs font-bold text-zinc-800 tabular-nums">{formatCurrency(d.total)}</span>
                      </div>
                    </div>
                    <div className="w-full bg-zinc-100 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${d.pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {despesasFiltradas.length > 0 && (
            <div className="mt-5 pt-4 border-t border-zinc-100 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-1.5">
                <i className="ri-information-line text-zinc-400 text-xs" />
                <span className="text-xs text-zinc-400">Baseado no fluxo de caixa — sem double-count de compras e contas pagas</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-xs text-zinc-400">Maior categoria</p>
                  <p className="text-xs font-bold text-zinc-700">{despesasFiltradas[0]?.category}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-400">Representa</p>
                  <p className="text-xs font-bold text-red-600">{despesasFiltradas[0]?.pct.toFixed(1)}% do total</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Receita vs Despesa Mensal ─────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-zinc-200 p-4 md:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 md:mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-100">
                <i className="ri-bar-chart-grouped-line text-emerald-600 text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-800">Receita vs Despesa</h3>
                <p className="text-xs text-zinc-400">Comparativo mensal com linha de lucro</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2 sm:gap-3 text-xs text-zinc-500 flex-wrap">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-emerald-500" /><span>Receita</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-red-400" /><span>Despesa</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-amber-500" /><span>Lucro</span></div>
              </div>
              <div className="flex bg-zinc-100 rounded-lg overflow-hidden">
                {([3, 6, 12] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setRvdMeses(m)}
                    className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${rvdMeses === m ? 'bg-amber-500 text-white' : 'text-zinc-500 hover:text-zinc-800'}`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          {rvdLoading ? (
            <div className="h-52 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={rvdData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickFormatter={v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v}`} axisLine={false} tickLine={false} width={52} />
                  <Tooltip content={<RvDTooltip />} />
                  <Bar dataKey="receita" name="receita" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="despesa" name="despesa" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Line type="monotone" dataKey="lucro" name="lucro" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3, fill: '#f59e0b', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>

              {/* Resumo do período */}
              <div className="mt-4 pt-4 border-t border-zinc-100 grid grid-cols-3 gap-2 md:gap-4">
                {[
                  { label: 'Total Receita', value: rvdData.reduce((s, d) => s + d.receita, 0), color: 'text-emerald-600', icon: 'ri-arrow-down-circle-line' },
                  { label: 'Total Despesa', value: rvdData.reduce((s, d) => s + d.despesa, 0), color: 'text-red-500', icon: 'ri-arrow-up-circle-line' },
                  { label: 'Lucro Acumulado', value: rvdData.reduce((s, d) => s + d.lucro, 0), color: rvdData.reduce((s, d) => s + d.lucro, 0) >= 0 ? 'text-amber-600' : 'text-red-600', icon: 'ri-funds-line' },
                ].map(item => (
                  <div key={item.label} className="text-center">
                    <p className="text-xs text-zinc-400 mb-1">{item.label}</p>
                    <p className={`text-base font-bold ${item.color}`}>{formatCurrency(item.value)}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Gráficos */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Tendência de Receita */}
          <div className="md:col-span-2 bg-white rounded-xl border border-zinc-200 p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-800">Tendência de Receita</h3>
              <div className="flex bg-zinc-100 rounded-lg overflow-hidden">
                {([7, 14, 30] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setTrendPeriod(p)}
                    className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${trendPeriod === p ? 'bg-amber-500 text-white' : 'text-zinc-500 hover:text-zinc-800'}`}
                  >
                    {p}d
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="receitaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  tickFormatter={d => d.slice(5)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  tickFormatter={fmtK}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip content={<AreaTooltip />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  fill="url(#receitaGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Horizontal Bar — Forma de Pagamento */}
          <div className="bg-white rounded-xl border border-zinc-200 p-5">
            <h3 className="text-sm font-semibold text-zinc-800 mb-4">Por Forma de Pagamento</h3>
            {dashboard.receitaPorPagamento.length > 0 ? (
              <div className="space-y-3">
                {dashboard.receitaPorPagamento
                  .sort((a, b) => b.value - a.value)
                  .map((item, i) => {
                    const pct = ((item.value / maxPayment) * 100).toFixed(0);
                    const color = PAYMENT_COLORS[i % PAYMENT_COLORS.length];
                    const total = dashboard.receitaPorPagamento.reduce((s, p) => s + p.value, 0);
                    const share = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
                    return (
                      <div key={item.name}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                            <span className="text-xs font-medium text-zinc-700 truncate max-w-[90px]">{item.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-400">{share}%</span>
                            <span className="text-xs font-bold text-zinc-800">{fmtK(item.value)}</span>
                          </div>
                        </div>
                        <div className="w-full bg-zinc-100 rounded-full h-2">
                          <div
                            className="h-2 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-zinc-400 text-sm">Sem dados</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
