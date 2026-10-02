// Venda por canal (pedidos pagos do sistema por origem + iFood), com a variação contra o mesmo período
// da semana passada até esta hora.

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

const CANAL: Record<string, { label: string; icon: string; cor: string }> = {
  table: { label: 'Salão (mesas)', icon: 'ri-restaurant-line', cor: 'bg-amber-400' },
  waiter: { label: 'Garçom', icon: 'ri-walk-line', cor: 'bg-yellow-400' },
  cashier: { label: 'Balcão', icon: 'ri-store-2-line', cor: 'bg-orange-400' },
  delivery: { label: 'Delivery próprio', icon: 'ri-motorbike-line', cor: 'bg-teal-400' },
  self_service: { label: 'Autoatendimento', icon: 'ri-tablet-line', cor: 'bg-violet-400' },
  ifood: { label: 'iFood', icon: 'ri-e-bike-2-line', cor: 'bg-red-400' },
};

export interface LinhaCanal { origem: string; valor: number; pedidos: number; semanaPassada?: number }

export default function PorCanal({ linhas, rotuloSemana }: { linhas: LinhaCanal[]; rotuloSemana: string | null }) {
  const ordenadas = [...linhas].filter((l) => l.valor > 0 || l.pedidos > 0).sort((a, b) => b.valor - a.valor);
  const total = ordenadas.reduce((s, l) => s + l.valor, 0);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Por canal</h3>
          <p className="text-xs text-zinc-400">Onde a venda está acontecendo{rotuloSemana ? ` · vs ${rotuloSemana}` : ''}</p>
        </div>
      </div>
      <div className="p-5">
        {ordenadas.length === 0 ? (
          <div className="py-8 text-center">
            <i className="ri-store-3-line text-3xl text-zinc-200" />
            <p className="text-zinc-400 text-sm mt-1">Sem vendas pagas ainda</p>
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
              {ordenadas.map((l) => (
                <div key={l.origem} className={CANAL[l.origem]?.cor ?? 'bg-zinc-300'} style={{ width: `${total > 0 ? (l.valor / total) * 100 : 0}%` }} />
              ))}
            </div>
            {ordenadas.map((l) => {
              const c = CANAL[l.origem] ?? { label: l.origem, icon: 'ri-shopping-bag-line', cor: 'bg-zinc-300' };
              const varPct = rotuloSemana && l.semanaPassada && l.semanaPassada > 0 ? ((l.valor - l.semanaPassada) / l.semanaPassada) * 100 : undefined;
              return (
                <div key={l.origem} className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
                    <i className={`${c.icon} ${l.origem === 'ifood' ? 'text-red-500' : 'text-zinc-500'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-700 truncate">{c.label}</p>
                    <p className="text-[10px] text-zinc-400">{l.pedidos} pedido{l.pedidos !== 1 ? 's' : ''} · {total > 0 ? Math.round((l.valor / total) * 100) : 0}%</p>
                  </div>
                  {varPct !== undefined && (
                    <span className={`text-[10px] font-semibold tabular-nums ${varPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {varPct >= 0 ? '▲' : '▼'} {Math.abs(varPct).toFixed(0)}%
                    </span>
                  )}
                  <b className="tabular-nums w-20 text-right text-zinc-800">{fmt(l.valor)}</b>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
