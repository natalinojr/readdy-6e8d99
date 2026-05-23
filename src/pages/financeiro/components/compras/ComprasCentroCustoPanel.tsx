import { useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/formatters';
import type { Purchase } from '@/types/financeiro';

interface CostCenter { id: string; name: string; color?: string; }

interface Props {
  purchases: Purchase[];
  centers: CostCenter[];
}

type PeriodFilter = 'all' | '30d' | '90d' | 'year';

function getDateLimit(period: PeriodFilter): string | null {
  if (period === 'all') return null;
  const now = new Date();
  if (period === '30d') now.setDate(now.getDate() - 30);
  else if (period === '90d') now.setDate(now.getDate() - 90);
  else if (period === 'year') now.setMonth(now.getMonth() - 12);
  return now.toISOString().split('T')[0];
}

export default function ComprasCentroCustoPanel({ purchases, centers }: Props) {
  const [period, setPeriod] = useState<PeriodFilter>('30d');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const centersMap = useMemo(() => {
    const m: Record<string, string> = {};
    centers.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [centers]);

  const filteredPurchases = useMemo(() => {
    const limit = getDateLimit(period);
    if (!limit) return purchases;
    return purchases.filter((p) => p.purchase_date >= limit);
  }, [purchases, period]);

  // Agrupa por centro de custo (compra total + itens com cost_center_id)
  const grouped = useMemo(() => {
    const map: Record<string, {
      id: string;
      name: string;
      total: number;
      count: number;
      purchases: { id: string; supplier: string; date: string; amount: number; }[];
    }> = {};

    const ensure = (id: string, name: string) => {
      if (!map[id]) map[id] = { id, name, total: 0, count: 0, purchases: [] };
    };

    filteredPurchases.forEach((p) => {
      // Verifica se algum item tem cost_center_id próprio
      const itemsWithCC = (p.items ?? []).filter((it: any) => it.cost_center_id);
      const hasPerItemCC = itemsWithCC.length > 0;

      if (hasPerItemCC) {
        // Distribui por item
        const itemsWithoutCC = (p.items ?? []).filter((it: any) => !it.cost_center_id);
        itemsWithCC.forEach((it: any) => {
          const ccId = it.cost_center_id;
          const ccName = centersMap[ccId] ?? 'Desconhecido';
          ensure(ccId, ccName);
          map[ccId].total += Number(it.total_price ?? 0);
          map[ccId].count += 1;
          if (!map[ccId].purchases.find((x) => x.id === p.id)) {
            map[ccId].purchases.push({ id: p.id, supplier: p.supplier, date: p.purchase_date, amount: Number(it.total_price ?? 0) });
          } else {
            const existing = map[ccId].purchases.find((x) => x.id === p.id)!;
            existing.amount += Number(it.total_price ?? 0);
          }
        });
        // Itens sem CC vão para "Sem centro de custo"
        if (itemsWithoutCC.length > 0) {
          const semCC = itemsWithoutCC.reduce((s: number, it: any) => s + Number(it.total_price ?? 0), 0);
          ensure('__none__', 'Sem centro de custo');
          map['__none__'].total += semCC;
          map['__none__'].count += 1;
          if (!map['__none__'].purchases.find((x) => x.id === p.id)) {
            map['__none__'].purchases.push({ id: p.id, supplier: p.supplier, date: p.purchase_date, amount: semCC });
          } else {
            map['__none__'].purchases.find((x) => x.id === p.id)!.amount += semCC;
          }
        }
      } else {
        // Usa o cost_center_id da compra toda
        const ccId = p.cost_center_id || '__none__';
        const ccName = p.cost_center_id ? (centersMap[p.cost_center_id] ?? 'Desconhecido') : 'Sem centro de custo';
        ensure(ccId, ccName);
        map[ccId].total += Number(p.total_amount ?? 0);
        map[ccId].count += 1;
        map[ccId].purchases.push({ id: p.id, supplier: p.supplier, date: p.purchase_date, amount: Number(p.total_amount ?? 0) });
      }
    });

    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filteredPurchases, centersMap]);

  const grandTotal = grouped.reduce((s, g) => s + g.total, 0);

  const COLORS = [
    'bg-amber-500', 'bg-emerald-500', 'bg-sky-500', 'bg-violet-500',
    'bg-rose-500', 'bg-orange-500', 'bg-teal-500', 'bg-indigo-500',
  ];

  const fmt = (v: number) => formatCurrency(v);
  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');

  if (filteredPurchases.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 p-12 text-center">
        <i className="ri-pie-chart-2-line text-4xl text-zinc-200 block mb-3" />
        <p className="text-zinc-400 text-sm">Nenhuma compra no período selecionado</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtro de período */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-500 font-semibold">Período:</span>
        {([
          { key: '30d', label: 'Últimos 30 dias' },
          { key: '90d', label: 'Últimos 90 dias' },
          { key: 'year', label: 'Último ano' },
          { key: 'all', label: 'Tudo' },
        ] as const).map((opt) => (
          <button key={opt.key} onClick={() => setPeriod(opt.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${
              period === opt.key ? 'bg-amber-500 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:border-amber-300'
            }`}>
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-400">
          {filteredPurchases.length} compra{filteredPurchases.length !== 1 ? 's' : ''} · Total: <strong className="text-zinc-700">{fmt(grandTotal)}</strong>
        </span>
      </div>

      {/* Gráfico de barras horizontal */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-3">
        <h4 className="text-sm font-bold text-zinc-800">Distribuição por Centro de Custo</h4>
        <div className="space-y-2.5">
          {grouped.map((g, idx) => {
            const pct = grandTotal > 0 ? (g.total / grandTotal) * 100 : 0;
            const colorClass = COLORS[idx % COLORS.length];
            return (
              <div key={g.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colorClass}`} />
                    <span className="text-xs font-semibold text-zinc-700">{g.name}</span>
                    <span className="text-[10px] text-zinc-400">{g.count} compra{g.count !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400">{pct.toFixed(1)}%</span>
                    <span className="text-sm font-bold text-zinc-800">{fmt(g.total)}</span>
                  </div>
                </div>
                <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cards detalhados por centro de custo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {grouped.map((g, idx) => {
          const pct = grandTotal > 0 ? (g.total / grandTotal) * 100 : 0;
          const colorClass = COLORS[idx % COLORS.length];
          const isExpanded = expandedId === g.id;

          return (
            <div key={g.id} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : g.id)}
                className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClass} text-white flex-shrink-0`}>
                    <i className="ri-price-tag-3-line text-sm" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-zinc-800">{g.name}</p>
                    <p className="text-xs text-zinc-400">{g.count} compra{g.count !== 1 ? 's' : ''} · {pct.toFixed(1)}% do total</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-base font-black text-zinc-900">{fmt(g.total)}</p>
                  {isExpanded
                    ? <i className="ri-arrow-up-s-line text-zinc-400 text-sm" />
                    : <i className="ri-arrow-down-s-line text-zinc-400 text-sm" />
                  }
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-zinc-100">
                  <div className="px-4 py-2 bg-zinc-50 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Compras incluídas</span>
                    <span className="text-[10px] text-zinc-400">{g.purchases.length} registro{g.purchases.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="divide-y divide-zinc-50 max-h-48 overflow-y-auto">
                    {g.purchases.map((p) => (
                      <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <p className="text-xs font-semibold text-zinc-700">{p.supplier}</p>
                          <p className="text-[10px] text-zinc-400">{fmtDate(p.date)}</p>
                        </div>
                        <span className="text-xs font-bold text-zinc-800">{fmt(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-50 border-t border-zinc-100">
                    <span className="text-xs font-bold text-zinc-600">Subtotal</span>
                    <span className="text-sm font-black text-zinc-900">{fmt(g.total)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Tabela resumo */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50">
          <h4 className="text-xs font-bold text-zinc-600 uppercase tracking-wide">Resumo Consolidado</h4>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-zinc-500">Centro de Custo</th>
              <th className="text-right px-5 py-2.5 text-xs font-semibold text-zinc-500">Compras</th>
              <th className="text-right px-5 py-2.5 text-xs font-semibold text-zinc-500">Total</th>
              <th className="text-right px-5 py-2.5 text-xs font-semibold text-zinc-500">% do Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {grouped.map((g, idx) => {
              const pct = grandTotal > 0 ? (g.total / grandTotal) * 100 : 0;
              const colorClass = COLORS[idx % COLORS.length];
              return (
                <tr key={g.id} className="hover:bg-zinc-50">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${colorClass}`} />
                      <span className="text-xs font-semibold text-zinc-700">{g.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs text-zinc-500">{g.count}</td>
                  <td className="px-5 py-2.5 text-right text-sm font-bold text-zinc-800">{fmt(g.total)}</td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="text-xs font-semibold text-zinc-500">{pct.toFixed(1)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-200 bg-zinc-50">
              <td className="px-5 py-3 text-xs font-bold text-zinc-700">Total Geral</td>
              <td className="px-5 py-3 text-right text-xs font-bold text-zinc-700">{filteredPurchases.length}</td>
              <td className="px-5 py-3 text-right text-sm font-black text-zinc-900">{fmt(grandTotal)}</td>
              <td className="px-5 py-3 text-right text-xs font-bold text-zinc-500">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
