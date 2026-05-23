import type { Mesa } from '@/types/pdv';
import type { CarrinhoItem } from '../../../../contexts/PDVContext';

interface Props {
  mesaDestino: Mesa;
  mesasOcupadas: Mesa[];
  pedidosPorMesa: Record<string, CarrinhoItem[]>;
  onConfirmar: (mesaOrigem: Mesa) => void;
  onVoltar: () => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function TransferirMesaModal({
  mesaDestino,
  mesasOcupadas,
  pedidosPorMesa,
  onConfirmar,
  onVoltar,
}: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: 'min(90dvh, 90vh)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100 bg-zinc-50 flex-shrink-0">
          <button
            onClick={onVoltar}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-500 transition-colors"
          >
            <i className="ri-arrow-left-line text-base" />
          </button>
          <div>
            <p className="font-bold text-zinc-900 text-sm">Transferir para Mesa {mesaDestino.numero}</p>
            <p className="text-xs text-zinc-500">Selecione a mesa de origem</p>
          </div>
        </div>

        {/* Info */}
        <div className="mx-5 mt-4 mb-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex-shrink-0">
          <div className="flex items-start gap-2">
            <i className="ri-information-line text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800 leading-relaxed">
              Todos os itens consumidos na mesa selecionada serão movidos para a{' '}
              <strong>Mesa {mesaDestino.numero}</strong>. A mesa de origem ficará livre.
            </p>
          </div>
        </div>

        {/* Lista de mesas ocupadas */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2">
          {mesasOcupadas.map((m) => {
            const itens = pedidosPorMesa[m.id] ?? [];
            const total = m.totalConsumo ?? itens.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);
            const totalItens = itens.reduce((acc, i) => acc + i.quantidade, 0);

            return (
              <button
                key={m.id}
                onClick={() => onConfirmar(m)}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-zinc-200 hover:border-amber-400 hover:bg-amber-50 transition-all cursor-pointer text-left group"
              >
                {/* Número da mesa */}
                <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-amber-100 rounded-xl group-hover:bg-amber-200 transition-colors">
                  <span className="text-2xl font-black text-amber-700">{m.numero}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-zinc-900 truncate">
                    {m.clienteNome || `Mesa ${m.numero}`}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {m.garcomNome && (
                      <span className="text-[10px] text-zinc-400">
                        <i className="ri-walk-line mr-0.5" />{m.garcomNome.split(' ')[0]}
                      </span>
                    )}
                    {totalItens > 0 && (
                      <span className="text-[10px] text-zinc-400">
                        {totalItens} {totalItens === 1 ? 'item' : 'itens'}
                      </span>
                    )}
                    {m.abertaEm && (
                      <span className="text-[10px] text-zinc-400">desde {m.abertaEm}</span>
                    )}
                  </div>
                </div>

                {/* Total */}
                <div className="flex-shrink-0 text-right">
                  <p className="text-sm font-bold text-zinc-800">{formatPrice(total)}</p>
                  <p className="text-[10px] text-zinc-400">{m.capacidade} lugares</p>
                </div>

                <i className="ri-arrow-right-line text-zinc-300 group-hover:text-amber-500 transition-colors flex-shrink-0" />
              </button>
            );
          })}

          {mesasOcupadas.length === 0 && (
            <div className="text-center py-8">
              <i className="ri-table-line text-3xl text-zinc-200 block mb-2" />
              <p className="text-sm text-zinc-400">Nenhuma mesa ocupada disponível</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
