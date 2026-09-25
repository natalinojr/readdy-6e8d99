import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Insumo } from '@/contexts/EstoqueContext';
import { useIngredientPriceHistory } from '@/hooks/useIngredientPriceHistory';
import { useProductionPriceHistory } from '@/hooks/useProductionPriceHistory';

const fmt = (v: number, digits = 2) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits }).format(v);

// Insumo em g/ml tem preço de fração de centavo: mais casas para não virar R$ 0,00
const fmtPreco = (v: number) => fmt(v, v > 0 && v < 1 ? 4 : 2);

interface MiniPriceHistoryProps {
  insumo: Insumo;
}

export default function MiniPriceHistory({ insumo }: MiniPriceHistoryProps) {
  // Sempre busca ambos — usa produção se tiver bateladas, senão fallback para compras
  const { stats: purchaseStats, loading: purchaseLoading } = useIngredientPriceHistory(insumo.id);
  const { stats: productionStats, loading: productionLoading } = useProductionPriceHistory(insumo.id);

  const hasProductionData = productionStats && productionStats.points.length > 0;
  const isProduction = hasProductionData;

  const stats = isProduction ? productionStats : purchaseStats;
  const loading = isProduction ? productionLoading : purchaseLoading;

  if (loading) {
    return (
      <tr>
        <td colSpan={7} className="px-6 py-3 bg-amber-50/40 border-t border-amber-100">
          <div className="flex items-center gap-2 text-zinc-400 text-xs">
            <i className="ri-loader-4-line animate-spin" /> Carregando histórico...
          </div>
        </td>
      </tr>
    );
  }

  if (!stats || stats.points.length === 0) {
    return (
      <tr>
        <td colSpan={7} className="px-6 py-3 bg-zinc-50/60 border-t border-zinc-100">
          <p className="text-xs text-zinc-400 flex items-center gap-1.5">
            <i className="ri-bar-chart-2-line" />
            {isProduction
              ? 'Nenhuma produção nos últimos 6 meses — histórico de custo indisponível.'
              : 'Nenhuma compra nos últimos 3 meses — histórico indisponível.'}
          </p>
        </td>
      </tr>
    );
  }

  const prices = stats.points.map((p) => p.price);
  const sparkMax = Math.max(...prices, 0.01);
  const sparkPoints = prices.map((p, i) => {
    const x = prices.length === 1 ? 50 : (i / (prices.length - 1)) * 100;
    const y = 24 - (p / sparkMax) * 22;
    return `${x},${y}`;
  }).join(' ');

  return (
    <tr>
      <td colSpan={7} className="px-4 py-3 bg-amber-50/30 border-t border-amber-100/60">
        <div className="flex items-start gap-5 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="bg-white border border-zinc-100 rounded-lg px-3 py-2 min-w-[90px]">
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide mb-0.5">
                {isProduction ? 'Custo médio 6m' : 'Preço médio 3m'}
              </p>
              <p className="text-xs font-bold text-zinc-800">{fmtPreco(stats.avg3m)}</p>
            </div>
            <div className="bg-white border border-zinc-100 rounded-lg px-3 py-2 min-w-[90px]">
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide mb-0.5">
                {isProduction ? 'Custo médio 30 dias' : 'Média 30 dias'}
              </p>
              <p className="text-xs font-bold text-zinc-800">{fmtPreco(stats.avg1m)}</p>
            </div>
            <div className="bg-white border border-zinc-100 rounded-lg px-3 py-2 min-w-[90px]">
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide mb-0.5">Variação recente</p>
              <div className="flex items-center gap-1">
                {stats.trend === 'stable' ? (
                  <Minus size={11} className="text-zinc-400" />
                ) : stats.trend === 'up' ? (
                  <TrendingUp size={11} className="text-red-500" />
                ) : (
                  <TrendingDown size={11} className="text-emerald-500" />
                )}
                <p className={`text-xs font-bold ${
                  stats.trend === 'stable' ? 'text-zinc-500'
                  : stats.trend === 'up' ? 'text-red-600'
                  : 'text-emerald-600'
                }`}>
                  {stats.trend === 'stable' ? 'Estável' : `${stats.trendPct > 0 ? '+' : ''}${stats.trendPct.toFixed(1)}%`}
                </p>
              </div>
            </div>
            <div className="bg-white border border-zinc-100 rounded-lg px-3 py-2 min-w-[110px]">
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide mb-0.5">
                {isProduction ? 'Faixa 6m' : 'Faixa 3m'}
              </p>
              <p className="text-xs font-semibold text-zinc-700">{fmtPreco(stats.minPrice)} – {fmtPreco(stats.maxPrice)}</p>
            </div>
          </div>

          {prices.length > 1 && (
            <div className="flex-1 min-w-[200px] max-w-xl">
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide mb-1">
                {isProduction ? 'Evolução do custo (6 meses)' : 'Evolução do preço (3 meses)'}
              </p>
              {/* Preço em cada ponto (HTML por cima: o SVG estica e deformaria o texto) */}
              <div className="relative pt-4 px-6">
              <div className="relative">
              <svg viewBox="0 0 100 26" className="w-full h-10 overflow-visible" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="miniGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <polygon points={`0,26 ${sparkPoints} 100,26`} fill="url(#miniGrad)" />
                <polyline points={sparkPoints} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                {prices.map((p, i) => {
                  const x = prices.length === 1 ? 50 : (i / (prices.length - 1)) * 100;
                  const y = 24 - (p / sparkMax) * 22;
                  return <circle key={i} cx={x} cy={y} r="1.5" fill="#f59e0b" vectorEffect="non-scaling-stroke" />;
                })}
              </svg>
              {stats.points.map((pt, i) => {
                const x = prices.length === 1 ? 50 : (i / (prices.length - 1)) * 100;
                const y = ((24 - (pt.price / sparkMax) * 22) / 26) * 100;
                // Muitos pontos: mostra o preço de 1 em cada N (sempre o primeiro e o último) para não encavalar
                const passo = Math.ceil(prices.length / 8);
                if (i % passo !== 0 && i !== prices.length - 1) return null;
                return (
                  <span key={i}
                    title={`${new Date(pt.date + 'T00:00:00').toLocaleDateString('pt-BR')} · ${'supplier' in pt ? pt.supplier : 'produção'} · ${fmtPreco(pt.price)}`}
                    className="absolute -translate-x-1/2 -translate-y-full -mt-1 text-[9px] font-semibold text-amber-700 whitespace-nowrap bg-white/80 rounded px-0.5 leading-tight"
                    style={{ left: `${x}%`, top: `${y}%` }}>
                    {fmtPreco(pt.price)}
                  </span>
                );
              })}
              </div>
              </div>
              <div className="flex justify-between text-[9px] text-zinc-400 mt-0.5">
                <span>{stats.points[0]?.date ? new Date(stats.points[0].date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : ''}</span>
                <span className="font-semibold text-amber-600">{fmtPreco(stats.lastPrice)}</span>
                <span>{stats.points[stats.points.length - 1]?.date ? new Date(stats.points[stats.points.length - 1].date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : ''}</span>
              </div>
            </div>
          )}

          <p className="text-[9px] text-zinc-400 self-end">
            {isProduction
              ? `${stats.points.length} produção${stats.points.length !== 1 ? 's' : ''} nos últimos 6 meses`
              : `${stats.points.length} compra${stats.points.length !== 1 ? 's' : ''} nos últimos 3 meses`}
          </p>
        </div>
      </td>
    </tr>
  );
}