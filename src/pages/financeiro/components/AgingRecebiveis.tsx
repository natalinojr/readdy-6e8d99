import { useMemo } from 'react';
import type { ReceivableInstallment } from '@/types/financeiro';
import { formatCurrency } from '@/lib/formatters';

interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number;
  count: number;
  total: number;
  pct: number;
  items: ReceivableInstallment[];
  color: string;
  bgColor: string;
  textColor: string;
  barColor: string;
}

interface Props {
  installments: ReceivableInstallment[];
  activeBucket: string | null;
  onBucketClick: (label: string | null) => void;
}

const BUCKET_DEFS = [
  { label: 'A vencer', minDays: -9999, maxDays: -1, color: 'border-green-200', bgColor: 'bg-green-50', textColor: 'text-green-700', barColor: 'bg-green-400' },
  { label: 'Vence hoje', minDays: 0, maxDays: 0, color: 'border-amber-200', bgColor: 'bg-amber-50', textColor: 'text-amber-700', barColor: 'bg-amber-400' },
  { label: '1–7 dias', minDays: 1, maxDays: 7, color: 'border-orange-200', bgColor: 'bg-orange-50', textColor: 'text-orange-700', barColor: 'bg-orange-400' },
  { label: '8–30 dias', minDays: 8, maxDays: 30, color: 'border-orange-300', bgColor: 'bg-orange-50', textColor: 'text-orange-800', barColor: 'bg-orange-500' },
  { label: '31–60 dias', minDays: 31, maxDays: 60, color: 'border-red-200', bgColor: 'bg-red-50', textColor: 'text-red-700', barColor: 'bg-red-400' },
  { label: '61–90 dias', minDays: 61, maxDays: 90, color: 'border-red-300', bgColor: 'bg-red-50', textColor: 'text-red-800', barColor: 'bg-red-500' },
  { label: '+90 dias', minDays: 91, maxDays: 9999, color: 'border-red-400', bgColor: 'bg-red-100', textColor: 'text-red-900', barColor: 'bg-red-700' },
];

export function buildAgingBuckets(installments: ReceivableInstallment[]): AgingBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Apenas pendentes e não antecipados
  const pending = installments.filter(
    (i) => i.status !== 'received' && !i.is_anticipated
  );
  const grandTotal = pending.reduce((s, i) => s + Number(i.amount), 0);

  return BUCKET_DEFS.map((def) => {
    const items = pending.filter((i) => {
      if (!i.due_date) return false;
      const due = new Date(i.due_date + 'T00:00:00');
      const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
      return days >= def.minDays && days <= def.maxDays;
    });
    const total = items.reduce((s, i) => s + Number(i.amount), 0);
    return {
      ...def,
      count: items.length,
      total,
      pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
      items,
    };
  });
}

export default function AgingRecebiveis({ installments, activeBucket, onBucketClick }: Props) {
  const buckets = useMemo(() => buildAgingBuckets(installments), [installments]);

  const totalPendente = buckets.reduce((s, b) => s + b.total, 0);
  const totalVencido = buckets
    .filter((b) => b.minDays >= 1)
    .reduce((s, b) => s + b.total, 0);
  const pctVencido = totalPendente > 0 ? (totalVencido / totalPendente) * 100 : 0;
  const hasHighOverdue = pctVencido > 20;

  if (totalPendente === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-50">
            <i className="ri-bar-chart-grouped-line text-amber-600 text-sm" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-800">Aging de Recebíveis</h3>
            <p className="text-xs text-zinc-400">Distribuição por faixa de vencimento — apenas pendentes</p>
          </div>
        </div>
        {hasHighOverdue && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
            <i className="ri-alarm-warning-line text-red-500 text-sm" />
            <span className="text-xs font-bold text-red-700">
              {pctVencido.toFixed(0)}% vencido — atenção!
            </span>
          </div>
        )}
      </div>

      {/* Barra visual horizontal */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
          {buckets.map((b) =>
            b.pct > 0 ? (
              <button
                key={b.label}
                onClick={() => onBucketClick(activeBucket === b.label ? null : b.label)}
                title={`${b.label}: ${formatCurrency(b.total)} (${b.pct.toFixed(1)}%)`}
                className={`${b.barColor} transition-all cursor-pointer hover:opacity-80 ${activeBucket === b.label ? 'ring-2 ring-offset-1 ring-zinc-400' : ''}`}
                style={{ width: `${b.pct}%` }}
              />
            ) : null
          )}
        </div>
        <div className="flex items-center gap-4 mt-2 flex-wrap">
          {buckets.filter((b) => b.count > 0).map((b) => (
            <div key={b.label} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${b.barColor}`} />
              <span className="text-xs text-zinc-500">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grid de buckets */}
      <div className="px-5 pb-5 grid grid-cols-4 gap-3 mt-2">
        {buckets.map((b) => {
          const isActive = activeBucket === b.label;
          const isOverdue = b.minDays >= 1;
          return (
            <button
              key={b.label}
              onClick={() => onBucketClick(isActive ? null : b.label)}
              className={`text-left p-3 rounded-xl border-2 transition-all cursor-pointer ${
                isActive
                  ? `${b.bgColor} ${b.color} ring-2 ring-offset-1 ring-zinc-300`
                  : b.count > 0
                  ? `${b.bgColor} ${b.color} hover:ring-1 hover:ring-zinc-300`
                  : 'bg-zinc-50 border-zinc-100 opacity-50 cursor-default'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs font-bold ${b.count > 0 ? b.textColor : 'text-zinc-400'}`}>
                  {b.label}
                </span>
                {isOverdue && b.count > 0 && (
                  <i className="ri-alarm-warning-line text-xs text-red-400" />
                )}
              </div>
              <p className={`text-base font-black ${b.count > 0 ? b.textColor : 'text-zinc-300'}`}>
                {formatCurrency(b.total)}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                {b.count} parcela{b.count !== 1 ? 's' : ''}
                {b.pct > 0 && ` · ${b.pct.toFixed(1)}%`}
              </p>
              {isActive && (
                <p className="text-[10px] text-zinc-500 mt-1 flex items-center gap-1">
                  <i className="ri-filter-line" /> Filtrando
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Resumo de vencidos */}
      {totalVencido > 0 && (
        <div className={`mx-5 mb-5 rounded-xl p-3 flex items-center justify-between ${hasHighOverdue ? 'bg-red-50 border border-red-200' : 'bg-orange-50 border border-orange-200'}`}>
          <div className="flex items-center gap-2">
            <i className={`ri-error-warning-line text-sm ${hasHighOverdue ? 'text-red-500' : 'text-orange-500'}`} />
            <span className={`text-xs font-semibold ${hasHighOverdue ? 'text-red-700' : 'text-orange-700'}`}>
              Total vencido: {formatCurrency(totalVencido)}
            </span>
            <span className={`text-xs ${hasHighOverdue ? 'text-red-500' : 'text-orange-500'}`}>
              ({pctVencido.toFixed(1)}% do total a receber)
            </span>
          </div>
          {activeBucket && (
            <button
              onClick={() => onBucketClick(null)}
              className="text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer flex items-center gap-1"
            >
              <i className="ri-close-line" /> Limpar filtro
            </button>
          )}
        </div>
      )}
    </div>
  );
}
