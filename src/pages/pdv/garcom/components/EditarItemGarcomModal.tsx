import { useState } from 'react';
import type { CarrinhoItem } from '../../../../contexts/PDVContext';
import { useObsPorItemId } from '@/hooks/useObsPorItemId';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  item: CarrinhoItem;
  onSalvar: (cartId: string, updates: { quantidade: number; observacaoLivre: string; observacoes?: string[]; obsUnidades?: string[] }) => void;
  onDeletar: (cartId: string) => void;
  onClose: () => void;
}

export default function EditarItemGarcomModal({ item, onSalvar, onDeletar, onClose }: Props) {
  const [quantidade, setQuantidade] = useState(item.quantidade);
  const [obs, setObs] = useState(item.observacaoLivre || '');
  const [obsUnidades, setObsUnidades] = useState<string[]>(item.obsUnidades ?? []);
  const [abaObs, setAbaObs] = useState<'todas' | number>('todas');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Obs pré-definidas do item (específicas + globais)
  const todasObsDisponiveis = useObsPorItemId(item.itemId);
  // Inicializa seleção com as obs que já estavam no item
  const [obsSelecionadas, setObsSelecionadas] = useState<string[]>(
    () => item.observacoes ?? [],
  );

  const toggleObsTag = (obsTexto: string) => {
    setObsSelecionadas((prev) =>
      prev.includes(obsTexto) ? prev.filter((o) => o !== obsTexto) : [...prev, obsTexto],
    );
  };

  const totalItem = item.precoBase * quantidade;

  const handleSalvar = () => {
    if (quantidade <= 0) {
      onDeletar(item.cartId);
    } else {
      onSalvar(item.cartId, {
        quantidade,
        observacaoLivre: obs,
        observacoes: obsSelecionadas,
        obsUnidades: obsUnidades.some(Boolean) ? obsUnidades : undefined,
      });
    }
    onClose();
  };

  const handleDeletar = () => {
    onDeletar(item.cartId);
    onClose();
  };

  const handleSetQuantidade = (novaQtd: number) => {
    const q = Math.max(0, novaQtd);
    setQuantidade(q);
    setObsUnidades((prev) => prev.slice(0, q));
    if (typeof abaObs === 'number' && abaObs >= q) setAbaObs('todas');
    if (q === 1) setAbaObs('todas');
  };

  const temObsUnidade = obsUnidades.some(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden" style={{ maxHeight: 'min(90dvh, 90vh)' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-900 truncate">{item.nome}</p>
            {item.opcoes.length > 0 && (
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                {item.opcoes.map((o) => o.opcaoNome).join(' · ')}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer text-zinc-400 transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4 overflow-y-auto flex-1">

          {/* Quantidade */}
          <div>
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Quantidade</p>
            <div className="flex items-center gap-4">
              <button
                onClick={() => handleSetQuantidade(quantidade - 1)}
                className={`w-10 h-10 flex items-center justify-center rounded-xl border-2 cursor-pointer transition-colors font-bold text-lg
                  ${quantidade <= 1 ? 'border-red-200 text-red-400 hover:bg-red-50' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100'}`}
              >
                {quantidade <= 1 ? <i className="ri-delete-bin-line text-base" /> : <i className="ri-subtract-line text-base" />}
              </button>
              <div className="flex-1 text-center">
                <span className="text-3xl font-black text-zinc-900">{quantidade}</span>
                <p className="text-xs text-zinc-400 mt-0.5">{fmt(item.precoBase)} / un</p>
              </div>
              <button
                onClick={() => handleSetQuantidade(quantidade + 1)}
                className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-zinc-200 text-zinc-600 hover:bg-zinc-100 cursor-pointer transition-colors"
              >
                <i className="ri-add-line text-base font-bold" />
              </button>
            </div>
            {quantidade > 0 && (
              <div className="mt-2 text-center">
                <span className="text-sm font-bold text-amber-600">{fmt(totalItem)}</span>
              </div>
            )}
            {quantidade === 0 && (
              <div className="mt-2 text-center">
                <span className="text-xs font-semibold text-red-500">Item será removido</span>
              </div>
            )}
          </div>

          {/* Observação */}
          <div>
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Observação</p>

            {/* Tags pré-definidas */}
            {todasObsDisponiveis.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {todasObsDisponiveis.map((obsTexto) => {
                  const sel = obsSelecionadas.includes(obsTexto);
                  return (
                    <button
                      key={obsTexto}
                      onClick={() => toggleObsTag(obsTexto)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer whitespace-nowrap ${
                        sel
                          ? 'bg-amber-500 border-amber-500 text-white'
                          : 'bg-white border-zinc-200 text-zinc-600 hover:border-amber-300'
                      }`}
                    >
                      {obsTexto}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Abas de unidade — só quando quantidade > 1 */}
            {quantidade > 1 && (
              <div className="flex gap-1 mb-2 flex-wrap">
                <button
                  onClick={() => setAbaObs('todas')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                    abaObs === 'todas' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  Todas
                </button>
                {Array.from({ length: quantidade }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setAbaObs(i)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors relative ${
                      abaObs === i ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                    }`}
                  >
                    Un. {i + 1}
                    {obsUnidades[i] && (
                      <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-300 align-middle" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Campo de texto */}
            {abaObs === 'todas' || quantidade <= 1 ? (
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value.slice(0, 150))}
                placeholder={quantidade > 1 ? 'Obs. para todas as unidades...' : 'Ex: sem cebola, mal passado...'}
                rows={2}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 resize-none"
              />
            ) : (
              <textarea
                value={obsUnidades[abaObs as number] ?? ''}
                onChange={(e) => {
                  const val = e.target.value.slice(0, 150);
                  setObsUnidades((prev) => {
                    const next = [...prev];
                    next[abaObs as number] = val;
                    return next;
                  });
                }}
                placeholder={`Obs. só para unidade ${(abaObs as number) + 1}...`}
                rows={2}
                className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 resize-none bg-amber-50"
              />
            )}
            <p className="text-[10px] text-zinc-400 text-right mt-0.5">
              {abaObs === 'todas' ? obs.length : (obsUnidades[abaObs as number]?.length ?? 0)}/150
            </p>

            {/* Resumo obs por unidade */}
            {temObsUnidade && quantidade > 1 && (
              <div className="mt-2 space-y-1">
                {obsUnidades.map((u, i) => u ? (
                  <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                    <span className="font-black flex-shrink-0">Un.{i + 1}:</span>
                    <span className="truncate">{u}</span>
                  </div>
                ) : null)}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 pb-5 pt-2 space-y-2.5">
          {!confirmDelete ? (
            <>
              <button
                onClick={handleSalvar}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm"
              >
                <i className="ri-check-line mr-1.5" />
                {quantidade === 0 ? 'Remover item' : 'Salvar alterações'}
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full py-2.5 border-2 border-red-200 text-red-500 hover:bg-red-50 font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm"
              >
                <i className="ri-delete-bin-line mr-1.5" />
                Remover item
              </button>
            </>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2.5">
              <p className="text-sm font-semibold text-red-700 text-center">Remover &quot;{item.nome}&quot;?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-2 bg-white border border-zinc-200 text-zinc-600 font-semibold rounded-lg cursor-pointer text-sm whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeletar}
                  className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg cursor-pointer text-sm whitespace-nowrap transition-colors"
                >
                  Remover
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
