import { useMemo } from 'react';
import { ShoppingCart, Package, AlertTriangle, ArrowDownLeft, ArrowUpRight, Clock, Hash, TrendingDown } from 'lucide-react';
import { useConsumoDetalhe, ConsumoNoDia } from '@/hooks/useConsumoDetalhe';
import type { UnidadeEstoque } from '@/types/estoque';

interface Props {
  ingredientId: string;
  ingredientUnit: UnidadeEstoque;
  dateFrom: string;
  dateTo: string;
}

const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const ORIGIN_LABELS: Record<string, { label: string; color: string }> = {
  cashier:      { label: 'Caixa',          color: 'bg-amber-100 text-amber-700' },
  waiter:       { label: 'Garçom',         color: 'bg-sky-100 text-sky-700' },
  delivery:     { label: 'Delivery',       color: 'bg-emerald-100 text-emerald-700' },
  kiosk:        { label: 'Totem',          color: 'bg-violet-100 text-violet-700' },
  self_service: { label: 'Autoatend.',     color: 'bg-rose-100 text-rose-700' },
  table:        { label: 'Mesa',           color: 'bg-teal-100 text-teal-700' },
};

const BUCKET_STYLE: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  vendas:        { icon: <ShoppingCart size={10} />, color: 'text-amber-600 bg-amber-50 border-amber-100', label: 'Venda' },
  producao:      { icon: <Package size={10} />,      color: 'text-sky-600 bg-sky-50 border-sky-100',      label: 'Produção' },
  perda:         { icon: <AlertTriangle size={10} />, color: 'text-red-600 bg-red-50 border-red-100',    label: 'Perda' },
  ajuste:        { icon: <TrendingDown size={10} />, color: 'text-zinc-500 bg-zinc-50 border-zinc-100',  label: 'Ajuste' },
  transferencia: { icon: <ArrowUpRight size={10} />, color: 'text-violet-600 bg-violet-50 border-violet-100', label: 'Transfer.' },
};

function OrigemBadge({ tipo }: { tipo: string | null }) {
  const info = tipo ? ORIGIN_LABELS[tipo] : null;
  if (!info) return <span className="text-[10px] text-zinc-400">—</span>;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${info.color}`}>
      {info.label}
    </span>
  );
}

function BucketBadge({ bucket, qty, unit }: { bucket: string; qty: number; unit: string }) {
  const s = BUCKET_STYLE[bucket] ?? BUCKET_STYLE.ajuste;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-medium ${s.color}`}>
      {s.icon} {s.label}: {fmtNum(qty)} {unit}
    </span>
  );
}

