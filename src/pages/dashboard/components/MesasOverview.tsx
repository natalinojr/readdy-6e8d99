import { memo, useState } from 'react';
import type { DashboardMesa } from '../../../hooks/useDashboardMetrics';

interface Props { mesas: DashboardMesa[]; }

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function formatTempo(minutos: number | null): string {
  if (minutos === null) return '';
  const m = Math.round(minutos);
  if (m >= 60) return `${Math.floor(m / 60)}h${(m % 60).toString().padStart(2, '0')}m`;
  return `${m}min`;
}

const MesaDetalheModal = memo(function MesaDetalheModal({ mesa, onClose }: { mesa: DashboardMesa; onClose: () => void }) {
  const isOcupada = mesa.status === 'occupied';
  const numero = mesa.numero;

  if (!isOcupada) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div className="bg-white rounded-2xl p-6 w-full max-w-xs sm:w-72" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-zinc-800">Mesa {numero}</h3>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 cursor-pointer"><i className="ri-close-line text-sm text-zinc-500" /></button>
          </div>
          <div className="flex flex-col items-center py-4 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-xl mb-3"><i className="ri-restaurant-line text-xl text-zinc-400" /></div>
            <p className="text-sm font-semibold text-zinc-400">Mesa Livre</p>
          </div>
        </div>
      </div>
    );
  }

  const realMesa = mesa;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-xs sm:w-80" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-xl"><span className="text-sm font-black text-amber-700">{numero}</span></div>
            <div>
              <h3 className="text-sm font-bold text-zinc-800">Mesa {numero}</h3>
              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">OCUPADA</span>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 cursor-pointer"><i className="ri-close-line text-sm text-zinc-500" /></button>
        </div>
        <div className="space-y-2">
          {realMesa.tempo !== null && (
            <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2"><i className="ri-time-line text-zinc-400 text-sm" /><span className="text-xs text-zinc-500">Tempo na mesa</span></div>
              <span className="text-xs font-bold text-zinc-800">{formatTempo(realMesa.tempo)}</span>
            </div>
          )}
          {realMesa.pessoas > 0 && (
            <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2"><i className="ri-group-line text-zinc-400 text-sm" /><span className="text-xs text-zinc-500">Pessoas</span></div>
              <span className="text-xs font-bold text-zinc-800">{realMesa.pessoas}</span>
            </div>
          )}
          <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2"><i className="ri-money-dollar-circle-line text-amber-500 text-sm" /><span className="text-xs text-amber-700 font-semibold">Consumo atual</span></div>
            <span className="text-sm font-black text-amber-700">{fmt(Number(realMesa.valor) || 0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

const MesasOverview = memo(function MesasOverview({ mesas }: Props) {
  const [mesaSelecionada, setMesaSelecionada] = useState<DashboardMesa | null>(null);
  const ocupadas = mesas.filter((m) => m.status === 'occupied').length;

  if (mesas.length === 0) {
    return (
      <div className="bg-white border border-zinc-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Mapa de Mesas</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Nenhuma mesa em uso no momento</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl mb-3">
            <i className="ri-layout-grid-line text-zinc-400 text-lg" />
          </div>
          <p className="text-sm text-zinc-400">Nenhuma mesa aberta hoje</p>
          <p className="text-xs text-zinc-300 mt-1">As mesas aparecerão aqui quando estiverem em uso</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-zinc-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Mapa de Mesas</h3>
            <p className="text-xs text-zinc-400 mt-0.5">{ocupadas} ocupadas · {mesas.length - ocupadas} livres</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />Ocupada</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-100 border border-zinc-200 inline-block" />Livre</span>
          </div>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
          {mesas.map((mesa) => {
            const isOcupada = mesa.status === 'occupied';
            return (
              <button key={mesa.numero} onClick={() => setMesaSelecionada(mesa)}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs font-semibold transition-all cursor-pointer ${isOcupada ? 'bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100' : 'bg-zinc-50 border border-zinc-100 text-zinc-400 hover:bg-zinc-100'}`}>
                <span className="text-sm font-bold">{mesa.numero}</span>
                {isOcupada && mesa.tempo !== null && (
                  <span className="text-[9px] font-medium text-amber-500 mt-0.5">{formatTempo(mesa.tempo)}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {mesaSelecionada && <MesaDetalheModal mesa={mesaSelecionada} onClose={() => setMesaSelecionada(null)} />}
    </>
  );
});

export default MesasOverview;
