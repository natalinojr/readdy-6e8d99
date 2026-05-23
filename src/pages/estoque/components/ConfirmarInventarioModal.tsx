import type { InventarioItemContado } from '../../../contexts/EstoqueContext';

const fmt = (v: number, digits = 2) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits }).format(v);

interface Props {
  itens: InventarioItemContado[];
  operador: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export default function ConfirmarInventarioModal({ itens, operador, onConfirmar, onCancelar }: Props) {
  const comDiff = itens.filter((i) => i.diferenca !== 0);
  const semDiff = itens.filter((i) => i.diferenca === 0);
  const faltando = comDiff.filter((i) => i.diferenca < 0);
  const sobrando = comDiff.filter((i) => i.diferenca > 0);

  const valorImpacto = comDiff.reduce((s, i) => s + i.diferenca * i.precoUnitario, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header — warning */}
        <div className="flex items-start gap-4 px-6 py-5 bg-amber-50 border-b border-amber-200">
          <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl flex-shrink-0 mt-0.5">
            <i className="ri-alert-line text-amber-600 text-xl" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-zinc-900 mb-1">Confirmar Contagem de Inventário?</h2>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Esta ação <strong>atualizará os valores reais do estoque</strong> de acordo com as quantidades contadas.
              Todas as diferenças serão registradas no histórico de movimentações e não podem ser desfeitas.
            </p>
          </div>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-4 gap-0 border-b border-zinc-100 flex-shrink-0">
          <div className="px-5 py-4 text-center border-r border-zinc-100">
            <p className="text-xl font-black text-zinc-800">{itens.length}</p>
            <p className="text-[10px] text-zinc-500">itens contados</p>
          </div>
          <div className="px-5 py-4 text-center border-r border-zinc-100">
            <p className="text-xl font-black text-zinc-500">{semDiff.length}</p>
            <p className="text-[10px] text-zinc-500">sem diferença</p>
          </div>
          <div className="px-5 py-4 text-center border-r border-zinc-100">
            <p className={`text-xl font-black ${comDiff.length > 0 ? 'text-red-500' : 'text-zinc-500'}`}>{comDiff.length}</p>
            <p className="text-[10px] text-zinc-500">com diferença</p>
          </div>
          <div className="px-5 py-4 text-center">
            <p className={`text-xl font-black ${valorImpacto < 0 ? 'text-red-500' : valorImpacto > 0 ? 'text-emerald-600' : 'text-zinc-500'}`}>
              {valorImpacto >= 0 ? '+' : ''}{fmt(valorImpacto)}
            </p>
            <p className="text-[10px] text-zinc-500">impacto financeiro</p>
          </div>
        </div>

        {/* Lista de diferenças */}
        <div className="flex-1 overflow-y-auto">
          {comDiff.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 flex items-center justify-center bg-emerald-50 rounded-full mb-3">
                <i className="ri-checkbox-circle-line text-3xl text-emerald-500" />
              </div>
              <p className="text-sm font-semibold text-zinc-700">Nenhuma diferença encontrada!</p>
              <p className="text-xs text-zinc-400 mt-1">O estoque físico está igual ao sistema.</p>
            </div>
          ) : (
            <div>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider px-6 py-3 border-b border-zinc-50">
                Itens com diferença — serão ajustados no estoque
              </p>
              {faltando.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-6 py-2 bg-red-50">
                    <i className="ri-arrow-down-line text-red-500 text-xs" />
                    <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider">
                      Faltando ({faltando.length})
                    </span>
                  </div>
                  {faltando.map((item) => (
                    <div key={item.insumoId} className="flex items-center gap-3 px-6 py-3 border-b border-zinc-50 hover:bg-zinc-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-zinc-800 truncate">{item.insumoNome}</p>
                        <p className="text-[10px] text-zinc-400">
                          Sistema: {item.qtdTeorica} {item.unidade} → Contado: {item.qtdContada} {item.unidade}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-bold text-red-500">
                          {item.diferenca.toFixed(3)} {item.unidade}
                        </p>
                        <p className="text-[10px] text-zinc-400">{fmt(item.diferenca * item.precoUnitario)}</p>
                      </div>
                      <span className="text-[9px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200 flex-shrink-0">
                        FALTA
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {sobrando.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-6 py-2 bg-emerald-50">
                    <i className="ri-arrow-up-line text-emerald-600 text-xs" />
                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                      Sobrando ({sobrando.length})
                    </span>
                  </div>
                  {sobrando.map((item) => (
                    <div key={item.insumoId} className="flex items-center gap-3 px-6 py-3 border-b border-zinc-50 hover:bg-zinc-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-zinc-800 truncate">{item.insumoNome}</p>
                        <p className="text-[10px] text-zinc-400">
                          Sistema: {item.qtdTeorica} {item.unidade} → Contado: {item.qtdContada} {item.unidade}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-bold text-emerald-600">
                          +{item.diferenca.toFixed(3)} {item.unidade}
                        </p>
                        <p className="text-[10px] text-zinc-400">{fmt(item.diferenca * item.precoUnitario)}</p>
                      </div>
                      <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex-shrink-0">
                        SOBRA
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Operador + ações */}
        <div className="px-6 py-4 border-t border-zinc-100 bg-zinc-50 flex items-center gap-4 flex-shrink-0">
          <div className="flex-1">
            <p className="text-[10px] text-zinc-400">Responsável pela contagem</p>
            <p className="text-xs font-semibold text-zinc-700">{operador}</p>
          </div>
          <button
            onClick={onCancelar}
            className="px-4 py-2.5 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center gap-2"
          >
            <i className="ri-check-double-line" />
            Confirmar e Atualizar Estoque
          </button>
        </div>
      </div>
    </div>
  );
}
