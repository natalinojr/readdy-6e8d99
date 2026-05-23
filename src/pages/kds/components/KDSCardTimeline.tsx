import { memo } from 'react';
import type { KDSItem } from '@/types/kds';
import { useKDSTick, getItemFase, formatDuration } from '@/hooks/useKDSTick';

interface Props {
  item: KDSItem;
}

function formatTime(ts?: number) {
  if (!ts) return '--:--';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Mini timeline bar shown below each item row.
 * Displays elapsed time per phase (espera → preparo → pronto) with a progress bar.
 *
 * AGGREGATE RULE: each phase is only solid-colored when ALL units have passed
 * through that phase. If any unit is still behind, the phase pulses.
 */
const KDSCardTimeline = memo(function KDSCardTimeline({ item }: Props) {
  useKDSTick();
  const now = Date.now();
  const hasUnidades = (item.unidades?.length ?? 0) > 0;

  // ── Helpers for aggregate unit calculations ───────────────────────────────
  const allUnitsHave = (fn: (u: NonNullable<KDSItem['unidades']>[number]) => boolean) =>
    hasUnidades ? item.unidades!.every(fn) : true;

  const firstUnit = (fn: (u: NonNullable<KDSItem['unidades']>[number]) => number | undefined) => {
    if (!hasUnidades) return undefined;
    const vals = item.unidades!.map(fn).filter((v): v is number => v !== undefined);
    return vals.length > 0 ? Math.min(...vals) : undefined;
  };

  const lastUnit = (fn: (u: NonNullable<KDSItem['unidades']>[number]) => number | undefined) => {
    if (!hasUnidades) return undefined;
    const vals = item.unidades!.map(fn).filter((v): v is number => v !== undefined);
    return vals.length > 0 ? Math.max(...vals) : undefined;
  };

  // ── Phase timestamps (aggregate when units exist) ─────────────────────────
  const iniciouPreparoRef = hasUnidades ? lastUnit((u) => u.iniciouPreparoEm) : item.iniciouPreparoEm;
  const ficouProntoRef = hasUnidades ? lastUnit((u) => u.ficouProntoEm) : item.ficouProntoEm;
  const entregueRef = hasUnidades ? firstUnit((u) => u.entregueEm) : item.entregueEm;
  const ultimoEntregueRef = hasUnidades ? lastUnit((u) => u.entregueEm) : item.entregueEm;

  // ── Phase flags (solid only when ALL units passed) ────────────────────────
  const todasIniciaramPreparo = allUnitsHave((u) => !!u.iniciouPreparoEm);
  const todasProntas = allUnitsHave((u) => !!u.ficouProntoEm);
  const todasEntregues = allUnitsHave((u) => !!u.entregueEm);

  // ── Phase durations ───────────────────────────────────────────────────────
  const espera = iniciouPreparoRef
    ? Math.floor((iniciouPreparoRef - item.entroKdsEm) / 1000)
    : Math.floor((now - item.entroKdsEm) / 1000);

  const preparo =
    ficouProntoRef && iniciouPreparoRef
      ? Math.floor((ficouProntoRef - iniciouPreparoRef) / 1000)
      : iniciouPreparoRef
        ? Math.floor((now - iniciouPreparoRef) / 1000)
        : null;

  const cozinha = ficouProntoRef
    ? Math.floor((ficouProntoRef - item.entroKdsEm) / 1000)
    : null;

  const aguardandoEntrega =
    entregueRef && ficouProntoRef
      ? Math.floor((entregueRef - ficouProntoRef) / 1000)
      : ficouProntoRef
        ? Math.floor((now - ficouProntoRef) / 1000)
        : null;

  // ── Current phase label ───────────────────────────────────────────────────
  const fase = getItemFase(item.status, item.iniciouPreparoEm, item.ficouProntoEm, item.entregueEm);

  const faseLabel: Record<string, { text: string; color: string; icon: string }> = {
    aguardando:       { text: `Aguardando início: ${formatDuration(espera)}`,                          color: 'text-amber-600',  icon: 'ri-time-line' },
    preparo:          { text: `Em preparo: ${formatDuration(preparo ?? 0)}`,                           color: 'text-yellow-600', icon: 'ri-fire-line' },
    pronto_aguardando:{ text: `Pronto · aguard. entrega: ${formatDuration(aguardandoEntrega ?? 0)}`,   color: 'text-green-600',  icon: 'ri-check-line' },
    entregue:         { text: 'Entregue',                                                              color: 'text-zinc-400',   icon: 'ri-check-double-line' },
  };

  const cfg = faseLabel[fase];

  return (
    <div className="mt-1.5 space-y-1">
      {/* Current phase label */}
      <div className={`flex items-center gap-1 text-[10px] font-bold ${cfg.color}`}>
        <div className="w-3 h-3 flex items-center justify-center">
          <i className={`${cfg.icon} text-[10px]`} />
        </div>
        <span>{cfg.text}</span>
      </div>

      {/* Timestamps absolutos */}
      <div className="flex items-center gap-2 text-[9px] text-zinc-400 mt-0.5">
        <span className="flex items-center gap-0.5">
          <i className="ri-time-line text-[9px] text-amber-400" />
          Criado: {formatTime(item.entroKdsEm)}
        </span>
        {ultimoEntregueRef && (
          <span className="flex items-center gap-0.5">
            <i className="ri-check-double-line text-[9px] text-green-500" />
            Entregue: {formatTime(ultimoEntregueRef)}
          </span>
        )}
        {!ultimoEntregueRef && ficouProntoRef && (
          <span className="flex items-center gap-0.5">
            <i className="ri-check-line text-[9px] text-green-400" />
            Pronto: {formatTime(ficouProntoRef)}
          </span>
        )}
        {!ultimoEntregueRef && !ficouProntoRef && iniciouPreparoRef && (
          <span className="flex items-center gap-0.5">
            <i className="ri-fire-line text-[9px] text-yellow-400" />
            Início: {formatTime(iniciouPreparoRef)}
          </span>
        )}
      </div>

      {/* Phase breakdown dots — only show aggregate when units exist */}
      {(iniciouPreparoRef || ficouProntoRef) && (
        <div className="flex items-center gap-2 flex-wrap">
          {iniciouPreparoRef && (
            <span className={`text-[9px] font-medium flex items-center gap-0.5 ${todasIniciaramPreparo ? 'text-zinc-400' : 'text-amber-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${todasIniciaramPreparo ? 'bg-amber-300' : 'bg-amber-300 animate-pulse'}`} />
              Espera: {formatDuration(espera)}
            </span>
          )}
          {preparo !== null && iniciouPreparoRef && (
            <span className={`text-[9px] font-medium flex items-center gap-0.5 ${todasProntas ? 'text-zinc-400' : 'text-yellow-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${todasProntas ? 'bg-yellow-400' : 'bg-yellow-400 animate-pulse'}`} />
              Preparo: {formatDuration(preparo)}
            </span>
          )}
          {cozinha !== null && (
            <span className={`text-[9px] font-bold flex items-center gap-0.5 ${todasProntas ? 'text-zinc-500' : 'text-green-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${todasProntas ? 'bg-green-400' : 'bg-green-400 animate-pulse'}`} />
              Cozinha: {formatDuration(cozinha)}
            </span>
          )}
          {aguardandoEntrega !== null && ficouProntoRef && !entregueRef && (
            <span className={`text-[9px] font-medium flex items-center gap-0.5 ${todasEntregues ? 'text-zinc-400' : 'text-zinc-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${todasEntregues ? 'bg-zinc-300' : 'bg-zinc-300 animate-pulse'}`} />
              Ag. entrega: {formatDuration(aguardandoEntrega)}
            </span>
          )}
        </div>
      )}

      {/* Progress bar — solid only when ALL units passed the phase */}
      <div className="flex h-1 rounded-full overflow-hidden bg-zinc-100 gap-px">
        <div
          className={`${todasIniciaramPreparo ? 'bg-amber-300' : 'bg-amber-200 animate-pulse'} flex-shrink-0`}
          style={{ flex: iniciouPreparoRef ? espera : 1, minWidth: 4 }}
        />
        {iniciouPreparoRef && (
          <div
            className={`${todasProntas ? 'bg-yellow-400' : 'bg-yellow-300 animate-pulse'} flex-shrink-0`}
            style={{ flex: preparo ?? 30, minWidth: 4 }}
          />
        )}
        {ficouProntoRef && (
          <div
            className={`${todasEntregues ? 'bg-green-400' : 'bg-green-300 animate-pulse'} flex-shrink-0`}
            style={{ flex: aguardandoEntrega ?? 10, minWidth: 4 }}
          />
        )}
      </div>
    </div>
  );
});

export default KDSCardTimeline;