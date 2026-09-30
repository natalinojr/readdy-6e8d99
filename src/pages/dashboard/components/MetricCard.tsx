interface MetricCardProps {
  label: string;
  value: string;
  trend?: number;
  trendLabel?: string;
  /** classe remixicon, ex.: 'ri-money-dollar-circle-line' */
  icon: string;
  /** cor do ícone quando precisa sinalizar (ex.: SLA acima do alvo) */
  alerta?: boolean;
  onClick?: () => void;
}

export default function MetricCard({
  label,
  value,
  trend,
  trendLabel,
  icon,
  alerta,
  onClick,
}: MetricCardProps) {
  const isPositive = trend !== undefined && trend >= 0;
  const subTone = trend !== undefined
    ? 'text-zinc-400'
    : trendLabel === 'No prazo' ? 'text-emerald-600' : trendLabel === 'Acima do alvo' ? 'text-red-500' : 'text-zinc-400';

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-2 ${onClick ? 'cursor-pointer hover:border-amber-300 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-amber-200' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${alerta ? 'bg-red-50 text-red-500' : 'bg-zinc-100 text-zinc-500'}`}>
            <i className={`${icon} text-sm`} />
          </span>
          <span className="text-xs font-semibold text-zinc-500 truncate">{label}</span>
        </div>
        {trend !== undefined && (
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            <i className={isPositive ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />
            {Math.abs(trend).toFixed(1).replace('.', ',')}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold tabular-nums tracking-tight text-zinc-900">{value}</p>
      {trendLabel && <p className={`text-xs ${subTone}`}>{trendLabel}</p>}
    </div>
  );
}
