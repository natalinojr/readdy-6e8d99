import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar, Legend,
} from 'recharts';

interface DayDetail {
  tipo: 'recebivel' | 'conta_pagar' | 'folha' | 'manual_entrada' | 'manual_saida';
  descricao: string;
  valor: number;
}

interface DayPoint {
  date: string;
  label: string;
  // Entradas separadas
  entradasAuto: number;      // recebíveis D+N (verde claro)
  entradasManuais: number;   // entradas manuais (verde escuro)
  // Saídas separadas
  saidasFolha: number;       // folha (vermelho claro)
  saidasContas: number;      // contas a pagar (vermelho escuro)
  saidasManuais: number;     // saídas manuais (laranja)
  // Totais calculados
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  saldoAcumulado: number;
  detalhes: DayDetail[];
}

interface Receivable {
  id: string;
  due_date: string;
  amount: number;
  status: string;
  payment_method_name: string | null;
  order_number: string | null;
}

interface Payable {
  due_date: string;
  amount: number;
  description: string;
}

interface PayrollEntry {
  net_salary: number;
  paid_date: string | null;
  reference_month: string;
  employee_name: string;
}

interface CashFlowEntry {
  date: string;
  amount: number;
  type: 'income' | 'expense';
  origin?: string;
  description?: string;
}

const HORIZON_OPTIONS = [
  { label: '30 dias', days: 30 },
  { label: '60 dias', days: 60 },
  { label: '90 dias', days: 90 },
];

// Paleta de cores das 5 séries
const SERIES_COLORS = {
  entradasAuto: '#4ade80',    // verde claro
  entradasManuais: '#16a34a', // verde escuro
  saidasFolha: '#fca5a5',     // vermelho claro
  saidasContas: '#dc2626',    // vermelho escuro
  saidasManuais: '#f97316',   // laranja
  saldoAcumulado: '#f59e0b',  // âmbar (linha de saldo)
};

const TIPO_CONFIG: Record<DayDetail['tipo'], { label: string; color: string; icon: string; sinal: '+' | '-'; textColor: string }> = {
  recebivel:      { label: 'Recebível D+N',   color: SERIES_COLORS.entradasAuto,    icon: 'ri-bank-card-line',  sinal: '+', textColor: 'text-green-600' },
  manual_entrada: { label: 'Entrada Manual',  color: SERIES_COLORS.entradasManuais, icon: 'ri-add-circle-line', sinal: '+', textColor: 'text-green-800' },
  conta_pagar:    { label: 'Conta a Pagar',   color: SERIES_COLORS.saidasContas,    icon: 'ri-bill-line',       sinal: '-', textColor: 'text-red-700' },
  folha:          { label: 'Folha de Pagto',  color: SERIES_COLORS.saidasFolha,     icon: 'ri-team-line',       sinal: '-', textColor: 'text-red-400' },
  manual_saida:   { label: 'Saída Manual',    color: SERIES_COLORS.saidasManuais,   icon: 'ri-subtract-line',   sinal: '-', textColor: 'text-orange-600' },
};

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(d: Date) {
  return d.toISOString().split('T')[0];
}

