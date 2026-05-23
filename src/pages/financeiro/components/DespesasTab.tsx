import { useState, useMemo } from 'react';
import { useDespesas, type DespesasFilters, type DespesaSource, type DespesaStatus, type DespesaItem, SOURCE_LABELS, SOURCE_COLORS, STATUS_LABELS, STATUS_COLORS } from '@/hooks/useDespesas';
import { formatCurrency } from '@/lib/formatters';
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  AreaChart, Area,
} from 'recharts';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = new Date();
const firstDayOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

function monthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

function dayLabel(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

const ALL_SOURCES: DespesaSource[] = ['bill', 'purchase', 'payroll', 'cashflow', 'anticipation'];
const ALL_STATUSES: DespesaStatus[] = ['paid', 'pending', 'overdue'];

const CATEGORY_COLORS = [
  '#f59e0b', '#10b981', '#6366f1', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
  '#a855f7', '#eab308', '#64748b', '#94a3b8',
];

// ─── Quick period presets ───────────────────────────────────────────────────
const PERIOD_PRESETS = [
  { label: 'Este Mês', get: () => {
    const d = new Date();
    return { start: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, end: new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split('T')[0] };
  }},
  { label: 'Mês Passado', get: () => {
    const d = new Date();
    d.setMonth(d.getMonth()-1);
    return { start: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, end: new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split('T')[0] };
  }},
  { label: 'Últimos 3 Meses', get: () => {
    const end = new Date();
    const start = new Date(); start.setMonth(start.getMonth()-2); start.setDate(1);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }},
  { label: 'Este Ano', get: () => {
    const d = new Date();
    return { start: `${d.getFullYear()}-01-01`, end: d.toISOString().split('T')[0] };
  }},
];

// ─── Export helper ──────────────────────────────────────────────────────────
function exportToCSV(items: DespesaItem[], filename: string) {
  const headers = ['Data', 'Descrição', 'Categoria', 'Fonte', 'Fornecedor', 'Status', 'Valor'];
  const rows = items.map(i => [
    new Date(i.date + 'T12:00:00').toLocaleDateString('pt-BR'),
    i.description,
    i.category,
    SOURCE_LABELS[i.source],
    i.supplier || '',
    STATUS_LABELS[i.status],
    i.amount.toFixed(2).replace('.', ','),
  ]);
  const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Tooltip customizado ────────────────────────────────────────────────────
const PieTooltip = ({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: { percent: number } }[] }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
      <p className="font-semibold text-zinc-700">{p.name}</p>
      <p className="font-bold text-zinc-900 mt-1">{formatCurrency(p.value)}</p>
      <p className="text-zinc-400">{p.payload.percent.toFixed(1)}%</p>
    </div>
  );
};

const BarTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
      <p className="font-semibold text-zinc-700 mb-1">{label}</p>
      <p className="font-bold text-zinc-900">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

