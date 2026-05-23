import type { ReactNode } from 'react';
import type { KDSPedidoStatus } from '@/types/kds';

interface Props {
  status: KDSPedidoStatus;
  count: number;
  children: ReactNode;
  /** Mostrar botão de inverter ordem (só para novo e preparo) */
  invertSort?: boolean;
  onToggleSort?: () => void;
  sortLabel?: string;
}

const COLUNA_CONFIG: Record<KDSPedidoStatus, {
  label: string;
  icon: string;
  dot: string;
  headerText: string;
  badgeColor: string;
  bodyBg: string;
}> = {
  novo: {
    label: 'Novos Pedidos',
    icon: 'ri-notification-3-line',
    dot: 'bg-amber-400',
    headerText: 'text-zinc-700',
    badgeColor: 'bg-amber-500 text-white',
    bodyBg: '',
  },
  preparo: {
    label: 'Em Preparo',
    icon: 'ri-fire-line',
    dot: 'bg-orange-400',
    headerText: 'text-zinc-700',
    badgeColor: 'bg-orange-400 text-white',
    bodyBg: '',
  },
  pronto: {
    label: 'Prontos',
    icon: 'ri-check-line',
    dot: 'bg-emerald-500',
    headerText: 'text-zinc-700',
    badgeColor: 'bg-emerald-500 text-white',
    bodyBg: '',
  },
  entregue: {
    label: 'Entregues',
    icon: 'ri-check-double-line',
    dot: 'bg-zinc-300',
    headerText: 'text-zinc-500',
    badgeColor: 'bg-zinc-300 text-zinc-600',
    bodyBg: 'opacity-70',
  },
};

export default function KDSColuna({ status, count, children, invertSort, onToggleSort, sortLabel }: Props) {
  const cfg = COLUNA_CONFIG[status];

  return (
    <div
      className="flex flex-col flex-1 min-w-0 rounded-xl overflow-hidden border border-zinc-200/70"
      style={{
        background: status === 'novo'
          ? 'linear-gradient(160deg, rgba(254,243,199,0.65) 0%, rgba(255,255,255,0.80) 60%)'
          : status === 'preparo'
          ? 'linear-gradient(160deg, rgba(186,230,253,0.50) 0%, rgba(255,255,255,0.80) 60%)'
          : 'rgba(255,255,255,0.70)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header neutro com dot colorido */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/80 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
          <span className={`font-semibold text-sm ${cfg.headerText}`}>{cfg.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {invertSort && onToggleSort && (
            <button
              onClick={onToggleSort}
              title={sortLabel ?? 'Inverter ordem'}
              className="flex items-center gap-1 text-[10px] font-semibold text-zinc-500 hover:text-zinc-700 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-full cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-arrow-up-down-line text-[10px]" />
              {sortLabel}
            </button>
          )}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badgeColor}`}>
            {count}
          </span>
        </div>
      </div>

      {/* Cards scroll area */}
      <div className={`flex-1 overflow-y-auto p-3 ${cfg.bodyBg}`}>
        {count === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-8 h-8 flex items-center justify-center mb-2">
              <i className={`${cfg.icon} text-2xl text-zinc-200`} />
            </div>
            <p className="text-xs text-zinc-300">Nenhum pedido</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
