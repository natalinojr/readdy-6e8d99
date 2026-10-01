import { useState, useMemo } from 'react';
import { usePayrollHistory } from '@/hooks/useRH';
import { CATEGORIAS_FOLHA, categorizarRubrica } from '@/lib/dominioExtrato';
import { formatCurrency } from '@/lib/formatters';
import { KpiCard, Segmented } from './dreUi';

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
    return <div className="py-14 text-center text-zinc-400 text-sm">Nenhum dado disponível</div>;
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
  // Folha importada do Domínio traz as rubricas com categoria (hr_payroll.rubricas):
  // soma por categoria, com detalhe por rubrica, mês e funcionário. Lançamentos manuais
  // (sem rubricas) caem nos campos da folha.
  const itemData = useMemo(() => {
    type Acc = { key: string; label: string; type: 'provento' | 'desconto' | 'encargo'; total: number;
      porDesc: Record<string, number>; porMes: Record<string, number>; porFunc: Record<string, number> };
    const acc: Record<string, Acc> = {};
    const add = (cat: string, valor: number, desc: string, mes: string, func: string) => {
      if (!valor || cat === 'liquido_rescisao') return; // é o líquido pago no TRCT, não desconto
      const def = CATEGORIAS_FOLHA[cat] ?? CATEGORIAS_FOLHA.outros_proventos;
      const it = acc[cat] ?? (acc[cat] = { key: cat, label: def.label, type: def.tipo, total: 0, porDesc: {}, porMes: {}, porFunc: {} });
      it.total += valor;
      it.porDesc[desc] = (it.porDesc[desc] ?? 0) + valor;
      it.porMes[mes] = (it.porMes[mes] ?? 0) + valor;
      it.porFunc[func] = (it.porFunc[func] ?? 0) + valor;
    };
    filteredRaw.forEach(e => {
      const mes = e.reference_month;
      const func = e.employee_name;
      const rub = Array.isArray(e.rubricas) ? e.rubricas : [];
      if (rub.length > 0) {
        rub.forEach(r => add(r.categoria || categorizarRubrica(r), Number(r.valor || 0), r.descricao, mes, func));
      } else {
        const n = (v: unknown) => Number(v || 0);
        const extras = n(e.overtime_50) + n(e.overtime_100);
        const outrosP = n(e.bonuses) + n(e.other_bonuses);
        const base = Math.max(0, n(e.total_proventos ?? e.gross_salary) - extras - n(e.night_shift_value) - n(e.dsr_value) - outrosP);
        add('salario', base, 'Salário', mes, func);
        add('hora_extra', n(e.overtime_50), 'Horas extras (dia útil)', mes, func);
        add('hora_extra', n(e.overtime_100), 'Horas extras 100%', mes, func);
        add('adicional_noturno', n(e.night_shift_value), 'Adicional noturno', mes, func);
        add('dsr', n(e.dsr_value), 'DSR', mes, func);
        add('outros_proventos', outrosP, 'Bônus / outros proventos', mes, func);
        add('inss', n(e.inss), 'INSS', mes, func);
        add('irrf', n(e.irrf), 'IRRF', mes, func);
        add('faltas', n(e.desconto_faltas), 'Faltas', mes, func);
        add('vale_transporte', n(e.vale_transporte), 'Vale-transporte', mes, func);
        add('vale_refeicao', n(e.vale_refeicao), 'Vale-refeição', mes, func);
        add('outros_descontos', n(e.other_deductions), 'Outros descontos', mes, func);
      }
      add('fgts', Number(e.fgts || 0), 'FGTS do mês', mes, func);
    });
    const ordem = { provento: 0, desconto: 1, encargo: 2 } as const;
    return Object.values(acc).filter(i => i.total > 0.004)
      .sort((x, y) => ordem[x.type] - ordem[y.type] || y.total - x.total);
  }, [filteredRaw]);
  const [itemAberto, setItemAberto] = useState<string | null>(null);

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
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-bold text-zinc-800">Relatório de Folha de Pagamento</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Análise completa da folha por múltiplas dimensões</p>
      </div>

      {/* Subabas + filtros */}
      <div className="flex flex-wrap items-center gap-2 lg:gap-3">
        <div className="flex gap-1 overflow-x-auto bg-zinc-100/80 rounded-xl p-1 w-full sm:w-fit max-w-full">
          {[
            { key: 'evolucao', label: 'Evolução', icon: 'ri-bar-chart-2-line' },
            { key: 'funcionario', label: 'Por Funcionário', icon: 'ri-user-line' },
            { key: 'item', label: 'Por Item', icon: 'ri-file-list-3-line' },
            { key: 'categoria', label: 'Por Categoria', icon: 'ri-pie-chart-line' },
          ].map(t => (
            <button key={t.key} onClick={() => setReportTab(t.key as typeof reportTab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${reportTab === t.key ? 'bg-white text-amber-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
              <i className={t.icon} /> {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="overflow-x-auto max-w-full">
            <Segmented
              value={String(monthsBack) as '6' | '12' | '24'}
              onChange={(v) => setMonthsBack(Number(v))}
              options={[
                { id: '6', label: '6 meses', icon: 'ri-calendar-line' },
                { id: '12', label: '12 meses', icon: 'ri-calendar-line' },
                { id: '24', label: '24 meses', icon: 'ri-calendar-line' },
              ]}
            />
          </div>
          <select value={entryTypeFilter} onChange={e => setEntryTypeFilter(e.target.value as typeof entryTypeFilter)}
            className="h-10 border border-zinc-200 rounded-xl px-3 text-xs font-semibold text-zinc-600 bg-white shadow-sm focus:outline-none focus:border-amber-400">
            <option value="all">Todos os lançamentos</option>
            <option value="regular">Folha regular</option>
            <option value="thirteenth">13º Salário</option>
            <option value="vacation">Férias</option>
          </select>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm">
            <i className="ri-download-line" /> Exportar CSV
          </button>
        </div>
      </div>

      {/* ── TAB: EVOLUÇÃO ── */}
      {reportTab === 'evolucao' && (
        <div className="space-y-5">
          {!loading && (
            <div className="grid grid-cols-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <KpiCard label="Total no período" icon="ri-money-dollar-circle-line" value={formatCurrency(totalPeriod)} sub={`${months.length} meses`} atual={totalPeriod} semVariacao />
              <KpiCard label="Média mensal" icon="ri-line-chart-line" value={formatCurrency(avgMonthly)} sub="por mês" atual={avgMonthly} semVariacao />
              <KpiCard label="Mês mais alto" icon="ri-arrow-up-circle-line" value={formatCurrency(maxMonth?.total ?? 0)} sub={maxMonth ? fullMonthLabel(maxMonth.month) : '—'} atual={maxMonth?.total ?? 0} semVariacao />
              <KpiCard label="Últ. vs anterior" icon="ri-exchange-line" value={formatCurrency(lastMonth?.total ?? 0)} sub={lastMonth ? fullMonthLabel(lastMonth.month) : '—'} atual={lastMonth?.total ?? 0} anterior={prevMonth?.total} inverse />
            </div>
          )}

          <div className="bg-white rounded-2xl border border-zinc-200 p-5">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap -mx-5 -mt-5 mb-5">
              <div><h3 className="text-sm font-bold text-zinc-800">Evolução Mensal</h3><p className="text-xs text-zinc-400">Líquido por mês e departamento</p></div>
              <div className="flex items-center gap-2">
                <div className="flex bg-zinc-100 p-1 rounded-xl gap-0.5">
                  {[{ value: 'stacked', icon: 'ri-bar-chart-2-line' }, { value: 'grouped', icon: 'ri-bar-chart-line' }, { value: 'total', icon: 'ri-bar-chart-fill' }].map(m => (
                    <button key={m.value} onClick={() => setViewMode(m.value as typeof viewMode)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm cursor-pointer transition-colors ${viewMode === m.value ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
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
              <div className="py-14 text-center"><i className="ri-loader-4-line text-4xl text-zinc-200 animate-spin" /></div>
            ) : (
              <BarChart data={chartData} departments={activeDepts} deptColors={deptColors} viewMode={viewMode} />
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl border border-zinc-200 p-5">
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap -mx-5 -mt-5 mb-5"><h3 className="text-sm font-bold text-zinc-800">Distribuição por Departamento</h3></div>
              {loading ? (
                <div className="py-14 text-center"><i className="ri-loader-4-line text-4xl text-zinc-200 animate-spin" /></div>
              ) : deptBreakdown.length === 0 ? (
                <p className="text-zinc-400 text-sm text-center py-14">Nenhum dado disponível</p>
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
            <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap"><div><h3 className="text-sm font-bold text-zinc-800">Detalhe Mensal</h3><p className="text-xs text-zinc-400">Mais recente primeiro</p></div></div>
              {loading ? (
                <div className="py-14 text-center"><i className="ri-loader-4-line text-4xl text-zinc-200 animate-spin" /></div>
              ) : tableData.length === 0 ? (
                <div className="py-14 text-center text-zinc-400 text-sm">Nenhum dado disponível</div>
              ) : (
                <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
                  <table className="w-full">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-zinc-200">
                        <th className="text-left pl-5 pr-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Mês</th>
                        <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Func.</th>
                        <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Bruto</th>
                        <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Líquido</th>
                        <th className="text-right pl-3 pr-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Pago</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100/80">
                      {[...tableData].reverse().map(row => (
                        <tr key={row.month} className="hover:bg-zinc-50 transition-colors">
                          <td className="pl-5 pr-3 py-2.5 text-sm text-zinc-700 font-medium whitespace-nowrap">{fullMonthLabel(row.month)}</td>
                          <td className="px-3 py-2.5 text-sm text-right tabular-nums whitespace-nowrap text-zinc-500">{row.headcount}</td>
                          <td className="px-3 py-2.5 text-sm text-right tabular-nums whitespace-nowrap text-zinc-700">{formatCurrency(row.total_gross)}</td>
                          <td className="px-3 py-2.5 text-sm text-right tabular-nums whitespace-nowrap font-semibold text-zinc-800">{formatCurrency(row.total_net)}</td>
                          <td className="pl-3 pr-5 py-2.5 text-sm text-right tabular-nums whitespace-nowrap">
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
            <div className="bg-white rounded-2xl border border-zinc-200 p-5">
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap -mx-5 -mt-5 mb-5"><h3 className="text-sm font-bold text-zinc-800">Resumo de Encargos — Período Completo</h3></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3">
                {(() => {
                  const totals = tableData.reduce((acc, row) => ({
                    gross: acc.gross + row.total_gross, net: acc.net + row.total_net,
                    inss: acc.inss + row.total_inss, fgts: acc.fgts + row.total_fgts, paid: acc.paid + row.paid,
                  }), { gross: 0, net: 0, inss: 0, fgts: 0, paid: 0 });
                  return [
                    { label: 'Total Bruto', icon: 'ri-money-dollar-circle-line', value: totals.gross, color: 'text-zinc-900' },
                    { label: 'Total INSS', icon: 'ri-government-line', value: totals.inss, color: 'text-amber-700', sub: `${totals.gross > 0 ? ((totals.inss / totals.gross) * 100).toFixed(1) : 0}% do bruto` },
                    { label: 'Total FGTS', icon: 'ri-safe-2-line', value: totals.fgts, color: 'text-amber-700', sub: `${totals.gross > 0 ? ((totals.fgts / totals.gross) * 100).toFixed(1) : 0}% do bruto` },
                    { label: 'Total Líquido', icon: 'ri-wallet-3-line', value: totals.net, color: 'text-zinc-900' },
                    { label: 'Total Pago', icon: 'ri-check-double-line', value: totals.paid, color: 'text-emerald-700', sub: `${totals.net > 0 ? ((totals.paid / totals.net) * 100).toFixed(1) : 0}% do líquido` },
                  ].map(item => (
                    <KpiCard key={item.label} label={item.label} icon={item.icon} value={formatCurrency(item.value)} valueTone={item.color} sub={item.sub} atual={item.value} semVariacao />
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: POR FUNCIONÁRIO ── */}
      {reportTab === 'funcionario' && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
            <div><h3 className="text-sm font-bold text-zinc-800">Gasto por Funcionário — Período</h3>
            <p className="text-xs text-zinc-400">{filteredRaw.length} lançamentos no período selecionado</p></div>
          </div>
          {loading ? (
            <div className="py-14 text-center"><i className="ri-loader-4-line text-4xl text-zinc-200 animate-spin" /></div>
          ) : funcionarioData.length === 0 ? (
            <div className="py-14 text-center text-zinc-400 text-sm">Nenhum dado disponível</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-200">
                    <th className="text-left pl-5 pr-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Funcionário</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Depto</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Meses</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Salário Base</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">HE</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Noturno</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">DSR</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Bônus</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">INSS</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">IRRF</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">FGTS</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Faltas</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">VT/VR</th>
                    <th className="text-right pl-3 pr-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Líquido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100/80">
                  {funcionarioData.map(f => (
                    <tr key={f.name} className="hover:bg-zinc-50 transition-colors">
                      <td className="pl-5 pr-3 py-3">
                        <p className="text-sm font-semibold text-zinc-800">{f.name}</p>
                        <p className="text-xs text-zinc-400">{f.role}</p>
                      </td>
                      <td className="px-3 py-3 text-xs text-zinc-500">{f.department}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-zinc-500">{f.months.size}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-zinc-700">{formatCurrency(f.base_salary)}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-green-600">{formatCurrency(f.overtime_50 + f.overtime_100 + f.overtime_night)}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-green-600">{formatCurrency(f.night_shift)}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-green-600">{formatCurrency(f.dsr)}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-green-600">{formatCurrency(f.bonuses)}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-orange-600">-{formatCurrency(f.total_inss)}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-red-500">-{formatCurrency(f.total_irrf)}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-amber-600">{formatCurrency(f.total_fgts)}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-red-500">-{formatCurrency(f.desconto_faltas)}</td>
                      <td className="px-3 py-3 text-sm text-right tabular-nums whitespace-nowrap text-red-500">-{formatCurrency(f.vale_transporte + f.vale_refeicao)}</td>
                      <td className="pl-3 pr-5 py-3 text-sm text-right tabular-nums whitespace-nowrap font-bold text-zinc-900">{formatCurrency(f.total_net)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-50 border-t-2 border-zinc-200">
                    <td colSpan={3} className="pl-5 pr-3 py-3 text-sm font-bold text-zinc-900">Total ({funcionarioData.length} funcionários)</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-zinc-800">{formatCurrency(funcionarioData.reduce((s, f) => s + f.base_salary, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-green-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.overtime_50 + f.overtime_100 + f.overtime_night, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-green-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.night_shift, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-green-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.dsr, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-green-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.bonuses, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-orange-600">-{formatCurrency(funcionarioData.reduce((s, f) => s + f.total_inss, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-red-500">-{formatCurrency(funcionarioData.reduce((s, f) => s + f.total_irrf, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-amber-600">{formatCurrency(funcionarioData.reduce((s, f) => s + f.total_fgts, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-red-500">-{formatCurrency(funcionarioData.reduce((s, f) => s + f.desconto_faltas, 0))}</td>
                    <td className="px-3 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-red-500">-{formatCurrency(funcionarioData.reduce((s, f) => s + f.vale_transporte + f.vale_refeicao, 0))}</td>
                    <td className="pl-3 pr-5 py-3 text-sm font-bold text-right tabular-nums whitespace-nowrap text-zinc-900">{formatCurrency(funcionarioData.reduce((s, f) => s + f.total_net, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: POR ITEM ── */}
      {reportTab === 'item' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-zinc-200 p-5">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap -mx-5 -mt-5 mb-5"><h3 className="text-sm font-bold text-zinc-800">Gasto por Item da Folha</h3></div>
            {loading ? (
              <div className="py-14 text-center"><i className="ri-loader-4-line text-4xl text-zinc-200 animate-spin" /></div>
            ) : itemData.length === 0 ? (
              <p className="text-zinc-400 text-sm text-center py-14">Nenhum dado disponível</p>
            ) : (
              <div className="space-y-3">
                {itemData.map(item => {
                  const totalGeral = itemData.reduce((s, i) => s + i.total, 0);
                  const pct = totalGeral > 0 ? (item.total / totalGeral) * 100 : 0;
                  const color = item.type === 'provento' ? '#10b981' : item.type === 'desconto' ? '#ef4444' : '#f59e0b';
                  return (
                    <div key={item.key}>
                      <button type="button" onClick={() => setItemAberto(itemAberto === item.key ? null : item.key)}
                        className="w-full flex items-center justify-between mb-1 cursor-pointer text-left">
                        <div className="flex items-center gap-2">
                          <i className={`ri-arrow-${itemAberto === item.key ? 'down' : 'right'}-s-line text-zinc-400`} />
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-sm font-medium text-zinc-700">{item.label}</span>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${item.type === 'provento' ? 'bg-emerald-50 text-emerald-700' : item.type === 'desconto' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                            {item.type === 'provento' ? 'Provento' : item.type === 'desconto' ? 'Desconto' : 'Encargo'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-zinc-800">{formatCurrency(item.total)}</span>
                          <span className="text-xs text-zinc-400 ml-2">{pct.toFixed(1)}%</span>
                        </div>
                      </button>
                      <div className="w-full bg-zinc-100 rounded-full h-2">
                        <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
                      </div>
                      {itemAberto === item.key && (
                        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-2 mb-1 pl-6 text-xs">
                          <div>
                            <p className="font-semibold text-zinc-500 mb-1">Rubricas</p>
                            {Object.entries(item.porDesc).sort((x, y) => y[1] - x[1]).map(([d, v]) => (
                              <div key={d} className="flex justify-between gap-2 py-0.5 border-b border-zinc-100">
                                <span className="text-zinc-600 truncate">{d}</span><span className="text-zinc-800 whitespace-nowrap">{formatCurrency(v)}</span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <p className="font-semibold text-zinc-500 mb-1">Por funcionário</p>
                            {Object.entries(item.porFunc).sort((x, y) => y[1] - x[1]).map(([f, v]) => (
                              <div key={f} className="flex justify-between gap-2 py-0.5 border-b border-zinc-100">
                                <span className="text-zinc-600 truncate">{f}</span><span className="text-zinc-800 whitespace-nowrap">{formatCurrency(v)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(() => {
              const proventos = itemData.filter(i => i.type === 'provento').reduce((s, i) => s + i.total, 0);
              const descontos = itemData.filter(i => i.type === 'desconto').reduce((s, i) => s + i.total, 0);
              const encargos = itemData.filter(i => i.type === 'encargo').reduce((s, i) => s + i.total, 0);
              return [
                { label: 'Total Proventos', icon: 'ri-arrow-up-circle-line', value: proventos, color: 'text-emerald-700' },
                { label: 'Total Descontos', icon: 'ri-arrow-down-circle-line', value: descontos, color: 'text-red-600' },
                { label: 'Total Encargos', icon: 'ri-safe-2-line', value: encargos, color: 'text-amber-700' },
              ].map(item => (
                <KpiCard key={item.label} label={item.label} icon={item.icon} value={formatCurrency(item.value)} valueTone={item.color} atual={item.value} semVariacao />
              ));
            })()}
          </div>

          {itemData.length > 0 && months.length > 0 && (
            <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
                <div><h3 className="text-sm font-bold text-zinc-800">Cada item, mês a mês</h3>
                <p className="text-xs text-zinc-400">Quanto foi pago (proventos), descontado (descontos) e recolhido (FGTS) em cada competência.</p></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200">
                      <th className="pl-5 pr-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 sticky left-0 bg-white">Item</th>
                      {months.map(m => <th key={m} className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400 whitespace-nowrap">{monthLabel(m)}</th>)}
                      <th className="pl-3 pr-5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100/80">
                    {itemData.map(item => (
                      <tr key={item.key} className="hover:bg-zinc-50">
                        <td className={`pl-5 pr-4 py-2 font-medium sticky left-0 bg-white whitespace-nowrap ${item.type === 'provento' ? 'text-green-700' : item.type === 'desconto' ? 'text-red-600' : 'text-amber-700'}`}>{item.label}</td>
                        {months.map(m => <td key={m} className="px-3 py-2 text-right tabular-nums text-zinc-700 whitespace-nowrap">{item.porMes[m] ? formatCurrency(item.porMes[m]) : '—'}</td>)}
                        <td className="pl-3 pr-5 py-2 text-right tabular-nums font-bold text-zinc-900 whitespace-nowrap">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: POR CATEGORIA ── */}
      {reportTab === 'categoria' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl border border-zinc-200 p-5">
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap -mx-5 -mt-5 mb-5"><h3 className="text-sm font-bold text-zinc-800">Distribuição por Categoria</h3></div>
              {loading ? (
                <div className="py-14 text-center"><i className="ri-loader-4-line text-4xl text-zinc-200 animate-spin" /></div>
              ) : categoriaData.length === 0 ? (
                <p className="text-zinc-400 text-sm text-center py-14">Nenhum dado disponível</p>
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

            <div className="bg-white rounded-2xl border border-zinc-200 p-5">
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap -mx-5 -mt-5 mb-5"><h3 className="text-sm font-bold text-zinc-800">Resumo Financeiro</h3></div>
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