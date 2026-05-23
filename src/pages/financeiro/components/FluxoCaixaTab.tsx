import { useState, useMemo } from 'react';
import { useCashFlow, useCostCenters } from '@/hooks/useFinanceiro';
import { formatCurrency } from '@/lib/formatters';
import type { CashFlowEntry } from '@/types/financeiro';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import CalendarioFluxoCaixa from './CalendarioFluxoCaixa';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';

const PERIODS = [
  { label: 'Hoje', value: 'today' },
  { label: 'Semana', value: 'week' },
  { label: 'Mês', value: 'month' },
  { label: 'Personalizado', value: 'custom' },
];

function getPeriodDates(period: string, customStart: string, customEnd: string) {
  const today = new Date().toISOString().split('T')[0];
  if (period === 'today') return { start: today, end: today };
  if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return { start: d.toISOString().split('T')[0], end: today };
  }
  if (period === 'month') return { start: today.slice(0, 7) + '-01', end: today };
  return { start: customStart, end: customEnd };
}

const CATEGORIES = ['Vendas', 'Compras', 'Conta a Pagar', 'Antecipação', 'Sangria', 'Suprimento', 'Outros'];
const PAGE_SIZE = 15;

const originLabel: Record<string, string> = {
  manual: 'Manual', auto_sale: 'Venda', auto_purchase: 'Compra',
  auto_sangria: 'Sangria', auto_anticipation: 'Antecipação',
};

