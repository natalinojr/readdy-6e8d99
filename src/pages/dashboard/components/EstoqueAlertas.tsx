import { memo } from 'react';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import type { DashboardAlertaEstoque } from '../../../hooks/useDashboardMetrics';

interface Props {
  alertas: DashboardAlertaEstoque[];
}

const EstoqueAlertas = memo(function EstoqueAlertas({ alertas }: Props) {
  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Alertas de Estoque</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Insumos abaixo do mínimo</p>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${alertas.length > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
          {alertas.length > 0 ? `${alertas.length} alertas` : 'OK'}
        </span>
      </div>

      {alertas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-zinc-400">
          <div className="w-10 h-10 flex items-center justify-center bg-emerald-50 rounded-xl mb-2">
            <i className="ri-checkbox-circle-line text-emerald-500 text-xl" />
          </div>
          <p className="text-xs font-semibold text-emerald-600">Estoque em dia!</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">Nenhum insumo abaixo do mínimo</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alertas.map((item) => {
            const isCritico = item.critico;
            return (
              <div key={item.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${isCritico ? 'bg-red-50' : 'bg-amber-50'}`}>
                <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${isCritico ? 'text-red-500' : 'text-amber-500'}`}>
                  {isCritico ? <AlertCircle size={15} /> : <AlertTriangle size={15} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${isCritico ? 'text-red-700' : 'text-amber-700'}`}>{item.nome}</p>
                  <p className={`text-[10px] ${isCritico ? 'text-red-500' : 'text-amber-500'}`}>
                    {Number(item.estoque).toFixed(2)} {item.unidade} · mín: {Number(item.minimo).toFixed(2)} {item.unidade}
                  </p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${isCritico ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                  {isCritico ? 'CRÍTICO' : 'BAIXO'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default EstoqueAlertas;
