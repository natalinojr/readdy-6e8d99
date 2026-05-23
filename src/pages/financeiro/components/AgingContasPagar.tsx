import { useMemo } from 'react';
import type { BillPayable } from '@/types/financeiro';
import { formatCurrency } from '@/lib/formatters';

interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number;
  count: number;
  total: number;
  pct: number;
  color: string;
  bgColor: string;
  textColor: string;
  barColor: string;
}

interface SupplierAging {
  supplier: string;
  total: number;
  overdue: number;
  pending: number;
  oldestDue: string;
  count: number;
}

interface Props {
  bills: BillPayable[];
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

function buildBuckets(bills: BillPayable[]): AgingBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const unpaid = bills.filter((b) => b.status !== 'paid');
  const grandTotal = unpaid.reduce((s, b) => s + Number(b.amount), 0);

  return BUCKET_DEFS.map((def) => {
    const items = unpaid.filter((b) => {
      if (!b.due_date) return false;
      const due = new Date(b.due_date + 'T00:00:00');
      const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
      return days >= def.minDays && days <= def.maxDays;
    });
    const total = items.reduce((s, b) => s + Number(b.amount), 0);
    return {
      ...def,
      count: items.length,
      total,
      pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
    };
  });
}

function buildSupplierAging(bills: BillPayable[]): SupplierAging[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const unpaid = bills.filter((b) => b.status !== 'paid' && b.supplier);
  const map: Record<string, SupplierAging> = {};

  for (const b of unpaid) {
    const key = b.supplier ?? 'Sem fornecedor';
    if (!map[key]) {
      map[key] = { supplier: key, total: 0, overdue: 0, pending: 0, oldestDue: b.due_date ?? '', count: 0 };
    }
    const amount = Number(b.amount);
    map[key].total += amount;
    map[key].count += 1;

    const due = b.due_date ? new Date(b.due_date + 'T00:00:00') : null;
    const isOverdue = due ? due < today : false;
    if (isOverdue) {
      map[key].overdue += amount;
    } else {
      map[key].pending += amount;
    }

    // Oldest due date
    if (b.due_date && (!map[key].oldestDue || b.due_date < map[key].oldestDue)) {
      map[key].oldestDue = b.due_date;
    }
  }

  return Object.values(map)
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

export default function AgingContasPagar({ bills, activeBucket, onBucketClick }: Props) {
  const buckets = useMemo(() => buildBuckets(bills), [bills]);
  const supplierAging = useMemo(() => buildSupplierAging(bills), [bills]);

  const totalUnpaid = buckets.reduce((s, b) => s + b.total, 0);
  const totalVencido = buckets.filter((b) => b.minDays >= 1).reduce((s, b) => s + b.total, 0);
  const pctVencido = totalUnpaid > 0 ? (totalVencido / totalUnpaid) * 100 : 0;
  const hasHighOverdue = pctVencido > 20;

  if (totalUnpaid === 0) return null;

  return (
    <div className="space-y-4">
      {/* ── Aging por faixa ── */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50">
              <i className="ri-bar-chart-grouped-line text-red-500 text-sm" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-800">Aging de Contas a Pagar</h3>
              <p className="text-xs text-zinc-400">Distribuição por faixa de vencimento — apenas em aberto</p>
            </div>
          </div>
          {hasHighOverdue && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              <i className="ri-alarm-warning-line text-red-500 text-sm" />
              <span className="text-xs font-bold text-red-700">
                {pctVencido.toFixed(0)}% vencido — risco de inadimplência!
              </span>
            </div>
          )}
        </div>

        {/* Barra visual */}
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
                onClick={() => b.count > 0 && onBucketClick(isActive ? null : b.label)}
                className={`text-left p-3 rounded-xl border-2 transition-all ${
                  b.count === 0
                    ? 'bg-zinc-50 border-zinc-100 opacity-40 cursor-default'
                    : isActive
                    ? `${b.bgColor} ${b.color} ring-2 ring-offset-1 ring-zinc-300 cursor-pointer`
                    : `${b.bgColor} ${b.color} hover:ring-1 hover:ring-zinc-300 cursor-pointer`
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
                  {b.count} conta{b.count !== 1 ? 's' : ''}
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

        {/* Resumo vencidos */}
        {totalVencido > 0 && (
          <div className={`mx-5 mb-5 rounded-xl p-3 flex items-center justify-between ${hasHighOverdue ? 'bg-red-50 border border-red-200' : 'bg-orange-50 border border-orange-200'}`}>
            <div className="flex items-center gap-2">
              <i className={`ri-error-warning-line text-sm ${hasHighOverdue ? 'text-red-500' : 'text-orange-500'}`} />
              <span className={`text-xs font-semibold ${hasHighOverdue ? 'text-red-700' : 'text-orange-700'}`}>
                Total vencido: {formatCurrency(totalVencido)}
              </span>
              <span className={`text-xs ${hasHighOverdue ? 'text-red-500' : 'text-orange-500'}`}>
                ({pctVencido.toFixed(1)}% do total em aberto)
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

      {/* ── Aging por Fornecedor ── */}
      {supplierAging.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-100 bg-zinc-50">
            <h3 className="text-xs font-bold text-zinc-600 uppercase tracking-wide flex items-center gap-2">
              <i className="ri-building-2-line text-zinc-400" /> Inadimplência por Fornecedor
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">Fornecedores com débitos em aberto, ordenados por valor vencido</p>
          </div>
          <div className="divide-y divide-zinc-50">
            {supplierAging.map((s) => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const oldestDue = s.oldestDue ? new Date(s.oldestDue + 'T00:00:00') : null;
              const daysOldest = oldestDue
                ? Math.floor((today.getTime() - oldestDue.getTime()) / 86400000)
                : 0;
              const isCritical = daysOldest > 30 && s.overdue > 0;

              return (
                <div
                  key={s.supplier}
                  className={`flex items-center gap-4 px-5 py-3.5 ${isCritical ? 'bg-red-50/40' : 'hover:bg-zinc-50'} transition-colors`}
                >
                  {/* Ícone */}
                  <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${isCritical ? 'bg-red-100' : 'bg-zinc-100'}`}>
                    <i className={`ri-store-2-line text-sm ${isCritical ? 'text-red-500' : 'text-zinc-400'}`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-zinc-800 truncate">{s.supplier}</p>
                      {isCritical && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">
                          +30 dias vencido
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-zinc-400">
                        {s.count} conta{s.count !== 1 ? 's' : ''} em aberto
                      </span>
                      {s.oldestDue && (
                        <span className="text-xs text-zinc-400">
                          Mais antiga: {new Date(s.oldestDue + 'T00:00:00').toLocaleDateString('pt-BR')}
                          {daysOldest > 0 && (
                            <span className={`ml-1 font-semibold ${daysOldest > 30 ? 'text-red-500' : daysOldest > 7 ? 'text-orange-500' : 'text-zinc-500'}`}>
                              ({daysOldest}d atrás)
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Mini barra overdue vs pending */}
                    {s.total > 0 && (
                      <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5 gap-0.5 max-w-48">
                        {s.overdue > 0 && (
                          <div
                            className="bg-red-400 rounded-full"
                            style={{ width: `${(s.overdue / s.total) * 100}%` }}
                            title={`Vencido: ${formatCurrency(s.overdue)}`}
                          />
                        )}
                        {s.pending > 0 && (
                          <div
                            className="bg-green-400 rounded-full"
                            style={{ width: `${(s.pending / s.total) * 100}%` }}
                            title={`A vencer: ${formatCurrency(s.pending)}`}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Valores */}
                  <div className="text-right flex-shrink-0 space-y-0.5">
                    <p className="text-sm font-bold text-zinc-800">{formatCurrency(s.total)}</p>
                    {s.overdue > 0 && (
                      <p className="text-xs font-semibold text-red-600">
                        <i className="ri-alarm-warning-line mr-0.5" />
                        {formatCurrency(s.overdue)} vencido
                      </p>
                    )}
                    {s.pending > 0 && (
                      <p className="text-xs text-green-600">
                        {formatCurrency(s.pending)} a vencer
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
