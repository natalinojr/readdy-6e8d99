import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
  PieChart, Pie, Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/formatters';
import type { Purchase } from '@/types/financeiro';
import { KpiCard, Segmented } from './dreUi';

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
        // Meio do mês em hora local: 'AAAA-MM-01' puro é UTC e vira o mês anterior no Brasil.
        name: new Date(name + '-15T00:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''),
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
  const maiorCompraDe = filtered.find(p => p.total_amount === maiorCompra)?.supplier;

  if (purchases.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 py-16 text-center">
        <i className="ri-bar-chart-2-line text-4xl text-zinc-200 block mb-2" />
        <p className="text-zinc-400 text-sm">Nenhuma compra para exibir relatório</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Period filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="overflow-x-auto">
          <Segmented
            value={period}
            onChange={setPeriod}
            options={PERIOD_OPTIONS.map(opt => ({ id: opt.value, label: opt.label, icon: opt.value === 'all' ? 'ri-infinity-line' : 'ri-calendar-line' }))}
          />
        </div>
        <span className="text-xs text-zinc-400">
          <strong className="text-zinc-700">{filtered.length}</strong> compra{filtered.length !== 1 ? 's' : ''}
          {period !== 'all' ? ' no período' : ' no total'}
        </span>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-3 gap-3">
        <KpiCard label="Total no período" icon="ri-shopping-cart-2-line" value={formatCurrency(totalGeral)}
          sub={`${porFornecedor.length} fornecedor${porFornecedor.length !== 1 ? 'es' : ''}`} atual={totalGeral} semVariacao />
        <KpiCard label="Ticket médio" icon="ri-scales-line" value={formatCurrency(mediaCompra)}
          sub="Valor médio por compra" atual={mediaCompra} semVariacao />
        <KpiCard label="Maior compra" icon="ri-trophy-line" value={formatCurrency(maiorCompra)}
          sub={maiorCompraDe ? `De ${maiorCompraDe}` : undefined} atual={maiorCompra} semVariacao />
      </div>

      {/* Chart: Por Mês */}
      {porMes.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-zinc-800">Compras por mês</h3>
            <p className="text-xs text-zinc-400">O mês mais recente em destaque</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={porMes} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomBarTooltip />} cursor={{ fill: '#fafafa' }} />
              <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={48}>
                {porMes.map((_, i) => (
                  <Cell key={i} fill={i === porMes.length - 1 ? '#f59e0b' : '#e5e7eb'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Ranking fornecedores */}
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-zinc-800">Ranking de fornecedores</h3>
            <span className="text-xs text-zinc-400">{porFornecedor.length} fornecedores</span>
          </div>
          <div className="divide-y divide-zinc-100/80 max-h-80 overflow-y-auto">
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
                      <p className="text-xs font-bold text-zinc-900 ml-2 whitespace-nowrap tabular-nums">{formatCurrency(f.total)}</p>
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
        <div className="bg-white rounded-2xl border border-zinc-200 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-zinc-800">Por forma de pagamento</h3>
            <p className="text-xs text-zinc-400">Como as compras do período foram pagas</p>
          </div>
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
                      <span className="font-semibold text-zinc-800 tabular-nums">{formatCurrency(p.value)}</span>
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
