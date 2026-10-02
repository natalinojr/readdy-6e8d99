import { useNavigate } from 'react-router-dom';
import type { DashboardFilaStatus } from '@/hooks/useDashboardPainel';

// Fila da cozinha agora (mesmo escopo do KDS: sessão aberta; sem sessão, o dia) com o mais antigo de cada
// status. O rodapé fecha com o cartão "Pedidos": pedidos pagos do sistema + iFood (o iFood não passa pelo KDS).

interface Props {
  fila: Partial<Record<'new' | 'preparing' | 'ready', DashboardFilaStatus>>;
  atrasados: number;
  atrasoMin: number;
  pagosSistema: number;
  pedidosIfood: number;
  rotuloPeriodo: string;
}

const LINHAS = [
  { k: 'new' as const, label: 'Novos', icon: 'ri-time-line', bg: 'bg-zinc-100', text: 'text-zinc-700', iconColor: 'text-zinc-500' },
  { k: 'preparing' as const, label: 'Em preparo', icon: 'ri-fire-line', bg: 'bg-amber-50', text: 'text-amber-800', iconColor: 'text-amber-500' },
  { k: 'ready' as const, label: 'Prontos', icon: 'ri-checkbox-circle-line', bg: 'bg-emerald-50', text: 'text-emerald-800', iconColor: 'text-emerald-500' },
];

export default function PedidosAgora({ fila, atrasados, atrasoMin, pagosSistema, pedidosIfood, rotuloPeriodo }: Props) {
  const navigate = useNavigate();
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Pedidos agora</h3>
          <p className="text-xs text-zinc-400">Na cozinha neste momento</p>
        </div>
        <button onClick={() => navigate('/kds')} className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer whitespace-nowrap">Abrir KDS →</button>
      </div>
      <div className="p-4 space-y-2 flex-1">
        {LINHAS.map((l) => {
          const s = fila[l.k];
          const qtd = s?.qtd ?? 0;
          const antigo = s?.mais_antigo_min ?? 0;
          const atrasou = l.k !== 'ready' && qtd > 0 && antigo >= atrasoMin;
          const dica = qtd === 0 ? null
            : l.k === 'preparing' && atrasados > 0 ? `${atrasados} há +${atrasoMin} min`
            : l.k === 'ready' ? `esperando há ${antigo} min`
            : `mais antigo ${antigo} min`;
          return (
            <div key={l.k} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${l.bg}`}>
              <i className={`${l.icon} ${l.iconColor}`} />
              <span className={`text-sm font-medium flex-1 ${l.text}`}>{l.label}</span>
              {dica && <span className={`text-[10px] whitespace-nowrap ${atrasou ? 'font-semibold text-red-600' : 'text-zinc-400'}`}>{dica}</span>}
              <span className={`text-xl font-bold tabular-nums w-8 text-right ${l.text}`}>{qtd}</span>
            </div>
          );
        })}
      </div>
      <div className="px-5 py-3 border-t border-zinc-100 text-xs flex justify-between items-center gap-2">
        <span className="text-zinc-400">{rotuloPeriodo}</span>
        <span className="text-right">
          <b className="text-zinc-800">{pagosSistema + pedidosIfood} pedidos</b>
          {pedidosIfood > 0 && <span className="text-zinc-400"> ({pagosSistema} do sistema + {pedidosIfood} iFood)</span>}
        </span>
      </div>
    </div>
  );
}
