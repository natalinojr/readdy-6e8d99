import { useEffect, useRef, useState } from 'react';

/**
 * Ícone ⓘ de cartão de indicador: um toque abre a explicação de onde vem o número
 * (funciona no celular, ao contrário de `title`). O cartão pai precisa de `relative`.
 */
export default function AjudaCartao({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('touchstart', fechar);
    return () => {
      document.removeEventListener('mousedown', fechar);
      document.removeEventListener('touchstart', fechar);
    };
  }, [aberto]);

  return (
    <span ref={ref} className="flex-shrink-0">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAberto(a => !a); }}
        className={`w-5 h-5 flex items-center justify-center rounded-full cursor-pointer transition-colors ${aberto ? 'text-amber-600' : 'text-zinc-300 hover:text-zinc-500'}`}
        aria-label="O que é este número?"
        aria-expanded={aberto}
      >
        <i className="ri-information-line text-sm" />
      </button>
      {aberto && (
        <span
          role="tooltip"
          onClick={(e) => { e.stopPropagation(); setAberto(false); }}
          className="absolute left-3 right-3 top-12 z-30 block rounded-xl bg-zinc-900 text-white text-left text-xs font-normal leading-relaxed p-3 shadow-lg whitespace-pre-line"
        >
          {texto}
        </span>
      )}
    </span>
  );
}
