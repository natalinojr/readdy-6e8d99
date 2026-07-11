import { memo } from 'react';
import { Clock, Flame, CheckCircle, Package } from 'lucide-react';

interface Props {
  novos: number;
  emPreparo: number;
  prontos: number;
  entregues: number;
}

const statuses = [
  { key: 'novos', label: 'Novos', icon: Clock, bg: 'bg-zinc-100', text: 'text-zinc-700', iconColor: 'text-zinc-500' },
  { key: 'emPreparo', label: 'Em Preparo', icon: Flame, bg: 'bg-amber-50', text: 'text-amber-700', iconColor: 'text-amber-500' },
  { key: 'prontos', label: 'Prontos', icon: CheckCircle, bg: 'bg-emerald-50', text: 'text-emerald-700', iconColor: 'text-emerald-500' },
  { key: 'entregues', label: 'Entregues', icon: Package, bg: 'bg-zinc-50', text: 'text-zinc-400', iconColor: 'text-zinc-300' },
];

const PedidosStatus = memo(function PedidosStatus({ novos, emPreparo, prontos, entregues }: Props) {
  const data: Record<string, number> = { novos, emPreparo, prontos, entregues };
  const total = novos + emPreparo + prontos + entregues;

  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-zinc-800 mb-1">Pedidos Agora</h3>
      <p className="text-xs text-zinc-400 mb-5">Status dos pedidos de hoje</p>
      <div className="space-y-3">
        {statuses.map((s) => (
          <div key={s.key} className={`flex items-center justify-between px-4 py-3 rounded-xl ${s.bg}`}>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 flex items-center justify-center">
                <s.icon size={16} className={s.iconColor} />
              </div>
              <span className={`text-sm font-medium ${s.text}`}>{s.label}</span>
            </div>
            <span className={`text-xl font-bold ${s.text}`}>{data[s.key]}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-4 border-t border-zinc-100 flex justify-between items-center">
        <span className="text-xs text-zinc-400">Total de hoje</span>
        <span className="text-sm font-bold text-zinc-800">{total} pedido{total !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
});

export default PedidosStatus;
