import { useState, useMemo, useEffect } from 'react';
import { useImplantacao } from '@/hooks/useImplantacao';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { formatCurrency } from '@/lib/formatters';
import type { ImplementationCost } from '@/types/financeiro';

const CATEGORIAS = ['Obras', 'Equipamentos', 'Móveis', 'Documentação', 'Marketing Inicial', 'Estoque Inicial', 'Outros'];
const FONTES = ['Recursos Próprios', 'Empréstimo Bancário', 'Investidor Anjo', 'BNDES', 'Sócio 1', 'Sócio 2'];
const COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16'];

const emptyForm = { date: new Date().toISOString().split('T')[0], description: '', amount: '', custom_fields: {} as Record<string, string> };

const PAGE_SIZE = 10;

export default function ImplantacaoTab() {
  const { costs, settings, loading, upsertCost, deleteCost, saveSettings, totalInvestimento } = useImplantacao();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ImplementationCost | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [settingsForm, setSettingsForm] = useState({
    inauguration_date: settings?.inauguration_date ?? '',
    total_investment: settings?.total_investment ?? 0,
  });
  const [showSettings, setShowSettings] = useState(false);

  // Sincronizar settingsForm quando os dados carregarem do banco
  useEffect(() => {
    if (settings) {
      setSettingsForm({
        inauguration_date: settings.inauguration_date ?? '',
        total_investment: settings.total_investment ?? 0,
      });
    }
  }, [settings]);

  // Filters
  const [search, setSearch] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('all');
  const [filterFonte, setFilterFonte] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await upsertCost(editing ? { ...form, id: editing.id, amount: Number(form.amount) } : { ...form, amount: Number(form.amount) });
    setShowModal(false); setForm(emptyForm); setEditing(null); setPage(1);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSettings(settingsForm);
    setShowSettings(false);
  };

  const handleExport = () => {
    const rows = [
      ['Data', 'Descrição', 'Categoria', 'Fonte', 'Quem Pagou', 'Valor'],
      ...costs.map(c => [c.date, c.description, c.custom_fields?.categoria ?? '', c.custom_fields?.fonte ?? '', c.custom_fields?.quem_pagou ?? '', c.amount]),
    ];
    const csv = rows.map(r => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'Implantacao.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Filtered costs
  const filtered = useMemo(() => {
    let result = [...costs];
    if (search.trim()) { const q = search.toLowerCase(); result = result.filter(c => c.description.toLowerCase().includes(q) || (c.custom_fields?.quem_pagou || '').toLowerCase().includes(q)); }
    if (filterCategoria !== 'all') result = result.filter(c => c.custom_fields?.categoria === filterCategoria);
    if (filterFonte !== 'all') result = result.filter(c => c.custom_fields?.fonte === filterFonte);
    if (filterDateFrom) result = result.filter(c => c.date >= filterDateFrom);
    if (filterDateTo) result = result.filter(c => c.date <= filterDateTo);
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }, [costs, search, filterCategoria, filterFonte, filterDateFrom, filterDateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeFiltersCount = [filterCategoria !== 'all', filterFonte !== 'all', !!filterDateFrom, !!filterDateTo].filter(Boolean).length;
  const clearFilters = () => { setFilterCategoria('all'); setFilterFonte('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearch(''); setPage(1); };

  // Charts data
  const porCategoria = useMemo(() => CATEGORIAS.map(cat => ({
    name: cat, value: costs.filter(c => c.custom_fields?.categoria === cat).reduce((s, c) => s + Number(c.amount), 0),
  })).filter(c => c.value > 0), [costs]);

  const porFonte = useMemo(() => FONTES.map(fonte => ({
    name: fonte, value: costs.filter(c => c.custom_fields?.fonte === fonte).reduce((s, c) => s + Number(c.amount), 0),
  })).filter(f => f.value > 0), [costs]);

  const porSocio = useMemo(() => {
    const map: Record<string, number> = {};
    costs.forEach(c => { const quem = (c.custom_fields?.quem_pagou as string) || 'Não informado'; map[quem] = (map[quem] ?? 0) + Number(c.amount); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).filter(s => s.value > 0);
  }, [costs]);

  // Timeline: gastos acumulados por mês
  const timeline = useMemo(() => {
    const map: Record<string, number> = {};
    costs.forEach(c => { const mes = c.date.slice(0, 7); map[mes] = (map[mes] ?? 0) + Number(c.amount); });
    let acc = 0;
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([mes, value]) => {
      acc += value;
      return {
        mes: new Date(mes + '-01').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        mensal: value, acumulado: acc,
      };
    });
  }, [costs]);

  const investimentoTotal = settings?.total_investment ?? totalInvestimento;
  const inaugDate = settings?.inauguration_date;
  const lucroMedioMensal = investimentoTotal * 0.1;
  const mesesPayback = lucroMedioMensal > 0 ? Math.ceil(investimentoTotal / lucroMedioMensal) : null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Implantação &amp; Investimento</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Controle do investimento inicial e análise de retorno</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport}
            className="flex items-center gap-2 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
            <i className="ri-download-line" /> CSV
          </button>
          <button onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
            <i className="ri-settings-line" /> Configurações
          </button>
          <button onClick={() => { setEditing(null); setForm(emptyForm); setShowModal(true); }}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
            <i className="ri-add-line" /> Novo Gasto
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Investimento Total', value: formatCurrency(investimentoTotal), sub: `${costs.length} lançamentos`, icon: 'ri-money-dollar-circle-line', color: 'text-zinc-800', bg: 'bg-zinc-50' },
          { label: 'Inauguração', value: inaugDate ? new Date(inaugDate + 'T00:00:00').toLocaleDateString('pt-BR') : '—', sub: 'Data configurada', icon: 'ri-calendar-event-line', color: 'text-zinc-800', bg: 'bg-zinc-50' },
          { label: 'Payback Estimado', value: mesesPayback ? `${mesesPayback} meses` : '—', sub: 'Baseado em 10%/mês', icon: 'ri-time-line', color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'ROI Anualizado', value: investimentoTotal > 0 ? '120%' : '—', sub: 'Projeção estimada', icon: 'ri-line-chart-line', color: 'text-green-700', bg: 'bg-green-50' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg ${k.bg}`}>
              <i className={`${k.icon} ${k.color} text-lg`} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">{k.label}</p>
              <p className={`text-base font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-zinc-400">{k.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Timeline */}
      {timeline.length > 1 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h4 className="text-sm font-semibold text-zinc-800 mb-4">Timeline de Gastos — Mensal vs Acumulado</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={timeline} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="mensal" name="Gasto Mensal" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Bar dataKey="acumulado" name="Acumulado" fill="#e5e7eb" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Gráficos categoria + fonte */}
      {(porCategoria.length > 0 || porFonte.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {porCategoria.length > 0 && (
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h4 className="text-sm font-semibold text-zinc-800 mb-4">Por Categoria</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={porCategoria} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {porCategoria.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {porFonte.length > 0 && (
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h4 className="text-sm font-semibold text-zinc-800 mb-4">Por Fonte de Recurso</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={porFonte} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {porFonte.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Sócios */}
      {porSocio.length > 1 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h4 className="text-sm font-semibold text-zinc-800 mb-4">Participação dos Sócios / Pagadores</h4>
          <div className="grid grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={porSocio} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                  {porSocio.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 flex flex-col justify-center">
              {porSocio.map((s, i) => {
                const pctVal = investimentoTotal > 0 ? (s.value / investimentoTotal) * 100 : 0;
                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-semibold text-zinc-700 truncate">{s.name}</span>
                        <span className="text-xs font-bold text-zinc-800 ml-2">{formatCurrency(s.value)}</span>
                      </div>
                      <div className="w-full bg-zinc-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full" style={{ width: `${pctVal}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                      </div>
                      <span className="text-xs text-zinc-400">{pctVal.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-zinc-100 flex justify-between">
                <span className="text-xs font-semibold text-zinc-500">Total</span>
                <span className="text-xs font-bold text-zinc-800">{formatCurrency(investimentoTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar por descrição ou pagador..."
            className="w-full pl-9 pr-8 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer"><i className="ri-close-line text-zinc-400 text-sm" /></button>}
        </div>

        <select value={filterCategoria} onChange={e => { setFilterCategoria(e.target.value); setPage(1); }}
          className="border border-zinc-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="all">Todas as categorias</option>
          {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select value={filterFonte} onChange={e => { setFilterFonte(e.target.value); setPage(1); }}
          className="border border-zinc-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="all">Todas as fontes</option>
          {FONTES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <button onClick={() => setShowFilters(f => !f)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors whitespace-nowrap ${showFilters ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
          <i className="ri-calendar-line" /> Período
        </button>

        {activeFiltersCount > 0 && (
          <button onClick={clearFilters} className="text-xs text-zinc-400 hover:text-red-500 cursor-pointer whitespace-nowrap">Limpar filtros</button>
        )}
      </div>

      {showFilters && (
        <div className="bg-white border border-zinc-200 rounded-xl p-4 grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Data de</label>
            <input type="date" value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Data até</label>
            <input type="date" value={filterDateTo} onChange={e => { setFilterDateTo(e.target.value); setPage(1); }}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-zinc-800">Gastos de Implantação</h4>
          <span className="text-xs text-zinc-400">{filtered.length} de {costs.length} registros</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-zinc-400 text-sm">Carregando...</div>
        ) : paginated.length === 0 ? (
          <div className="p-10 text-center">
            <i className="ri-building-line text-4xl text-zinc-200 block mb-2" />
            <p className="text-zinc-400 text-sm">Nenhum gasto encontrado</p>
            {(search || activeFiltersCount > 0) && <button onClick={clearFilters} className="text-xs text-amber-600 mt-1 cursor-pointer hover:underline">Limpar filtros</button>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                {['Data', 'Descrição', 'Categoria', 'Fonte', 'Quem Pagou', 'Valor', 'Ações'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {paginated.map(c => (
                <tr key={c.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">{new Date(c.date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3 font-medium text-zinc-800">{c.description}</td>
                  <td className="px-4 py-3">
                    {c.custom_fields?.categoria ? (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{c.custom_fields.categoria}</span>
                    ) : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{c.custom_fields?.fonte ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{c.custom_fields?.quem_pagou ?? '—'}</td>
                  <td className="px-4 py-3 font-semibold text-zinc-900">{formatCurrency(c.amount)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditing(c); setForm({ date: c.date, description: c.description, amount: String(c.amount), custom_fields: c.custom_fields as Record<string, string> }); setShowModal(true); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer">
                        <i className="ri-edit-line text-xs" />
                      </button>
                      <button onClick={() => deleteCost(c.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer">
                        <i className="ri-delete-bin-line text-xs" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 bg-zinc-50">
            <p className="text-xs text-zinc-500">Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}</p>
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

      {/* Modal Gasto */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">{editing ? 'Editar' : 'Novo'} Gasto de Implantação</h3>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"><i className="ri-close-line text-zinc-500" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Data *</label>
                  <input required type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Valor *</label>
                  <input required type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Descrição *</label>
                <input required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Categoria</label>
                  <select value={form.custom_fields?.categoria ?? ''} onChange={e => setForm(f => ({ ...f, custom_fields: { ...f.custom_fields, categoria: e.target.value } }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    <option value="">Selecionar</option>
                    {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Fonte do Dinheiro</label>
                  <select value={form.custom_fields?.fonte ?? ''} onChange={e => setForm(f => ({ ...f, custom_fields: { ...f.custom_fields, fonte: e.target.value } }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    <option value="">Selecionar</option>
                    {FONTES.map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Quem Pagou</label>
                <input value={form.custom_fields?.quem_pagou ?? ''} onChange={e => setForm(f => ({ ...f, custom_fields: { ...f.custom_fields, quem_pagou: e.target.value } }))}
                  placeholder="Ex: Sócio 1, Empresa..."
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
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

      {/* Modal Configurações */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">Configurações de Investimento</h3>
              <button onClick={() => setShowSettings(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"><i className="ri-close-line text-zinc-500" /></button>
            </div>
            <form onSubmit={handleSaveSettings} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Data de Inauguração</label>
                <input type="date" value={settingsForm.inauguration_date} onChange={e => setSettingsForm(f => ({ ...f, inauguration_date: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Investimento Total (editável)</label>
                <input type="number" step="0.01" value={settingsForm.total_investment} onChange={e => setSettingsForm(f => ({ ...f, total_investment: Number(e.target.value) }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <p className="text-xs text-zinc-400 mt-1">Soma automática dos gastos: {formatCurrency(totalInvestimento)}</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowSettings(false)}
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
