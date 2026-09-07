import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  titulo: string;
  descricao?: string;
  textoConfirmar?: string;
  textoCancelar?: string;
  /** Vermelho pra ações destrutivas (padrão); false pra confirmações neutras. */
  perigo?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/** Substitui o `confirm()` nativo do navegador — mesma cara dos outros modais do módulo. */
export default function ConfirmDialog({
  titulo, descricao, textoConfirmar = 'Confirmar', textoCancelar = 'Cancelar',
  perigo = true, onConfirmar, onCancelar,
}: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => { e.stopPropagation(); onCancelar(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
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
