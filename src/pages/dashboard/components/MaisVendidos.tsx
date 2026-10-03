// Itens mais vendidos de hoje (por quantidade), dos pedidos do sistema. O iFood fica de fora:
// a API de Vendas do iFood só traz valores, não os itens do pedido.
import { memo } from 'react';
import type { ItemRevenue } from '@/hooks/useVisaoGeralExtras';

interface Props {
  data: ItemRevenue[];
  loading?: boolean;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

const MaisVendidos = memo(function MaisVendidos({ data, loading }: Props) {
  const top = data.slice(0, 8);
  const maxQtd = top[0]?.total_qty ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Mais vendidos</h3>
          <p className="text-xs text-zinc-400" title="A API do iFood não traz os itens dos pedidos, por isso o iFood não entra aqui.">
            Hoje · pedidos do sistema (sem iFood)
          </p>
        </div>
        <i className="ri-trophy-line text-amber-500 text-lg" />
      </div>
      <div className="p-5 flex-1 flex flex-col">
        {loading && data.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-14">
            <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : top.length === 0 ? (
          <div className="flex-1 py-14 text-center">
            <i className="ri-trophy-line text-4xl text-zinc-200" />
            <p className="text-zinc-400 text-sm mt-2">Sem vendas hoje</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {top.map((it, i) => (
              <li key={it.item_name} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-500'}`}>
                    {i + 1}
                  </span>
                  <span className="flex-1 min-w-0 truncate font-medium text-zinc-700" title={it.item_name}>{it.item_name}</span>
                  <b className="tabular-nums text-zinc-800">{it.total_qty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×</b>
                  <span className="tabular-nums text-zinc-400 w-16 text-right">{fmt(it.total_revenue)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden ml-7">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${maxQtd > 0 ? (it.total_qty / maxQtd) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
});

export default MaisVendidos;
