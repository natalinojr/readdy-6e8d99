// Aviso "sistema atualizado" (2026-09-24): chega o pedido de "Atualizar os aparelhos" e a tela
// recarrega sozinha na versão nova. Não recarrega no meio de uma digitação: espera a pessoa parar
// (15 s sem tocar/digitar), no máximo 3 min. Só com alguém logado — a tela pública do cliente
// (cardápio, QR da mesa) não recarrega no meio do pedido dele.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAtualizarApp, recarregarNaVersaoNova } from '@/hooks/useAtualizarApp';

const ESPERA_S = 20;
const PARADO_MS = 15_000;
const MAX_MS = 3 * 60_000;

export default function AvisoAtualizacao() {
  const { user } = useAuth();
  const [pedidoEm, setPedidoEm] = useState<number | null>(null);
  const [falta, setFalta] = useState(ESPERA_S);
  const ultimoToque = useRef(0);

  useAtualizarApp(!!user, () => setPedidoEm((p) => p ?? Date.now()));

  useEffect(() => {
    if (!pedidoEm) return;
    const marcar = () => { ultimoToque.current = Date.now(); };
    window.addEventListener('keydown', marcar, true);
    window.addEventListener('input', marcar, true);
    window.addEventListener('pointerdown', marcar, true);
    const t = window.setInterval(() => {
      const agora = Date.now();
      const restante = Math.max(0, ESPERA_S - Math.floor((agora - pedidoEm) / 1000));
      setFalta(restante);
      const mexendo = agora - ultimoToque.current < PARADO_MS;
      // Aba escondida recarrega na hora; na frente, espera a contagem e a pessoa parar de mexer
      if (document.hidden || (restante === 0 && (!mexendo || agora - pedidoEm > MAX_MS))) {
        window.clearInterval(t);
        recarregarNaVersaoNova();
      }
    }, 1000);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('keydown', marcar, true);
      window.removeEventListener('input', marcar, true);
      window.removeEventListener('pointerdown', marcar, true);
    };
  }, [pedidoEm]);

  if (!pedidoEm) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[200] flex justify-center px-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
      <div className="w-full max-w-md bg-violet-600 text-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3">
        <i className="ri-refresh-line text-2xl animate-spin" style={{ animationDuration: '2.5s' }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">Nova versão do sistema</p>
          <p className="text-xs text-white/85">{falta > 0 ? `Atualizando em ${falta}s…` : 'Atualiza quando você parar de digitar.'}</p>
        </div>
        <button type="button" onClick={() => recarregarNaVersaoNova()} className="px-3 py-2 rounded-xl bg-white text-violet-700 text-sm font-bold cursor-pointer">
          Agora
        </button>
      </div>
    </div>
  );
}
