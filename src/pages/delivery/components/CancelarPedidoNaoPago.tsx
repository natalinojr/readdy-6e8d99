// Cliente desiste do pedido que ainda espera o pagamento pelo app (nada foi cobrado).
// Confirmação no próprio lugar. O servidor confere no Mercado Pago antes de cancelar:
// se o pagamento acabou de cair, o pedido segue para a cozinha e a mensagem explica.
import { useState } from 'react';

interface Props {
  numero: string;
  /** null = cancelou; texto = por que não cancelou (ex.: o pagamento acabou de ser confirmado) */
  onCancelar: () => Promise<string | null>;
  onCancelado: () => void;
}

export default function CancelarPedidoNaoPago(props: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    setCancelando(true);
    setErro('');
    const motivo = await props.onCancelar();
    setCancelando(false);
    setConfirmando(false);
    if (motivo) { setErro(motivo); return; }
    props.onCancelado();
  }

  if (!confirmando) {
    return (
      <div className="text-center">
        <button
          type="button"
          onClick={function () { setErro(''); setConfirmando(true); }}
          className="h-11 px-2 text-[13px] font-bold text-stone-500 hover:text-red-700 underline cursor-pointer whitespace-nowrap"
        >
          Cancelar pedido
        </button>
        {erro ? <p role="alert" className="text-xs text-red-700 mt-0.5 px-2">{erro}</p> : null}
      </div>
    );
  }

  return (
    <div className="p-3.5 bg-red-50 border border-red-100 rounded-2xl">
      <p className="text-sm font-bold text-stone-900">Cancelar o pedido #{props.numero.slice(-4)}?</p>
      <p className="text-xs text-stone-600 mt-0.5">Ele ainda não foi pago, então nada será cobrado.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={function () { setConfirmando(false); }}
          disabled={cancelando}
          className="h-11 rounded-xl bg-white border border-stone-200 text-sm font-bold text-stone-700 cursor-pointer disabled:opacity-60"
        >
          Voltar
        </button>
        <button
          type="button"
          onClick={confirmar}
          disabled={cancelando}
          className="h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold cursor-pointer disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
        >
          {cancelando ? <i className="ri-loader-4-line animate-spin" /> : null}
          Sim, cancelar
        </button>
      </div>
    </div>
  );
}