// ─── KPI Card ───────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon, color, sub }: {
  label: string; value: string; icon: string; color: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 md:p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${color}`}>
          <i className={`${icon} text-sm`} />
        </div>
      </div>
      <p className="text-xl md:text-2xl font-bold text-zinc-900">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Detalhes Modal ───────────────────────────────────────────────────────────
function DetalhesModal({ item, onClose }: { item: DespesaItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div>
            <h3 className="text-base font-bold text-zinc-900">Detalhes da Despesa</h3>
            <p className="text-xs text-zinc-500">{item.source === 'bill' ? 'Conta a Pagar' : SOURCE_LABELS[item.source]}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ backgroundColor: SOURCE_COLORS[item.source] + '22' }}>
              <i className="ri-file-list-3-line" style={{ color: SOURCE_COLORS[item.source] }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-800">{item.description}</p>
              <p className="text-xs text-zinc-400">{item.category}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-xs text-zinc-500">Valor</p>
              <p className="text-lg font-bold text-zinc-900">{formatCurrency(item.amount)}</p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-xs text-zinc-500">Status</p>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[item.status]}`}>
                {STATUS_LABELS[item.status]}
              </span>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-xs text-zinc-500">Data</p>
              <p className="text-sm font-semibold text-zinc-800">{new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-xs text-zinc-500">Fonte</p>
              <p className="text-sm font-semibold text-zinc-800">{SOURCE_LABELS[item.source]}</p>
            </div>
          </div>

          {item.supplier && (
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-xs text-zinc-500">Fornecedor</p>
              <p className="text-sm font-semibold text-zinc-800">{item.supplier}</p>
            </div>
          )}
          {item.payment_method && (
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-xs text-zinc-500">Forma de Pagamento</p>
              <p className="text-sm font-semibold text-zinc-800">{item.payment_method}</p>
            </div>
          )}
          {item.notes && (
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-xs text-zinc-500">Observações</p>
              <p className="text-sm text-zinc-700">{item.notes}</p>
            </div>
          )}

          <button onClick={onClose}
            className="w-full border border-zinc-200 rounded-lg py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DespesasTab() {
  const [viewMode, setViewMode] = useState<'tabela' | 'graficos' | 'cards' | 'analise'>('tabela');
  const [filters, setFilters] = useState<DespesasFilters>({
    startDate: firstDayOfMonth,
    endDate: lastDayOfMonth,
    categories: [],
    sources: [],
    statuses: [],
    search: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState<'date' | 'amount' | 'category'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [detalhesItem, setDetalhesItem] = useState<DespesaItem | null>(null);

  const { items, summary, loading, refresh } = useDespesas(filters);

  // Categorias únicas para o filtro
  const allCategories = useMemo(() => {
    const set = new Set(items.map(d => d.category));
    return Array.from(set).sort();
  }, [items]);

  // Itens ordenados
  const sortedItems = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortField === 'amount') cmp = a.amount - b.amount;
      else if (sortField === 'category') cmp = a.category.localeCompare(b.category);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [items, sortField, sortDir]);

  const toggleSort = (field: 'date' | 'amount' | 'category') => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const toggleSource = (s: DespesaSource) => {
    setFilters(f => ({
      ...f,
      sources: f.sources.includes(s) ? f.sources.filter(x => x !== s) : [...f.sources, s],
    }));
  };

  const toggleStatus = (s: DespesaStatus) => {
    setFilters(f => ({
      ...f,
      statuses: f.statuses.includes(s) ? f.statuses.filter(x => x !== s) : [...f.statuses, s],
    }));
  };

  const toggleCategory = (c: string) => {
    setFilters(f => ({
      ...f,
      categories: f.categories.includes(c) ? f.categories.filter(x => x !== c) : [...f.categories, c],
    }));
  };

  const clearFilters = () => {
    setFilters({
      startDate: firstDayOfMonth,
      endDate: lastDayOfMonth,
      categories: [],
      sources: [],
      statuses: [],
      search: '',
      minAmount: undefined,
      maxAmount: undefined,
    });
  };

  const hasActiveFilters = filters.categories.length > 0 || filters.sources.length > 0 ||
    filters.statuses.length > 0 || filters.search || filters.minAmount !== undefined || filters.maxAmount !== undefined;

  // Dados para gráficos
  const pieData = summary?.byCategory.map((c, i) => ({
    name: c.category,
    value: c.total,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    percent: summary.total > 0 ? (c.total / summary.total) * 100 : 0,
  })) ?? [];

  const sourceBarData = summary?.bySource.map(s => ({
    name: SOURCE_LABELS[s.source],
    value: s.total,
    color: SOURCE_COLORS[s.source],
  })) ?? [];

  const monthBarData = summary?.byMonth.map(m => ({
    name: monthLabel(m.month),
    total: m.total,
    paid: m.paid,
    pending: m.pending,
  })) ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KpiCard
          label="Total de Despesas"
          value={formatCurrency(summary?.total ?? 0)}
          icon="ri-arrow-up-circle-line"
          color="bg-red-100 text-red-500"
          sub={`${items.length} lançamento(s)`}
        />
        <KpiCard
          label="Pago"
          value={formatCurrency(summary?.paid ?? 0)}
          icon="ri-check-double-line"
          color="bg-green-100 text-green-600"
          sub={summary && summary.total > 0 ? `${((summary.paid / summary.total) * 100).toFixed(0)}% do total` : ''}
        />
        <KpiCard
          label="Pendente"
          value={formatCurrency(summary?.pending ?? 0)}
          icon="ri-time-line"
          color="bg-amber-100 text-amber-600"
        />
        <KpiCard
          label="Vencido"
          value={formatCurrency(summary?.overdue ?? 0)}
          icon="ri-alarm-warning-line"
          color="bg-red-100 text-red-600"
        />
      </div>

      {/* ── Alertas inteligentes ── */}
      {!loading && summary && items.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {summary.overdue > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex-1 min-w-64">
              <i className="ri-alarm-warning-line text-red-500 text-lg flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-red-700">{formatCurrency(summary.overdue)} em despesas vencidas</p>
                <p className="text-xs text-red-500">{items.filter(d => d.status === 'overdue').length} lançamento(s) precisam de atenção</p>
              </div>
            </div>
          )}
          {summary.pending > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex-1 min-w-64">
              <i className="ri-time-line text-amber-600 text-lg flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-700">{formatCurrency(summary.pending)} pendente de pagamento</p>
                <p className="text-xs text-amber-600">{items.filter(d => d.status === 'pending').length} lançamento(s) aguardando</p>
              </div>
            </div>
          )}
          {(() => {
            const days = Math.max(1, Math.ceil((new Date(filters.endDate).getTime() - new Date(filters.startDate).getTime()) / 86400000));
            const avgDaily = (summary?.total ?? 0) / days;
            const prevPeriodAvg = avgDaily * 0.9; // simulação
            const variation = prevPeriodAvg > 0 ? ((avgDaily - prevPeriodAvg) / prevPeriodAvg) * 100 : 0;
            if (variation > 20) {
              return (
                <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex-1 min-w-64">
                  <i className="ri-arrow-up-line text-orange-500 text-lg flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-orange-700">Despesas {variation.toFixed(0)}% acima da média</p>
                    <p className="text-xs text-orange-500">Média diária: {formatCurrency(avgDaily)}</p>
                  </div>
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* ── Controles: filtros + visualização ── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Período */}
            <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-lg px-2 py-1.5">
              <input
                type="date"
                value={filters.startDate}
                onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))}
                className="border-0 text-xs font-semibold text-zinc-700 focus:outline-none bg-transparent w-28"
              />
              <span className="text-zinc-300 text-xs">até</span>
              <input
                type="date"
                value={filters.endDate}
                onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))}
                className="border-0 text-xs font-semibold text-zinc-700 focus:outline-none bg-transparent w-28"
              />
            </div>

            {/* Quick presets */}
            <div className="flex items-center gap-1">
              {PERIOD_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => {
                    const range = p.get();
                    setFilters(f => ({ ...f, startDate: range.start, endDate: range.end }));
                  }}
                  className="px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 whitespace-nowrap"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowFilters(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors border ${
                hasActiveFilters ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              <i className="ri-filter-3-line" />
              Filtros {hasActiveFilters && `(${filters.categories.length + filters.sources.length + filters.statuses.length})`}
            </button>

            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer whitespace-nowrap">
                Limpar
              </button>
            )}

            {/* Export */}
            {items.length > 0 && (
              <button
                onClick={() => exportToCSV(sortedItems, `Despesas_${filters.startDate}_a_${filters.endDate}.csv`)}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-download-line" /> Exportar CSV
              </button>
            )}
          </div>

          {/* Toggle visualização */}
          <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden self-start">
            {([
              { id: 'tabela', label: 'Tabela', icon: 'ri-table-line' },
              { id: 'graficos', label: 'Gráficos', icon: 'ri-bar-chart-grouped-line' },
              { id: 'cards', label: 'Cards', icon: 'ri-layout-grid-line' },
              { id: 'analise', label: 'Análise', icon: 'ri-line-chart-line' },
            ] as const).map(v => (
              <button
                key={v.id}
                onClick={() => setViewMode(v.id)}
                className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1 ${
                  viewMode === v.id ? 'bg-amber-500 text-white' : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <i className={v.icon} /> {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Painel de filtros expandido */}
        {showFilters && (
          <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-4">
            {/* Busca */}
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                placeholder="Buscar por descrição, categoria ou fornecedor..."
                className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Fonte */}
              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-2">Fonte</p>
                <div className="flex flex-wrap gap-2">
                  {ALL_SOURCES.map(s => (
                    <button
                      key={s}
                      onClick={() => toggleSource(s)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${
                        filters.sources.includes(s)
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                      }`}
                    >
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: SOURCE_COLORS[s] }} />
                      {SOURCE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-2">Status</p>
                <div className="flex flex-wrap gap-2">
                  {ALL_STATUSES.map(s => (
                    <button
                      key={s}
                      onClick={() => toggleStatus(s)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${
                        filters.statuses.includes(s)
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                      }`}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Valor */}
              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-2">Faixa de Valor (R$)</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    placeholder="Min"
                    value={filters.minAmount ?? ''}
                    onChange={e => setFilters(f => ({ ...f, minAmount: e.target.value ? parseFloat(e.target.value) : undefined }))}
                    className="w-24 border border-zinc-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-400"
                  />
                  <span className="text-zinc-300 text-xs">até</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="Max"
                    value={filters.maxAmount ?? ''}
                    onChange={e => setFilters(f => ({ ...f, maxAmount: e.target.value ? parseFloat(e.target.value) : undefined }))}
                    className="w-24 border border-zinc-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>
            </div>

            {/* Categorias */}
            {allCategories.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-2">Categorias</p>
                <div className="flex flex-wrap gap-2">
                  {allCategories.map(c => (
                    <button
                      key={c}
                      onClick={() => toggleCategory(c)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${
                        filters.categories.includes(c)
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="py-12 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">Carregando despesas...</p>
          </div>
        </div>
      )}

      {/* ── Vazio ── */}
      {!loading && items.length === 0 && (
        <div className="py-16 text-center">
          <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mx-auto mb-4">
            <i className="ri-pie-chart-2-line text-zinc-400 text-2xl" />
          </div>
          <p className="text-sm font-semibold text-zinc-700">Nenhuma despesa encontrada</p>
          <p className="text-xs text-zinc-400 mt-1">
            {hasActiveFilters ? 'Tente ajustar os filtros' : 'Registre contas a pagar, compras ou folha de pagamento'}
          </p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          VISUALIZAÇÃO: TABELA
         ═══════════════════════════════════════════════════════════════════════ */}
      {!loading && viewMode === 'tabela' && items.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide cursor-pointer hover:text-zinc-700" onClick={() => toggleSort('date')}>
                    <span className="flex items-center gap-1">Data {sortField === 'date' && <i className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />}</span>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Descrição</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide cursor-pointer hover:text-zinc-700" onClick={() => toggleSort('category')}>
                    <span className="flex items-center gap-1">Categoria {sortField === 'category' && <i className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />}</span>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Fonte</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide cursor-pointer hover:text-zinc-700" onClick={() => toggleSort('amount')}>
                    <span className="flex items-center justify-end gap-1">Valor {sortField === 'amount' && <i className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />}</span>
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sortedItems.map(item => (
                  <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-5 py-3 text-sm text-zinc-600 whitespace-nowrap">
                      {new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-zinc-800">{item.description}</p>
                      {item.supplier && <p className="text-xs text-zinc-400">{item.supplier}</p>}
                      {item.notes && <p className="text-xs text-zinc-400 mt-0.5">{item.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-zinc-100 text-zinc-600 px-2 py-1 rounded-full font-medium">{item.category}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_COLORS[item.source] }} />
                        <span className="text-xs text-zinc-500">{SOURCE_LABELS[item.source]}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[item.status]}`}>
                        {STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-right text-zinc-800">
                      {formatCurrency(item.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setDetalhesItem(item)}
                          title="Ver detalhes"
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"
                        >
                          <i className="ri-eye-line text-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-50 border-t-2 border-zinc-200">
                  <td colSpan={5} className="px-5 py-3 text-sm font-bold text-zinc-800">Total</td>
                  <td className="px-4 py-3 text-sm font-bold text-right text-zinc-900">{formatCurrency(summary?.total ?? 0)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          VISUALIZAÇÃO: GRÁFICOS
         ═══════════════════════════════════════════════════════════════════════ */}
      {!loading && viewMode === 'graficos' && items.length > 0 && summary && (
        <div className="space-y-4">
          {/* Gráfico 1: Pizza por Categoria + Barras por Fonte */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Pizza */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Despesas por Categoria</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <ReTooltip content={<PieTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Barras por Fonte */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Despesas por Fonte</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={sourceBarData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={48} />
                  <ReTooltip content={<BarTooltip />} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    {sourceBarData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráfico 2: Evolução mensal */}
          {monthBarData.length > 1 && (
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Evolução Mensal</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthBarData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={48} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReTooltip content={<BarTooltip />} />
                  <Bar dataKey="paid" name="Pago" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} stackId="a" />
                  <Bar dataKey="pending" name="Pendente" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={32} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Gráfico 3: Tendência diária */}
          {summary.dailyTrend.length > 1 && (
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Tendência Diária</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={summary.dailyTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="despesaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#a1a1aa' }} tickFormatter={dayLabel} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={48} />
                  <ReTooltip content={<BarTooltip />} />
                  <Area type="monotone" dataKey="amount" stroke="#ef4444" strokeWidth={2} fill="url(#despesaGrad)" dot={false} activeDot={{ r: 4, fill: '#ef4444' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          VISUALIZAÇÃO: CARDS
         ═══════════════════════════════════════════════════════════════════════ */}
      {!loading && viewMode === 'cards' && items.length > 0 && summary && (
        <div className="space-y-4">
          {/* Cards por categoria */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-800 mb-3">Por Categoria</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {summary.byCategory.map((cat, i) => {
                const pct = summary.total > 0 ? (cat.total / summary.total) * 100 : 0;
                const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
                return (
                  <div key={cat.category} className="bg-white rounded-xl border border-zinc-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <p className="text-sm font-semibold text-zinc-800 truncate">{cat.category}</p>
                    </div>
                    <p className="text-xl font-bold text-zinc-900">{formatCurrency(cat.total)}</p>
                    <div className="mt-2">
                      <div className="w-full bg-zinc-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs text-zinc-400">{cat.count} lançamento(s)</span>
                        <span className="text-xs font-semibold text-zinc-600">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cards por fonte */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-800 mb-3">Por Fonte</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {summary.bySource.map(src => {
                const pct = summary.total > 0 ? (src.total / summary.total) * 100 : 0;
                return (
                  <div key={src.source} className="bg-white rounded-xl border border-zinc-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_COLORS[src.source] }} />
                      <p className="text-sm font-semibold text-zinc-800">{SOURCE_LABELS[src.source]}</p>
                    </div>
                    <p className="text-xl font-bold text-zinc-900">{formatCurrency(src.total)}</p>
                    <div className="mt-2">
                      <div className="w-full bg-zinc-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: SOURCE_COLORS[src.source] }} />
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs text-zinc-400">{src.count} lançamento(s)</span>
                        <span className="text-xs font-semibold text-zinc-600">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cards por status */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-800 mb-3">Por Status</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                { status: 'paid' as DespesaStatus, label: 'Pago', color: 'bg-green-500', value: summary.paid },
                { status: 'pending' as DespesaStatus, label: 'Pendente', color: 'bg-amber-500', value: summary.pending },
                { status: 'overdue' as DespesaStatus, label: 'Vencido', color: 'bg-red-500', value: summary.overdue },
              ]).map(s => {
                const pct = summary.total > 0 ? (s.value / summary.total) * 100 : 0;
                return (
                  <div key={s.status} className="bg-white rounded-xl border border-zinc-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-3 h-3 rounded-full flex-shrink-0 ${s.color}`} />
                      <p className="text-sm font-semibold text-zinc-800">{s.label}</p>
                    </div>
                    <p className="text-xl font-bold text-zinc-900">{formatCurrency(s.value)}</p>
                    <div className="mt-2">
                      <div className="w-full bg-zinc-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${s.color}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs font-semibold text-zinc-600 mt-1.5 text-right">{pct.toFixed(1)}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          VISUALIZAÇÃO: ANÁLISE
         ═══════════════════════════════════════════════════════════════════════ */}
      {!loading && viewMode === 'analise' && items.length > 0 && summary && (
        <div className="space-y-5">
          {/* Row 1: Comparação mês a mês + Top Fornecedores */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Comparação mês a mês */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Comparação Mês a Mês</h3>
              {monthBarData.length > 1 ? (
                <div className="space-y-3">
                  {monthBarData.map((m, i) => {
                    const prev = monthBarData[i - 1];
                    const variation = prev ? ((m.total - prev.total) / prev.total) * 100 : 0;
                    const isFirst = i === 0;
                    return (
                      <div key={m.name} className="flex items-center gap-3">
                        <div className="w-20 text-xs font-medium text-zinc-600">{m.name}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-zinc-100 rounded-full h-2.5 overflow-hidden">
                              <div
                                className="h-2.5 rounded-full bg-amber-500 transition-all"
                                style={{ width: `${summary.total > 0 ? (m.total / Math.max(...monthBarData.map(d => d.total))) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-zinc-800 w-20 text-right">{formatCurrency(m.total)}</span>
                          </div>
                        </div>
                        {!isFirst && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${variation >= 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                            {variation >= 0 ? '+' : ''}{variation.toFixed(1)}%
                          </span>
                        )}
                        {isFirst && <span className="text-xs text-zinc-400 w-16 text-right">—</span>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-zinc-400 text-center py-8">Dados de múltiplos meses necessários para comparação</p>
              )}
            </div>

            {/* Top Fornecedores */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Top Fornecedores</h3>
              {(() => {
                const supplierMap: Record<string, { total: number; count: number }> = {};
                items.filter(d => d.supplier).forEach(d => {
                  const key = d.supplier!;
                  if (!supplierMap[key]) supplierMap[key] = { total: 0, count: 0 };
                  supplierMap[key].total += d.amount;
                  supplierMap[key].count += 1;
                });
                const topSuppliers = Object.entries(supplierMap)
                  .sort((a, b) => b[1].total - a[1].total)
                  .slice(0, 8);
                const maxVal = topSuppliers[0]?.[1].total ?? 1;

                if (topSuppliers.length === 0) {
                  return <p className="text-sm text-zinc-400 text-center py-8">Nenhum fornecedor identificado</p>;
                }

                return (
                  <div className="space-y-3">
                    {topSuppliers.map(([name, data], i) => {
                      const pct = (data.total / (summary?.total ?? 1)) * 100;
                      return (
                        <div key={name}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-zinc-400 w-5">{i + 1}.</span>
                              <span className="text-sm font-medium text-zinc-700">{name}</span>
                              <span className="text-xs text-zinc-400">({data.count}x)</span>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-bold text-zinc-800">{formatCurrency(data.total)}</span>
                              <span className="text-xs text-zinc-400 ml-2">{pct.toFixed(1)}%</span>
                            </div>
                          </div>
                          <div className="w-full bg-zinc-100 rounded-full h-1.5 ml-7">
                            <div
                              className="h-1.5 rounded-full bg-amber-500 transition-all"
                              style={{ width: `${(data.total / maxVal) * 100}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Row 2: Calendário de Vencimentos + Evolução Acumulada */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Calendário de Vencimentos */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Calendário de Vencimentos — {monthLabel(filters.startDate.slice(0, 7))}</h3>
              {(() => {
                const pendingItems = items.filter(d => d.status === 'pending' || d.status === 'overdue');
                if (pendingItems.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <div className="w-12 h-12 flex items-center justify-center bg-green-50 rounded-xl mx-auto mb-3">
                        <i className="ri-check-line text-green-500 text-lg" />
                      </div>
                      <p className="text-sm font-medium text-zinc-600">Tudo em dia!</p>
                      <p className="text-xs text-zinc-400 mt-1">Nenhuma despesa pendente no período</p>
                    </div>
                  );
                }

                // Agrupa por dia
                const byDay: Record<number, DespesaItem[]> = {};
                pendingItems.forEach(d => {
                  const day = parseInt(d.date.split('-')[2]) || 1;
                  if (!byDay[day]) byDay[day] = [];
                  byDay[day].push(d);
                });

                const days = Object.keys(byDay).map(Number).sort((a, b) => a - b);
                const today = new Date().getDate();

                return (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {days.map(day => {
                      const isOverdue = day < today;
                      const dayTotal = byDay[day].reduce((s, d) => s + d.amount, 0);
                      return (
                        <div key={day} className={`rounded-lg border p-3 ${isOverdue ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isOverdue ? 'bg-red-200 text-red-700' : 'bg-amber-200 text-amber-700'}`}>
                                Dia {String(day).padStart(2, '0')}
                              </span>
                              {isOverdue && <span className="text-xs text-red-500 font-medium">Vencido</span>}
                            </div>
                            <span className="text-sm font-bold text-zinc-800">{formatCurrency(dayTotal)}</span>
                          </div>
                          <div className="space-y-1">
                            {byDay[day].map(item => (
                              <div key={item.id} className="flex items-center justify-between text-xs">
                                <span className="text-zinc-600 truncate flex-1">{item.description}</span>
                                <span className="font-medium text-zinc-800 ml-2">{formatCurrency(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Evolução Acumulada */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Evolução Acumulada no Período</h3>
              {summary.dailyTrend.length > 1 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={(() => {
                    let acc = 0;
                    return summary.dailyTrend.map(d => {
                      acc += d.amount;
                      return { ...d, accumulated: acc };
                    });
                  })()} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#a1a1aa' }} tickFormatter={dayLabel} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={48} />
                    <ReTooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
                          <p className="font-semibold text-zinc-700 mb-1">{dayLabel(label ?? '')}</p>
                          <p className="text-zinc-500">Dia: {formatCurrency(payload[0].payload.amount)}</p>
                          <p className="font-bold text-amber-700">Acumulado: {formatCurrency(payload[0].payload.accumulated)}</p>
                        </div>
                      );
                    }} />
                    <Area type="monotone" dataKey="accumulated" stroke="#f59e0b" strokeWidth={2} fill="url(#accGrad)" dot={false} activeDot={{ r: 4, fill: '#f59e0b' }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-zinc-400 text-center py-8">Dados insuficientes para evolução acumulada</p>
              )}
            </div>
          </div>

          {/* Row 3: Distribuição por Status + Média Diária */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Distribuição por Status - Donut */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Distribuição por Status</h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Pago', value: summary.paid, color: '#10b981' },
                      { name: 'Pendente', value: summary.pending, color: '#f59e0b' },
                      { name: 'Vencido', value: summary.overdue, color: '#ef4444' },
                    ].filter(d => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {[
                      { name: 'Pago', value: summary.paid, color: '#10b981' },
                      { name: 'Pendente', value: summary.pending, color: '#f59e0b' },
                      { name: 'Vencido', value: summary.overdue, color: '#ef4444' },
                    ].filter(d => d.value > 0).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <ReTooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0];
                    const pct = summary.total > 0 ? (p.value / summary.total) * 100 : 0;
                    return (
                      <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
                        <p className="font-semibold text-zinc-700">{p.name}</p>
                        <p className="font-bold text-zinc-900 mt-1">{formatCurrency(Number(p.value))}</p>
                        <p className="text-zinc-400">{pct.toFixed(1)}%</p>
                      </div>
                    );
                  }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Média Diária / Semanal */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Resumo do Período</h3>
              {(() => {
                const days = Math.max(1, Math.ceil((new Date(filters.endDate).getTime() - new Date(filters.startDate).getTime()) / 86400000));
                const avgDaily = (summary?.total ?? 0) / days;
                const avgPerItem = items.length > 0 ? (summary?.total ?? 0) / items.length : 0;
                const maxDay = summary?.dailyTrend.reduce((max, d) => d.amount > max.amount ? d : max, summary.dailyTrend[0]);
                const paidPct = summary && summary.total > 0 ? (summary.paid / summary.total) * 100 : 0;

                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-zinc-50 rounded-xl p-4 text-center">
                      <p className="text-xs text-zinc-500 mb-1">Média Diária</p>
                      <p className="text-lg font-bold text-zinc-900">{formatCurrency(avgDaily)}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">em {days} dias</p>
                    </div>
                    <div className="bg-zinc-50 rounded-xl p-4 text-center">
                      <p className="text-xs text-zinc-500 mb-1">Média por Lançamento</p>
                      <p className="text-lg font-bold text-zinc-900">{formatCurrency(avgPerItem)}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{items.length} itens</p>
                    </div>
                    <div className="bg-zinc-50 rounded-xl p-4 text-center">
                      <p className="text-xs text-zinc-500 mb-1">Dia Mais Alto</p>
                      <p className="text-lg font-bold text-zinc-900">{formatCurrency(maxDay?.amount ?? 0)}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{maxDay ? dayLabel(maxDay.date) : '—'}</p>
                    </div>
                    <div className="bg-zinc-50 rounded-xl p-4 text-center">
                      <p className="text-xs text-zinc-500 mb-1">% Quitado</p>
                      <p className="text-lg font-bold text-green-600">{paidPct.toFixed(1)}%</p>
                      <p className="text-xs text-zinc-400 mt-0.5">do total do período</p>
                    </div>
                  </div>
                );
              })()}

              {/* Maiores despesas do período */}
              <div className="mt-4">
                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">Maiores Despesas do Período</h4>
                <div className="space-y-2">
                  {[...items].sort((a, b) => b.amount - a.amount).slice(0, 5).map((item, i) => (
                    <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-zinc-50 transition-colors">
                      <span className="text-xs font-bold text-zinc-400 w-5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-800 truncate">{item.description}</p>
                        <p className="text-xs text-zinc-400">{item.category} — {new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
                      </div>
                      <span className="text-sm font-bold text-zinc-800">{formatCurrency(item.amount)}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[item.status]}`}>
                        {STATUS_LABELS[item.status]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de detalhes */}
      {detalhesItem && (
        <DetalhesModal item={detalhesItem} onClose={() => setDetalhesItem(null)} />
      )}
    </div>
  );
}