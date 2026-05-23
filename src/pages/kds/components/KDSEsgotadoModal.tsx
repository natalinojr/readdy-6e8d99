import { memo, useMemo } from 'react';
import type { Insumo } from '@/types/estoque';
import type { Item } from '@/types/cardapio';

interface Props {
  insumos: Insumo[];
  insumosEsgotados: string[];
  itensAtivos: Item[];
  buscaInsumo: string;
  insumoEsgotadoId: string;
  operadorNome: string;
  onBuscaChange: (v: string) => void;
  onSelecionarInsumo: (id: string) => void;
  onConfirmar: () => void;
  onClose: () => void;
}

export const KDSEsgotadoModal = memo(function KDSEsgotadoModal({
  insumos,
  insumosEsgotados,
  itensAtivos,
  buscaInsumo,
  insumoEsgotadoId,
  onBuscaChange,
  onSelecionarInsumo,
  onConfirmar,
  onClose,
}: Props) {
  const insumosFiltrados = useMemo(() => {
    const disponiveis = insumos.filter((i) => !insumosEsgotados.includes(i.id));
    if (!buscaInsumo.trim()) return disponiveis;
    const q = buscaInsumo.toLowerCase();
    return disponiveis.filter((i) => i.nome.toLowerCase().includes(q));
  }, [insumos, insumosEsgotados, buscaInsumo]);

  const itensAfetados = useMemo(() => {
    if (!insumoEsgotadoId) return [];
    return itensAtivos.filter((item) =>
      item.fichaTecnica?.some((ft) => ft.insumoId === insumoEsgotadoId),
    );
  }, [insumoEsgotadoId, itensAtivos]);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-md p-6 border border-zinc-700 max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-3 mb-4 flex-shrink-0">
          <div className="w-10 h-10 flex items-center justify-center bg-orange-500/20 rounded-xl">
            <i className="ri-forbid-2-line text-orange-400 text-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-bold text-sm">Marcar Insumo Esgotado</h3>
            <p className="text-zinc-400 text-xs">Itens afetados serão sinalizados no cardápio</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-700 cursor-pointer flex-shrink-0"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Busca */}
        <div className="relative mb-3 flex-shrink-0">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            type="text"
            value={buscaInsumo}
            onChange={(e) => onBuscaChange(e.target.value)}
            placeholder="Buscar insumo..."
            className="w-full text-sm bg-zinc-700 border border-zinc-600 rounded-xl pl-9 pr-4 py-2.5 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Lista de insumos */}
        <div className="flex-1 overflow-y-auto space-y-1 mb-4 min-h-0">
          {insumosFiltrados.length === 0 ? (
            <p className="text-zinc-500 text-xs text-center py-4">
              {buscaInsumo ? 'Nenhum insumo encontrado' : 'Todos os insumos estão disponíveis'}
            </p>
          ) : (
            insumosFiltrados.map((insumo) => (
              <button
                key={insumo.id}
                onClick={() => onSelecionarInsumo(insumo.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all text-left ${
                  insumoEsgotadoId === insumo.id
                    ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                    : 'bg-zinc-700/50 border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    insumoEsgotadoId === insumo.id ? 'bg-orange-400' : 'bg-zinc-500'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{insumo.nome}</p>
                  <p className="text-[10px] text-zinc-500 truncate">
                    Estoque: {insumo.estoqueAtual} {insumo.unidade}
                  </p>
                </div>
                {insumoEsgotadoId === insumo.id && (
                  <i className="ri-check-line text-orange-400 flex-shrink-0" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Itens afetados */}
        {itensAfetados.length > 0 && (
          <div className="mb-4 p-3 bg-red-900/20 border border-red-700/30 rounded-xl flex-shrink-0">
            <p className="text-xs font-bold text-red-400 mb-2 flex items-center gap-1.5">
              <i className="ri-alarm-warning-line" />
              {itensAfetados.length}{' '}
              {itensAfetados.length === 1 ? 'item afetado' : 'itens afetados'} no cardápio:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {itensAfetados.map((item) => (
                <span
                  key={item.id}
                  className="text-[10px] font-medium bg-red-900/40 text-red-300 border border-red-700/40 px-2 py-0.5 rounded-full"
                >
                  {item.nome}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Esgotados já marcados */}
        {insumosEsgotados.length > 0 && (
          <div className="mb-4 p-3 bg-zinc-700/40 rounded-xl flex-shrink-0">
            <p className="text-[10px] font-bold text-zinc-400 mb-1.5">Já esgotados nesta sessão:</p>
            <div className="flex flex-wrap gap-1">
              {insumosEsgotados.map((id) => {
                const ins = insumos.find((i) => i.id === id);
                return ins ? (
                  <span
                    key={id}
                    className="text-[9px] font-medium bg-orange-900/40 text-orange-400 border border-orange-700/40 px-2 py-0.5 rounded-full"
                  >
                    {ins.nome}
                  </span>
                ) : null;
              })}
            </div>
          </div>
        )}

        <div className="flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            disabled={!insumoEsgotadoId}
            onClick={onConfirmar}
            className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-forbid-2-line mr-1" />
            Confirmar Esgotado
          </button>
        </div>
      </div>
    </div>
  );
});
