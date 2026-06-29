interface Props {
  onConfirmar: () => void;
  onCancelar: () => void;
  busy?: boolean;
}

/** Confirma liberar o entregador atual (volta uma fase da entrega). */
export default function LiberarModal({ onConfirmar, onCancelar, busy }: Props) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onCancelar}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg shrink-0">
            <i className="ri-e-bike-2-line text-amber-600" />
          </div>
          <h4 className="text-sm font-bold text-zinc-800">Liberar entregador</h4>
        </div>
        <p className="text-sm text-zinc-600">Tira este pedido do entregador atual e <strong>volta uma fase</strong> da entrega. Ele fica disponível para o próximo entregador assumir.</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancelar}
            className="flex-1 py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-semibold hover:bg-zinc-200">Cancelar</button>
          <button type="button" disabled={busy} onClick={onConfirmar}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50">Liberar</button>
        </div>
      </div>
    </div>
  );
}
