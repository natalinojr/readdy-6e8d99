// Confirmação de abrir/fechar a loja quando a pessoa chega pelo Enter (2026-10-03, pedido da loja:
// na contagem todo mundo aperta Enter para descer de linha — o último Enter não pode abrir o caixa
// sem perguntar). Confirma com Enter, mas nem a tecla segurada (repeat) nem o Enter "no embalo" de
// quem vinha descendo as linhas (menos de 0,6 s depois de a janela abrir) confirmam: é preciso ver a
// janela. Esc ou "Voltar" cancela.
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  titulo: string;
  detalhe?: ReactNode;
  botao: string;
  perigo?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export default function ConfirmaEnter({ titulo, detalhe, botao, perigo, onConfirmar, onCancelar }: Props) {
  const btn = useRef<HTMLButtonElement>(null);
  // Callbacks por ref: o pai re-renderiza (poll da sessão) e isso não pode zerar a trava de 0,6 s.
  const cb = useRef({ onConfirmar, onCancelar });
  cb.current = { onConfirmar, onCancelar };

  useEffect(() => {
    btn.current?.focus();
    const montou = Date.now();
    const aperta = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cb.current.onCancelar(); return; }
      if (e.key !== 'Enter') {
        if (/^F\d{1,2}$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); }
        if (e.key === ' ') e.stopPropagation(); // Espaço do PDV (foca a busca) não rouba o foco daqui
        return;
      }
      // preventDefault também impede o clique nativo do botão focado (que ignoraria a trava abaixo)
      e.preventDefault(); e.stopPropagation();
      if (e.repeat || Date.now() - montou < 600) return;
      cb.current.onConfirmar();
    };
    window.addEventListener('keydown', aperta, true);
    return () => {
      window.removeEventListener('keydown', aperta, true);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={titulo}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-6 pt-6 pb-4 text-center">
          <p className="text-xl font-black text-zinc-900 leading-snug">{titulo}</p>
          {detalhe && <div className="mt-2 text-sm text-zinc-500">{detalhe}</div>}
        </div>
        <div className="flex gap-2.5 px-5 pb-5">
          <button onClick={onCancelar} className="min-h-[52px] px-5 rounded-2xl border border-stone-200 bg-white hover:bg-stone-50 text-sm font-bold text-zinc-700 cursor-pointer">
            Voltar
          </button>
          <button
            ref={btn}
            onClick={onConfirmar}
            className={`flex-1 min-h-[52px] rounded-2xl text-[15px] font-black cursor-pointer flex items-center justify-center gap-2 ${
              perigo ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-amber-500 hover:bg-amber-600 text-zinc-900'}`}
          >
            {botao}
            <kbd className="hidden md:inline text-[11px] font-black bg-black/10 rounded-md px-1.5 py-0.5">Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
