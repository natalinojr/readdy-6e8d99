import { useState, useEffect } from 'react';
import type { PedidoRecente } from '@/types/pdv';

interface SlaCellProps {
  pedido: PedidoRecente;
}

function calcSecs(
  fromTs: string | null | undefined,
  toTs: string | null | undefined,
  nowMs: number,
): number {
  if (!fromTs) return 0;
  const from = new Date(fromTs).getTime();
  if (Number.isNaN(from)) return 0;
  const to = toTs ? new Date(toTs).getTime() : nowMs;
  return Math.max(0, Math.floor((to - from) / 1000));
}

function formatTime(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  if (m === 0) return `${s}s`;
  return `${m}min ${s}s`;
}

/**
 * Hook que sempre ticks a cada segundo, sem depender de condições externas.
 * Garante que o estado mude e o React re-renderize.
 */
function useNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return nowMs;
}

/** Espera: do pedido criado até primeiro item entrar no preparo */
function EsperaTag({ pedido }: { pedido: PedidoRecente }) {
  const nowMs = useNowMs();

  if (!pedido._criadoTs) return null;

  // Ativo = ainda não entrou em preparo
  const isAtivo = !pedido._iniciouPreparoTs;
  const secs = calcSecs(pedido._criadoTs, pedido._iniciouPreparoTs ?? null, nowMs);
  const mins = Math.floor(secs / 60);
  const isAlerta = mins >= 7;
  const isCritico = mins >= 12;

  const colorClass = isCritico
    ? 'bg-red-50 text-red-600 border border-red-200'
    : isAlerta
    ? 'bg-orange-50 text-orange-600 border border-orange-200'
    : 'bg-sky-50 text-sky-600 border border-sky-200';

  return (
    <span
      className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md w-fit ${colorClass}`}
      title={`Espera: tempo do pedido criado até entrar no preparo${isAtivo ? ' (em andamento)' : ''}`}
    >
      <i className="ri-time-line" />
      Espera {formatTime(secs)}
      {isAtivo && (
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 animate-ping" />
      )}
    </span>
  );
}

/** Cozinha: do primeiro item iniciou preparo até o primeiro item ficar pronto */
function CozinhaTag({ pedido }: { pedido: PedidoRecente }) {
  const nowMs = useNowMs();

  if (!pedido._iniciouPreparoTs) return null;

  // Ativo = está em preparo mas ainda não ficou pronto
  const isAtivo = !pedido._ficouProntoTs;
  const secs = calcSecs(pedido._iniciouPreparoTs, pedido._ficouProntoTs ?? null, nowMs);
  const mins = Math.floor(secs / 60);
  const isAlerta = mins >= 10;
  const isCritico = mins >= 15;

  const colorClass = isCritico
    ? 'bg-red-50 text-red-600 border border-red-200'
    : isAlerta
    ? 'bg-amber-50 text-amber-600 border border-amber-200'
    : 'bg-amber-50 text-amber-600 border border-amber-100';

  return (
    <span
      className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md w-fit ${colorClass}`}
      title={`Cozinha: tempo de preparo${isAtivo ? ' (em andamento)' : ''}`}
    >
      <i className="ri-fire-line" />
      Cozinha {formatTime(secs)}
      {isAtivo && (
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 animate-ping" />
      )}
    </span>
  );
}

/**
 * SlaCell — mostra Espera + Cozinha em tempo real.
 */
export default function SlaCell({ pedido }: SlaCellProps) {
  const isCancelado =
    pedido.status === 'cancelado' || pedido.status === 'cancelled';

  if (isCancelado) {
    return <span className="text-xs text-zinc-300">—</span>;
  }

  // Sem timestamp (pedido antigo): mostra valores estáticos salvos no DB
  if (!pedido._criadoTs) {
    const hasSla =
      pedido.slaEspera !== undefined || pedido.slaCozinha !== undefined;
    if (!hasSla) return <span className="text-xs text-zinc-300">—</span>;

    const esperaAlerta = (pedido.slaEspera ?? 0) > 7;
    return (
      <div className="flex flex-col gap-0.5">
        {pedido.slaEspera !== undefined && (
          <span
            className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md w-fit ${
              esperaAlerta
                ? 'bg-orange-50 text-orange-600'
                : 'bg-zinc-50 text-zinc-500'
            }`}
          >
            <i className="ri-time-line" />
            Espera {pedido.slaEspera}min
          </span>
        )}
        {pedido.slaCozinha !== undefined && (
          <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 w-fit">
            <i className="ri-fire-line" />
            Cozinha {pedido.slaCozinha}min
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <EsperaTag pedido={pedido} />
      <CozinhaTag pedido={pedido} />
    </div>
  );
}

/** Tempo total do pedido em tempo real (coluna "Tempo") */
export function TempoCell({ pedido }: { pedido: PedidoRecente }) {
  const nowMs = useNowMs();

  const hasEntrega = !!pedido._entregueTs;
  const isCancelado =
    pedido.status === 'cancelado' || pedido.status === 'cancelled';

  if (isCancelado) return <span className="text-xs text-zinc-300">—</span>;

  const toTs = pedido._entregueTs ?? null;
  const secs = pedido._criadoTs
    ? calcSecs(pedido._criadoTs, toTs, nowMs)
    : (pedido.tempoAberto ?? 0) * 60;

  const mins = Math.floor(secs / 60);
  const isAtrasado = mins > 15;
  const isNoPrazo = hasEntrega && !isAtrasado;
  const isAtivo = !hasEntrega && !!pedido._criadoTs;

  const colorClass = isAtrasado
    ? 'bg-red-50 text-red-600 border border-red-200'
    : isNoPrazo
    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
    : 'bg-amber-50 text-amber-700 border border-amber-200';

  return (
    <span
      className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md w-fit flex items-center gap-0.5 whitespace-nowrap ${colorClass}`}
    >
      <i className="ri-timer-line text-[10px]" />
      {formatTime(secs)}
      {isAtivo && (
        <span className="w-1 h-1 rounded-full bg-current opacity-60 animate-ping ml-0.5" />
      )}
    </span>
  );
}