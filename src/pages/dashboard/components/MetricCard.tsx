import { TrendingUp, TrendingDown } from 'lucide-react';
import type { ComponentType } from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  trend?: number;
  trendLabel?: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  iconBg: string;
  iconColor: string;
  onClick?: () => void;
}

export default function MetricCard({
  label,
  value,
  trend,
  trendLabel,
  icon: Icon,
  iconBg,
  iconColor,
  onClick,
}: MetricCardProps) {
  const isPositive = trend !== undefined && trend >= 0;

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`bg-white border border-zinc-100 rounded-xl p-5 ${onClick ? 'cursor-pointer hover:border-rose-200 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-rose-200' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold text-zinc-900 mt-1.5">{value}</p>
          {(trend !== undefined || trendLabel) && (
            <div className="flex items-center gap-1 mt-1.5">
              {trend !== undefined && (
                <div
                  className={`flex items-center gap-0.5 text-xs font-semibold ${
                    isPositive ? 'text-emerald-600' : 'text-red-500'
                  }`}
                >
                  {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {Math.abs(trend).toFixed(1)}%
                </div>
              )}
              {trendLabel && (
                <span className={`text-xs font-medium ${trend !== undefined ? 'text-zinc-400' : trendLabel === 'No prazo' ? 'text-emerald-600' : trendLabel === 'Acima do alvo' ? 'text-red-500' : 'text-zinc-400'}`}>
                  {trendLabel}
                </span>
              )}
            </div>
          )}
        </div>
        <div className={`w-11 h-11 flex items-center justify-center rounded-xl ${iconBg}`}>
          <Icon size={20} className={iconColor} />
        </div>
      </div>
    </div>
  );
}
