import { useNavigate } from 'react-router-dom';
import { usePendencias } from '@/contexts/PendenciasContext';

/**
 * Botão da caixa de Pendências no topo (2026-09-28) — ocupa o lugar do sino, que saiu para
 * todo mundo. O número é o que ainda não foi tocado na loja ativa (a caixa já filtra o que
 * cada papel vê: pedido de cancelamento só para quem aprova, dinheiro só para o Financeiro).
 */
export default function BotaoPendencias() {
  const navigate = useNavigate();
  const { naoVistas, naoVistasAltas } = usePendencias();

  return (
    <button
      onClick={() => navigate('/pendencias')}
      title="Pendências"
      aria-label={naoVistas > 0 ? `Pendências: ${naoVistas} em aberto` : 'Pendências'}
      className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-600 cursor-pointer transition-colors"
    >
      <i className="ri-inbox-line text-lg" />
      {naoVistas > 0 && (
        <span
          className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-bold text-white ${
            naoVistasAltas > 0 ? 'bg-red-500 animate-pulse' : 'bg-amber-500'
          }`}
        >
          {naoVistas > 99 ? '99+' : naoVistas}
        </span>
      )}
    </button>
  );
}
