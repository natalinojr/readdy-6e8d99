// "Esvaziar" no cabeçalho da sacola (delivery e QR). Pede confirmação no próprio lugar:
// um toque sem querer não apaga o que o cliente montou.
import { useState } from 'react';

export default function BotaoEsvaziarSacola(props: { onEsvaziar: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={function () { setConfirmando(true); }}
        className="ml-auto shrink-0 h-11 px-2 inline-flex items-center gap-1 text-[13px] font-bold text-stone-500 hover:text-red-700 cursor-pointer whitespace-nowrap"
      >
        <i className="ri-delete-bin-line" /> Esvaziar
      </button>
    );
  }
  return (
    <div className="ml-auto shrink-0 flex items-center gap-1.5" role="group" aria-label="Esvaziar a sacola?">
      <span className="text-[13px] font-semibold text-stone-700 whitespace-nowrap">Tirar tudo?</span>
      <button
        type="button"
        onClick={function () { setConfirmando(false); props.onEsvaziar(); }}
        className="h-9 px-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-[13px] font-bold cursor-pointer"
      >
        Sim
      </button>
      <button
        type="button"
        onClick={function () { setConfirmando(false); }}
        className="h-9 px-3 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-700 text-[13px] font-bold cursor-pointer"
      >
        Não
      </button>
    </div>
  );
}
