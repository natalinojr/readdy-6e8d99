import type { CSSProperties } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useVoltarFecha } from '@/lib/voltarAndroid';

interface ConfirmDialogProps {
  titulo: string;
  descricao?: string;
  textoConfirmar?: string;
  textoCancelar?: string;
  /** Vermelho pra ações destrutivas (padrão); false pra confirmações neutras. */
  perigo?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
  /** Botão que abriu a confirmação: no computador a janela abre colada nele,
   *  em vez de no meio da tela (2026-09-29). No celular continua centralizada. */
  ancora?: DOMRect | null;
}

const LARGURA = 320;

/** Posição junto da âncora: abaixo e alinhada à direita do botão; sem espaço embaixo, sobe. */
function posicaoJuntoDe(r: DOMRect): CSSProperties {
  const margem = 8;
  const left = Math.min(Math.max(margem, r.right - LARGURA), window.innerWidth - LARGURA - margem);
  const cabeEmbaixo = r.bottom + 170 < window.innerHeight;
  return cabeEmbaixo
    ? { position: 'fixed', left, top: r.bottom + 6, width: LARGURA }
    : { position: 'fixed', left, bottom: window.innerHeight - r.top + 6, width: LARGURA };
}

/** Substitui o `confirm()` nativo do navegador — mesma cara dos outros modais do módulo. */
export default function ConfirmDialog({
  titulo, descricao, textoConfirmar = 'Confirmar', textoCancelar = 'Cancelar',
  perigo = true, onConfirmar, onCancelar, ancora = null,
}: ConfirmDialogProps) {
  useVoltarFecha(true, onCancelar, 'tarefas-confirmar');
  const junto = !!ancora && window.innerWidth >= 768;
  return (
    <div
      className={`fixed inset-0 z-[60] ${junto ? 'bg-transparent' : 'flex items-center justify-center bg-black/30 p-4'}`}
      onClick={(e) => { e.stopPropagation(); onCancelar(); }}
    >
      <div
        className={`bg-white shadow-xl ${junto ? 'rounded-xl border border-slate-200 p-4' : 'rounded-2xl w-full max-w-sm p-5'}`}
        style={junto ? posicaoJuntoDe(ancora!) : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start gap-3 mb-4">
          <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${perigo ? 'bg-red-50 text-red-500' : 'bg-indigo-50 text-indigo-500'}`}>
            <AlertTriangle size={18} />
          </span>
          <div className="pt-1">
            <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
            {descricao && <p className="text-xs text-slate-500 mt-1">{descricao}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancelar} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">
            {textoCancelar}
          </button>
          <button
            onClick={onConfirmar}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${
              perigo ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
