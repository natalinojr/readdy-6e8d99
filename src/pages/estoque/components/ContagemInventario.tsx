import { useState, useMemo } from 'react';
import { useEstoque, type InventarioItemContado } from '../../../contexts/EstoqueContext';
import ConfirmarInventarioModal from './ConfirmarInventarioModal';

interface Props {
  operador: string;
  onConcluido: () => void;
  onCancelar: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function ContagemInventario({ operador, onConcluido, onCancelar }: Props) {
  const { insumos } = useEstoque();
  const { confirmarInventario } = useEstoque();

  // Mapa: insumoId → quantidade digitada (string para permitir vazio/decimal)
  const [contagens, setContagens] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    insumos.forEach((i) => { init[i.id] = i.estoqueAtual.toString(); });
    return init;
  });

  const [categoriaFiltro, setCategoriaFiltro] = useState('Todas');
  const [apenasComDiff, setApenasComDiff] = useState(false);
  const [showConfirmar, setShowConfirmar] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  const handleChange = (id: string, value: string) => {
    setContagens((prev) => ({ ...prev, [id]: value }));
  };

  const insumosFiltrados = useMemo(() => {
    return insumos
      .filter((i) => categoriaFiltro === 'Todas' || i.categoria === categoriaFiltro)
      .filter((i) => {
        if (!apenasComDiff) return true;
        const contado = parseFloat(contagens[i.id] ?? '');
        return !isNaN(contado) && contado !== i.estoqueAtual;
      });
  }, [insumos, categoriaFiltro, apenasComDiff, contagens]);

  // Calcula os itens com diferença para o resumo inferior
  const itensComDiferenca = useMemo(() => {
    return insumos.filter((i) => {
      const contado = parseFloat(contagens[i.id] ?? '');
      return !isNaN(contado) && contado !== i.estoqueAtual;
    });
  }, [insumos, contagens]);

  const valorImpacto = useMemo(() => {
    return itensComDiferenca.reduce((s, i) => {
      const contado = parseFloat(contagens[i.id] ?? '0');
      return s + (contado - i.estoqueAtual) * i.precoUnitario;
    }, 0);
  }, [itensComDiferenca, contagens]);

  // Monta a lista final de itens para confirmar
  const itensParaConfirmar: InventarioItemContado[] = useMemo(() => {
    return insumos.map((i) => {
      const raw = contagens[i.id] ?? '';
      const contado = raw === '' ? i.estoqueAtual : parseFloat(raw);
      const qtdContada = isNaN(contado) ? i.estoqueAtual : contado;
      return {
        insumoId: i.id,
        insumoNome: i.nome,
        unidade: i.unidade,
        qtdTeorica: i.estoqueAtual,
        qtdContada,
        diferenca: parseFloat((qtdContada - i.estoqueAtual).toFixed(4)),
        precoUnitario: i.precoUnitario,
      };
    });
  }, [insumos, contagens]);

  const handleConfirmar = () => {
    confirmarInventario(itensParaConfirmar, operador);
    setShowConfirmar(false);
    setConfirmado(true);
    setTimeout(() => onConcluido(), 2000);
  };

  if (confirmado) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 flex items-center justify-center bg-emerald-50 rounded-full mb-4">
          <i className="ri-check-double-line text-3xl text-emerald-500" />
        </div>
        <h3 className="text-base font-bold text-zinc-800 mb-1">Inventário Confirmado!</h3>
        <p className="text-sm text-zinc-500">Estoque atualizado · {itensComDiferenca.length} ajuste{itensComDiferenca.length !== 1 ? 's' : ''} registrado{itensComDiferenca.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2 mt-4 text-zinc-400 text-xs">
          <i className="ri-loader-4-line animate-spin" />
          Voltando ao histórico...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header da contagem */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-zinc-800">Nova Contagem de Inventário</p>
          <p className="text-xs text-zinc-500">Operador: <span className="font-semibold">{operador}</span> · {insumos.length} insumos a contar</p>
        </div>
        <button
          onClick={onCancelar}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer transition-colors whitespace-nowrap"
        >
          <i className="ri-close-line text-sm" />
          Cancelar contagem
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
          {['Todas', ...Array.from(new Set(insumos.map(i => i.categoria).filter(Boolean)))].map((c) => (
            <button
              key={c}
              onClick={() => setCategoriaFiltro(c)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${categoriaFiltro === c ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          onClick={() => setApenasComDiff(!apenasComDiff)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-all whitespace-nowrap ${
            apenasComDiff
              ? 'bg-amber-500 border-amber-500 text-white'
              : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
          }`}
        >
          <i className={`ri-filter-line text-xs`} />
          Só com diferença ({itensComDiferenca.length})
        </button>
      </div>

      {/* Tabela de contagem */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500">Insumo</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500">Categoria</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Sistema (teórico)</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500 w-40">Contagem real</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Diferença</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Impacto (R$)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {insumosFiltrados.map((insumo) => {
                const rawVal = contagens[insumo.id] ?? '';
                const contado = rawVal === '' ? NaN : parseFloat(rawVal);
                const diff = isNaN(contado) ? 0 : parseFloat((contado - insumo.estoqueAtual).toFixed(4));
                const temDiff = !isNaN(contado) && contado !== insumo.estoqueAtual;
                const impacto = temDiff ? diff * insumo.precoUnitario : 0;

                return (
                  <tr
                    key={insumo.id}
                    className={`transition-colors ${temDiff ? 'bg-amber-50/30' : 'hover:bg-zinc-50'}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-800">{insumo.nome}</p>
                      <p className="text-[10px] text-zinc-400">{insumo.fornecedor}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-full text-[10px] font-medium whitespace-nowrap">
                        {insumo.categoria}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-600">
                      {insumo.estoqueAtual} {insumo.unidade}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={rawVal}
                          onChange={(e) => handleChange(insumo.id, e.target.value)}
                          className={`w-full text-sm text-right border rounded-lg px-2 py-1.5 focus:outline-none transition-colors ${
                            temDiff
                              ? 'border-amber-400 bg-amber-50 text-zinc-800 focus:border-amber-500'
                              : 'border-zinc-200 bg-white text-zinc-700 focus:border-amber-400'
                          }`}
                        />
                        <span className="text-zinc-400 text-[10px] flex-shrink-0">{insumo.unidade}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {temDiff ? (
                        <span className={`font-bold ${diff > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {diff > 0 ? '+' : ''}{diff} {insumo.unidade}
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {temDiff ? (
                        <span className={`font-semibold text-xs ${impacto > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {impacto >= 0 ? '+' : ''}{fmt(impacto)}
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {insumosFiltrados.length === 0 && (
            <div className="text-center py-8">
              <i className="ri-search-line text-2xl text-zinc-300 block mb-1" />
              <p className="text-xs text-zinc-400">Nenhum insumo neste filtro</p>
            </div>
          )}
        </div>
      </div>

      {/* Barra inferior de resumo + confirmar */}
      <div className="sticky bottom-0 bg-white border border-zinc-200 rounded-xl px-5 py-4 flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-6 flex-1 flex-wrap">
          <div>
            <p className="text-[10px] text-zinc-400">Itens contados</p>
            <p className="text-sm font-bold text-zinc-800">{insumos.length}</p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-400">Com diferença</p>
            <p className={`text-sm font-bold ${itensComDiferenca.length > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
              {itensComDiferenca.length}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-400">Impacto financeiro</p>
            <p className={`text-sm font-bold ${valorImpacto < 0 ? 'text-red-500' : valorImpacto > 0 ? 'text-emerald-600' : 'text-zinc-400'}`}>
              {valorImpacto >= 0 ? '+' : ''}{fmt(valorImpacto)}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowConfirmar(true)}
          className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center gap-2"
        >
          <i className="ri-clipboard-check-line" />
          Confirmar Contagem
        </button>
      </div>

      {showConfirmar && (
        <ConfirmarInventarioModal
          itens={itensParaConfirmar}
          operador={operador}
          onConfirmar={handleConfirmar}
          onCancelar={() => setShowConfirmar(false)}
        />
      )}
    </div>
  );
}
