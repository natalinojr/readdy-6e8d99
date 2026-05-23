import { memo } from 'react';
import type { KDSPedido } from '@/types/kds';

interface Props {
  prontos: KDSPedido[];
  entregues: KDSPedido[];
  emRota: KDSPedido[];
  somAtivo: boolean;
  onShowProntos: () => void;
  onShowEntregues: () => void;
}

export const KDSStatusBar = memo(function KDSStatusBar({
  prontos,
  entregues,
  emRota,
  somAtivo,
  onShowProntos,
  onShowEntregues,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0 overflow-x-auto border-b border-amber-200/60" style={{ background: 'linear-gradient(90deg, #fef3c7 0%, #fffbeb 40%, #fff 100%)' }}>
      <span className="text-amber-700/60 text-[11px] font-medium flex-shrink-0 hidden sm:inline">
        Consultar:
      </span>

      {/* Prontos */}
      <button
        onClick={onShowProntos}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-all flex-shrink-0 ${
          prontos.length > 0
            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
            : 'bg-amber-50 text-amber-600/60 border border-amber-200 hover:bg-amber-100'
        }`}
      >
        <i className={`ri-check-line text-xs ${prontos.length > 0 ? 'text-emerald-600' : 'text-amber-400/60'}`} />
        Prontos
        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
          prontos.length > 0 ? 'bg-emerald-500 text-white' : 'bg-amber-200 text-amber-600/60'
        }`}>
          {prontos.length}
        </span>
      </button>

      {/* Entregues */}
      <button
        onClick={onShowEntregues}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors flex-shrink-0 border border-amber-200"
      >
        <i className="ri-check-double-line text-xs text-amber-500" />
        Entregues
        <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-700">
          {entregues.length}
        </span>
      </button>

      {/* Alerta prontos aguardando */}
      {prontos.length > 0 && (
        <span className="text-emerald-700 text-[11px] font-semibold flex-shrink-0 hidden sm:flex items-center gap-1">
          <i className="ri-alarm-warning-line text-xs" />
          {prontos.length} aguardando entrega
        </span>
      )}

      {/* Em rota */}
      {emRota.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-50 border border-orange-200 rounded-lg flex-shrink-0">
          <i className="ri-bike-line text-orange-500 text-xs" />
          <span className="text-orange-600 text-[11px] font-semibold hidden sm:inline">
            {emRota.length} em rota
          </span>
          <span className="text-orange-600 text-[11px] font-semibold sm:hidden">{emRota.length}</span>
        </div>
      )}

      {/* Legenda SLA */}
      <div className="ml-auto flex items-center gap-3 flex-shrink-0">
        {[
          { dot: 'bg-emerald-500', label: 'Dentro do SLA' },
          { dot: 'bg-amber-400',   label: 'Atenção (+50%)' },
          { dot: 'bg-red-500',     label: 'SLA Ultrapassado' },
        ].map(({ dot, label }) => (
          <div key={label} className="hidden lg:flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            <span className="text-amber-700/60 text-[10px]">{label}</span>
          </div>
        ))}
        <span className="text-amber-700/60 text-[10px] hidden lg:inline">
          {somAtivo ? 'Som ON' : 'Som OFF'}
        </span>
      </div>
    </div>
  );
});
