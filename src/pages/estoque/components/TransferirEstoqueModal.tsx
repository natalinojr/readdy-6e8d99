import { useState } from 'react';
import type { UnidadeEstoque } from '@/types/estoque';
import { useEstoque } from '../../../contexts/EstoqueContext';
import { useAuth } from '../../../contexts/AuthContext';

interface Props {
  onClose: () => void;
}

export default function TransferirEstoqueModal({ onClose }: Props) {
  const { insumos, addMovimentacao } = useEstoque();
  const { user } = useAuth();
  const [insumoId, setInsumoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [lojaDestino, setLojaDestino] = useState('');
  const [obs, setObs] = useState('');
  const [done, setDone] = useState(false);

  const insumoSel = insumos.find((i) => i.id === insumoId);
  const lojaOrigem = user?.loja || '—';
  const qtd = parseFloat(quantidade) || 0;
  const valid = insumoId && qtd > 0 && lojaDestino.trim().length > 0;

  const handleConfirmar = () => {
    if (!valid || !insumoSel) return;
    addMovimentacao({
      insumoId,
      tipo: 'saida_manual',
      quantidade: qtd,
      unidade: insumoSel.unidade,
      motivo: `Transferência para ${lojaDestino.trim()}${obs ? ` — ${obs}` : ''}`,
    });
    setDone(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
        {done ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 flex items-center justify-center bg-emerald-100 rounded-2xl mx-auto mb-3">
              <i className="ri-checkbox-circle-fill text-3xl text-emerald-500" />
            </div>
            <p className="text-sm font-bold text-zinc-800 mb-1">Transferência registrada!</p>
            <p className="text-xs text-zinc-500 mb-4">
              {qtd} {insumoSel?.unidade} de <strong>{insumoSel?.nome}</strong> registrado como saída para <strong>{lojaDestino}</strong>.
            </p>
            <button onClick={onClose} className="px-6 py-2 bg-amber-500 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap hover:bg-amber-600 transition-colors">
              Concluir
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 flex items-center justify-center bg-sky-100 rounded-xl">
                  <i className="ri-truck-line text-sky-600 text-base" />
                </div>
                <h2 className="text-sm font-bold text-zinc-900">Transferência entre Lojas</h2>
              </div>
              <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Lojas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Origem</label>
                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 rounded-lg">
                    <i className="ri-store-2-line text-zinc-400 text-sm" />
                    <span className="text-xs font-semibold text-zinc-700">{lojaOrigem}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Destino <span className="text-red-400">*</span></label>
                  <input
                    value={lojaDestino}
                    onChange={(e) => setLojaDestino(e.target.value)}
                    placeholder="Nome do destino..."
                    className="w-full text-xs border border-zinc-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Insumo */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Insumo <span className="text-red-400">*</span></label>
                <div className="relative">
                  <select
                    value={insumoId}
                    onChange={(e) => setInsumoId(e.target.value)}
                    className="w-full text-xs border border-zinc-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:border-amber-400 appearance-none cursor-pointer"
                  >
                    <option value="">Selecionar insumo</option>
                    {insumos.map((i) => (
                      <option key={i.id} value={i.id}>{i.nome} ({i.estoqueAtual} {i.unidade} disponível)</option>
                    ))}
                  </select>
                  <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none" />
                </div>
              </div>

              {/* Quantidade */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">
                  Quantidade {insumoSel ? `(${insumoSel.unidade})` : ''} <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  placeholder="0"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:border-amber-400"
                />
                {insumoSel && qtd > 0 && qtd > insumoSel.estoqueAtual && (
                  <p className="text-[10px] text-red-500 mt-1">
                    <i className="ri-alert-line mr-0.5" />
                    Quantidade excede o estoque disponível ({insumoSel.estoqueAtual} {insumoSel.unidade}).
                  </p>
                )}
              </div>

              {/* Observação */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Observação (opcional)</label>
                <input
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Ex: Urgente — evento fim de semana"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Preview */}
              {valid && insumoSel && (
                <div className="flex items-center gap-3 p-3 bg-sky-50 border border-sky-200 rounded-xl">
                  <i className="ri-information-line text-sky-500 text-base flex-shrink-0" />
                  <p className="text-xs text-sky-700">
                    Será registrada <strong>saída de {qtd} {insumoSel.unidade}</strong> de <strong>{insumoSel.nome}</strong> em <strong>{lojaOrigem}</strong> com destino a <strong>{lojaDestino}</strong>.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={onClose} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap">Cancelar</button>
              <button
                onClick={handleConfirmar}
                disabled={!valid}
                className="flex-1 py-2 text-sm font-semibold text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                Confirmar Transferência
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
