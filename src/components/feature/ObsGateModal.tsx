import { useState, useEffect, useRef } from 'react';
import type { KDSItem, KDSItemOpcao } from '@/types/kds';

export type ObsGateTipo = 'iniciar' | 'pronto';

interface ObsGateModalProps {
  tipo: ObsGateTipo;
  itensComObs: KDSItem[];
  onConfirm: () => void;
  onCancel: () => void;
}

/** Formata uma opção como string legível para o gate: "Grupo: Opção" */
function formatOpcao(o: KDSItemOpcao): string {
  return `${o.grupoNome}: ${o.opcaoNome}`;
}

export default function ObsGateModal({ tipo, itensComObs, onConfirm, onCancel }: ObsGateModalProps) {
  const [checadas, setChecadas] = useState<Record<string, Set<string>>>({});
  const modalRef = useRef<HTMLDivElement>(null);

  // No tablet, quando o teclado virtual abre ele empurra a viewport.
  // Ancoramos o modal no topo da tela para não ficar atrás do teclado.
  useEffect(() => {
    const scrollToModal = () => {
      modalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    // Faz scroll imediato ao abrir
    const timer = setTimeout(scrollToModal, 50);
    // E também ao redimensionar (quando teclado sobe/desce)
    window.addEventListener('resize', scrollToModal);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', scrollToModal);
    };
  }, []);

  const toggle = (itemId: string, key: string) => {
    setChecadas((prev) => {
      const set = new Set(prev[itemId] ?? []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...prev, [itemId]: set };
    });
  };

  // Cada item precisa confirmar: observações + opções (como "Grupo: Opção")
  const getItensKeys = (item: KDSItem): string[] => [
    ...item.observacoes,
    ...item.opcoes.map(formatOpcao),
  ];

  const todasChecadas = itensComObs.every((item) => {
    const set = checadas[item.id] ?? new Set<string>();
    return getItensKeys(item).every((k) => set.has(k));
  });

  const totalKeys = itensComObs.reduce((acc, i) => acc + getItensKeys(i).length, 0);
  const totalChecadas = Object.values(checadas).reduce((acc, s) => acc + s.size, 0);

  const titulo = tipo === 'iniciar' ? 'Confirmar antes de Iniciar o Preparo' : 'Confirmar antes de Marcar como Pronto';
  const descricao = tipo === 'iniciar'
    ? 'Leia e confirme as opções e observações antes de iniciar.'
    : 'Confirme que o item foi preparado conforme as opções e observações.';
  const confirmLabel = tipo === 'iniciar' ? 'Confirmei — Iniciar Preparo' : 'Confirmei — Marcar Pronto';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 overflow-y-auto pt-4 pb-8"
      onClick={onCancel}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 py-4 border-b border-zinc-100 ${tipo === 'pronto' ? 'bg-green-50' : 'bg-amber-50'}`}>
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${tipo === 'pronto' ? 'bg-green-500' : 'bg-amber-500'}`}>
              <i className={`text-white text-base ${tipo === 'pronto' ? 'ri-checkbox-circle-line' : 'ri-alert-line'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-zinc-900 text-sm">{titulo}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{descricao}</p>
            </div>
            <button
              onClick={onCancel}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-200 text-zinc-400 cursor-pointer flex-shrink-0"
            >
              <i className="ri-close-line text-base" />
            </button>
          </div>

          {/* Progresso */}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${tipo === 'pronto' ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: totalKeys > 0 ? `${(totalChecadas / totalKeys) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-[10px] font-bold text-zinc-500">{totalChecadas}/{totalKeys}</span>
          </div>
        </div>

        {/* Lista por item */}
        <div className="px-5 py-4 space-y-4 max-h-[55vh] overflow-y-auto">
          {itensComObs.map((item) => {
            const itemChecadas = checadas[item.id] ?? new Set<string>();
            const keys = getItensKeys(item);
            const todasItemChecadas = keys.every((k) => itemChecadas.has(k));
            return (
              <div key={item.id}>
                <div className="flex items-center gap-2 mb-2">
                  {todasItemChecadas ? (
                    <div className="w-5 h-5 flex items-center justify-center rounded-full bg-green-500 flex-shrink-0">
                      <i className="ri-check-line text-white text-[10px]" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 flex items-center justify-center rounded-full bg-amber-100 border-2 border-amber-400 flex-shrink-0" />
                  )}
                  <span className="text-sm font-bold text-zinc-800">
                    {item.quantidade > 1 && <span className="text-amber-600">{item.quantidade}x </span>}
                    {item.nome}
                  </span>
                </div>

                <div className="space-y-2 pl-7">
                  {/* Opções obrigatórias — bloco roxo/índigo */}
                  {item.opcoes.length > 0 && (
                    <>
                      <div className="flex items-center gap-1 mb-1">
                        <i className="ri-list-check-3 text-[10px] text-indigo-500" />
                        <span className="text-[9px] font-black text-indigo-600 uppercase tracking-wide">Opções selecionadas</span>
                      </div>
                      {item.opcoes.map((op, idx) => {
                        const key = formatOpcao(op);
                        const checked = itemChecadas.has(key);
                        return (
                          <button
                            key={`op-${idx}`}
                            onClick={() => toggle(item.id, key)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                              checked
                                ? 'bg-green-50 border-green-300'
                                : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100'
                            }`}
                          >
                            <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-all ${
                              checked ? 'bg-green-500 border-green-500' : 'bg-white border-indigo-400'
                            }`}>
                              {checked && <i className="ri-check-line text-white text-[10px]" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-[9px] text-zinc-400 font-semibold">{op.grupoNome}</span>
                              <p className={`text-xs font-bold truncate ${checked ? 'text-green-700 line-through decoration-green-400' : 'text-indigo-800'}`}>
                                {op.opcaoNome}
                              </p>
                            </div>
                            {!checked && (
                              <span className="text-[9px] font-bold text-indigo-500 whitespace-nowrap">
                                <i className="ri-error-warning-line mr-0.5" />confirmar
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}

                  {/* Observações — bloco âmbar */}
                  {item.observacoes.length > 0 && (
                    <>
                      {item.opcoes.length > 0 && (
                        <div className="flex items-center gap-1 mb-1 mt-2">
                          <i className="ri-alert-fill text-[10px] text-amber-500" />
                          <span className="text-[9px] font-black text-amber-600 uppercase tracking-wide">Observações</span>
                        </div>
                      )}
                      {item.observacoes.map((obs, idx) => {
                        const checked = itemChecadas.has(obs);
                        return (
                          <button
                            key={`obs-${idx}`}
                            onClick={() => toggle(item.id, obs)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                              checked
                                ? 'bg-green-50 border-green-300'
                                : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                            }`}
                          >
                            <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-all ${
                              checked ? 'bg-green-500 border-green-500' : 'bg-white border-amber-400'
                            }`}>
                              {checked && <i className="ri-check-line text-white text-[10px]" />}
                            </div>
                            <span className={`text-xs font-semibold flex-1 ${checked ? 'text-green-700 line-through decoration-green-400' : 'text-amber-800'}`}>
                              {obs}
                            </span>
                            {!checked && (
                              <span className="text-[9px] font-bold text-amber-500 whitespace-nowrap">
                                <i className="ri-error-warning-line mr-0.5" />confirmar
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-100 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => { if (todasChecadas) onConfirm(); }}
            disabled={!todasChecadas}
            className={`flex-1 py-2.5 text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors ${
              todasChecadas
                ? tipo === 'pronto'
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-amber-500 hover:bg-amber-600 text-zinc-900'
                : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
            }`}
          >
            {todasChecadas ? (
              <><i className={`mr-1 ${tipo === 'pronto' ? 'ri-checkbox-circle-line' : 'ri-play-line'}`} />{confirmLabel}</>
            ) : (
              <><i className="ri-lock-line mr-1" />Confirme tudo acima</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
