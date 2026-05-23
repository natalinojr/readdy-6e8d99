import { useState } from 'react';
import { type ItemPedidoCliente } from '@/types/mesaCliente';

interface Props {
  item: ItemPedidoCliente;
  index: number;
  onSalvar: (index: number, updates: Partial<ItemPedidoCliente>) => void;
  onFechar: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const LETRAS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
];
const NUMEROS = ['1','2','3','4','5','6','7','8','9','0'];

export default function EditarItemKiosk({ item, index, onSalvar, onFechar }: Props) {
  const [quantidade, setQuantidade] = useState(item.quantidade);
  const [observacao, setObservacao] = useState(item.observacao ?? '');
  // Per-unit obs
  const [obsUnidades, setObsUnidades] = useState<string[]>(
    (item as ItemPedidoCliente & { obsUnidades?: string[] }).obsUnidades ?? []
  );
  const [abaObs, setAbaObs] = useState<'todas' | number>('todas');
  const [teclado, setTeclado] = useState<'letras' | 'numeros'>('letras');

  // Current active text value
  const currentText = abaObs === 'todas' ? observacao : (obsUnidades[abaObs as number] ?? '');

  const setCurrentText = (val: string) => {
    if (abaObs === 'todas') {
      setObservacao(val);
    } else {
      setObsUnidades((prev) => {
        const next = [...prev];
        next[abaObs as number] = val;
        return next;
      });
    }
  };

  const appendChar = (c: string) => setCurrentText(currentText + c);
  const backspace = () => setCurrentText(currentText.slice(0, -1));
  const clearText = () => setCurrentText('');

  const handleSetQuantidade = (q: number) => {
    const novaQtd = Math.max(1, q);
    setQuantidade(novaQtd);
    setObsUnidades((prev) => prev.slice(0, novaQtd));
    if (typeof abaObs === 'number' && abaObs >= novaQtd) setAbaObs('todas');
    if (novaQtd === 1) setAbaObs('todas');
  };

  const handleSalvar = () => {
    const temObsUnidades = obsUnidades.some(Boolean);
    onSalvar(index, {
      quantidade,
      observacao,
      ...(temObsUnidades ? { obsUnidades } : {}),
    } as Partial<ItemPedidoCliente>);
    onFechar();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
      <div className="bg-zinc-900 rounded-3xl w-full max-w-2xl flex flex-col overflow-hidden border border-zinc-700 max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-zinc-800 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-black text-white">{item.nome}</h2>
            {item.opcoesSelecionadas.length > 0 && (
              <p className="text-zinc-500 text-sm mt-0.5">{item.opcoesSelecionadas.join(', ')}</p>
            )}
          </div>
          <button onClick={onFechar}
            className="w-10 h-10 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded-2xl cursor-pointer transition-colors text-zinc-400">
            <i className="ri-close-line text-xl" />
          </button>
        </div>

        <div className="p-7 flex flex-col gap-5 overflow-y-auto flex-1">
          {/* Quantidade */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Quantidade</p>
            <div className="flex items-center gap-5">
              <button
                onClick={() => handleSetQuantidade(quantidade - 1)}
                className="w-14 h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded-2xl cursor-pointer transition-colors text-white text-2xl font-black"
              >
                <i className="ri-subtract-line" />
              </button>
              <span className="text-4xl font-black text-white w-16 text-center">{quantidade}</span>
              <button
                onClick={() => handleSetQuantidade(quantidade + 1)}
                className="w-14 h-14 flex items-center justify-center bg-amber-500 hover:bg-amber-400 rounded-2xl cursor-pointer transition-colors text-zinc-950 text-2xl font-black"
              >
                <i className="ri-add-line" />
              </button>
              <div className="ml-4">
                <p className="text-zinc-500 text-sm">Subtotal</p>
                <p className="text-amber-400 font-black text-2xl">{fmt(item.preco * quantidade)}</p>
              </div>
            </div>
          </div>

          {/* Observação */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Observação</p>
              <div className="flex items-center gap-1 bg-zinc-800 rounded-xl p-1">
                <button onClick={() => setTeclado('letras')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${teclado === 'letras' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>
                  ABC
                </button>
                <button onClick={() => setTeclado('numeros')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${teclado === 'numeros' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>
                  123
                </button>
              </div>
            </div>

            {/* Abas por unidade */}
            {quantidade > 1 && (
              <div className="flex gap-2 mb-3 flex-wrap">
                <button
                  onClick={() => setAbaObs('todas')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap transition-colors ${
                    abaObs === 'todas' ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  Todas
                </button>
                {Array.from({ length: quantidade }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setAbaObs(i)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap transition-colors relative ${
                      abaObs === i ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    Un. {i + 1}
                    {obsUnidades[i] && (
                      <span className="ml-1 inline-block w-2 h-2 rounded-full bg-amber-300 align-middle" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Display da observação */}
            <div
              className={`w-full min-h-[3.5rem] text-white text-lg font-semibold text-center rounded-2xl px-5 py-4 mb-4 border-2 transition-colors ${
                abaObs !== 'todas'
                  ? 'bg-amber-900/30 border-amber-500/60'
                  : currentText ? 'bg-zinc-800 border-amber-500/40' : 'bg-zinc-800 border-transparent'
              }`}
            >
              {currentText || (
                <span className="text-zinc-600">
                  {abaObs === 'todas' ? 'Sem retirar, extra, etc...' : `Obs. para unidade ${(abaObs as number) + 1}...`}
                </span>
              )}
            </div>

            {/* Teclado virtual */}
            {teclado === 'letras' ? (
              <div>
                {LETRAS.map((linha, li) => (
                  <div key={li} className="flex justify-center gap-1.5 mb-1.5">
                    {linha.map((letra) => (
                      <button key={letra} onClick={() => appendChar(letra)}
                        className="w-11 h-11 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-sm rounded-xl cursor-pointer active:scale-90 transition-all">
                        {letra}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="flex justify-center gap-2 mt-2">
                  <button onClick={() => appendChar(' ')}
                    className="px-14 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-sm rounded-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
                    Espaço
                  </button>
                  <button onClick={backspace}
                    className="px-5 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
                    <i className="ri-delete-back-2-line" />
                  </button>
                  <button onClick={clearText}
                    className="px-5 py-2.5 bg-zinc-700 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 rounded-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
                    <i className="ri-delete-bin-line" />
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex justify-center gap-1.5 mb-1.5 flex-wrap">
                  {NUMEROS.map((n) => (
                    <button key={n} onClick={() => appendChar(n)}
                      className="w-14 h-14 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-lg rounded-xl cursor-pointer active:scale-90 transition-all">
                      {n}
                    </button>
                  ))}
                </div>
                <div className="flex justify-center gap-2 mt-2">
                  {[' ', ',', '.', '-', '/'].map((c) => (
                    <button key={c} onClick={() => appendChar(c)}
                      className="w-14 h-10 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold rounded-xl cursor-pointer active:scale-95 transition-all">
                      {c === ' ' ? '␣' : c}
                    </button>
                  ))}
                  <button onClick={backspace}
                    className="px-4 h-10 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-400 rounded-xl cursor-pointer active:scale-95 transition-all">
                    <i className="ri-delete-back-2-line" />
                  </button>
                </div>
              </div>
            )}

            {/* Resumo obs por unidade */}
            {obsUnidades.some(Boolean) && quantidade > 1 && (
              <div className="mt-3 space-y-1.5">
                {obsUnidades.map((u, i) => u ? (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 px-3 py-1.5 rounded-xl">
                    <span className="font-black flex-shrink-0">Un.{i + 1}:</span>
                    <span className="truncate">{u}</span>
                  </div>
                ) : null)}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-7 py-5 border-t border-zinc-800 flex gap-3 flex-shrink-0">
          <button onClick={onFechar}
            className="px-8 py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-lg rounded-2xl cursor-pointer transition-colors whitespace-nowrap">
            Cancelar
          </button>
          <button onClick={handleSalvar}
            className="flex-1 py-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xl font-black rounded-2xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
            <i className="ri-save-line mr-2" />
            Salvar alterações
          </button>
        </div>
      </div>
    </div>
  );
}
