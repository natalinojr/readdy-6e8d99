import { useState, useMemo } from 'react';
import { useEstoque } from '../../../contexts/EstoqueContext';
import { useAuth } from '../../../contexts/AuthContext';

interface Props {
  onClose: () => void;
}

export default function RegistrarSaidaModal({ onClose }: Props) {
  const { insumos, addMovimentacao } = useEstoque();
  const { user } = useAuth();

  const [busca, setBusca] = useState('');
  const [insumoId, setInsumoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const insumoSelecionado = insumos.find((i) => i.id === insumoId);

  const insumosFiltrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return insumos.slice(0, 20);
    return insumos.filter((i) => i.nome.toLowerCase().includes(q)).slice(0, 20);
  }, [insumos, busca]);

  const handleSelecionarInsumo = (id: string, nome: string) => {
    setInsumoId(id);
    setBusca(nome);
    setShowDropdown(false);
    setErro('');
  };

  const qtdNum = parseFloat(quantidade);
  const estoqueDisponivel = insumoSelecionado?.estoqueAtual ?? 0;
  const qtdInvalida = !isNaN(qtdNum) && qtdNum > estoqueDisponivel;

  const handleSubmit = async () => {
    setErro('');
    if (!insumoId) { setErro('Selecione um insumo.'); return; }
    if (!quantidade || isNaN(qtdNum) || qtdNum <= 0) { setErro('Informe uma quantidade válida.'); return; }
    if (qtdInvalida) { setErro(`Quantidade maior que o estoque disponível (${estoqueDisponivel} ${insumoSelecionado?.unidade ?? ''}).`); return; }
    if (!motivo.trim()) { setErro('Informe o motivo da saída.'); return; }

    setLoading(true);
    try {
      await addMovimentacao({
        insumoId,
        tipo: 'saida_manual',
        quantidade: qtdNum,
        unidade: insumoSelecionado?.unidade ?? 'un',
        motivo: motivo.trim(),
        operadorId: user?.id,
      });
      setSucesso(true);
      setTimeout(() => onClose(), 1500);
    } catch {
      setErro('Erro ao registrar saída. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-orange-50 rounded-xl">
              <i className="ri-arrow-down-circle-line text-orange-500 text-lg" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Registrar Saída</h2>
              <p className="text-xs text-zinc-400">Saída manual do estoque</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {sucesso ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-14 h-14 flex items-center justify-center bg-emerald-50 rounded-full mb-3">
                <i className="ri-check-double-line text-3xl text-emerald-500" />
              </div>
              <p className="text-sm font-bold text-zinc-800">Saída registrada!</p>
              <p className="text-xs text-zinc-400 mt-1">Estoque atualizado com sucesso.</p>
            </div>
          ) : (
            <>
              {/* Insumo */}
              <div className="relative">
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                  Insumo <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={busca}
                    onChange={(e) => {
                      setBusca(e.target.value);
                      setInsumoId('');
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Buscar insumo..."
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-amber-400 pr-9"
                  />
                  <i className="ri-search-line text-zinc-400 text-sm absolute right-3 top-1/2 -translate-y-1/2" />
                </div>

                {showDropdown && insumosFiltrados.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {insumosFiltrados.map((i) => (
                      <button
                        key={i.id}
                        onMouseDown={() => handleSelecionarInsumo(i.id, i.nome)}
                        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-amber-50 text-left cursor-pointer transition-colors"
                      >
                        <span className="text-sm font-medium text-zinc-800 truncate flex-1">{i.nome}</span>
                        <span className={`text-xs flex-shrink-0 ml-2 font-semibold ${i.estoqueAtual <= 0 ? 'text-red-500' : 'text-zinc-500'}`}>
                          {i.estoqueAtual} {i.unidade}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Info do insumo selecionado */}
              {insumoSelecionado && (
                <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-zinc-700">{insumoSelecionado.nome}</p>
                    <p className="text-[10px] text-zinc-400">{insumoSelecionado.categoria}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${insumoSelecionado.estoqueAtual <= 0 ? 'text-red-500' : 'text-zinc-800'}`}>
                      {insumoSelecionado.estoqueAtual} {insumoSelecionado.unidade}
                    </p>
                    <p className="text-[10px] text-zinc-400">disponível</p>
                  </div>
                </div>
              )}

              {/* Quantidade */}
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                  Quantidade {insumoSelecionado && <span className="font-normal text-zinc-400">({insumoSelecionado.unidade})</span>}
                  <span className="text-red-400"> *</span>
                </label>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={quantidade}
                  onChange={(e) => { setQuantidade(e.target.value); setErro(''); }}
                  placeholder="0,000"
                  className={`w-full text-sm border rounded-xl px-3 py-2.5 text-zinc-800 placeholder-zinc-400 focus:outline-none transition-colors ${
                    qtdInvalida ? 'border-red-400 bg-red-50 focus:border-red-500' : 'border-zinc-200 focus:border-amber-400'
                  }`}
                />
                {qtdInvalida && (
                  <p className="text-[10px] text-red-500 mt-1">
                    Máximo disponível: {estoqueDisponivel} {insumoSelecionado?.unidade}
                  </p>
                )}
              </div>

              {/* Motivo */}
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                  Motivo da saída <span className="text-red-400">*</span>
                </label>
                <select
                  value={motivo}
                  onChange={(e) => { setMotivo(e.target.value); setErro(''); }}
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 cursor-pointer bg-white"
                >
                  <option value="">Selecione o motivo...</option>
                  <option value="Consumo interno">Consumo interno</option>
                  <option value="Teste / degustação">Teste / degustação</option>
                  <option value="Doação">Doação</option>
                  <option value="Descarte por validade">Descarte por validade</option>
                  <option value="Ajuste de contagem">Ajuste de contagem</option>
                  <option value="Uso em evento">Uso em evento</option>
                  <option value="Outro">Outro</option>
                </select>
                {motivo === 'Outro' && (
                  <input
                    type="text"
                    placeholder="Descreva o motivo..."
                    className="mt-2 w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
                    onChange={(e) => setMotivo(e.target.value === '' ? 'Outro' : e.target.value)}
                  />
                )}
              </div>

              {/* Erro */}
              {erro && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                  <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0" />
                  <p className="text-xs text-red-600">{erro}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!sucesso && (
          <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-zinc-600 hover:text-zinc-800 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl cursor-pointer transition-colors whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              {loading ? (
                <><i className="ri-loader-4-line animate-spin" /> Registrando...</>
              ) : (
                <><i className="ri-arrow-down-circle-line" /> Registrar Saída</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}