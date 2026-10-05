import { useEffect, type ReactNode } from 'react';
import { useVoltarFecha } from '@/lib/voltarAndroid';

// Folha que sobe de baixo no celular (janela no centro a partir de sm). Voltar do Android fecha.
export default function Folha({ aberta, titulo, subtitulo, onFechar, children, rodape, fecharNoFundo = true }: {
  aberta: boolean;
  /** false = toque no fundo escuro não fecha (ex.: contagem com números digitados) */
  fecharNoFundo?: boolean;
  titulo: string;
  subtitulo?: string;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  useVoltarFecha(aberta, onFechar, 'estoque-folha');
  // Esc fecha (no computador), menos na folha que guarda o que foi digitado (fecharNoFundo = false).
  useEffect(() => {
    if (!aberta || !fecharNoFundo) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aberta, fecharNoFundo, onFechar]);
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45" onClick={fecharNoFundo ? onFechar : undefined}>
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90dvh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-3 pb-2 relative flex-shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-zinc-200 mx-auto mb-3 sm:hidden" />
          <h3 className="text-[17px] font-extrabold text-zinc-900 pr-10 leading-snug">{titulo}</h3>
          {subtitulo && <p className="text-xs text-zinc-500 mt-0.5">{subtitulo}</p>}
          <button
            onClick={onFechar}
            className="absolute right-3 top-3 sm:top-3 w-9 h-9 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center cursor-pointer"
            aria-label="Fechar"
          >
            <i className="ri-close-line text-lg text-zinc-600" />
          </button>
        </div>
        <div className="px-5 py-2 overflow-y-auto flex-1">{children}</div>
        {rodape && <div className="px-5 pt-3 pb-5 border-t border-zinc-100 flex gap-2 flex-shrink-0">{rodape}</div>}
      </div>
    </div>
  );
}
