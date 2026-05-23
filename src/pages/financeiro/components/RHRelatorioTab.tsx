import { useState, useMemo } from 'react';
import { usePayrollHistory } from '@/hooks/useRH';
import { formatCurrency } from '@/lib/formatters';

const DEPT_COLORS = [
  '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899',
];

function monthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

function fullMonthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function BarChart({
  data,
  departments,
  deptColors,
  viewMode,
}: {
  data: { month: string; byDept: Record<string, number>; total: number }[];
  departments: string[];
  deptColors: Record<string, string>;
  viewMode: 'stacked' | 'grouped' | 'total';
}) {
  const maxVal = useMemo(() => Math.max(...data.map(d => d.total), 1), [data]);
  if (data.length === 0) {
    return <div className="h-64 flex items-center justify-center text-zinc-400 text-sm">Nenhum dado disponível</div>;
  }
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-end gap-1.5 px-2 pb-0" style={{ minWidth: data.length * 56 + 40, height: 260 }}>
        {data.map((d) => {
          const totalPct = (d.total / maxVal) * 100;
          return (
            <div key={d.month} className="flex flex-col items-center gap-1 flex-1 group relative">
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none shadow-lg">
                <p className="font-semibold mb-1">{fullMonthLabel(d.month)}</p>
                <p className="text-zinc-300">Total: {formatCurrency(d.total)}</p>
                {departments.map(dept => d.byDept[dept] > 0 && (
                  <p key={dept} className="text-zinc-300"><span style={{ color: deptColors[dept] }}>●</span> {dept}: {formatCurrency(d.byDept[dept])}</p>
                ))}
              </div>
              <div className="w-full flex flex-col justify-end" style={{ height: 220 }}>
                {viewMode === 'total' ? (
                  <div className="w-full rounded-t-md transition-all duration-500" style={{ height: `${totalPct}%`, backgroundColor: '#f59e0b', minHeight: d.total > 0 ? 4 : 0 }} />
                ) : viewMode === 'stacked' ? (
                  <div className="w-full flex flex-col justify-end rounded-t-md overflow-hidden" style={{ height: `${totalPct}%`, minHeight: d.total > 0 ? 4 : 0 }}>
                    {departments.map(dept => {
                      const deptVal = d.byDept[dept] ?? 0;
                      const deptPct = d.total > 0 ? (deptVal / d.total) * 100 : 0;
                      if (deptPct === 0) return null;
                      return <div key={dept} style={{ height: `${deptPct}%`, backgroundColor: deptColors[dept], minHeight: 2 }} />;
                    })}
                  </div>
                ) : (
                  <div className="w-full flex items-end gap-0.5 justify-center" style={{ height: `${totalPct}%`, minHeight: d.total > 0 ? 4 : 0 }}>
                    {departments.filter(dept => d.byDept[dept] > 0).map(dept => {
                      const deptVal = d.byDept[dept] ?? 0;
                      const deptPct = d.total > 0 ? (deptVal / d.total) * 100 : 0;
                      return <div key={dept} className="flex-1 rounded-t-sm" style={{ height: `${deptPct}%`, backgroundColor: deptColors[dept], minHeight: 2 }} />;
                    })}
                  </div>
                )}
              </div>
              <span className="text-xs text-zinc-400 whitespace-nowrap">{monthLabel(d.month)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RHRelatorioTab() {
  const [monthsBack, setMonthsBack] = useState(12);
  const [viewMode, setViewMode] = useState<'stacked' | 'grouped' | 'total'>('stacked');
  const [deptFilter, setDeptFilter] = useState<string[]>([]);
  const [entryTypeFilter, setEntryTypeFilter] = useState<'all' | 'regular' | 'thirteenth' | 'vacation'>('all');
  const [reportTab, setReportTab] = useState<'evolucao' | 'funcionario' | 'item' | 'categoria'>('evolucao');

  const { history, rawEntries, loading, months, departments, monthlyTotals } = usePayrollHistory(monthsBack);

  const deptColors = useMemo(() => {
    const map: Record<string, string> = {};
    departments.forEach((d, i) => { map[d] = DEPT_COLORS[i % DEPT_COLORS.length]; });
    return map;
  }, [departments]);

  const activeDepts = deptFilter.length > 0 ? deptFilter : departments;

  const filteredRaw = useMemo(() => {
    return rawEntries.filter(e => {
      if (entryTypeFilter === 'regular') return e.entry_type === 'regular' || !e.entry_type;
      if (entryTypeFilter === 'thirteenth') return e.entry_type === 'thirteenth_first' || e.entry_type === 'thirteenth_second';
      if (entryTypeFilter === 'vacation') return e.entry_type === 'vacation_pay';
      return true;
    });
  }, [rawEntries, entryTypeFilter]);

  // ─── DADOS: EVOLUÇÃO ───
  const chartData = useMemo(() => {
    return months.map(m => {
      const monthRows = filteredRaw.filter(r => r.reference_month === m);
      const byDept: Record<string, number> = {};
      activeDepts.forEach(d => { byDept[d] = 0; });
      monthRows.forEach(r => {
        if (activeDepts.includes(r.department)) {
          byDept[r.department] = (byDept[r.department] ?? 0) + Number(r.net_salary);
        }
      });
      const total = activeDepts.reduce((s, d) => s + (byDept[d] ?? 0), 0);
      return { month: m, byDept, total };
    });
  }, [months, filteredRaw, activeDepts]);

  const lastMonth = monthlyTotals[monthlyTotals.length - 1];
  const prevMonth = monthlyTotals[monthlyTotals.length - 2];
  const variation = prevMonth && prevMonth.total > 0 ? ((lastMonth?.total ?? 0) - prevMonth.total) / prevMonth.total * 100 : 0;
  const totalPeriod = monthlyTotals.reduce((s, m) => s + m.total, 0);
  const avgMonthly = months.length > 0 ? totalPeriod / months.length : 0;
  const maxMonth = monthlyTotals.reduce((max, m) => m.total > (max?.total ?? 0) ? m : max, monthlyTotals[0]);

  const deptBreakdown = useMemo(() => {
    const map: Record<string, { total: number; headcount: Set<string> }> = {};
    filteredRaw.forEach(e => {
      if (!map[e.department]) map[e.department] = { total: 0, headcount: new Set() };
      map[e.department].total += Number(e.net_salary);
      map[e.department].headcount.add(e.employee_id ?? e.employee_name);
    });
    const total = Object.values(map).reduce((s, v) => s + v.total, 0);
    return Object.entries(map).map(([dept, v]) => ({
      dept, total: v.total, headcount: v.headcount.size, pct: total > 0 ? (v.total / total) * 100 : 0,
    })).sort((a, b) => b.total - a.total);
  }, [filteredRaw]);

  const tableData = useMemo(() => {
    return months.map(m => {
      const rows = filteredRaw.filter(r => r.reference_month === m);
      return {
        month: m,
        total_net: rows.reduce((s, r) => s + Number(r.net_salary), 0),
        total_gross: rows.reduce((s, r) => s + Number(r.gross_salary), 0),
        total_inss: rows.reduce((s, r) => s + Number(r.inss), 0),
        total_fgts: rows.reduce((s, r) => s + Number(r.fgts), 0),
        headcount: new Set(rows.map(r => r.employee_id ?? r.employee_name)).size,
        paid: rows.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.net_salary), 0),
      };
    });
  }, [months, filteredRaw]);

  // ─── DADOS: POR FUNCIONÁRIO ───
  const funcionarioData = useMemo(() => {
    const map: Record<string, {
      name: string; role: string; department: string;
      total_net: number; total_gross: number; total_inss: number; total_irrf: number;
      total_fgts: number; months: Set<string>; entries: number;
      base_salary: number; overtime_50: number; overtime_100: number; overtime_night: number;
      night_shift: number; dsr: number; bonuses: number; desconto_faltas: number;
      vale_transporte: number; vale_refeicao: number;
    }> = {};
    filteredRaw.forEach(e => {
      const key = e.employee_id ?? e.employee_name;
      if (!map[key]) {
        map[key] = {
          name: e.employee_name, role: e.role, department: e.department,
          total_net: 0, total_gross: 0, total_inss: 0, total_irrf: 0, total_fgts: 0,
          months: new Set(), entries: 0,
          base_salary: 0, overtime_50: 0, overtime_100: 0, overtime_night: 0,
          night_shift: 0, dsr: 0, bonuses: 0, desconto_faltas: 0,
          vale_transporte: 0, vale_refeicao: 0,
        };
      }
      map[key].total_net += Number(e.net_salary);
      map[key].total_gross += Number(e.gross_salary);
      map[key].total_inss += Number(e.inss);
      map[key].total_irrf += Number(e.irrf);
      map[key].total_fgts += Number(e.fgts);
      map[key].months.add(e.reference_month);
      map[key].entries += 1;
      map[key].base_salary += Number(e.base_salary);
      map[key].overtime_50 += Number(e.overtime_50 || 0);
      map[key].overtime_100 += Number(e.overtime_100 || 0);
      map[key].overtime_night += Number(e.overtime_night || 0);
      map[key].night_shift += Number(e.night_shift_value || 0);
      map[key].dsr += Number(e.dsr_value || 0);
      map[key].bonuses += Number(e.bonuses || 0) + Number(e.other_bonuses || 0);
      map[key].desconto_faltas += Number(e.desconto_faltas || 0);
      map[key].vale_transporte += Number(e.vale_transporte || 0);
      map[key].vale_refeicao += Number(e.vale_refeicao || 0);
    });
    return Object.values(map).sort((a, b) => b.total_net - a.total_net);
  }, [filteredRaw]);

  // ─── DADOS: POR ITEM ───
  const itemData = useMemo(() => {
    const items = [
      { key: 'base_salary', label: 'Salário Base', type: 'provento' as const },
      { key: 'overtime_50', label: 'HE Dia Útil', type: 'provento' as const },
      { key: 'overtime_100', label: 'HE 100%', type: 'provento' as const },
      { key: 'overtime_night', label: 'HE Noturna', type: 'provento' as const },
      { key: 'night_shift_value', label: 'Adic. Noturno', type: 'provento' as const },
      { key: 'dsr_value', label: 'DSR', type: 'provento' as const },
      { key: 'bonuses', label: 'Bônus/Comissões', type: 'provento' as const },
      { key: 'other_bonuses', label: 'Outros Proventos', type: 'provento' as const },
      { key: 'inss', label: 'INSS', type: 'desconto' as const },
      { key: 'irrf', label: 'IRRF', type: 'desconto' as const },
      { key: 'vale_transporte', label: 'Vale Transporte', type: 'desconto' as const },
      { key: 'vale_refeicao', label: 'Vale Refeição', type: 'desconto' as const },
      { key: 'desconto_faltas', label: 'Desconto Faltas', type: 'desconto' as const },
      { key: 'other_deductions', label: 'Outros Descontos', type: 'desconto' as const },
      { key: 'fgts', label: 'FGTS (empresa)', type: 'encargo' as const },
    ];
    return items.map(item => {
      const total = filteredRaw.reduce((s, e) => s + Number((e as Record<string, unknown>)[item.key] || 0), 0);
      return { ...item, total };
    }).filter(i => i.total > 0).sort((a, b) => b.total - a.total);
  }, [filteredRaw]);

  // ─── DADOS: POR CATEGORIA ───
  const categoriaData = useMemo(() => {
    const proventos = itemData.filter(i => i.type === 'provento').reduce((s, i) => s + i.total, 0);
    const descontos = itemData.filter(i => i.type === 'desconto').reduce((s, i) => s + i.total, 0);
    const encargos = itemData.filter(i => i.type === 'encargo').reduce((s, i) => s + i.total, 0);
    const liquido = proventos - descontos;
    const custoTotal = proventos + encargos;
    return [
      { label: 'Total Proventos', value: proventos, color: 'bg-green-500', pct: custoTotal > 0 ? (proventos / custoTotal) * 100 : 0 },
      { label: 'Total Descontos', value: descontos, color: 'bg-red-500', pct: custoTotal > 0 ? (descontos / custoTotal) * 100 : 0 },
      { label: 'Encargos Empresa', value: encargos, color: 'bg-amber-500', pct: custoTotal > 0 ? (encargos / custoTotal) * 100 : 0 },
      { label: 'Salário Líquido', value: liquido, color: 'bg-blue-500', pct: custoTotal > 0 ? (liquido / custoTotal) * 100 : 0 },
    ];
  }, [itemData]);

  const handleExport = () => {
    const rows = [
      ['Mês', 'Funcionários', 'Bruto', 'INSS', 'FGTS', 'Líquido', 'Pago'],
      ...tableData.map(r => [
        fullMonthLabel(r.month), r.headcount, r.total_gross.toFixed(2),
        r.total_inss.toFixed(2), r.total_fgts.toFixed(2), r.total_net.toFixed(2), r.paid.toFixed(2),
      ]),
    ];
    const csv = rows.map(r => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Relatorio_Folha_${monthsBack}meses.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Relatório de Folha de Pagamento</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Análise completa da folha por múltiplas dimensões</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
            {[{ label: '6 meses', value: 6 }, { label: '12 meses', value: 12 }, { label: '24 meses', value: 24 }].map(p => (
              <button key={p.value} onClick={() => setMonthsBack(p.value)}
                className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${monthsBack === p.value ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <select value={entryTypeFilter} onChange={e => setEntryTypeFilter(e.target.value as typeof entryTypeFilter)}
            className="border border-zinc-200 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-600 bg-white focus:outline-none focus:border-amber-400">
            <option value="all">Todos os lançamentos</option>
            <option value="regular">Folha regular</option>
            <option value="thirteenth">13º Salário</option>
            <option value="vacation">Férias</option>
          </select>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
            <i className="ri-download-line" /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden w-fit">
        {[
          { key: 'evolucao', label: 'Evolução', icon: 'ri-bar-chart-2-line' },
          { key: 'funcionario', label: 'Por Funcionário', icon: 'ri-user-line' },
          { key: 'item', label: 'Por Item', icon: 'ri-file-list-3-line' },
          { key: 'categoria', label: 'Por Categoria', icon: 'ri-pie-chart-line' },
        ].map(t => (
          <button key={t.key} onClick={() => setReportTab(t.key as typeof reportTab)}
            className={`px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${reportTab === t.key ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
            <i className={t.icon} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: EVOLUÇÃO ── */}
      {reportTab === 'evolucao' && (
        <div className="space-y-6">
          {!loading && (
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-zinc-200 p-4">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Total no Período</p>
                <p className="text-xl font-bold text-zinc-900">{formatCurrency(totalPeriod)}</p>
                <p className="text-xs text-zinc-400 mt-1">{months.length} meses</p>
              </div>
              <div className="bg-white rounded-xl border border-zinc-200 p-4">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Média Mensal</p>
                <p className="text-xl font-bold text-zinc-900">{formatCurrency(avgMonthly)}</p>
                <p className="text-xs text-zinc-400 mt-1">por mês</p>
              </div>
              <div className="bg-white rounded-xl border border-zinc-200 p-4">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Mês Mais Alto</p>
                <p className="text-xl font-bold text-zinc-900">{formatCurrency(maxMonth?.total ?? 0)}</p>
                <p className="text-xs text-zinc-400 mt-1">{maxMonth ? fullMonthLabel(maxMonth.month) : '—'}</p>
              </div>
              <div className="bg-white rounded-xl border border-zinc-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Últ. vs Anterior</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${variation >= 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                    {variation >= 0 ? '+' : ''}{variation.toFixed(1)}%
                  </span>
                </div>
                <p className="text-xl font-bold text-zinc-900">{formatCurrency(lastMonth?.total ?? 0)}</p>
                <p className="text-xs text-zinc-400 mt-1">{lastMonth ? fullMonthLabel(lastMonth.month) : '—'}</p>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-zinc-200 p-5">
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <h3 className="text-sm font-semibold text-zinc-800">Evolução Mensal</h3>
              <div className="flex items-center gap-2">
                <div className="flex bg-zinc-100 rounded-lg overflow-hidden p-0.5 gap-0.5">
                  {[{ value: 'stacked', icon: 'ri-bar-chart-2-line' }, { value: 'grouped', icon: 'ri-bar-chart-line' }, { value: 'total', icon: 'ri-bar-chart-fill' }].map(m => (
                    <button key={m.value} onClick={() => setViewMode(m.value as typeof viewMode)}
                      className={`w-8 h-8 flex items-center justify-center rounded-md text-sm cursor-pointer transition-colors ${viewMode === m.value ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                      <i className={m.icon} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {departments.length > 0 && viewMode !== 'total' && (
              <div className="flex flex-wrap gap-2 mb-4">
                {departments.map(dept => (
                  <button key={dept} onClick={() => setDeptFilter(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all ${deptFilter.length === 0 || deptFilter.includes(dept) ? 'opacity-100' : 'opacity-30'}`}
                    style={{ backgroundColor: deptColors[dept] + '22', border: `1.5px solid ${deptColors[dept]}`, color: deptColors[dept] }}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: deptColors[dept] }} />{dept}
                  </button>
                ))}
                {deptFilter.length > 0 && <button onClick={() => setDeptFilter([])} className="text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer px-1">Limpar filtro</button>}
              </div>
            )}
            {loading ? (
              <div className="h-64 flex items-center justify-center"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <BarChart data={chartData} departments={activeDepts} deptColors={deptColors} viewMode={viewMode} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Distribuição por Departamento</h3>
              {loading ? (
                <div className="h-32 flex items-center justify-center"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : deptBreakdown.length === 0 ? (
                <p className="text-sm text-zinc-400 text-center py-8">Nenhum dado disponível</p>
              ) : (
                <div className="space-y-3">
                  {deptBreakdown.map(d => (
                    <div key={d.dept}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: deptColors[d.dept] }} />
                          <span className="text-sm font-medium text-zinc-700">{d.dept}</span>
                          <span className="text-xs text-zinc-400">({d.headcount} func.)</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-zinc-800">{formatCurrency(d.total)}</span>
                          <span className="text-xs text-zinc-400 ml-2">{d.pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="w-full bg-zinc-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${d.pct}%`, backgroundColor: deptColors[d.dept] }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-100"><h3 className="text-sm font-semibold text-zinc-800">Detalhe Mensal</h3></div>
              {loading ? (
                <div className="h-32 flex items-center justify-center"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : tableData.length === 0 ? (
                <div className="py-10 text-center text-sm text-zinc-400">Nenhum dado disponível</div>
              ) : (
                <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
                  <table className="w-full">
                    <thead className="sticky top-0 bg-zinc-50">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Mês</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Func.</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Bruto</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Líquido</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Pago</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {[...tableData].reverse().map(row => (
                        <tr key={row.month} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="px-4 py-2.5 text-sm text-zinc-700 font-medium whitespace-nowrap">{fullMonthLabel(row.month)}</td>
                          <td className="px-3 py-2.5 text-sm text-right text-zinc-500">{row.headcount}</td>
                          <td className="px-3 py-2.5 text-sm text-right text-zinc-700">{formatCurrency(row.total_gross)}</td>
                          <td className="px-3 py-2.5 text-sm text-right font-semibold text-zinc-800">{formatCurrency(row.total_net)}</td>
                          <td className="px-4 py-2.5 text-sm text-right">
                            <span className={`font-semibold ${row.paid >= row.total_net ? 'text-green-600' : row.paid > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
                              {formatCurrency(row.paid)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {!loading && tableData.length > 0 && (
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Resumo de Encargos — Período Completo</h3>
              <div className="grid grid-cols-5 gap-4">
                {(() => {
                  const totals = tableData.reduce((acc, row) => ({
                    gross: acc.gross + row.total_gross, net: acc.net + row.total_net,
                    inss: acc.inss + row.total_inss, fgts: acc.fgts + row.total_fgts, paid: acc.paid + row.paid,
                  }), { gross: 0, net: 0, inss: 0, fgts: 0, paid: 0 });
                  return [
                    { label: 'Total Bruto', value: totals.gross, color: 'text-zinc-800' },
                    { label: 'Total INSS', value: totals.inss, color: 'text-orange-600', sub: `${totals.gross > 0 ? ((totals.inss / totals.gross) * 100).toFixed(1) : 0}% do bruto` },
                    { label: 'Total FGTS', value: totals.fgts, color: 'text-amber-600', sub: `${totals.gross > 0 ? ((totals.fgts / totals.gross) * 100).toFixed(1) : 0}% do bruto` },
                    { label: 'Total Líquido', value: totals.net, color: 'text-zinc-900' },
                    { label: 'Total Pago', value: totals.paid, color: 'text-green-600', sub: `${totals.net > 0 ? ((totals.paid / totals.net) * 100).toFixed(1) : 0}% do líquido` },
                  ].map(item => (
                    <div key={item.label} className="text-center p-3 bg-zinc-50 rounded-xl">
                      <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
                      <p className={`text-base font-bold ${item.color}`}>{formatCurrency(item.value)}</p>
                      {item.sub && <p className="text-xs text-zinc-400 mt-0.5">{item.sub}</p>}
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: POR FUNCIONÁRIO ── */}
      {reportTab === 'funcionario' && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-100">
            <h3 className="text-sm font-semibold text-zinc-800">Gasto por Funcionário — Período</h3>
            <p className="text-xs text-zinc-500">{filteredRaw.length} lançamentos no período selecionado</p>
          </div>
          {loading ? (
            <div className="h-64 flex items-center justify-center"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : funcionarioData.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-400">Nenhum dado disponível</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Funcionário</th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Depto</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Meses</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Salário Base</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">HE</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Noturno</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">DSR</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Bônus</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">INSS</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">IRRF</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">FGTS</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Faltas</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">VT/VR</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Líquido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {funcionarioData.map(f => (
                    <tr key={f.name} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-zinc-800">{f.name}</p>
                        <p className="text-xs text-zinc-400">{f.role}</p>
                      </td>
                      <td className="px-3 py-3 text-xs text-zinc-500">{f.department}</td>
                      <td className="px-3 py-3 text-sm text-right text-zinc-500">{f.months.size}</td>
                      <td className="px-3 py-3 text-sm text-right text-zinc-700">{formatCurrency(f.base_salary)}</td>
                      <td className="px-3 py-3 text-sm text-right text-green-600">{formatCurrency(f.overtime_50 + f.overtime_100 + f.overtime_night)}</td>
                      <td className="px-3 py-3 text-sm text-right text-green-600">{formatCurrency(f.night_shift)}</td>
                      <td className="px-3 py-3 text-sm text-right text-green-600">{formatCurrency(f.dsr)}</td>
                      <td className="px-3 py-3 text-sm text-right text-green-600">{formatCurrency(f.bonuses)}</td>
                      <td className="px-3 py-3 text-sm text-right text-orange-600">-{formatCurrency(f.total_inss)}</td>
                      <td className="px-3 py-3 text-sm text-right text-red-500">-{formatCurrency(f.total_irrf)}</td>
                      <td className="px-3 py-3 text-sm text-right text-amber-600">{formatCurrency(f.total_fgts)}</td>
                      <td className="px-3 py-3 text-sm text-right text-red-500">-{formatCurrency(f.desconto_faltas)}</td>
                      <td className="px-3 py-3 text-sm text-right text-red-500">-{formatCurrency(f.vale_transporte + f.vale_refeicao)}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-zinc-900">{formatCurrency(f.total_net)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-50 border-t-2 border-zinc-200">
                    <td colSpan={3} className="px-4 py-3 text-sm font-bold text-zinc-800">Total ({funcionarioData.length} funcionários)</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-zinc-800">{formatCurrency(funcionarioData.reduce((s, f) => s + f.base_salary, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-green-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.overtime_50 + f.overtime_100 + f.overtime_night, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-green-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.night_shift, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-green-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.dsr, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-green-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.bonuses, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-orange-600">-{formatCurrency(funcionarioData.reduce((s, f) => s + f.total_inss, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-red-500">-{formatCurrency(funcionarioData.reduce((s, f) => s + f.total_irrf, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-amber-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.total_fgts, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-red-500">-{formatCurrency(funcionarioData.reduce((s, f) => s + f.desconto_faltas, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right text-red-500">-{formatCurrency(funcionarioData.reduce((s, f) => s + f.vale_transporte + f.vale_refeicao, 0))}</td>
                    <td className="px-4 py-3 text-sm font-bold text-right text-zinc-900">{formatCurrency(funcionarioData.reduce((s, f) => s + f.total_net, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: POR ITEM ── */}
      {reportTab === 'item' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-zinc-200 p-5">
            <h3 className="text-sm font-semibold text-zinc-800 mb-4">Gasto por Item da Folha</h3>
            {loading ? (
              <div className="h-32 flex items-center justify-center"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : itemData.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-8">Nenhum dado disponível</p>
            ) : (
              <div className="space-y-3">
                {itemData.map(item => {
                  const totalGeral = itemData.reduce((s, i) => s + i.total, 0);
                  const pct = totalGeral > 0 ? (item.total / totalGeral) * 100 : 0;
                  const color = item.type === 'provento' ? '#10b981' : item.type === 'desconto' ? '#ef4444' : '#f59e0b';
                  return (
                    <div key={item.key}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-sm font-medium text-zinc-700">{item.label}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${item.type === 'provento' ? 'bg-green-100 text-green-700' : item.type === 'desconto' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {item.type === 'provento' ? 'Provento' : item.type === 'desconto' ? 'Desconto' : 'Encargo'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-zinc-800">{formatCurrency(item.total)}</span>
                          <span className="text-xs text-zinc-400 ml-2">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="w-full bg-zinc-100 rounded-full h-2">
                        <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            {(() => {
              const proventos = itemData.filter(i => i.type === 'provento').reduce((s, i) => s + i.total, 0);
              const descontos = itemData.filter(i => i.type === 'desconto').reduce((s, i) => s + i.total, 0);
              const encargos = itemData.filter(i => i.type === 'encargo').reduce((s, i) => s + i.total, 0);
              return [
                { label: 'Total Proventos', value: proventos, color: 'text-green-600', bg: 'bg-green-50' },
                { label: 'Total Descontos', value: descontos, color: 'text-red-600', bg: 'bg-red-50' },
                { label: 'Total Encargos', value: encargos, color: 'text-amber-600', bg: 'bg-amber-50' },
              ].map(item => (
                <div key={item.label} className={`${item.bg} rounded-xl p-4 text-center border border-zinc-200`}>
                  <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
                  <p className={`text-xl font-bold ${item.color}`}>{formatCurrency(item.value)}</p>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* ── TAB: POR CATEGORIA ── */}
      {reportTab === 'categoria' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Distribuição por Categoria</h3>
              {loading ? (
                <div className="h-32 flex items-center justify-center"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : categoriaData.length === 0 ? (
                <p className="text-sm text-zinc-400 text-center py-8">Nenhum dado disponível</p>
              ) : (
                <div className="space-y-4">
                  {categoriaData.map(cat => (
                    <div key={cat.label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-zinc-700">{cat.label}</span>
                        <div className="text-right">
                          <span className="text-sm font-bold text-zinc-800">{formatCurrency(cat.value)}</span>
                          <span className="text-xs text-zinc-400 ml-2">{cat.pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="w-full bg-zinc-100 rounded-full h-3">
                        <div className={`h-3 rounded-full transition-all duration-700 ${cat.color}`} style={{ width: `${cat.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Resumo Financeiro</h3>
              {(() => {
                const proventos = categoriaData.find(c => c.label === 'Total Proventos')?.value ?? 0;
                const descontos = categoriaData.find(c => c.label === 'Total Descontos')?.value ?? 0;
                const encargos = categoriaData.find(c => c.label === 'Encargos Empresa')?.value ?? 0;
                const liquido = categoriaData.find(c => c.label === 'Salário Líquido')?.value ?? 0;
                const custoTotal = proventos + encargos;
                return (
                  <div className="space-y-4">
                    <div className="p-4 bg-zinc-50 rounded-xl">
                      <p className="text-xs text-zinc-500 mb-1">Custo Total da Empresa</p>
                      <p className="text-2xl font-bold text-zinc-900">{formatCurrency(custoTotal)}</p>
                      <p className="text-xs text-zinc-400 mt-1">Proventos + Encargos</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-green-50 rounded-xl text-center">
                        <p className="text-xs text-green-600 mb-1">Proventos</p>
                        <p className="text-lg font-bold text-green-700">{formatCurrency(proventos)}</p>
                      </div>
                      <div className="p-3 bg-red-50 rounded-xl text-center">
                        <p className="text-xs text-red-600 mb-1">Descontos</p>
                        <p className="text-lg font-bold text-red-700">{formatCurrency(descontos)}</p>
                      </div>
                      <div className="p-3 bg-amber-50 rounded-xl text-center">
                        <p className="text-xs text-amber-600 mb-1">Encargos</p>
                        <p className="text-lg font-bold text-amber-700">{formatCurrency(encargos)}</p>
                      </div>
                      <div className="p-3 bg-blue-50 rounded-xl text-center">
                        <p className="text-xs text-blue-600 mb-1">Líquido</p>
                        <p className="text-lg font-bold text-blue-700">{formatCurrency(liquido)}</p>
                      </div>
                    </div>
                    <div className="p-3 bg-zinc-50 rounded-xl">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500">Relação Encargos/Proventos</span>
                        <span className="text-sm font-bold text-zinc-800">
                          {proventos > 0 ? ((encargos / proventos) * 100).toFixed(1) : 0}%
                        </span>
                      </div>
                      <div className="w-full bg-zinc-200 rounded-full h-1.5 mt-2">
                        <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${proventos > 0 ? Math.min((encargos / proventos) * 100, 100) : 0}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}