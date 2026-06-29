import { useState } from 'react';

interface Props {
  onConfirmar: (motivo: string) => void;
  onCancelar: () => void;
  busy?: boolean;
}

/** Modal para descrever um problema na entrega (registra no histórico do pedido). */
export default function ProblemaModal({ onConfirmar, onCancelar, busy }: Props) {
  const [motivo, setMotivo] = useState('');
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onCancelar}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg shrink-0">
            <i className="ri-alert-line text-red-600" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-zinc-800">Problema na entrega</h4>
            <p className="text-xs text-zinc-500">Descreva o que aconteceu — fica registrado no pedido.</p>
          </div>
        </div>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Ex.: cliente ausente, endereço não encontrado, motoboy sem acesso…"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 focus:border-red-400 outline-none text-sm resize-none"
        />
        <div className="flex gap-2">
          <button type="button" onClick={onCancelar}
            className="flex-1 py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-semibold hover:bg-zinc-200">Cancelar</button>
          <button type="button" disabled={!motivo.trim() || busy}
            onClick={() => onConfirmar(motivo.trim())}
            className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50">Registrar problema</button>
        </div>
      </div>
    </div>
  );
}
