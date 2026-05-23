import type { InsumoZerando } from '@/hooks/useEstoqueAlertaPDV';

interface Props {
  insumosZerando: InsumoZerando[];
  onConfirmar: () => void;
  onCancelar: () => void;
}

function formatQty(value: number, unit: string): string {
  const v = Number(value);
  if (unit === 'kg' || unit === 'l') {
    return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`;
  }
  if (unit === 'g' || unit === 'ml') {
    return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`;
  }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}

export default function EstoqueZerarModal({ insumosZerando, onConfirmar, onCancelar }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border-b border-amber-200">
          <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl flex-shrink-0">
            <i className="ri-error-warning-line text-amber-600 text-xl" />
          </div>
          <div>
            <p className="font-bold text-amber-900 text-sm">Insumo vai zerar no estoque!</p>
            <p className="text-xs text-amber-700 mt-0.5">
              {insumosZerando.length === 1
                ? '1 insumo ficará sem estoque após este pedido'
                : `${insumosZerando.length} insumos ficarão sem estoque após este pedido`}
            </p>
          </div>
        </div>

        {/* Lista de insumos */}
        <div className="px-5 py-4 space-y-2.5 max-h-64 overflow-y-auto">
          {insumosZerando.map((insumo) => {
            const estoqueApos = insumo.estoqueAtual - insumo.consumoTotal;
            const vai_negativo = estoqueApos < 0;

            return (
              <div
                key={insumo.ingredientId}
                className={`rounded-xl border px-4 py-3 ${
                  vai_negativo
                    ? 'bg-red-50 border-red-200'
                    : 'bg-amber-50 border-amber-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-6 h-6 flex items-center justify-center flex-shrink-0 rounded-lg ${
                      vai_negativo ? 'bg-red-100' : 'bg-amber-100'
                    }`}>
                      <i className={`text-sm ${
                        vai_negativo ? 'ri-close-circle-line text-red-500' : 'ri-alert-line text-amber-500'
                      }`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-bold truncate ${
                        vai_negativo ? 'text-red-800' : 'text-amber-800'
                      }`}>
                        {insumo.nome}
                      </p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {insumo.itensAfetados.join(', ')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-xs font-bold ${vai_negativo ? 'text-red-600' : 'text-amber-600'}`}>
                      {vai_negativo
                        ? `−${formatQty(Math.abs(estoqueApos), insumo.unidade)}`
                        : 'Vai zerar'}
                    </p>
                    <p className="text-[10px] text-zinc-400">
                      Estoque: {formatQty(insumo.estoqueAtual, insumo.unidade)}
                    </p>
                  </div>
                </div>

                {/* Barra de consumo */}
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        vai_negativo ? 'bg-red-400' : 'bg-amber-400'
                      }`}
                      style={{
                        width: insumo.estoqueAtual > 0
                          ? `${Math.min(100, (insumo.consumoTotal / insumo.estoqueAtual) * 100)}%`
                          : '100%',
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-zinc-400 flex-shrink-0 whitespace-nowrap">
                    usa {formatQty(insumo.consumoTotal, insumo.unidade)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Aviso */}
        <div className="px-5 pb-3">
          <div className="flex items-start gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5">
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">
              <i className="ri-information-line text-zinc-400 text-sm" />
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Mesmo assim você pode confirmar o pedido. Considere atualizar o estoque depois ou avisar a cozinha sobre a falta do insumo.
            </p>
          </div>
        </div>

        {/* Botões */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onCancelar}
            className="flex-1 py-3 border-2 border-zinc-200 text-zinc-600 font-bold rounded-xl hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap text-sm"
          >
            <i className="ri-arrow-left-line mr-1.5" />
            Voltar ao carrinho
          </button>
          <button
            onClick={onConfirmar}
            className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap text-sm flex items-center justify-center gap-1.5"
          >
            <i className="ri-check-line" />
            Continuar mesmo assim
          </button>
        </div>
      </div>
    </div>
  );
}