export default function FluxoCaixaTab() {
  const [period, setPeriod] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    type: 'expense', amount: '', description: '', category: 'Outros',
    date: new Date().toISOString().split('T')[0], notes: '', cost_center_id: '',
    payment_method_id: '',
  });

  // Filters
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { start, end } = getPeriodDates(period, customStart, customEnd);
  const { entries, loading, insert, totalEntradas, totalSaidas, saldo } = useCashFlow(start, end);
  const { centers } = useCostCenters();
  const { formasAtivas } = usePaymentMethods();
  const [chartMode, setChartMode] = useState<'saldo' | 'barras'>('saldo');
  const [viewMode, setViewMode] = useState<'lista' | 'calendario'>('lista');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.payment_method_id) {
      alert('Selecione uma forma de pagamento');
      return;
    }
    await insert({ ...form, amount: Number(form.amount), origin: 'manual' } as Partial<CashFlowEntry>);
    setShowModal(false);
    setForm({ type: 'expense', amount: '', description: '', category: 'Outros', date: new Date().toISOString().split('T')[0], notes: '', cost_center_id: '', payment_method_id: '' });
    setPage(1);
  };

  const filtered = useMemo(() => {
    let result = [...entries];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.description.toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q)
      );
    }
    if (filterType !== 'all') result = result.filter(e => e.type === filterType);
    if (filterCategory !== 'all') result = result.filter(e => e.category === filterCategory);
    result.sort((a, b) => {
      const da = a.date, db = b.date;
      return sortDir === 'desc' ? db.localeCompare(da) : da.localeCompare(db);
    });
    return result;
  }, [entries, search, filterType, filterCategory, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeFiltersCount = [filterType !== 'all', filterCategory !== 'all'].filter(Boolean).length;

  const clearFilters = () => {
    setSearch(''); setFilterType('all'); setFilterCategory('all'); setPage(1);
  };

  // Dados para gráfico de saldo acumulado por dia
  const chartData = useMemo(() => {
    const byDay = new Map<string, { entrada: number; saida: number }>();
    [...entries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(e => {
        const prev = byDay.get(e.date) ?? { entrada: 0, saida: 0 };
        if (e.type === 'income') byDay.set(e.date, { ...prev, entrada: prev.entrada + e.amount });
        else byDay.set(e.date, { ...prev, saida: prev.saida + e.amount });
      });

    let acumulado = 0;
    return Array.from(byDay.entries()).map(([date, v]) => {
      acumulado += v.entrada - v.saida;
      return {
        dia: new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
        entrada: v.entrada,
        saida: v.saida,
        saldo: acumulado,
      };
    });
  }, [entries]);

  const handleExport = () => {
    const rows = [
      ['Data', 'Descrição', 'Categoria', 'Origem', 'Tipo', 'Valor'],
      ...filtered.map(e => [
        e.date, e.description, e.category, originLabel[e.origin] ?? e.origin,
        e.type === 'income' ? 'Entrada' : 'Saída',
        e.type === 'income' ? e.amount : -e.amount,
      ]),
      [],
      ['', '', '', '', 'Total Entradas', totalEntradas],
      ['', '', '', '', 'Total Saídas', totalSaidas],
      ['', '', '', '', 'Saldo', saldo],
    ];
    const csv = rows.map(r => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `FluxoCaixa_${start}_${end}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {/* Period selector + View toggle */}
      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => { setPeriod(p.value); setPage(1); }}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${period === p.value ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <>
            <input type="date" value={customStart} onChange={e => { setCustomStart(e.target.value); setPage(1); }} className="border border-zinc-200 rounded-lg px-3 py-2 text-xs bg-white" />
            <span className="text-zinc-400 text-xs">até</span>
            <input type="date" value={customEnd} onChange={e => { setCustomEnd(e.target.value); setPage(1); }} className="border border-zinc-200 rounded-lg px-3 py-2 text-xs bg-white" />
          </>
        )}

        {/* Toggle Lista / Calendário */}
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5 ml-auto">
          <button
            onClick={() => setViewMode('lista')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1 ${viewMode === 'lista' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <i className="ri-list-check" /> Lista
          </button>
          <button
            onClick={() => setViewMode('calendario')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1 ${viewMode === 'calendario' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <i className="ri-calendar-todo-line" /> Calendário
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <div className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-green-50">
            <i className="ri-arrow-down-circle-line text-green-600 text-lg" />
          </div>
          <div>
            <p className="text-xs text-zinc-500">Total Entradas</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(totalEntradas)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-red-50">
            <i className="ri-arrow-up-circle-line text-red-500 text-lg" />
          </div>
          <div>
            <p className="text-xs text-zinc-500">Total Saídas</p>
            <p className="text-lg font-bold text-red-500">{formatCurrency(totalSaidas)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
          <div className={`w-10 h-10 flex items-center justify-center rounded-lg ${saldo >= 0 ? 'bg-amber-50' : 'bg-red-50'}`}>
            <i className={`ri-scales-line text-lg ${saldo >= 0 ? 'text-amber-600' : 'text-red-600'}`} />
          </div>
          <div>
            <p className="text-xs text-zinc-500">Saldo do Período</p>
            <p className={`text-lg font-bold ${saldo >= 0 ? 'text-amber-600' : 'text-red-500'}`}>{formatCurrency(saldo)}</p>
          </div>
        </div>
      </div>

      {viewMode === 'lista' ? (
        <>
          {/* Gráfico de Saldo / Entradas vs Saídas */}
          {chartData.length > 1 && (
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-800">
                    {chartMode === 'saldo' ? 'Saldo Acumulado' : 'Entradas vs Saídas por Dia'}
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {chartMode === 'saldo' ? 'Evolução do saldo ao longo do período' : 'Comparativo diário de movimentações'}
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setChartMode('saldo')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${chartMode === 'saldo' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                  >
                    <i className="ri-line-chart-line mr-1" />Saldo
                  </button>
                  <button
                    onClick={() => setChartMode('barras')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${chartMode === 'barras' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                  >
                    <i className="ri-bar-chart-grouped-line mr-1" />Comparativo
                  </button>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={180}>
                {chartMode === 'saldo' ? (
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="saldoGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="saldoNegGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                    <XAxis dataKey="dia" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(chartData.length / 8) - 1)} />
                    <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={52}
                      tickFormatter={v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v}`} />
                    <Tooltip
                      formatter={(v: number) => [formatCurrency(v), 'Saldo acumulado']}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                    />
                    <ReferenceLine y={0} stroke="#e4e4e7" strokeDasharray="4 4" />
                    <Area
                      type="monotone"
                      dataKey="saldo"
                      stroke={saldo >= 0 ? '#f59e0b' : '#ef4444'}
                      strokeWidth={2.5}
                      fill={saldo >= 0 ? 'url(#saldoGrad)' : 'url(#saldoNegGrad)'}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  </AreaChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                    <XAxis dataKey="dia" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(chartData.length / 8) - 1)} />
                    <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={52}
                      tickFormatter={v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v}`} />
                    <Tooltip
                      formatter={(v: number, name: string) => [formatCurrency(v), name === 'entrada' ? 'Entradas' : 'Saídas']}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                    />
                    <Bar dataKey="entrada" name="entrada" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={24} />
                    <Bar dataKey="saida" name="saida" fill="#f87171" radius={[3, 3, 0, 0]} maxBarSize={24} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar por descrição ou categoria..."
                className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer">
                  <i className="ri-close-line text-zinc-400 text-sm" />
                </button>
              )}
            </div>

            {/* Type quick filter */}
            <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
              {[['all', 'Todos'], ['income', 'Entradas'], ['expense', 'Saídas']].map(([v, l]) => (
                <button key={v} onClick={() => { setFilterType(v as 'all' | 'income' | 'expense'); setPage(1); }}
                  className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterType === v ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
                  {l}
                </button>
              ))}
            </div>

            {/* Advanced filters */}
            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors whitespace-nowrap ${showFilters || activeFiltersCount > 0 ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
            >
              <i className="ri-filter-3-line" />
              Filtros {activeFiltersCount > 0 && <span className="bg-amber-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">{activeFiltersCount}</span>}
            </button>

            {/* Sort direction */}
            <button
              onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 whitespace-nowrap"
              title={sortDir === 'desc' ? 'Mais recentes primeiro' : 'Mais antigos primeiro'}
            >
              <i className={sortDir === 'desc' ? 'ri-sort-desc' : 'ri-sort-asc'} />
              {sortDir === 'desc' ? 'Mais recentes' : 'Mais antigos'}
            </button>

            <button onClick={handleExport}
              className="flex items-center gap-2 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-download-line" /> Exportar CSV
            </button>

            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-3 md:px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-add-line" /> <span className="hidden sm:inline">Nova Movimentação</span><span className="sm:hidden">Nova</span>
            </button>
          </div>

          {/* Advanced filters panel */}
          {showFilters && (
            <div className="bg-white border border-zinc-200 rounded-xl p-4 flex items-end gap-4">
              <div className="flex-1">
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Categoria</label>
                <select
                  value={filterCategory}
                  onChange={e => { setFilterCategory(e.target.value); setPage(1); }}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="all">Todas as categorias</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {activeFiltersCount > 0 && (
                <button onClick={clearFilters} className="px-3 py-2 text-xs text-red-500 hover:bg-red-50 rounded-lg cursor-pointer whitespace-nowrap border border-red-200">
                  Limpar filtros
                </button>
              )}
            </div>
          )}

          {/* Results info */}
          {(search || activeFiltersCount > 0) && (
            <p className="text-xs text-zinc-500">
              {filtered.length} resultado{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
              {entries.length !== filtered.length && ` de ${entries.length} movimentações`}
            </p>
          )}

          {/* Lista */}
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-800">Movimentações</h3>
              <span className="text-xs text-zinc-400">{filtered.length} registros</span>
            </div>
            {loading ? (
              <div className="p-10 text-center text-zinc-400 text-sm">Carregando...</div>
            ) : paginated.length === 0 ? (
              <div className="p-10 text-center">
                <i className="ri-file-search-line text-3xl text-zinc-300 block mb-2" />
                <p className="text-zinc-400 text-sm">Nenhuma movimentação encontrada</p>
                {(search || activeFiltersCount > 0) && (
                  <button onClick={clearFilters} className="text-xs text-amber-600 mt-1 cursor-pointer hover:underline">Limpar filtros</button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-zinc-50">
                {paginated.map(e => (
                  <div key={e.id} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-50 transition-colors">
                    <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${e.type === 'income' ? 'bg-green-100' : 'bg-red-100'}`}>
                      <i className={`text-sm ${e.type === 'income' ? 'ri-arrow-down-line text-green-600' : 'ri-arrow-up-line text-red-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{e.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-zinc-400">{new Date(e.date + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                        <span className="text-zinc-300">·</span>
                        <span className="text-xs bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">{e.category}</span>
                      </div>
                    </div>
                    <p className={`text-sm font-bold whitespace-nowrap ${e.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
                      {e.type === 'income' ? '+' : '-'}{formatCurrency(e.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 bg-zinc-50">
                <p className="text-xs text-zinc-500">
                  Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer">
                    <i className="ri-arrow-left-s-line text-sm" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-semibold cursor-pointer ${page === p ? 'bg-amber-500 text-white' : 'border border-zinc-200 text-zinc-600 hover:bg-white'}`}>
                        {p}
                      </button>
                    );
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer">
                    <i className="ri-arrow-right-s-line text-sm" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <CalendarioFluxoCaixa />
      )}

      {/* Modal Nova Movimentação */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">Nova Movimentação</h3>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="flex gap-2">
                {(['income', 'expense'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t, category: t === 'income' ? 'Vendas' : 'Outros' }))}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${form.type === t ? (t === 'income' ? 'bg-green-500 text-white' : 'bg-red-500 text-white') : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                    <i className={t === 'income' ? 'ri-arrow-down-circle-line' : 'ri-arrow-up-circle-line'} />
                    {t === 'income' ? 'Entrada' : 'Saída'}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Descrição</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder={form.type === 'income' ? 'Ex: Venda avulsa' : 'Ex: Despesa operacional'}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Valor *</label>
                  <input required type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Data *</label>
                  <input required type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Categoria</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Forma de Pagamento *</label>
                  <select required value={form.payment_method_id} onChange={e => setForm(f => ({ ...f, payment_method_id: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    <option value="">Selecione...</option>
                    {formasAtivas.map(pm => <option key={pm.id} value={pm.id}>{pm.nome}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Centro de Custo</label>
                <select value={form.cost_center_id} onChange={e => setForm(f => ({ ...f, cost_center_id: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="">Nenhum</option>
                  {centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">Cancelar</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
