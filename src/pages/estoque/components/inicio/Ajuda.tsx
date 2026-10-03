import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Balãozinho "?" que explica o que é cada coisa no Início do Estoque (dono, 2026-10-03).
// Computador: abre ao passar o mouse. Celular: abre e fecha no toque. Desenhado por portal com posição
// fixa, para não ser cortado pelos cartões (que têm overflow-hidden por causa da faixa colorida).
export default function Ajuda({ children, titulo, className = '' }: { children: ReactNode; titulo?: string; className?: string }) {
  const [aberto, setAberto] = useState(false);
  const [fixo, setFixo] = useState(false); // aberto por toque/clique: só fecha com outro toque
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const balao = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    const largura = Math.min(300, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - largura / 2, window.innerWidth - largura - 8));
    const alturaBalao = balao.current?.offsetHeight ?? 120;
    const embaixo = r.bottom + 8 + alturaBalao < window.innerHeight;
    setPos({ top: embaixo ? r.bottom + 8 : Math.max(8, r.top - 8 - alturaBalao), left });
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: Event) => {
      if (botao.current?.contains(e.target as Node) || balao.current?.contains(e.target as Node)) return;
      setAberto(false); setFixo(false);
    };
    const sair = () => { setAberto(false); setFixo(false); };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('touchstart', fechar);
    window.addEventListener('scroll', sair, true);
    return () => {
      document.removeEventListener('mousedown', fechar);
      document.removeEventListener('touchstart', fechar);
      window.removeEventListener('scroll', sair, true);
    };
  }, [aberto]);

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={(e) => { e.stopPropagation(); if (fixo) { setAberto(false); setFixo(false); } else { setAberto(true); setFixo(true); } }}
        onMouseEnter={() => { if (!fixo) setAberto(true); }}
        onMouseLeave={() => { if (!fixo) setAberto(false); }}
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full border text-[10px] font-extrabold leading-none align-middle cursor-help transition-colors flex-shrink-0 ${aberto ? 'border-amber-500 bg-amber-500 text-white' : 'border-zinc-300 text-zinc-400 hover:border-amber-400 hover:text-amber-600'} ${className}`}
        aria-label={titulo ? `O que é: ${titulo}` : 'O que é isso?'}
        aria-expanded={aberto}
      >
        ?
      </button>
      {aberto && createPortal(
        <div
          ref={balao}
          role="tooltip"
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: Math.min(300, window.innerWidth - 16) }}
          className="z-[70] rounded-xl bg-zinc-900 text-white text-[12.5px] font-normal normal-case tracking-normal leading-relaxed p-3 shadow-xl text-left"
        >
          {titulo && <p className="font-bold text-amber-300 mb-1">{titulo}</p>}
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
