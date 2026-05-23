import { useState, useMemo } from 'react';
import {
  useReceitas, useInsertReceitaManual,
  type ReceitasFilters, type ReceitaSource, type ReceitaItem,
  SOURCE_LABELS_R, SOURCE_COLORS_R,
} from '@/hooks/useReceitas';
import { formatCurrency } from '@/lib/formatters';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = new Date();
const firstDayOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

function dayLabel(d: string) {
  const [, m, day] = d.split('-').map(Number);
  return `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

const PERIOD_PRESETS = [
  { label: 'Este Mês', get: () => {
    const d = new Date();
    return { start: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, end: new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split('T')[0] };
  }},
  { label: 'Mês Passado', get: () => {
    const d = new Date(); d.setMonth(d.getMonth()-1);
    return { start: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, end: new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split('T')[0] };
  }},
  { label: 'Últimos 3 Meses', get: () => {
    const end = new Date(); const start = new Date(); start.setMonth(start.getMonth()-2); start.setDate(1);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }},
  { label: 'Este Ano', get: () => {
    const d = new Date();
    return { start: `${d.getFullYear()}-01-01`, end: d.toISOString().split('T')[0] };
  }},
];

const CATEGORY_COLORS = [
  '#10b981', '#f59e0b', '#6366f1', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
];

const RECEITA_CATEGORIES = [
  'Salão', 'Delivery', 'PDV / Caixa', 'Totem', 'Outros',
  'Serviços', 'Aluguel', 'Eventos', 'Gorjeta', 'Taxa de Serviço',
];

function exportToCSV(items: ReceitaItem[], filename: string) {
  const headers = ['Data', 'Descrição', 'Categoria', 'Fonte', 'Origem', 'Valor'];
  const rows = items.map(i => [
    new Date(i.date + 'T12:00:00').toLocaleDateString('pt-BR'),
    i.description,
    i.category,
    SOURCE_LABELS_R[i.source],
    i.origin_detail || '',
    i.amount.toFixed(2).replace('.', ','),
  ]);
  const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name?: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs">
      {label && <p className="font-semibold text-zinc-700 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="font-bold text-zinc-900">{p.name ? `${p.name}: ` : ''}{formatCurrency(p.value)}</p>
      ))}
    </div>
  );
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon, color, sub }: { label: string; value: string; icon: string; color: string; sub?: string }) {
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

// ─── Modal de Lançamento Manual ───────────────────────────────────────────────
function NovaReceitaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { insert, saving } = useInsertReceitaManual();
  const [form, setForm] = useState({
    description: '',
    amount: '',
    date: today.toISOString().split('T')[0],
    category: 'Outros',
    notes: '',
  });
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!form.description.trim()) { setError('Informe a descrição'); return; }
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError('Informe um valor válido'); return; }
    setError('');
    const { error: err } = await insert({
      description: form.description.trim(),
      amount,
      date: form.date,
      category: form.category,
      notes: form.notes.trim() || undefined,
    });
    if (err) { setError(err); return; }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div>
            <h3 className="text-base font-bold text-zinc-900">Nova Receita Manual</h3>
            <p className="text-xs text-zinc-500">Lançamento de receita sem pedido no sistema</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Descrição */}
          <div>
            <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Descrição *</label>
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Ex: Venda de almoço executivo, Evento corporativo..."
              className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            />
          </div>

          {/* Valor + Data */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Valor (R$) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400 font-semibold">R$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0,00"
                  className="w-full border border-zinc-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Data *</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
          </div>

          {/* Categoria */}
          <div>
            <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Categoria</label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
            >
              {RECEITA_CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Observações */}
          <div>
            <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Observações</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Informações adicionais..."
              rows={2}
              maxLength={500}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              Cancelar
            </button>
            <button onClick={handleSubmit} disabled={saving}
              className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-add-line" />}
              {saving ? 'Salvando...' : 'Lançar Receita'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ReceitasTab() {
  const [viewMode, setViewMode] = useState<'tabela' | 'graficos' | 'analise'>('tabela');
  const [filters, setFilters] = useState<ReceitasFilters>({
    startDate: firstDayOfMonth,
    endDate: lastDayOfMonth,
    categories: [],
    sources: [],
    search: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [showNovaReceita, setShowNovaReceita] = useState(false);
  const [sortField, setSortField] = useState<'date' | 'amount' | 'category'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { items, summary, loading, refresh } = useReceitas(filters);

  const allCategories = useMemo(() => {
    const set = new Set(items.map(r => r.category));
    return Array.from(set).sort();
  }, [items]);

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

  const toggleSource = (s: ReceitaSource) => {
    setFilters(f => ({
      ...f,
      sources: f.sources.includes(s) ? f.sources.filter(x => x !== s) : [...f.sources, s],
    }));
  };

  const toggleCategory = (c: string) => {
    setFilters(f => ({
      ...f,
      categories: f.categories.includes(c) ? f.categories.filter(x => x !== c) : [...f.categories, c],
    }));
  };

  const clearFilters = () => {
    setFilters({ startDate: firstDayOfMonth, endDate: lastDayOfMonth, categories: [], sources: [], search: '', minAmount: undefined, maxAmount: undefined });
  };

  const hasActiveFilters = filters.categories.length > 0 || filters.sources.length > 0 ||
    filters.search || filters.minAmount !== undefined || filters.maxAmount !== undefined;

  const pieData = (summary?.byCategory ?? []).map((c, i) => ({
    name: c.category,
    value: c.total,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    percent: (summary?.total ?? 0) > 0 ? (c.total / (summary?.total ?? 1)) * 100 : 0,
  }));

  const sourceBarData = (summary?.bySource ?? []).map(s => ({
    name: SOURCE_LABELS_R[s.source],
    value: s.total,
    color: SOURCE_COLORS_R[s.source],
  }));

  const monthBarData = (summary?.byMonth ?? []).map(m => ({
    name: monthLabel(m.month),
    total: m.total,
  }));

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KpiCard
          label="Total de Receitas"
          value={formatCurrency(summary?.total ?? 0)}
          icon="ri-arrow-down-circle-line"
          color="bg-green-100 text-green-600"
          sub={`${items.length} lançamento(s)`}
        />
        <KpiCard
          label="Vendas (Pedidos)"
          value={formatCurrency(summary?.fromOrders ?? 0)}
          icon="ri-shopping-bag-3-line"
          color="bg-emerald-100 text-emerald-600"
          sub={`${items.filter(r => r.source === 'order').length} pedido(s) pago(s)`}
        />
        <KpiCard
          label="Lançamentos Manuais"
          value={formatCurrency(summary?.fromManual ?? 0)}
          icon="ri-edit-box-line"
          color="bg-amber-100 text-amber-600"
          sub={`${items.filter(r => r.source === 'manual').length} lançamento(s)`}
        />
        <KpiCard
          label="Média Diária"
          value={formatCurrency((() => {
            const days = Math.max(1, Math.ceil((new Date(filters.endDate).getTime() - new Date(filters.startDate).getTime()) / 86400000));
            return (summary?.total ?? 0) / days;
          })())}
          icon="ri-line-chart-line"
          color="bg-zinc-100 text-zinc-600"
          sub="no período selecionado"
        />
      </div>

      {/* ── Controles ── */}
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
                <button key={p.label}
                  onClick={() => { const r = p.get(); setFilters(f => ({ ...f, startDate: r.start, endDate: r.end })); }}
                  className="px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 whitespace-nowrap">
                  {p.label}
                </button>
              ))}
            </div>

            <button onClick={() => setShowFilters(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors border ${
                hasActiveFilters ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
              }`}>
              <i className="ri-filter-3-line" />
              Filtros {hasActiveFilters && `(${filters.categories.length + filters.sources.length})`}
            </button>

            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer whitespace-nowrap">
                Limpar
              </button>
            )}

            {items.length > 0 && (
              <button onClick={() => exportToCSV(sortedItems, `Receitas_${filters.startDate}_a_${filters.endDate}.csv`)}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors">
                <i className="ri-download-line" /> Exportar CSV
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 self-start">
            {/* Toggle visualização */}
            <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
              {([
                { id: 'tabela', icon: 'ri-table-line', label: 'Tabela' },
                { id: 'graficos', icon: 'ri-bar-chart-grouped-line', label: 'Gráficos' },
                { id: 'analise', icon: 'ri-line-chart-line', label: 'Análise' },
              ] as const).map(v => (
                <button key={v.id} onClick={() => setViewMode(v.id)}
                  className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1 ${
                    viewMode === v.id ? 'bg-green-500 text-white' : 'text-zinc-500 hover:text-zinc-800'
                  }`}>
                  <i className={v.icon} /> {v.label}
                </button>
              ))}
            </div>

            {/* Botão nova receita */}
            <button onClick={() => setShowNovaReceita(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-add-line" /> Nova Receita
            </button>
          </div>
        </div>

        {/* Painel de filtros */}
        {showFilters && (
          <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-4">
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                placeholder="Buscar por descrição, categoria ou origem..."
                className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-green-400"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Fonte */}
              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-2">Fonte</p>
                <div className="flex flex-wrap gap-2">
                  {(['order', 'manual'] as ReceitaSource[]).map(s => (
                    <button key={s} onClick={() => toggleSource(s)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${
                        filters.sources.includes(s) ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                      }`}>
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: SOURCE_COLORS_R[s] }} />
                      {SOURCE_LABELS_R[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Faixa de valor */}
              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-2">Faixa de Valor (R$)</p>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} placeholder="Min"
                    value={filters.minAmount ?? ''}
                    onChange={e => setFilters(f => ({ ...f, minAmount: e.target.value ? parseFloat(e.target.value) : undefined }))}
                    className="w-24 border border-zinc-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-green-400"
                  />
                  <span className="text-zinc-300 text-xs">até</span>
                  <input type="number" min={0} placeholder="Max"
                    value={filters.maxAmount ?? ''}
                    onChange={e => setFilters(f => ({ ...f, maxAmount: e.target.value ? parseFloat(e.target.value) : undefined }))}
                    className="w-24 border border-zinc-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-green-400"
                  />
                </div>
              </div>

              {/* Categorias */}
              {allCategories.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-600 mb-2">Categorias</p>
                  <div className="flex flex-wrap gap-2">
                    {allCategories.map(c => (
                      <button key={c} onClick={() => toggleCategory(c)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${
                          filters.categories.includes(c) ? 'bg-green-500 text-white border-green-500' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                        }`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="py-12 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">Carregando receitas...</p>
          </div>
        </div>
      )}

      {/* ── Vazio ── */}
      {!loading && items.length === 0 && (
        <div className="py-16 text-center">
          <div className="w-14 h-14 flex items-center justify-center bg-green-50 rounded-2xl mx-auto mb-4">
            <i className="ri-arrow-down-circle-line text-green-400 text-2xl" />
          </div>
          <p className="text-sm font-semibold text-zinc-700">Nenhuma receita encontrada</p>
          <p className="text-xs text-zinc-400 mt-1">
            {hasActiveFilters ? 'Tente ajustar os filtros' : 'Pedidos pagos e lançamentos manuais aparecerão aqui'}
          </p>
          <button onClick={() => setShowNovaReceita(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap">
            <i className="ri-add-line" /> Lançar Receita Manual
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          TABELA
         ═══════════════════════════════════════════════════════════════════════ */}
      {!loading && viewMode === 'tabela' && items.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide cursor-pointer hover:text-zinc-700"
                    onClick={() => toggleSort('date')}>
                    <span className="flex items-center gap-1">
                      Data {sortField === 'date' && <i className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />}
                    </span>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Descrição</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide cursor-pointer hover:text-zinc-700"
                    onClick={() => toggleSort('category')}>
                    <span className="flex items-center gap-1">
                      Categoria {sortField === 'category' && <i className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />}
                    </span>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Fonte</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide cursor-pointer hover:text-zinc-700"
                    onClick={() => toggleSort('amount')}>
                    <span className="flex items-center justify-end gap-1">
                      Valor {sortField === 'amount' && <i className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />}
                    </span>
                  </th>
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
                      {item.origin_detail && <p className="text-xs text-zinc-400">{item.origin_detail}</p>}
                      {item.notes && <p className="text-xs text-zinc-400 mt-0.5">{item.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full font-medium">{item.category}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_COLORS_R[item.source] }} />
                        <span className="text-xs text-zinc-500">{SOURCE_LABELS_R[item.source]}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-right text-green-700">
                      {formatCurrency(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-50 border-t-2 border-zinc-200">
                  <td colSpan={4} className="px-5 py-3 text-sm font-bold text-zinc-800">Total</td>
                  <td className="px-4 py-3 text-sm font-bold text-right text-green-700">{formatCurrency(summary?.total ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          GRÁFICOS
         ═══════════════════════════════════════════════════════════════════════ */}
      {!loading && viewMode === 'graficos' && items.length > 0 && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Pizza por categoria */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Receitas por Categoria</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" nameKey="name">
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <ReTooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0];
                    return (
                      <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs">
                        <p className="font-semibold text-zinc-700">{p.name}</p>
                        <p className="font-bold text-zinc-900 mt-1">{formatCurrency(Number(p.value))}</p>
                        <p className="text-zinc-400">{(p.payload as { percent: number }).percent.toFixed(1)}%</p>
                      </div>
                    );
                  }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Barras por fonte */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Receitas por Fonte</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={sourceBarData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={48} />
                  <ReTooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={60}>
                    {sourceBarData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Evolução mensal */}
          {monthBarData.length > 1 && (
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Evolução Mensal</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthBarData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={48} />
                  <ReTooltip content={<ChartTooltip />} />
                  <Bar dataKey="total" name="Receita" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tendência diária */}
          {summary.dailyTrend.length > 1 && (
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Tendência Diária</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={summary.dailyTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="receitaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#a1a1aa' }} tickFormatter={dayLabel} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={48} />
                  <ReTooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} fill="url(#receitaGrad)" dot={false} activeDot={{ r: 4, fill: '#10b981' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          ANÁLISE
         ═══════════════════════════════════════════════════════════════════════ */}
      {!loading && viewMode === 'analise' && items.length > 0 && summary && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Comparação mês a mês */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Comparação Mês a Mês</h3>
              {monthBarData.length > 1 ? (
                <div className="space-y-3">
                  {monthBarData.map((m, i) => {
                    const prev = monthBarData[i - 1];
                    const variation = prev ? ((m.total - prev.total) / prev.total) * 100 : 0;
                    const maxVal = Math.max(...monthBarData.map(d => d.total));
                    return (
                      <div key={m.name} className="flex items-center gap-3">
                        <div className="w-20 text-xs font-medium text-zinc-600">{m.name}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-zinc-100 rounded-full h-2.5 overflow-hidden">
                              <div className="h-2.5 rounded-full bg-green-500 transition-all"
                                style={{ width: `${maxVal > 0 ? (m.total / maxVal) * 100 : 0}%` }} />
                            </div>
                            <span className="text-xs font-bold text-zinc-800 w-20 text-right">{formatCurrency(m.total)}</span>
                          </div>
                        </div>
                        {i > 0 ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${variation >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                            {variation >= 0 ? '+' : ''}{variation.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400 w-16 text-right">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-zinc-400 text-center py-8">Dados de múltiplos meses necessários</p>
              )}
            </div>

            {/* Top categorias */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Receita por Categoria</h3>
              <div className="space-y-3">
                {summary.byCategory.slice(0, 8).map((cat, i) => {
                  const pct = summary.total > 0 ? (cat.total / summary.total) * 100 : 0;
                  const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
                  return (
                    <div key={cat.category}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-sm font-medium text-zinc-700">{cat.category}</span>
                          <span className="text-xs text-zinc-400">({cat.count}x)</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-zinc-800">{formatCurrency(cat.total)}</span>
                          <span className="text-xs text-zinc-400 ml-2">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="w-full bg-zinc-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Resumo do período */}
          <div className="bg-white rounded-xl border border-zinc-200 p-5">
            <h3 className="text-sm font-semibold text-zinc-800 mb-4">Resumo do Período</h3>
            {(() => {
              const days = Math.max(1, Math.ceil((new Date(filters.endDate).getTime() - new Date(filters.startDate).getTime()) / 86400000));
              const avgDaily = summary.total / days;
              const avgPerItem = items.length > 0 ? summary.total / items.length : 0;
              const maxDay = summary.dailyTrend.reduce((max, d) => d.amount > max.amount ? d : max, summary.dailyTrend[0] ?? { date: '', amount: 0 });
              const ordersPct = summary.total > 0 ? (summary.fromOrders / summary.total) * 100 : 0;
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-zinc-50 rounded-xl p-4 text-center">
                    <p className="text-xs text-zinc-500 mb-1">Média Diária</p>
                    <p className="text-lg font-bold text-zinc-900">{formatCurrency(avgDaily)}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">em {days} dias</p>
                  </div>
                  <div className="bg-zinc-50 rounded-xl p-4 text-center">
                    <p className="text-xs text-zinc-500 mb-1">Ticket Médio</p>
                    <p className="text-lg font-bold text-zinc-900">{formatCurrency(avgPerItem)}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{items.length} lançamentos</p>
                  </div>
                  <div className="bg-zinc-50 rounded-xl p-4 text-center">
                    <p className="text-xs text-zinc-500 mb-1">Melhor Dia</p>
                    <p className="text-lg font-bold text-zinc-900">{formatCurrency(maxDay?.amount ?? 0)}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{maxDay?.date ? dayLabel(maxDay.date) : '—'}</p>
                  </div>
                  <div className="bg-zinc-50 rounded-xl p-4 text-center">
                    <p className="text-xs text-zinc-500 mb-1">% de Vendas</p>
                    <p className="text-lg font-bold text-green-600">{ordersPct.toFixed(1)}%</p>
                    <p className="text-xs text-zinc-400 mt-0.5">via pedidos</p>
                  </div>
                </div>
              );
            })()}

            {/* Maiores receitas */}
            <div className="mt-5">
              <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">Maiores Receitas do Período</h4>
              <div className="space-y-2">
                {[...items].sort((a, b) => b.amount - a.amount).slice(0, 5).map((item, i) => (
                  <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-zinc-50 transition-colors">
                    <span className="text-xs font-bold text-zinc-400 w-5">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{item.description}</p>
                      <p className="text-xs text-zinc-400">{item.category} — {new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-green-700">{formatCurrency(item.amount)}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: SOURCE_COLORS_R[item.source] + '22', color: SOURCE_COLORS_R[item.source] }}>
                        {item.source === 'order' ? 'Pedido' : 'Manual'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal nova receita */}
      {showNovaReceita && (
        <NovaReceitaModal
          onClose={() => setShowNovaReceita(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