function DiaCard({ dia, unidade }: { dia: ConsumoNoDia; unidade: string }) {
  const activeBuckets = Object.entries(dia.buckets).filter(([, v]) => v > 0);

  return (
    <div className="border border-zinc-100 rounded-xl bg-white overflow-hidden">
      {/* Header do dia */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-50 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <div className="text-center min-w-[40px]">
            <p className="text-[10px] font-medium text-zinc-400 uppercase">{dia.diaSemana}</p>
            <p className="text-sm font-bold text-zinc-800">{dia.dataLabel}</p>
          </div>
          <div className="h-8 w-px bg-zinc-200" />
          <div>
            <p className="text-xs font-bold text-zinc-800">
              {fmtNum(dia.totalQtd)} <span className="font-normal text-zinc-500">{unidade}</span>
            </p>
            <p className="text-[10px] text-zinc-400">{dia.movimentos.filter(m => m.qty > 0).length} mov.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 justify-end">
          {activeBuckets.map(([bucket, qty]) => (
            <BucketBadge key={bucket} bucket={bucket} qty={qty} unit={unidade} />
          ))}
        </div>
      </div>

      {/* Pedidos relacionados */}
      {dia.pedidos.length > 0 && (
        <div className="px-4 py-2 border-b border-zinc-50">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase mb-1.5 flex items-center gap-1">
            <ShoppingCart size={10} />
            {dia.pedidos.length} pedido{dia.pedidos.length > 1 ? 's' : ''} vinculado{dia.pedidos.length > 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {dia.pedidos.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-1.5 px-2 py-1 bg-white border border-zinc-100 rounded-lg hover:border-amber-200 transition-colors"
              >
                <Hash size={10} className="text-zinc-400" />
                <span className="text-xs font-semibold text-zinc-700">
                  {p.number ?? p.id.slice(0, 6)}
                </span>
                {p.tableNumber ? (
                  <span className="text-[10px] text-zinc-500">Mesa {p.tableNumber}</span>
                ) : p.destinationName ? (
                  <span className="text-[10px] text-zinc-500 max-w-[80px] truncate">{p.destinationName}</span>
                ) : null}
                <OrigemBadge tipo={p.originType} />
                {p.paidByPdv && (
                  <OrigemBadge tipo={p.paidByPdv} />
                )}
                <span className="text-[10px] font-medium text-emerald-600">{fmtMoney(p.total)}</span>
                {(p.status === 'cancelled' || p.status === 'cancelado') && (
                  <span className="text-[9px] text-red-500 font-bold">CANC.</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline de movimentos */}
      <div className="px-4 py-2">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase mb-1.5 flex items-center gap-1">
          <Clock size={10} />
          Movimentações
        </p>
        <div className="space-y-1">
          {dia.movimentos.map(m => {
            const isEntrada = m.qty < 0;
            const bucket = BUCKET_STYLE[m.bucket] ?? BUCKET_STYLE.ajuste;
            return (
              <div key={m.id} className="flex items-center gap-2 text-[10px] text-zinc-500">
                <span className="text-zinc-400 font-mono w-10 shrink-0">{m.hora}</span>
                {isEntrada ? (
                  <ArrowDownLeft size={10} className="text-emerald-500 shrink-0" />
                ) : (
                  <ArrowUpRight size={10} className="text-red-400 shrink-0" />
                )}
                <span className={`font-medium ${isEntrada ? 'text-emerald-600' : 'text-red-500'}`}>
                  {isEntrada ? '+' : '-'}{fmtNum(Math.abs(m.qty))} {unidade}
                </span>
                <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] border ${bucket.color}`}>
                  {bucket.icon}
                  {bucket.label}
                </span>
                {m.reason && (
                  <span className="text-zinc-400 truncate max-w-[160px]" title={m.reason}>
                    {m.reason}
                  </span>
                )}
                {m.orderId && !dia.pedidos.find(p => p.id === m.orderId) && (
                  <span className="text-zinc-400 font-mono">#{m.orderId.slice(0, 6)}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ConsumoDetalheDia({ ingredientId, ingredientUnit, dateFrom, dateTo }: Props) {
  const { dias, loading, error } = useConsumoDetalhe(ingredientId, ingredientUnit, dateFrom, dateTo);

  const totalConsumo = useMemo(
    () => dias.reduce((s, d) => s + d.totalQtd, 0),
    [dias],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 px-4">
        <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-zinc-400">Carregando consumo por dia...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3">
        <p className="text-xs text-red-500">{error}</p>
      </div>
    );
  }

  if (dias.length === 0) {
    return (
      <div className="px-4 py-4 text-center">
        <p className="text-xs text-zinc-400">Nenhuma movimentação no período selecionado.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3 bg-zinc-50/60 border-t border-zinc-100">
      {/* Cabeçalho do detalhe */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-600 flex items-center gap-1.5">
          <TrendingDown size={12} className="text-amber-500" />
          Consumo por dia — {dias.length} dia{dias.length > 1 ? 's' : ''} com movimentação
        </p>
        <span className="text-xs text-zinc-500">
          Total: <strong className="text-zinc-800">{fmtNum(totalConsumo)} {ingredientUnit}</strong>
        </span>
      </div>

      {/* Cards por dia */}
      {dias.map(dia => (
        <DiaCard key={dia.data} dia={dia} unidade={ingredientUnit} />
      ))}
    </div>
  );
}