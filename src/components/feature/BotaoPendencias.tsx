import { useNavigate } from 'react-router-dom';
import { useContagemHoje } from '@/pages/hoje/hojeStore';

/**
 * Número do topo (2026-09-28: ocupou o lugar do sino). Desde 2026-10-03 é o MESMO número da tela
 * Hoje — "Agora: o que precisa de você" em todas as lojas da pessoa, pelo papel dela em cada loja — e
 * abre a Hoje. Antes contava as "não vistas" da loja ativa e dava outro número (dono: "um número só").
 * A caixa completa (vistas, resolvidas, histórico) continua em /pendencias, com link na Hoje.
 */
export default function BotaoPendencias() {
  const navigate = useNavigate();
  const { agora, urgente } = useContagemHoje();

  return (
    <button
      onClick={() => navigate('/hoje')}
      title="Hoje — o que precisa de você"
      aria-label={agora > 0 ? `Hoje: ${agora} ${agora === 1 ? 'coisa precisa' : 'coisas precisam'} de você` : 'Hoje: nada urgente'}
      className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-600 cursor-pointer transition-colors"
    >
      <i className="ri-inbox-line text-lg" />
      {agora > 0 && (
        <span
          className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-bold text-white ${
            urgente ? 'bg-red-500' : 'bg-amber-500'
          }`}
        >
          {agora > 99 ? '99+' : agora}
        </span>
      )}
    </button>
  );
}