/** Retorna a data local do dispositivo no formato YYYY-MM-DD (sem depender de UTC) */
function localDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Tooltip customizado para o gráfico
const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; dataKey: string }[];
  label?: string;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const filtered = payload.filter((p) => p.value > 0);
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs min-w-52 max-w-64">
      <p className="font-bold text-zinc-700 mb-2 border-b border-zinc-100 pb-1.5">{label}</p>
      {filtered.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
            <span className="text-zinc-500">{p.name}</span>
          </div>
          <span className="font-semibold" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// Painel lateral de detalhes do dia clicado
function DayDetailPanel({
  point,
  onClose,
}: {
  point: DayPoint;
  onClose: () => void;
}) {
  const totalEntradas = point.totalEntradas;
  const totalSaidas = point.totalSaidas;

  const entradas = point.detalhes.filter((d) => d.tipo === 'recebivel' || d.tipo === 'manual_entrada');
  const saidas = point.detalhes.filter((d) => d.tipo !== 'recebivel' && d.tipo !== 'manual_entrada');

  return (
    <div className="bg-white border border-zinc-200 rounded-xl flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 bg-zinc-50">
        <div>
          <p className="text-xs text-zinc-400 font-medium">Detalhes do dia</p>
          <p className="text-sm font-bold text-zinc-800">{point.label}</p>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-200 cursor-pointer transition-colors"
        >
          <i className="ri-close-line text-zinc-500 text-sm" />
        </button>
      </div>

      {/* Resumo do dia */}
      <div className="grid grid-cols-2 gap-2 p-3 border-b border-zinc-100">
        <div className="bg-green-50 rounded-lg p-2.5">
          <p className="text-[10px] text-green-600 font-semibold uppercase tracking-wide">Entradas</p>
          <p className="text-sm font-bold text-green-700 mt-0.5">{formatCurrency(totalEntradas)}</p>
        </div>
        <div className="bg-red-50 rounded-lg p-2.5">
          <p className="text-[10px] text-red-600 font-semibold uppercase tracking-wide">Saídas</p>
          <p className="text-sm font-bold text-red-700 mt-0.5">{formatCurrency(totalSaidas)}</p>
        </div>
        <div className={`col-span-2 rounded-lg p-2.5 ${point.saldo >= 0 ? 'bg-amber-50' : 'bg-red-100'}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${point.saldo >= 0 ? 'text-amber-600' : 'text-red-600'}`}>Saldo do Dia</p>
          <p className={`text-sm font-bold mt-0.5 ${point.saldo >= 0 ? 'text-amber-700' : 'text-red-700'}`}>
            {point.saldo >= 0 ? '+' : ''}{formatCurrency(point.saldo)}
          </p>
        </div>
      </div>

      {/* Lista de itens */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {entradas.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Entradas</p>
            <div className="space-y-1.5">
              {entradas.map((d, i) => {
                const cfg = TIPO_CONFIG[d.tipo];
                return (
                  <div key={i} className="flex items-start gap-2 bg-green-50/60 rounded-lg px-2.5 py-2">
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i className={`${cfg.icon} text-xs`} style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</p>
                      <p className="text-xs text-zinc-600 truncate">{d.descricao}</p>
                    </div>
                    <span className="text-xs font-bold text-green-700 whitespace-nowrap">+{formatCurrency(d.valor)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {saidas.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Saídas</p>
            <div className="space-y-1.5">
              {saidas.map((d, i) => {
                const cfg = TIPO_CONFIG[d.tipo];
                return (
                  <div key={i} className="flex items-start gap-2 bg-red-50/40 rounded-lg px-2.5 py-2">
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i className={`${cfg.icon} text-xs`} style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</p>
                      <p className="text-xs text-zinc-600 truncate">{d.descricao}</p>
                    </div>
                    <span className={`text-xs font-bold whitespace-nowrap ${cfg.textColor}`}>-{formatCurrency(d.valor)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {point.detalhes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-300">
            <i className="ri-calendar-line text-3xl mb-2" />
            <p className="text-xs text-zinc-400">Sem movimentações neste dia</p>
          </div>
        )}
      </div>

      {/* Saldo acumulado até o dia */}
      <div className="px-3 py-2.5 border-t border-zinc-100 bg-zinc-50">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Saldo acumulado até {point.label}</span>
          <span className={`text-sm font-bold ${point.saldoAcumulado >= 0 ? 'text-zinc-800' : 'text-red-700'}`}>
            {formatCurrency(point.saldoAcumulado)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function PrevisaoCaixaTab() {
  const { user } = useAuth();
  const [horizon, setHorizon] = useState(30);
  const [loading, setLoading] = useState(true);
  const [projection, setProjection] = useState<DayPoint[]>([]);
  const [saldoAtual, setSaldoAtual] = useState(0);
  const [saldoSource, setSaldoSource] = useState<'banco' | 'razao'>('razao');
  const [totalRecebiveis, setTotalRecebiveis] = useState(0);
  const [totalSaidas, setTotalSaidas] = useState(0);
  const [totalEntradas, setTotalEntradas] = useState(0);
  const [pendingReceivables, setPendingReceivables] = useState<Receivable[]>([]);
  const [viewMode, setViewMode] = useState<'area' | 'bar'>('area');
  const [showDetail, setShowDetail] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<DayPoint | null>(null);

  const toggleDay = (date: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const buildProjection = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setSelectedDay(null);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = addDays(today, horizon);
    const todayStr = localDateKey(today);
    const endDateStr = localDateKey(endDate);

    const [payablesRes, cashFlowsRes, pastFlowsRes, receivablesRes, payrollRes, bankAccountsRes] = await Promise.all([
      supabase
        .from('fin_accounts_payable')
        .select('due_date, amount, description')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'pending')
        .gte('due_date', todayStr)
        .lte('due_date', endDateStr),

      supabase
        .from('fin_cash_flow')
        .select('date, amount, type, origin, description')
        .eq('tenant_id', user.tenantId)
        .gte('date', todayStr)
        .lte('date', endDateStr),

      supabase
        .from('fin_cash_flow')
        .select('amount, type')
        .eq('tenant_id', user.tenantId)
        .lt('date', todayStr),

      supabase
        .from('fin_receivable_installments')
        .select('id, due_date, amount, status, payment_method_name, order_number')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'pending')
        .gte('due_date', todayStr)
        .lte('due_date', endDateStr),

      supabase
        .from('hr_payroll')
        .select('net_salary, paid_date, reference_month, employee_name')
        .eq('tenant_id', user.tenantId)
        .in('status', ['pending', 'processing'])
        .gte('paid_date', todayStr)
        .lte('paid_date', endDateStr),

      supabase
        .from('fin_bank_accounts')
        .select('current_balance')
        .eq('tenant_id', user.tenantId)
        .eq('is_active', true),
    ]);

    // P5: saldo inicial da projeção.
    // Preferimos o saldo bancário real (fin_bank_accounts) quando os bancos estão em uso;
    // se ainda não há saldo em banco (contas não configuradas / sem income routing),
    // caímos no proxy do livro-razão (fin_cash_flow acumulado até ontem).
    const bankBalance = (bankAccountsRes.data ?? []).reduce((s, b) => s + Number(b.current_balance ?? 0), 0);
    const ledgerBalance = (pastFlowsRes.data ?? []).reduce((acc, f) => {
      return acc + (f.type === 'income' ? Number(f.amount) : -Number(f.amount));
    }, 0);
    const usaBanco = Math.abs(bankBalance) > 0.001;
    const currentBalance = usaBanco ? bankBalance : ledgerBalance;
    setSaldoAtual(currentBalance);
    setSaldoSource(usaBanco ? 'banco' : 'razao');

    // Mapa dia a dia com 5 categorias separadas
    const dayMap: Record<string, {
      entradasAuto: number;
      entradasManuais: number;
      saidasFolha: number;
      saidasContas: number;
      saidasManuais: number;
      detalhes: DayDetail[];
    }> = {};

    for (let i = 0; i <= horizon; i++) {
      const d = addDays(today, i);
      dayMap[localDateKey(d)] = {
        entradasAuto: 0,
        entradasManuais: 0,
        saidasFolha: 0,
        saidasContas: 0,
        saidasManuais: 0,
        detalhes: [],
      };
    }

    // Contas a pagar → saídas contas (vermelho escuro)
    (payablesRes.data ?? []).forEach((p: Payable) => {
      const k = p.due_date;
      if (dayMap[k]) {
        dayMap[k].saidasContas += Number(p.amount);
        dayMap[k].detalhes.push({
          tipo: 'conta_pagar',
          descricao: p.description ?? 'Conta a pagar',
          valor: Number(p.amount),
        });
      }
    });

    // Fluxo de caixa → entradas manuais (verde escuro) ou saídas (laranja)
    // Origens automáticas de compras (auto_purchase) vão para saidasContas, não saidasManuais
    const AUTO_PURCHASE_ORIGINS = ['auto_purchase', 'auto_bill_payment'];
    (cashFlowsRes.data ?? []).forEach((f: CashFlowEntry) => {
      const k = f.date;
      if (dayMap[k]) {
        if (f.type === 'income') {
          dayMap[k].entradasManuais += Number(f.amount);
          dayMap[k].detalhes.push({
            tipo: 'manual_entrada',
            descricao: f.description || 'Entrada manual',
            valor: Number(f.amount),
          });
        } else if (f.origin && AUTO_PURCHASE_ORIGINS.includes(f.origin)) {
          // Compras e pagamentos de contas automáticos → saídas contas (vermelho escuro)
          dayMap[k].saidasContas += Number(f.amount);
          dayMap[k].detalhes.push({
            tipo: 'conta_pagar',
            descricao: f.description || 'Compra / Conta paga',
            valor: Number(f.amount),
          });
        } else {
          dayMap[k].saidasManuais += Number(f.amount);
          dayMap[k].detalhes.push({
            tipo: 'manual_saida',
            descricao: f.description || 'Saída manual',
            valor: Number(f.amount),
          });
        }
      }
    });

    // Recebíveis D+N → entradas automáticas (verde claro)
    const receivables = (receivablesRes.data ?? []) as Receivable[];
    receivables.forEach((r) => {
      const k = r.due_date;
      if (dayMap[k]) {
        dayMap[k].entradasAuto += Number(r.amount);
        dayMap[k].detalhes.push({
          tipo: 'recebivel',
          descricao: `Pedido ${r.order_number ?? '—'} · ${r.payment_method_name ?? 'Cartão'}`,
          valor: Number(r.amount),
        });
      }
    });
    setPendingReceivables(receivables);

    // Folha → saídas folha (vermelho claro)
    (payrollRes.data ?? []).forEach((p: PayrollEntry) => {
      const k = p.paid_date;
      if (k && dayMap[k]) {
        dayMap[k].saidasFolha += Number(p.net_salary);
        dayMap[k].detalhes.push({
          tipo: 'folha',
          descricao: `Folha ${p.reference_month}${p.employee_name ? ` — ${p.employee_name}` : ''}`,
          valor: Number(p.net_salary),
        });
      }
    });

    // Monta array de projeção
    let accumulated = currentBalance;
    let sumRecebiveis = 0;
    let sumSaidas = 0;
    let sumEntradas = 0;
    const points: DayPoint[] = [];

    Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([dateStr, vals]) => {
        const d = new Date(dateStr + 'T00:00:00');
        const totalEnt = vals.entradasAuto + vals.entradasManuais;
        const totalSai = vals.saidasContas + vals.saidasFolha + vals.saidasManuais;
        accumulated += totalEnt - totalSai;
        sumRecebiveis += vals.entradasAuto;
        sumSaidas += totalSai;
        sumEntradas += vals.entradasManuais;

        points.push({
          date: dateStr,
          label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          entradasAuto: vals.entradasAuto,
          entradasManuais: vals.entradasManuais,
          saidasFolha: vals.saidasFolha,
          saidasContas: vals.saidasContas,
          saidasManuais: vals.saidasManuais,
          totalEntradas: totalEnt,
          totalSaidas: totalSai,
          saldo: totalEnt - totalSai,
          saldoAcumulado: accumulated,
          detalhes: vals.detalhes,
        });
      });

    setProjection(points);
    setTotalRecebiveis(sumRecebiveis);
    setTotalSaidas(sumSaidas);
    setTotalEntradas(sumEntradas);
    setLoading(false);
  }, [user?.tenantId, horizon]);

  useEffect(() => { buildProjection(); }, [buildProjection]);

  const chartData = useMemo(() => {
    if (horizon <= 30) return projection;
    return projection.filter((_, i) => i % 7 === 0 || i === projection.length - 1);
  }, [projection, horizon]);

  const saldoFinal = projection.length > 0 ? projection[projection.length - 1].saldoAcumulado : saldoAtual;
  const criticalDays = projection.filter((p) => p.saldoAcumulado < 0);
  const temDados = projection.some((p) => p.totalEntradas > 0 || p.totalSaidas > 0);

  const receivablesByMethod = useMemo(() => {
    const map: Record<string, number> = {};
    pendingReceivables.forEach((r) => {
      const key = r.payment_method_name ?? 'Outros';
      map[key] = (map[key] ?? 0) + Number(r.amount);
    });
    return Object.entries(map).sort(([, a], [, b]) => b - a);
  }, [pendingReceivables]);

  const receivablesByWeek = useMemo(() => {
    const map: Record<string, { total: number; count: number; items: Receivable[] }> = {};
    pendingReceivables.forEach((r) => {
      const d = new Date(r.due_date + 'T00:00:00');
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = dateKey(weekStart);
      if (!map[key]) map[key] = { total: 0, count: 0, items: [] };
      map[key].total += Number(r.amount);
      map[key].count += 1;
      map[key].items.push(r);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [pendingReceivables]);

  // Handler de clique no gráfico
  const handleChartClick = (data: { activePayload?: { payload: DayPoint }[] }) => {
    if (data?.activePayload?.[0]?.payload) {
      const point = data.activePayload[0].payload as DayPoint;
      setSelectedDay((prev) => prev?.date === point.date ? null : point);
    }
  };

  const SERIES_LABELS = {
    entradasAuto: 'Recebíveis D+N',
    entradasManuais: 'Entradas Manuais',
    saidasFolha: 'Folha de Pagto',
    saidasContas: 'Contas a Pagar',
    saidasManuais: 'Saídas Manuais',
    saldoAcumulado: 'Saldo Acumulado',
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Fluxo de Caixa Projetado</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Combina entradas D+0, recebíveis de cartão (D+N), contas a pagar e folha
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('area')}
              className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${viewMode === 'area' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
            >
              <i className="ri-line-chart-line mr-1" />Linha
            </button>
            <button
              onClick={() => setViewMode('bar')}
              className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${viewMode === 'bar' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
            >
              <i className="ri-bar-chart-line mr-1" />Barras
            </button>
          </div>
          <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
            {HORIZON_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setHorizon(opt.days)}
                className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${horizon === opt.days ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legenda visual das 5 séries */}
      <div className="bg-white border border-zinc-200 rounded-xl px-4 py-3">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2.5">Legenda do Gráfico</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {/* Entradas */}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.entradasAuto }} />
            <span className="text-xs text-zinc-600">Recebíveis D+N <span className="text-zinc-400">(verde claro)</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.entradasManuais }} />
            <span className="text-xs text-zinc-600">Entradas Manuais <span className="text-zinc-400">(verde escuro)</span></span>
          </div>
          {/* Saídas */}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.saidasFolha }} />
            <span className="text-xs text-zinc-600">Folha de Pagto <span className="text-zinc-400">(vermelho claro)</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.saidasContas }} />
            <span className="text-xs text-zinc-600">Contas a Pagar <span className="text-zinc-400">(vermelho escuro)</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.saidasManuais }} />
            <span className="text-xs text-zinc-600">Saídas Manuais <span className="text-zinc-400">(laranja)</span></span>
          </div>
          {/* Saldo */}
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 flex-shrink-0" style={{ background: SERIES_COLORS.saldoAcumulado }} />
            <span className="text-xs text-zinc-600">Saldo Acumulado <span className="text-zinc-400">(âmbar)</span></span>
          </div>
        </div>
        {!selectedDay && temDados && (
          <p className="text-[10px] text-zinc-400 mt-2.5 flex items-center gap-1">
            <i className="ri-cursor-line" />
            Clique em um ponto do gráfico para ver o detalhamento do dia
          </p>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Saldo Atual',
            value: saldoAtual,
            icon: 'ri-bank-line',
            color: saldoAtual >= 0 ? 'text-green-700' : 'text-red-700',
            bg: saldoAtual >= 0 ? 'bg-green-50' : 'bg-red-50',
            sub: saldoSource === 'banco' ? 'Saldo real das contas bancárias' : 'Estimado pelo caixa (configure os bancos p/ saldo real)',
          },
          {
            label: 'Recebíveis D+N',
            value: totalRecebiveis,
            icon: 'ri-time-line',
            color: 'text-green-600',
            bg: 'bg-green-50',
            sub: `${pendingReceivables.length} parcela(s) a liquidar`,
          },
          {
            label: 'Saídas Previstas',
            value: totalSaidas,
            icon: 'ri-arrow-up-circle-line',
            color: 'text-red-700',
            bg: 'bg-red-50',
            sub: 'Contas a pagar + folha no período',
          },
          {
            label: `Saldo em ${horizon}d`,
            value: saldoFinal,
            icon: 'ri-calendar-check-line',
            color: saldoFinal >= 0 ? 'text-green-700' : 'text-red-700',
            bg: saldoFinal >= 0 ? 'bg-green-50' : 'bg-red-50',
            sub: 'Projeção acumulada',
          },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-zinc-200 p-4">
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 flex items-center justify-center rounded-lg ${kpi.bg} flex-shrink-0`}>
                <i className={`${kpi.icon} ${kpi.color} text-base`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-zinc-500 truncate">{kpi.label}</p>
                <p className={`text-base font-bold ${kpi.color}`}>{formatCurrency(kpi.value)}</p>
                <p className="text-[10px] text-zinc-400 mt-0.5 truncate">{kpi.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Alerta saldo negativo */}
      {criticalDays.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
            <i className="ri-alert-line text-red-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-red-800">Atenção: Saldo negativo previsto</p>
            <p className="text-xs text-red-600 mt-0.5">
              {criticalDays.length} dia(s) com saldo acumulado negativo. Primeiro dia crítico: <strong>{criticalDays[0].label}</strong>
            </p>
          </div>
        </div>
      )}

      {/* Gráfico + Painel lateral */}
      <div className={`flex gap-4 ${selectedDay ? 'items-start' : ''}`}>
        {/* Gráfico principal */}
        <div className={`bg-white rounded-xl border border-zinc-200 p-5 transition-all ${selectedDay ? 'flex-1 min-w-0' : 'w-full'}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-700">Evolução do Saldo Acumulado</h3>
            <span className="text-xs text-zinc-400">
              {selectedDay ? (
                <span className="flex items-center gap-1 text-amber-600">
                  <i className="ri-focus-3-line" />
                  Dia selecionado: {selectedDay.label}
                </span>
              ) : 'Clique em um ponto para detalhar'}
            </span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-2" />
              <span className="text-zinc-400 text-sm">Calculando projeção...</span>
            </div>
          ) : !temDados ? (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-400">
              <i className="ri-line-chart-line text-4xl mb-3 text-zinc-300" />
              <p className="text-sm font-semibold text-zinc-500">Nenhuma movimentação prevista</p>
              <p className="text-xs text-zinc-400 mt-1 text-center max-w-xs">
                Cadastre contas a pagar ou registre vendas com cartão para ver a projeção aqui.
              </p>
            </div>
          ) : viewMode === 'area' ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={chartData}
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              >
                <defs>
                  <linearGradient id="gradSaldo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={SERIES_COLORS.saldoAcumulado} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={SERIES_COLORS.saldoAcumulado} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradEntradasAuto" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={SERIES_COLORS.entradasAuto} stopOpacity={0.12} />
                    <stop offset="95%" stopColor={SERIES_COLORS.entradasAuto} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71717a' }} />
                <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(value) => SERIES_LABELS[value as keyof typeof SERIES_LABELS] ?? value}
                />
                <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} />
                {/* Saldo acumulado — linha principal âmbar */}
                <Area
                  type="monotone"
                  dataKey="saldoAcumulado"
                  name="saldoAcumulado"
                  stroke={SERIES_COLORS.saldoAcumulado}
                  strokeWidth={2.5}
                  fill="url(#gradSaldo)"
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                />
                {/* Entradas automáticas — verde claro */}
                <Area
                  type="monotone"
                  dataKey="entradasAuto"
                  name="entradasAuto"
                  stroke={SERIES_COLORS.entradasAuto}
                  strokeWidth={1.5}
                  fill="url(#gradEntradasAuto)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Entradas manuais — verde escuro */}
                <Area
                  type="monotone"
                  dataKey="entradasManuais"
                  name="entradasManuais"
                  stroke={SERIES_COLORS.entradasManuais}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Saídas folha — vermelho claro */}
                <Area
                  type="monotone"
                  dataKey="saidasFolha"
                  name="saidasFolha"
                  stroke={SERIES_COLORS.saidasFolha}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="4 2"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Saídas contas — vermelho escuro */}
                <Area
                  type="monotone"
                  dataKey="saidasContas"
                  name="saidasContas"
                  stroke={SERIES_COLORS.saidasContas}
                  strokeWidth={1.5}
                  fill="none"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Saídas manuais — laranja */}
                <Area
                  type="monotone"
                  dataKey="saidasManuais"
                  name="saidasManuais"
                  stroke={SERIES_COLORS.saidasManuais}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="3 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={chartData}
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71717a' }} />
                <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(value) => SERIES_LABELS[value as keyof typeof SERIES_LABELS] ?? value}
                />
                <Bar dataKey="entradasAuto" name="entradasAuto" fill={SERIES_COLORS.entradasAuto} radius={[2, 2, 0, 0]} stackId="entradas" />
                <Bar dataKey="entradasManuais" name="entradasManuais" fill={SERIES_COLORS.entradasManuais} radius={[2, 2, 0, 0]} stackId="entradas" />
                <Bar dataKey="saidasFolha" name="saidasFolha" fill={SERIES_COLORS.saidasFolha} radius={[0, 0, 0, 0]} stackId="saidas" />
                <Bar dataKey="saidasContas" name="saidasContas" fill={SERIES_COLORS.saidasContas} radius={[0, 0, 0, 0]} stackId="saidas" />
                <Bar dataKey="saidasManuais" name="saidasManuais" fill={SERIES_COLORS.saidasManuais} radius={[2, 2, 0, 0]} stackId="saidas" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Painel lateral de detalhes do dia */}
        {selectedDay && (
          <div className="w-72 flex-shrink-0" style={{ minHeight: 340 }}>
            <DayDetailPanel
              point={selectedDay}
              onClose={() => setSelectedDay(null)}
            />
          </div>
        )}
      </div>

      {/* Painel de recebíveis por forma de pagamento */}
      {receivablesByMethod.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-800">Recebíveis D+N por Forma de Pagamento</h3>
              <p className="text-xs text-zinc-400 mt-0.5">Valores a liquidar no período de {horizon} dias</p>
            </div>
            <button
              onClick={() => setShowDetail(!showDetail)}
              className="text-xs text-amber-600 hover:text-amber-700 font-semibold cursor-pointer flex items-center gap-1"
            >
              {showDetail ? 'Ocultar detalhes' : 'Ver detalhes'}
              <i className={`${showDetail ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
            </button>
          </div>

          <div className="space-y-2">
            {receivablesByMethod.map(([method, total]) => {
              const pct = totalRecebiveis > 0 ? (total / totalRecebiveis) * 100 : 0;
              return (
                <div key={method}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <i className="ri-bank-card-line text-zinc-400 text-sm" />
                      <span className="text-sm text-zinc-700 font-medium">{method}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-400">{pct.toFixed(1)}%</span>
                      <span className="text-sm font-bold text-green-700">{formatCurrency(total)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: SERIES_COLORS.entradasAuto }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {showDetail && receivablesByWeek.length > 0 && (
            <div className="mt-4 border-t border-zinc-100 pt-4 space-y-3">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Detalhamento por semana</p>
              {receivablesByWeek.map(([weekStart, { total, count, items }]) => {
                const weekEnd = addDays(new Date(weekStart + 'T00:00:00'), 6);
                return (
                  <div key={weekStart} className="bg-zinc-50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-zinc-700">
                        {new Date(weekStart + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                        {' — '}
                        {weekEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400">{count} parcela(s)</span>
                        <span className="text-sm font-bold text-green-700">{formatCurrency(total)}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {items.slice(0, 5).map((r) => (
                        <div key={r.id} className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">
                            {r.order_number ? `#${r.order_number}` : 'Pedido'}
                            {r.payment_method_name ? ` · ${r.payment_method_name}` : ''}
                          </span>
                          <span className="font-medium text-zinc-700">{formatCurrency(r.amount)}</span>
                        </div>
                      ))}
                      {items.length > 5 && (
                        <p className="text-xs text-zinc-400">+{items.length - 5} mais...</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tabela diária (só 30 dias) */}
      {horizon === 30 && !loading && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-700">Detalhamento Diário</h3>
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.entradasAuto }} />
                Recebíveis
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.entradasManuais }} />
                Manuais
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.saidasContas }} />
                Contas
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.saidasFolha }} />
                Folha
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.saidasManuais }} />
                Saídas Manuais
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr>
                  {['Data', 'Recebíveis D+N', 'Entradas Manuais', 'Contas a Pagar', 'Folha', 'Saldo do Dia', 'Saldo Acumulado'].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {projection.filter((p) => p.totalEntradas > 0 || p.totalSaidas > 0).map((p) => (
                  <>
                    <tr
                      key={p.date}
                      onClick={() => {
                        if (p.detalhes.length > 0) toggleDay(p.date);
                        setSelectedDay((prev) => prev?.date === p.date ? null : p);
                      }}
                      className={`transition-colors ${p.saldoAcumulado < 0 ? 'bg-red-50/40' : ''} ${p.detalhes.length > 0 ? 'cursor-pointer hover:bg-zinc-50' : ''}`}
                    >
                      <td className="px-4 py-2.5 text-zinc-700 font-medium whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {p.detalhes.length > 0 && (
                            <i className={`text-zinc-400 text-xs transition-transform ${expandedDays.has(p.date) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}`} />
                          )}
                          {p.label}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: SERIES_COLORS.entradasAuto }}>
                        {p.entradasAuto > 0 ? <span className="font-medium">{formatCurrency(p.entradasAuto)}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: SERIES_COLORS.entradasManuais }}>
                        {p.entradasManuais > 0 ? <span className="font-medium">{formatCurrency(p.entradasManuais)}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: SERIES_COLORS.saidasContas }}>
                        {p.saidasContas > 0 ? <span className="font-medium">{formatCurrency(p.saidasContas)}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: SERIES_COLORS.saidasFolha }}>
                        {p.saidasFolha > 0 ? <span className="font-medium">{formatCurrency(p.saidasFolha)}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className={`px-4 py-2.5 font-semibold whitespace-nowrap ${p.saldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {formatCurrency(p.saldo)}
                      </td>
                      <td className={`px-4 py-2.5 font-bold whitespace-nowrap ${p.saldoAcumulado >= 0 ? 'text-zinc-900' : 'text-red-700'}`}>
                        {formatCurrency(p.saldoAcumulado)}
                      </td>
                    </tr>
                    {expandedDays.has(p.date) && p.detalhes.length > 0 && (
                      <tr key={`${p.date}-detail`} className="bg-zinc-50/60">
                        <td colSpan={7} className="px-6 py-2 pb-3">
                          <div className="space-y-1">
                            {p.detalhes.map((d, idx) => {
                              const cfg = TIPO_CONFIG[d.tipo];
                              const isEntrada = d.tipo === 'recebivel' || d.tipo === 'manual_entrada';
                              return (
                                <div key={idx} className="flex items-center justify-between text-xs py-0.5">
                                  <div className="flex items-center gap-2">
                                    <div className="w-5 h-5 flex items-center justify-center">
                                      <i className={`${cfg.icon} text-xs`} style={{ color: cfg.color }} />
                                    </div>
                                    <span className="font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
                                    <span className="text-zinc-500">{d.descricao}</span>
                                  </div>
                                  <span className={`font-semibold ${isEntrada ? 'text-green-700' : cfg.textColor}`}>
                                    {cfg.sinal}{formatCurrency(d.valor)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
            {projection.filter((p) => p.totalEntradas > 0 || p.totalSaidas > 0).length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                <i className="ri-calendar-line text-3xl mb-2" />
                <p className="text-sm">Nenhuma movimentação prevista no período</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
