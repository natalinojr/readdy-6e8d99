import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/formatters';
import type { Purchase } from '@/types/financeiro';

const COLORS = ['#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899'];

interface Props {
  purchases: Purchase[];
}

const PERIOD_OPTIONS = [
  { label: 'Último mês', value: '1m' },
  { label: '3 meses', value: '3m' },
  { label: '6 meses', value: '6m' },
  { label: '12 meses', value: '12m' },
  { label: 'Tudo', value: 'all' },
];

function getMinDate(period: string): string {
  if (period === 'all') return '';
  const d = new Date();
  const months = period === '1m' ? 1 : period === '3m' ? 3 : period === '6m' ? 6 : 12;
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split('T')[0];
}

const CustomBarTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
      <p className="font-semibold text-zinc-700 mb-1">{label}</p>
      <p className="text-amber-600 font-bold">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

const CustomPieTooltip = ({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: { pct: number } }[] }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
      <p className="font-semibold text-zinc-700">{p.name}</p>
      <p className="text-amber-600 font-bold mt-0.5">{formatCurrency(p.value)}</p>
      <p className="text-zinc-400">{p.payload.pct.toFixed(1)}% do total</p>
    </div>
  );
};

export default function ComprasRelatorioPanel({ purchases }: Props) {
  const [period, setPeriod] = useState('6m');

  const filtered = useMemo(() => {
    const minDate = getMinDate(period);
    if (!minDate) return purchases;
    return purchases.filter(p => p.purchase_date >= minDate);
  }, [purchases, period]);

  // Por mês
  const porMes = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(p => {
      const mes = p.purchase_date.slice(0, 7);
      map[mes] = (map[mes] ?? 0) + Number(p.total_amount);
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => ({
        name: new Date(name + '-01').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        value,
      }));
  }, [filtered]);

  // Por fornecedor
  const porFornecedor = useMemo(() => {
    const map: Record<string, { total: number; count: number; lastDate: string }> = {};
    filtered.forEach(p => {
      const key = p.supplier || 'Sem fornecedor';
      if (!map[key]) map[key] = { total: 0, count: 0, lastDate: p.purchase_date };
      map[key].total += Number(p.total_amount);
      map[key].count += 1;
      if (p.purchase_date > map[key].lastDate) map[key].lastDate = p.purchase_date;
    });
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  // Por forma de pagamento (para pizza)
  const porPagamento = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(p => {
      const key = p.payment_method || 'Outros';
      map[key] = (map[key] ?? 0) + Number(p.total_amount);
    });
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map)
      .map(([name, value]) => ({ name, value, pct: total > 0 ? (value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const totalGeral = porFornecedor.reduce((s, f) => s + f.total, 0);
  const mediaCompra = filtered.length > 0 ? totalGeral / filtered.length : 0;
  const maiorCompra = filtered.reduce((max, p) => Math.max(max, p.total_amount), 0);

  if (purchases.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 py-16 text-center">
        <i className="ri-bar-chart-2-line text-4xl text-zinc-200 block mb-2" />
        <p className="text-zinc-400 text-sm">Nenhuma compra para exibir relatório</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Period filter */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-700">
          Analisando <span className="text-amber-600">{filtered.length}</span> compras
          {period !== 'all' && <span className="text-zinc-400 font-normal"> no período selecionado</span>}
        </p>
        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          {PERIOD_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setPeriod(opt.value)}
              className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${period === opt.value ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total no Período', value: formatCurrency(totalGeral), icon: 'ri-shopping-cart-2-line', color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'Ticket Médio', value: formatCurrency(mediaCompra), icon: 'ri-scales-line', color: 'text-zinc-700', bg: 'bg-zinc-50' },
          { label: 'Maior Compra', value: formatCurrency(maiorCompra), icon: 'ri-trophy-line', color: 'text-green-700', bg: 'bg-green-50' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg ${k.bg}`}>
              <i className={`${k.icon} ${k.color} text-lg`} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">{k.label}</p>
              <p className={`text-base font-bold ${k.color}`}>{k.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Chart: Por Mês */}
      {porMes.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h4 className="text-sm font-semibold text-zinc-800 mb-4">Compras por Mês</h4>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={porMes} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={48}>
                {porMes.map((_, i) => (
                  <Cell key={i} fill={i === porMes.length - 1 ? '#f59e0b' : '#e5e7eb'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-2 gap-5">
        {/* Ranking fornecedores */}
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-zinc-800">Ranking de Fornecedores</h4>
            <span className="text-xs text-zinc-400">{porFornecedor.length} fornecedores</span>
          </div>
          <div className="divide-y divide-zinc-50 max-h-72 overflow-y-auto">
            {porFornecedor.map((f, i) => {
              const pct = totalGeral > 0 ? (f.total / totalGeral) * 100 : 0;
              return (
                <div key={f.name} className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 transition-colors">
                  <div className="w-6 h-6 flex items-center justify-center rounded-md text-xs font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-zinc-800 truncate">{f.name}</p>
                      <p className="text-xs font-bold text-zinc-900 ml-2 whitespace-nowrap">{formatCurrency(f.total)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                      </div>
                      <span className="text-xs text-zinc-400 whitespace-nowrap">{pct.toFixed(0)}%</span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">{f.count} compra{f.count > 1 ? 's' : ''} · {new Date(f.lastDate + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pizza: por forma de pagamento */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h4 className="text-sm font-semibold text-zinc-800 mb-4">Por Forma de Pagamento</h4>
          {porPagamento.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={porPagamento}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {porPagamento.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                  <Legend
                    formatter={(value) => <span className="text-xs text-zinc-600">{value}</span>}
                    iconSize={8}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {porPagamento.map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-zinc-600">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-800">{formatCurrency(p.value)}</span>
                      <span className="text-zinc-400 w-10 text-right">{p.pct.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-40 text-zinc-300 text-sm">Sem dados</div>
          )}
        </div>
      </div>
    </div>
  );
}
