import {
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, ShoppingBag, Percent } from 'lucide-react';
import { useSalesReport, useSalesReportBySession } from '@/hooks/useSalesReport';
import { useVisaoGeralExtras } from '@/hooks/useVisaoGeralExtras';
import { useIfoodVendas } from '@/hooks/useIfoodVendas';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import { getPeriodDateObjects, getPeriodoAnterior } from '@/lib/dateUtils';
import type { SessionInfo } from '@/hooks/useSessions';
import FaturamentoAcumuladoCard from './FaturamentoAcumuladoCard';

// Alias local para compatibilidade
const getPeriodDates = getPeriodDateObjects;

// ── Helpers de período ────────────────────────────────────────────────────────

function variacaoPct(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

interface VariacaoBadgeProps { pct: number | null; label?: string; }
function VariacaoBadge({ pct, label }: VariacaoBadgeProps) {
  if (pct === null) return null;
  const positivo = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${positivo ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
      <i className={positivo ? 'ri-arrow-up-line text-[9px]' : 'ri-arrow-down-line text-[9px]'} />
      {Math.abs(pct).toFixed(1)}% {label ?? ''}
    </span>
  );
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// by_destination agora usa origin_type
const DEST_LABELS: Record<string, string> = {
  ifood: 'iFood',
  cashier: 'PDV Caixa',
  waiter: 'PDV Garçom',
  table: 'Mesa (QR)',
  qr_universal: 'QR CODE',
  self_service: 'Autoatendimento',
  delivery: 'Delivery',
  // fallback para destination_type antigo
  immediate: 'Caixa',
  name: 'Por Nome',
  password: 'Por Senha',
};

const PAYMENT_COLORS: Record<string, string> = {
  cash: '#10b981',
  pix: '#06b6d4',
  credit_card: '#f59e0b',
  debit_card: '#f97316',
  meal_voucher: '#8b5cf6',
  other: '#94a3b8',
};

const CAT_COLORS = ['#f59e0b', '#10b981', '#06b6d4', '#f97316', '#8b5cf6', '#ec4899', '#14b8a6', '#a78bfa'];

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  iconBg: string;
  children?: React.ReactNode;
}

function MetricCard({ label, value, sub, icon, iconBg, children }: MetricCardProps) {
  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
      <div className="flex items-start justify-between mb-2 md:mb-3">
        <div className={`w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-lg ${iconBg}`}>{icon}</div>
      </div>
      <p className="text-xl md:text-2xl font-bold text-zinc-900 tracking-tight">{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

interface Props {
  periodo: string;
  externalSession?: SessionInfo | null;
  onSessionChange?: (s: SessionInfo | null) => void;
}

export default function VisaoGeralTab({ periodo, externalSession, onSessionChange: _onSessionChange }: Props) {
  const { modo } = useModoFaturamento();
  const isSessao = modo === 'sessao';

  // Em modo sessão, usa a sessão passada pelo header (externalSession)
  const selectedSession = externalSession ?? null;

  const periodoAnterior = getPeriodoAnterior(periodo);

  // Modo calendário
  const { data: reportCalendario, loading: loadingCalendario, hasRealData: hasCalendario } = useSalesReport(periodo);
  const { data: reportAnteriorCalendario } = useSalesReport(isSessao ? 'Hoje' : periodoAnterior);

  // Modo sessão
  const { data: reportSessao, loading: loadingSessao, hasRealData: hasSessao } = useSalesReportBySession(
    isSessao ? (selectedSession?.id ?? null) : null
  );

  const { data: extras, loading: extrasLoading } = useVisaoGeralExtras(periodo);

  // iFood: pedidos do relatório de conciliação importado (Financeiro › iFood) — só no modo calendário.
  const { data: ifood } = useIfoodVendas(isSessao ? '' : periodo);
  const { data: ifoodAnt } = useIfoodVendas(isSessao ? '' : periodoAnterior);

  const report = isSessao ? reportSessao : reportCalendario;
  const loading = isSessao ? loadingSessao : loadingCalendario;
  const hasRealData = isSessao ? hasSessao : hasCalendario;
  const reportAnterior = isSessao ? null : reportAnteriorCalendario;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-400">
        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-3" />
        <span className="text-sm">Carregando relatório...</span>
      </div>
    );
  }

  // Modo sessão sem sessão selecionada ainda
  if (isSessao && !selectedSession) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-amber-50 rounded-2xl mb-4">
          <i className="ri-store-2-line text-3xl text-amber-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Selecione uma sessão no cabeçalho</p>
        <p className="text-xs text-zinc-400 mt-1">Use o seletor de sessão acima para ver os dados</p>
      </div>
    );
  }

  // Modo sessão selecionada mas sem dados
  if (isSessao && selectedSession && !hasRealData && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-store-2-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Nenhum pedido nesta sessão</p>
        <p className="text-xs text-zinc-400 mt-1">Selecione outra sessão ou registre vendas no PDV</p>
      </div>
    );
  }

  if (!hasRealData && !isSessao && !(ifood && ifood.pedidos > 0)) {
    return (
      <div className="space-y-4 md:space-y-6">
        {/* O acumulado do mês aparece mesmo sem pedido no período (ex.: "Hoje" antes da 1ª venda). */}
        <FaturamentoAcumuladoCard periodo={periodo} />
        <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
          <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
            <i className="ri-bar-chart-2-line text-3xl text-zinc-300" />
          </div>
          <p className="text-sm font-semibold text-zinc-500">Nenhum pedido no período selecionado</p>
          <p className="text-xs text-zinc-400 mt-1">Registre vendas no PDV para ver os dados aqui</p>
          <p className="text-xs text-zinc-300 mt-1">Período: <strong className="text-zinc-400">{periodo}</strong></p>
        </div>
      </div>
    );
  }

  // Mês só com iFood (sem pedido no PDV) não tem relatório do ERP: usa um vazio.
  const rep = (report ?? {
    total_revenue: 0, total_orders: 0, avg_ticket: 0, orders_by_day: [], by_payment: [],
    by_destination: [], top_items: [], top_options: [],
  }) as unknown as NonNullable<typeof report>;

  // Totais = pedidos do ERP + iFood (valor das vendas como no Portal do Parceiro, pela data do pedido).
  const faturamentoErp = Number(rep.total_revenue);
  const ifTot = ifood?.total ?? 0;
  const ifPed = ifood?.pedidos ?? 0;
  const faturamento = faturamentoErp + ifTot;
  const pedidos = rep.total_orders + ifPed;
  const ticketMedio = pedidos > 0 ? faturamento / pedidos : 0;

  const faturamentoAnt = Number(reportAnterior?.total_revenue ?? 0) + (ifoodAnt?.total ?? 0);
  const pedidosAnt = Number(reportAnterior?.total_orders ?? 0) + (ifoodAnt?.pedidos ?? 0);
  const ticketAnt = pedidosAnt > 0 ? faturamentoAnt / pedidosAnt : 0;
  const varFat = isSessao ? null : variacaoPct(faturamento, faturamentoAnt);
  const varPed = isSessao ? null : variacaoPct(pedidos, pedidosAnt);
  const varTkt = isSessao ? null : variacaoPct(ticketMedio, ticketAnt);

  // Label legível do período anterior para os badges de variação
  const labelPeriodoAnt = (() => {
    if (isSessao) return '';
    const { from, to } = getPeriodDates(periodo);
    const diffDias = Math.round((to.getTime() - from.getTime()) / 86400000);
    if (diffDias === 1) return 'vs ontem';
    return `vs ${diffDias}d anteriores`;
  })();

  const diasMap = new Map<string, { erp: number; ifood: number; pedidos: number }>();
  rep.orders_by_day.forEach((d) => diasMap.set(d.day, { erp: Number(d.revenue), ifood: 0, pedidos: d.orders }));
  for (const [dia, v] of Object.entries(ifood?.porDia ?? {})) {
    const x = diasMap.get(dia) ?? { erp: 0, ifood: 0, pedidos: 0 };
    x.ifood += v.valor; x.pedidos += v.pedidos;
    diasMap.set(dia, x);
  }
  const semanalData = [...diasMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({
    dia: new Date(day + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }).slice(0, 6),
    valor: v.erp,
    ifood: Math.round(v.ifood * 100) / 100,
    pedidos: v.pedidos,
  }));

  const paymentTotal = rep.by_payment.reduce((s, p) => s + Number(p.total), 0);
  const paymentData = rep.by_payment.map((p, i) => ({
    forma: p.payment_method ?? p.payment_type ?? 'Outro',
    valor: Number(p.total),
    percentual: paymentTotal > 0 ? Math.round((Number(p.total) / paymentTotal) * 100) : 0,
    transacoes: p.count,
    cor: PAYMENT_COLORS[p.payment_type] ?? Object.values(PAYMENT_COLORS)[i % Object.keys(PAYMENT_COLORS).length],
  }));

  // Cobertura de pagamentos: percentual do faturamento coberto por registros de pagamento
  // Cobertura só sobre o ERP: o iFood é pago no app do iFood e não tem pagamento no caixa.
  const coberturaPayment = faturamentoErp > 0 ? Math.round((paymentTotal / faturamentoErp) * 100) : 0;
  const temPagamentosParciais = paymentData.length > 0 && coberturaPayment < 95;
  const semPagamentos = paymentData.length === 0;

  const destData = rep.by_destination.length > 0 ? rep.by_destination : null;

  // Dados de hora — apenas no modo calendário
  const ifoodHora: Record<number, number> = {};
  for (const [hm, v] of Object.entries(ifood?.porHora ?? {})) {
    const h = Number(hm.slice(0, 2));
    ifoodHora[h] = (ifoodHora[h] ?? 0) + v;
  }
  const hourlyData = !isSessao ? (() => {
    const base = new Map<number, { rev: number; ord: number }>((extras?.by_hour ?? []).map((h) => [h.hour, { rev: h.revenue, ord: h.orders }]));
    for (const h of Object.keys(ifoodHora).map(Number)) if (!base.has(h)) base.set(h, { rev: 0, ord: 0 });
    return [...base.entries()].sort(([a], [b]) => a - b).map(([h, v]) => ({
      hora: `${String(h).padStart(2, '0')}h`,
      valor: Math.round((v.rev + (ifoodHora[h] ?? 0)) * 100) / 100,
      ifood: Math.round((ifoodHora[h] ?? 0) * 100) / 100,
      pedidos: v.ord,
    }));
  })() : [];

  // Categorias — apenas no modo calendário
  const catData = !isSessao ? (extras?.by_category ?? []) : [];
  const catTotal = catData.reduce((s, c) => s + c.total_revenue, 0);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Métricas principais */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <MetricCard
          label="Faturamento líquido"
          value={fmt(faturamento)}
          icon={<TrendingUp size={15} className="text-amber-600" />}
          iconBg="bg-amber-50"
        >
          {!isSessao && <VariacaoBadge pct={varFat} label={labelPeriodoAnt} />}
        </MetricCard>
        <MetricCard
          label="Pedidos finalizados"
          value={pedidos.toString()}
          icon={<ShoppingBag size={15} className="text-emerald-600" />}
          iconBg="bg-emerald-50"
        >
          {!isSessao && <VariacaoBadge pct={varPed} label={labelPeriodoAnt} />}
        </MetricCard>
        <MetricCard
          label="Ticket médio"
          value={fmt(ticketMedio)}
          icon={<Percent size={15} className="text-sky-600" />}
          iconBg="bg-sky-50"
        >
          {!isSessao && <VariacaoBadge pct={varTkt} label={labelPeriodoAnt} />}
        </MetricCard>
      </div>
      {!isSessao && ifPed > 0 && (
        <p className="text-[11px] text-zinc-400 -mt-2">
          <i className="ri-restaurant-2-line text-red-500" /> Inclui iFood: <strong className="text-zinc-600">{fmt(ifTot)}</strong> em {ifPed} pedido(s) — relatório de conciliação importado em Financeiro › iFood (valor das vendas como no Portal do Parceiro, na data do pedido).
        </p>
      )}

      {/* Gráfico semanal + Formas de pagamento */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        {/* Vendas por dia */}
        <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
          <div className="mb-3 md:mb-4">
            <h3 className="text-sm font-semibold text-zinc-800">
              Vendas — {isSessao ? 'por dia na sessão' : periodo}
            </h3>
            <p className="text-xs text-zinc-400">{pedidos} pedidos no total</p>
          </div>
          {semanalData.length > 0 ? (
            <div className="h-40 md:h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={semanalData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} width={32} />
                  <Tooltip formatter={(val: number, name: string) => [fmt(val), name === 'ifood' ? 'iFood' : 'PDV / salão']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }} />
                  <Bar dataKey="valor" stackId="v" fill="#f59e0b" maxBarSize={32} />
                  <Bar dataKey="ifood" stackId="v" fill="#ea1d2c" radius={[4, 4, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-40 md:h-52 flex items-center justify-center text-zinc-300 text-xs">
              Sem dados suficientes para o gráfico
            </div>
          )}
        </div>

        {/* Formas de pagamento */}
        <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <h3 className="text-sm font-semibold text-zinc-800">Formas de Pagamento</h3>

          </div>

          {semPagamentos ? (
            /* Sem nenhum pagamento registrado: mostra o faturamento total com aviso */
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-xl">
                <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
                  <i className="ri-bank-card-line text-amber-600 text-base" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-zinc-900">{fmt(faturamentoErp)}</p>
                  <p className="text-[10px] text-zinc-500">Faturamento do PDV — {rep.total_orders} pedidos</p>
                </div>
              </div>
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-lg">
                <i className="ri-information-line text-amber-500 text-xs flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-700">
                  Pagamentos não registrados individualmente. Os valores foram processados diretamente no PDV.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2.5 md:space-y-3">
                {paymentData.map((f) => (
                  <div key={f.forma} className="flex items-center gap-2 md:gap-3">
                    <div className="w-2 h-2 flex-shrink-0 rounded-full" style={{ backgroundColor: f.cor }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium text-zinc-700 truncate">{f.forma}</span>
                        <span className="text-xs font-semibold text-zinc-800 ml-2 whitespace-nowrap">{fmt(f.valor)}</span>
                      </div>
                      <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${f.percentual}%`, backgroundColor: f.cor }} />
                      </div>
                    </div>
                    <div className="text-right w-12 md:w-14 flex-shrink-0">
                      <p className="text-xs font-semibold text-zinc-600">{f.percentual}%</p>
                      <p className="text-[10px] text-zinc-400 hidden sm:block">{f.transacoes} tran.</p>
                    </div>
                  </div>
                ))}
              </div>
              {/* Aviso de cobertura parcial */}
              {temPagamentosParciais && (
                <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                  <i className="ri-information-line text-amber-500 text-xs flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-700">
                    Cobertura parcial: {coberturaPayment}% do faturamento tem forma de pagamento registrada.
                  </p>
                </div>
              )}
              <div className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-zinc-100 grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-sm md:text-base font-bold text-zinc-900">{fmt(paymentTotal)}</p>
                  <p className="text-[10px] text-zinc-400">Registrado</p>
                </div>
                <div className="text-center">
                  <p className="text-sm md:text-base font-bold text-zinc-900">{paymentData.reduce((a, b) => a + b.transacoes, 0)}</p>
                  <p className="text-[10px] text-zinc-400">Transações</p>
                </div>
                <div className="text-center">
                  <p className="text-sm md:text-base font-bold text-zinc-900">{rep.total_orders}</p>
                  <p className="text-[10px] text-zinc-400">Pedidos</p>
                </div>
              </div>
            </>
          )}
          {!isSessao && ifPed > 0 && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
              <i className="ri-restaurant-2-line text-red-500 text-xs flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-red-700">
                + iFood {fmt(ifTot)} ({ifPed} pedidos) — pago no app do iFood e recebido pelos repasses (Financeiro › iFood), por isso não aparece nas formas de pagamento do caixa.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Faturamento acumulado: mês atual × anterior — apenas modo calendário */}
      {!isSessao && <FaturamentoAcumuladoCard periodo={periodo} />}

      {/* Vendas por hora (gráfico de linha) — apenas modo calendário */}
      {!isSessao && (
        <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-800">Vendas por Hora</h3>
              <p className="text-xs text-zinc-400">Distribuição do faturamento ao longo do dia</p>
            </div>
            {extrasLoading && (
              <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
          {hourlyData.some((h) => h.valor > 0) ? (
            <div className="h-44 md:h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis
                    dataKey="hora"
                    tick={{ fontSize: 9, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                    interval={2}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                    width={36}
                  />
                  <Tooltip
                    formatter={(val: number, name: string) => [fmt(val), name === 'ifood' ? 'Só iFood' : 'Faturamento total']}
                    labelFormatter={(label) => `Hora: ${label}`}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                  />
                  <defs>
                    <linearGradient id="sombra-vendas-hora" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="sombra-vendas-hora-ifood" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ea1d2c" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="#ea1d2c" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="valor"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#sombra-vendas-hora)"
                    dot={false}
                    activeDot={{ r: 4, fill: '#f59e0b' }}
                  />
                  {ifPed > 0 && (
                    <Area type="monotone" dataKey="ifood" stroke="#ea1d2c" strokeWidth={1.5} strokeDasharray="4 3" fill="url(#sombra-vendas-hora-ifood)" dot={false} activeDot={{ r: 3, fill: '#ea1d2c' }} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-44 md:h-56 flex items-center justify-center text-zinc-300 text-xs">
              {extrasLoading ? 'Carregando...' : 'Sem dados de hora para o período'}
            </div>
          )}
        </div>
      )}

      {/* Faturamento por categoria — apenas modo calendário */}
      {!isSessao && catData.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-800">Faturamento por Categoria</h3>
              <p className="text-xs text-zinc-400">Receita gerada por cada categoria do cardápio</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {catData.map((cat, idx) => {
              const pct = catTotal > 0 ? Math.round((cat.total_revenue / catTotal) * 100) : 0;
              const color = CAT_COLORS[idx % CAT_COLORS.length];
              return (
                <div key={cat.category_name} className="flex items-center gap-3">
                  <div className="w-2 h-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-zinc-700 truncate">{cat.category_name}</span>
                      <span className="text-xs font-bold text-zinc-900 ml-2 whitespace-nowrap">{fmt(cat.total_revenue)}</span>
                    </div>
                    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                  <div className="text-right w-20 flex-shrink-0">
                    <p className="text-xs font-semibold text-zinc-600">{pct}%</p>
                    <p className="text-[10px] text-zinc-400">{cat.total_qty} itens</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-4 border-t border-zinc-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500">{catData.length} categorias</span>
            <span className="text-sm font-bold text-zinc-900">{fmt(catTotal)}</span>
          </div>
        </div>
      )}

      {/* Origem dos pedidos */}
      {(destData || (!isSessao && ifPed > 0)) && (
        <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <h3 className="text-sm font-semibold text-zinc-800">Origem dos Pedidos</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
            {(() => {
              const origens = [
                ...(destData ?? []),
                ...(!isSessao && ifPed > 0 ? [{ destination: 'ifood', orders: ifPed, revenue: ifTot }] : []),
              ];
              const total = origens.reduce((s, x) => s + Number(x.revenue), 0);
              const colors = ['#f59e0b', '#10b981', '#06b6d4', '#f97316', '#8b5cf6'];
              return origens.map((d, i) => {
                const pct = total > 0 ? Math.round((Number(d.revenue) / total) * 100) : 0;
                const cor = d.destination === 'ifood' ? '#ea1d2c' : colors[i % colors.length];
                return (
                  <div key={d.destination} className="bg-zinc-50 rounded-xl p-3 md:p-4 text-center">
                    <p className="text-xl md:text-2xl font-black" style={{ color: cor }}>{d.orders}</p>
                    <p className="text-xs font-semibold text-zinc-700 mt-0.5">{DEST_LABELS[d.destination] ?? d.destination}</p>
                    <p className="text-xs text-zinc-400 mt-0.5 hidden sm:block">{fmt(Number(d.revenue))}</p>
                    <p className="text-[10px] font-bold mt-1" style={{ color: cor }}>{pct}%</p>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* Top itens */}
      {rep.top_items.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <h3 className="text-sm font-semibold text-zinc-800">Top Itens Vendidos</h3>
          </div>
          <div className="space-y-2">
            {rep.top_items.slice(0, 8).map((item, idx) => {
              const maxQty = rep.top_items[0]?.total_qty ?? 1;
              return (
                <div key={item.item_name} className="flex items-center gap-2 md:gap-3">
                  <span className={`w-5 h-5 md:w-6 md:h-6 flex items-center justify-center rounded-full text-[10px] font-black flex-shrink-0 ${
                    idx === 0 ? 'bg-amber-100 text-amber-700' : idx === 1 ? 'bg-zinc-100 text-zinc-600' : 'bg-zinc-50 text-zinc-400'
                  }`}>{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-zinc-700 truncate">{item.item_name}</span>
                      <span className="text-xs font-semibold text-zinc-800 ml-2 whitespace-nowrap">{fmt(Number(item.total_revenue))}</span>
                    </div>
                    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full transition-all"
                        style={{ width: `${(item.total_qty / maxQty) * 100}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-bold text-zinc-500 w-7 text-right flex-shrink-0">{item.total_qty}x</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top complementos */}
      {(() => {
        const complementos = (rep.top_options ?? []).filter((o) => Number(o.total_revenue) > 0);
        if (complementos.length === 0) return null;
        const maxRev = Number(complementos[0]?.total_revenue) || 1;
        return (
          <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <h3 className="text-sm font-semibold text-zinc-800">Top Complementos</h3>
              <span className="text-[10px] text-zinc-400">Adicionais escolhidos · por valor</span>
            </div>
            <div className="space-y-2">
              {complementos.slice(0, 8).map((op, idx) => (
                <div key={op.option_name} className="flex items-center gap-2 md:gap-3">
                  <span className={`w-5 h-5 md:w-6 md:h-6 flex items-center justify-center rounded-full text-[10px] font-black flex-shrink-0 ${
                    idx === 0 ? 'bg-emerald-100 text-emerald-700' : idx === 1 ? 'bg-zinc-100 text-zinc-600' : 'bg-zinc-50 text-zinc-400'
                  }`}>{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-zinc-700 truncate">{op.option_name}</span>
                      <span className="text-xs font-semibold text-zinc-800 ml-2 whitespace-nowrap">{fmt(Number(op.total_revenue))}</span>
                    </div>
                    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400 rounded-full transition-all"
                        style={{ width: `${(Number(op.total_revenue) / maxRev) * 100}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-bold text-zinc-500 w-7 text-right flex-shrink-0">{op.total_qty}x</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
