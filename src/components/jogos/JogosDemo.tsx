import { useState } from 'react';
import JogosEspera from './JogosEspera';

// Só no `npm run dev` (/dev/jogos): ver os jogos sem precisar de um pedido.
export default function JogosDemo() {
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <div className="min-h-screen bg-amber-50 p-4 max-w-md mx-auto">
      <p className="text-sm font-bold text-zinc-600 mb-3">Demo dos jogos (só em desenvolvimento)</p>
      <JogosEspera aviso={aviso} />
      <button type="button" onClick={function () { setAviso('Seu pedido saiu para entrega!'); }} className="mt-4 px-3 py-2 rounded-lg bg-zinc-800 text-white text-xs">
        Simular aviso do pedido
      </button>
    </div>
  );
}
