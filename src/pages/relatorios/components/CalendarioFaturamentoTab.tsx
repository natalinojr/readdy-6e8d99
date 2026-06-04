import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import DiaDetalheModal from './DiaDetalheModal';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface DayRevenue {
  date: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
}

interface WeekRow {
  days: (DayRevenue | null)[];
  weekTotal: number;
}

function buildCalendarRows(
  year: number,
  month: number,
  dataMap: Record<string, DayRevenue>
): WeekRow[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (DayRevenue | null)[] = [];

  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push(dataMap[key] ?? { date: key, revenue: 0, orders: 0 });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: WeekRow[] = [];
  for (let w = 0; w < cells.length / 7; w++) {
    const week = cells.slice(w * 7, w * 7 + 7);
    const weekTotal = week.reduce((s, d) => s + (d?.revenue ?? 0), 0);
    rows.push({ days: week, weekTotal });
  }
  return rows;
}

function getWeekdayTotals(rows: WeekRow[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach(({ days }) => {
    days.forEach((d, i) => { if (d) totals[i] += d.revenue; });
  });
  return totals;
}

export default function CalendarioFaturamentoTab() {
  const { user } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dayData, setDayData] = useState<DayRevenue[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthStr = String(month + 1).padStart(2, '0');
      const fromStr = `${year}-${monthStr}-01T00:00:00-03:00`;
      const toStr   = `${year}-${monthStr}-${daysInMonth}T23:59:59-03:00`;

      // ESTRATÉGIA 1: Usar a RPC fn_get_sales_report (igual ao Dashboard) que passa
      // tenant_id explicitamente e não sofre com RLS de múltiplos tenants.
      // A RPC retorna orders_by_day que já tem os dados agrupados por dia.
      const { data: rpcData, error: rpcError } = await supabase.rpc('fn_get_sales_report', {
        p_tenant_id: user.tenantId,
        p_date_from: fromStr,
        p_date_to: toStr,
        p_session_id: null,
      });

      if (!rpcError && rpcData && (rpcData as any).orders_by_day) {
        const ordersByDay = (rpcData as any).orders_by_day as Array<{ day: string; orders: number; revenue: number }>;
        setDayData(ordersByDay.map((d) => ({
          date: d.day,
          revenue: Number(d.revenue ?? 0),
          orders: Number(d.orders ?? 0),
        })));
        setLastUpdated(new Date());
        setLoading(false);
        return;
      }

      // ESTRATÉGIA 2 (fallback): Query direta na tabela orders
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('id, created_at, total_amount')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'delivered')
        .eq('is_training', false)
        .eq('is_draft', false)
        .gte('created_at', fromStr)
        .lte('created_at', toStr);

      if (ordersError) throw ordersError;

      const grouped: Record<string, { revenue: number; count: number }> = {};
      (ordersData ?? []).forEach((o: any) => {
        const key = new Date(o.created_at).toLocaleDateString('en-CA', {
          timeZone: 'America/Sao_Paulo',
        });
        if (!grouped[key]) grouped[key] = { revenue: 0, count: 0 };
        grouped[key].revenue += Number(o.total_amount ?? 0);
        grouped[key].count += 1;
      });

      setDayData(Object.entries(grouped).map(([date, v]) => ({
        date,
        revenue: v.revenue,
        orders: v.count,
      })));
      setLastUpdated(new Date());
    } catch (e) {
      console.error('[CalendarioFaturamento]', e);
      setDayData([]);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, year, month]);

  useEffect(() => { load(); }, [load]);

  // Realtime: atualiza quando um pedido é entregue no mês atual
  useEffect(() => {
    if (!user?.tenantId) return;
    const channel = supabase
      .channel('calendario-orders')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `tenant_id=eq.${user.tenantId}`,
        },
        () => { load(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.tenantId, load]);

  const dataMap = useMemo(() => {
    const m: Record<string, DayRevenue> = {};
    dayData.forEach((d) => { m[d.date] = d; });
    return m;
  }, [dayData]);

  const rows = useMemo(() => buildCalendarRows(year, month, dataMap), [year, month, dataMap]);
  const weekdayTotals = useMemo(() => getWeekdayTotals(rows), [rows]);
  const monthTotal = useMemo(() => dayData.reduce((s, d) => s + d.revenue, 0), [dayData]);

  const revenueValues = useMemo(
    () => dayData.filter((d) => d.revenue > 0).map((d) => d.revenue),
    [dayData]
  );
  const maxRevenue = revenueValues.length > 0 ? Math.max(...revenueValues) : 0;
  const minRevenue = revenueValues.length > 0 ? Math.min(...revenueValues) : 0;

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const monthName = new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="space-y-4 md:space-y-6">
        {/* Header do calendário */}
        <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-4 md:mb-5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center bg-violet-50 rounded-lg">
                <i className="ri-calendar-line text-violet-600 text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 capitalize">{monthName}</h3>
                <p className="text-[11px] text-zinc-400">
                  Faturamento diário
                  {lastUpdated && (
                    <span className="ml-2 text-emerald-500">
                      · atualizado {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={load}
                disabled={loading}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 hover:bg-zinc-50 transition-colors cursor-pointer text-zinc-400 disabled:opacity-50"
                title="Atualizar"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={prevMonth}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 hover:bg-zinc-50 transition-colors cursor-pointer text-zinc-500"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={nextMonth}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 hover:bg-zinc-50 transition-colors cursor-pointer text-zinc-500"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-zinc-400">
              <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin mr-3" />
              <span className="text-sm">Carregando...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[640px]">
                <thead>
                  <tr>
                    {WEEKDAYS.map((d) => (
                      <th
                        key={d}
                        className="bg-violet-50 text-violet-700 text-[11px] font-bold py-2.5 px-3 text-left border border-violet-100"
                      >
                        {d}
                      </th>
                    ))}
                    <th className="bg-violet-50 text-violet-700 text-[11px] font-bold py-2.5 px-3 text-left border border-violet-100 whitespace-nowrap">
                      Total semana
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, wi) => (
                    <tr key={wi}>
                      {row.days.map((day, di) => (
                        <DayCell
                          key={di}
                          day={day}
                          maxRevenue={maxRevenue}
                          minRevenue={minRevenue}
                          onClick={day && day.orders > 0 ? () => setSelectedDate(day.date) : undefined}
                        />
                      ))}
                      <td className="bg-violet-50/60 border border-violet-100 px-3 py-2 align-top">
                        {row.weekTotal > 0 && (
                          <p className="text-xs font-bold text-violet-700 text-right whitespace-nowrap">
                            {fmt(row.weekTotal)}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}

                  {/* Total dia (por coluna) */}
                  <tr className="bg-zinc-50">
                    {weekdayTotals.map((total, i) => (
                      <td key={i} className="border border-zinc-200 px-3 py-2.5 align-top">
                        <p className="text-[10px] font-bold text-zinc-500 mb-0.5">Total dia</p>
                        <p className="text-xs font-bold text-zinc-700 whitespace-nowrap">{fmt(total)}</p>
                      </td>
                    ))}
                    <td className="bg-violet-100 border border-violet-200 px-3 py-2.5 align-top">
                      <p className="text-[10px] font-bold text-violet-600 mb-0.5">Total mês</p>
                      <p className="text-xs font-bold text-violet-800 whitespace-nowrap">{fmt(monthTotal)}</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap items-center gap-4 px-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
              Maior venda
            </span>
            <span className="text-[11px] text-zinc-500">dia com maior faturamento do mês</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-600 border border-rose-200">
              Menor venda
            </span>
            <span className="text-[11px] text-zinc-500">dia com menor faturamento do mês</span>
          </div>
          <div className="flex items-center gap-2">
            <i className="ri-cursor-line text-[11px] text-zinc-400" />
            <span className="text-[11px] text-zinc-500">clique em um dia para ver detalhes</span>
          </div>
        </div>

        {/* Resumo do mês */}
        <MonthSummary dayData={dayData} monthTotal={monthTotal} />
      </div>

      {/* Modal de detalhe do dia */}
      {selectedDate && (
        <DiaDetalheModal
          date={selectedDate}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </>
  );
}

/* ---------- Day Cell ---------- */
interface DayCellProps {
  day: DayRevenue | null;
  maxRevenue: number;
  minRevenue: number;
  onClick?: () => void;
}

function DayCell({ day, maxRevenue, minRevenue, onClick }: DayCellProps) {
  if (!day) {
    return <td className="border border-zinc-100 bg-zinc-50/50 px-3 py-2 h-14" />;
  }

  const isMax = day.revenue > 0 && day.revenue === maxRevenue;
  const isMin = day.revenue > 0 && day.revenue === minRevenue && maxRevenue !== minRevenue;
  const dayNum = parseInt(day.date.split('-')[2], 10);
  const hasData = day.orders > 0;

  return (
    <td
      onClick={onClick}
      className={`border border-zinc-100 px-3 py-2 align-top h-14 transition-colors ${
        hasData
          ? 'hover:bg-violet-50/50 cursor-pointer'
          : ''
      } ${isMax ? 'bg-emerald-50/40' : isMin ? 'bg-rose-50/30' : ''}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-[11px] font-semibold text-zinc-500 leading-none">{dayNum}</span>
        {isMax && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap leading-none">
            Maior venda
          </span>
        )}
        {isMin && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-600 border border-rose-200 whitespace-nowrap leading-none">
            Menor venda
          </span>
        )}
      </div>
      <p className={`text-[11px] font-bold mt-1 text-right whitespace-nowrap ${day.revenue > 0 ? 'text-zinc-700' : 'text-zinc-300'}`}>
        {fmt(day.revenue)}
      </p>
      {day.orders > 0 && (
        <p className="text-[9px] text-zinc-400 text-right">{day.orders} ped.</p>
      )}
    </td>
  );
}

/* ---------- Month Summary ---------- */
interface MonthSummaryProps {
  dayData: DayRevenue[];
  monthTotal: number;
}

function MonthSummary({ dayData, monthTotal }: MonthSummaryProps) {
  const activeDays = dayData.filter((d) => d.revenue > 0);
  const avgDay = activeDays.length > 0 ? monthTotal / activeDays.length : 0;
  const totalOrders = dayData.reduce((s, d) => s + d.orders, 0);

  const best = activeDays.reduce<DayRevenue | null>(
    (b, d) => (!b || d.revenue > b.revenue ? d : b),
    null
  );
  const worst = activeDays.reduce<DayRevenue | null>(
    (w, d) => (!w || d.revenue < w.revenue ? d : w),
    null
  );

  const formatDay = (date: string) =>
    new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <div className="w-8 h-8 flex items-center justify-center bg-violet-50 rounded-lg mb-2">
          <i className="ri-money-dollar-circle-line text-violet-600 text-sm" />
        </div>
        <p className="text-lg font-bold text-zinc-900">{fmt(monthTotal)}</p>
        <p className="text-xs text-zinc-500 mt-0.5">Total do mês</p>
      </div>

      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <div className="w-8 h-8 flex items-center justify-center bg-amber-50 rounded-lg mb-2">
          <i className="ri-calendar-check-line text-amber-600 text-sm" />
        </div>
        <p className="text-lg font-bold text-zinc-900">{fmt(avgDay)}</p>
        <p className="text-xs text-zinc-500 mt-0.5">Média por dia ativo</p>
        <p className="text-[10px] text-zinc-400">{activeDays.length} dia(s) com venda</p>
      </div>

      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <div className="w-8 h-8 flex items-center justify-center bg-emerald-50 rounded-lg mb-2">
          <i className="ri-arrow-up-line text-emerald-600 text-sm" />
        </div>
        <p className="text-lg font-bold text-zinc-900">{best ? fmt(best.revenue) : '—'}</p>
        <p className="text-xs text-zinc-500 mt-0.5">Melhor dia</p>
        {best && <p className="text-[10px] text-zinc-400">{formatDay(best.date)}</p>}
      </div>

      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <div className="w-8 h-8 flex items-center justify-center bg-rose-50 rounded-lg mb-2">
          <i className="ri-shopping-bag-3-line text-rose-600 text-sm" />
        </div>
        <p className="text-lg font-bold text-zinc-900">{totalOrders}</p>
        <p className="text-xs text-zinc-500 mt-0.5">Pedidos no mês</p>
        {worst && <p className="text-[10px] text-zinc-400">Menor: {formatDay(worst.date)}</p>}
      </div>
    </div>
  );
}