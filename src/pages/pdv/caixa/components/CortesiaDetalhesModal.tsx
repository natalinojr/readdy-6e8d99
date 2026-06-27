import { useState } from 'react';

/* ─── Modal de detalhes da cortesia (destinatário + motivo) ─── */
export default function CortesiaDetalhesModal({
  autorizadoPor,
  onConfirmar,
  onCancelar,
}: {
  autorizadoPor: string;
  onConfirmar: (destinatario: string, motivo: string) => void;
  onCancelar: () => void;
}) {
  const [destinatario, setDestinatario] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');

  const handleConfirmar = () => {
    if (!destinatario.trim()) {
      setErro('Informe o destinatário da cortesia.');
      return;
    }
    if (!motivo.trim() || motivo.trim().length < 5) {
      setErro('Informe o motivo (mínimo 5 caracteres).');
      return;
    }
    onConfirmar(destinatario.trim(), motivo.trim());
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-violet-50 border-b border-violet-100 px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-violet-100 flex-shrink-0">
            <i className="ri-gift-line text-violet-600 text-xl" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-violet-800 leading-none">Detalhes da Cortesia</h2>
            <p className="text-xs text-violet-600 mt-0.5 leading-snug">Autorizado por: {autorizadoPor}</p>
          </div>
          <button
            onClick={onCancelar}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-violet-100 text-violet-400 cursor-pointer transition-colors flex-shrink-0"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
              Para quem <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={destinatario}
              onChange={(e) => { setDestinatario(e.target.value); setErro(''); }}
              placeholder="Ex: João da Silva"
              className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
              Motivo / observação <span className="text-red-400">*</span>
            </label>
            <textarea
              value={motivo}
              onChange={(e) => { setMotivo(e.target.value); setErro(''); }}
              placeholder="Ex: cliente VIP aniversário (mín. 5 caracteres)"
              rows={3}
              maxLength={500}
              className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-none"
            />
            <p className="text-[10px] text-zinc-400 mt-1">{motivo.length}/500 caracteres</p>
          </div>

          {erro && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium">{erro}</p>
            </div>
          )}

          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={onCancelar}
              className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmar}
              className="flex-1 py-2.5 text-sm font-bold rounded-xl whitespace-nowrap transition-colors flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-600 text-white cursor-pointer"
            >
              <i className="ri-check-line text-sm" />
              Confirmar Cortesia
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
