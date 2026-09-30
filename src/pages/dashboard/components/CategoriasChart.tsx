import { memo } from 'react';
import type { CategoryRevenue } from '@/hooks/useVisaoGeralExtras';

interface Props {
  data: CategoryRevenue[];
  loading?: boolean;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

const COLORS = [
  'bg-amber-400',
  'bg-emerald-400',
  'bg-orange-400',
  'bg-teal-400',
  'bg-rose-400',
  'bg-violet-400',
  'bg-cyan-400',
  'bg-pink-400',
];

const CategoriasChart = memo(function CategoriasChart({ data, loading }: Props) {
  const total = data.reduce((s, c) => s + c.total_revenue, 0);
  const top = data.slice(0, 7);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Faturamento por Categoria</h3>
          <p className="text-xs text-zinc-400">Hoje</p>
        </div>
        {data.length > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 tabular-nums">
            {fmt(total)}
          </span>
        )}
      </div>
      <div className="p-5 flex-1 flex flex-col">

      {loading ? (
        <div className="flex-1 flex items-center justify-center py-14">
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data.length === 0 ? (
        <div className="flex-1 py-14 text-center">
          <i className="ri-pie-chart-line text-4xl text-zinc-200" />
          <p className="text-zinc-400 text-sm mt-2">Sem dados hoje</p>
          <p className="text-xs text-zinc-300 mt-1">As categorias aparecerão quando houver vendas</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {/* Mini barra empilhada */}
          <div className="flex h-2 rounded-full overflow-hidden gap-px mb-1">
            {top.map((cat, i) => {
              const pct = total > 0 ? (cat.total_revenue / total) * 100 : 0;
              return (
                <div
                  key={cat.category_name}
                  className={`${COLORS[i % COLORS.length]} transition-all`}
                  style={{ width: `${pct}%`, minWidth: pct > 0 ? 2 : 0 }}
                  title={`${cat.category_name}: ${fmt(cat.total_revenue)}`}
                />
              );
            })}
          </div>

          {/* Lista */}
          {top.map((cat, i) => {
            const pct = total > 0 ? (cat.total_revenue / total) * 100 : 0;
            return (
              <div key={cat.category_name} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${COLORS[i % COLORS.length]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-zinc-700 truncate">{cat.category_name}</span>
                    <span className="text-xs font-bold text-zinc-800 ml-2 whitespace-nowrap tabular-nums">{fmt(cat.total_revenue)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${COLORS[i % COLORS.length]} opacity-70`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-zinc-400 w-8 text-right whitespace-nowrap">{pct.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
});

export default CategoriasChart;
