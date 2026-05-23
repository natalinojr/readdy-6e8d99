import { memo, useState } from 'react';
import { AlertTriangle, AlertCircle, TrendingDown, Package } from 'lucide-react';
import type { StockCriticalAlert } from '../../../hooks/useStockCriticalAlerts';

interface Props {
  alertas: StockCriticalAlert[];
}

const AlertasEstoqueCritico = memo(function AlertasEstoqueCritico({ alertas }: Props) {
  const [expandido, setExpandido] = useState(true);

  const criticos = alertas.filter((a) => a.nivelAlerta === 'critico');
  const alertasBaixo = alertas.filter((a) => a.nivelAlerta === 'alerta');

  if (alertas.length === 0) return null;

  return (
    <div className="bg-white border border-red-200 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpandido(!expandido)}
        className="w-full flex items-center justify-between px-4 py-3 bg-red-50 hover:bg-red-100/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
            <i className="ri-alarm-warning-line text-red-600 text-base" />
          </div>
          <div className="text-left">
            <p className="text-xs font-bold text-red-800">
              {alertas.length} insumo{alertas.length > 1 ? 's' : ''} vão zerar com os pedidos da sessão
              {criticos.length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-red-600 text-white rounded-full text-[9px] font-bold">
                  {criticos.length} crítico{criticos.length > 1 ? 's' : ''}
                </span>
              )}
            </p>
            <p className="text-[10px] text-red-500 mt-0.5">
              Projeção baseada nos pedidos em preparo da sessão atual que ainda não foram entregues
            </p>
          </div>
        </div>
        <i className={`text-red-400 text-sm ${expandido ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
      </button>

      {/* Lista */}
      {expandido && (
        <div className="divide-y divide-zinc-50">
          {alertas.map((item) => {
            const isCritico = item.nivelAlerta === 'critico';
            const pctAtual = item.minimo > 0
              ? Math.min((item.estoqueAtual / item.minimo) * 100, 100)
              : 0;
            const pctProjetado = item.minimo > 0
              ? Math.min(Math.max((item.estoqueProjetado / item.minimo) * 100, 0), 100)
              : 0;

            return (
              <div key={item.id} className={`flex items-center gap-3 px-4 py-2.5 ${isCritico ? 'bg-red-50/50' : 'bg-amber-50/30'}`}>
                <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${isCritico ? 'text-red-500' : 'text-amber-500'}`}>
                  {isCritico ? <AlertCircle size={15} /> : <AlertTriangle size={15} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className={`text-xs font-semibold truncate ${isCritico ? 'text-red-700' : 'text-amber-700'}`}>
                      {item.nome}
                    </p>
                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap ${
                      isCritico ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {isCritico ? 'VAI ZERAR' : 'VAI FICAR BAIXO'}
                    </span>
                  </div>

                  {/* Barras comparativas */}
                  <div className="space-y-1">
                    {/* Estoque atual */}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-zinc-400 w-12 whitespace-nowrap">Atual</span>
                      <div className="flex-1 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-400"
                          style={{ width: `${pctAtual}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-zinc-500 w-16 text-right whitespace-nowrap">
                        {item.estoqueAtual.toFixed(2)} {item.unidade}
                      </span>
                    </div>
                    {/* Estoque projetado */}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-zinc-400 w-12 whitespace-nowrap">Projetado</span>
                      <div className="flex-1 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isCritico ? 'bg-red-500' : 'bg-amber-400'}`}
                          style={{ width: `${pctProjetado}%` }}
                        />
                      </div>
                      <span className={`text-[9px] w-16 text-right whitespace-nowrap font-semibold ${
                        isCritico ? 'text-red-600' : 'text-amber-600'
                      }`}>
                        {item.estoqueProjetado.toFixed(2)} {item.unidade}
                      </span>
                    </div>
                  </div>

                  {/* Detalhes */}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[9px] text-zinc-400">
                      Mín: {item.minimo.toFixed(2)} {item.unidade}
                    </span>
                    {item.consumoPrevisto > 0 && (
                      <span className="text-[9px] text-zinc-400 flex items-center gap-0.5">
                        <TrendingDown size={9} />
                        -{item.consumoPrevisto.toFixed(2)} {item.unidade} em pedidos
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default AlertasEstoqueCritico;