import { memo } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Check, Repeat } from 'lucide-react';
import type { TaskRow } from '../../hooks/useTarefas';
import { larguraRotulo, type Periodo } from '../../lib/linhaTempo';

export type ModoBarra = 'mover' | 'inicio' | 'fim';

/** '#rrggbb' + transparência → rgba (outro formato de cor passa direto). */
export function comAlpha(cor: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(cor);
  if (!m) return cor;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Hachurado vermelho do atraso (do vencimento até hoje). */
export const FUNDO_ATRASO = 'repeating-linear-gradient(135deg, rgba(239,68,68,.6) 0 3px, rgba(239,68,68,.14) 3px 6px)';

export interface BarraProps {
  task: TaskRow;
  /** Posição na faixa (px) — já com a prévia do arrasto, se for o caso. */
  x: number;
  w: number;
  top: number;
  altura: number;
  cor: string;
  progresso: number | null;
  /** Largura do rabo de atraso (0 = em dia) e o aviso ("3d atrasada"; null = em dia). */
  atrasoPx: number;
  atrasoTexto: string | null;
  /** Onde o título gruda ao rolar (largura da coluna de nomes + folga). */
  stickyLeft: number;
  /** Detalhado com coluna de nomes: barra média já mostra o título cortado dentro. */
  comColuna: boolean;
  /** "14:00", "2/5"… vai depois do título. */
  extra: string;
  /** Barra inteira fora da tela à esquerda: a seta da linha já mostra o título, o de fora some. */
  semRotuloFora?: boolean;
  tracejada: boolean;
  arrastando: boolean;
  podeEditar: boolean;
  /** No toque não tem alça: segurar perto da ponta estica (ver ViewLinhaTempo). */
  toque: boolean;
  dica: string;
  /** Linha e período de origem do arrasto — o `onApertar` é estável (a barra é memo). */
  linhaKey: string;
  periodo: Periodo;
  onApertar: (e: ReactPointerEvent, task: TaskRow, linhaKey: string, modo: ModoBarra, periodo: Periodo, podeEditar: boolean) => void;
}

/**
 * Uma barra da linha do tempo. Nunca é um bloco mudo: o título vai dentro
 * quando cabe e, se não couber, logo depois da barra (e do atraso). O título de
 * dentro gruda na esquerda ao rolar — a barra que começa fora da tela continua legível.
 */
export const Barra = memo(function Barra(p: BarraProps) {
  const { task } = p;
  const concluida = task.status_category === 'done';
  const cancelada = task.status_category === 'cancelled';
  const texto = task.title || 'Sem título';
  const precisa = larguraRotulo(texto + p.extra);
  const dentro = p.w >= precisa || (p.comColuna && p.w >= 96);
  const w = Math.max(p.w, 6);

  return (
    <>
      <div
        data-barra
        className={`absolute select-none ${p.arrastando ? 'z-[4]' : 'z-[2]'}`}
        style={{ left: p.x, width: w, top: p.top, height: p.altura, WebkitTouchCallout: 'none' }}
        onPointerDown={(e) => p.onApertar(e, task, p.linhaKey, 'mover', p.periodo, p.podeEditar)}
        onContextMenu={(e) => e.preventDefault()}
        title={p.arrastando ? undefined : p.dica}
      >
        <div
          className={`group/barra relative h-full rounded-md border flex items-center overflow-clip transition-shadow ${
            p.podeEditar ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
          } ${p.arrastando ? 'ring-2 ring-indigo-500 shadow-lg' : 'hover:shadow-md'} ${concluida || cancelada ? 'opacity-55' : ''} ${p.tracejada ? 'border-dashed' : ''}`}
          style={{
            background: comAlpha(p.cor, concluida ? 0.12 : 0.2),
            borderColor: p.atrasoTexto ? '#ef4444' : comAlpha(p.cor, 0.7),
            borderWidth: p.atrasoTexto ? 1.5 : 1,
          }}
        >
          {p.progresso !== null && p.progresso > 0 && (
            <div className="absolute inset-y-0 left-0" style={{ width: `${Math.round(p.progresso * 100)}%`, background: comAlpha(p.cor, 0.42) }} />
          )}
          {dentro && (
            <span
              className={`sticky z-[1] flex items-center gap-1 min-w-0 px-1.5 text-[12px] leading-none font-medium whitespace-nowrap ${concluida || cancelada ? 'text-slate-500 line-through' : 'text-slate-800'}`}
              style={{ left: p.stickyLeft }}
            >
              {concluida && <Check size={11} className="shrink-0 text-emerald-600" />}
              {task.recurrence && <Repeat size={10} className="shrink-0 text-slate-500" />}
              <span className="truncate">{texto}</span>
              {p.extra && <span className="shrink-0 font-normal text-slate-500">{p.extra}</span>}
            </span>
          )}
          {p.podeEditar && !p.toque && w >= 34 && (
            <>
              <span
                onPointerDown={(e) => { e.stopPropagation(); p.onApertar(e, task, p.linhaKey, 'inicio', p.periodo, p.podeEditar); }}
                className={`absolute left-0 inset-y-0 ${w >= 40 ? 'w-2.5' : 'w-2'} cursor-ew-resize z-[2] flex items-center justify-center`}
                title="Arraste para mudar o início"
              >
                <span className="w-0.5 h-3/5 rounded-full bg-slate-500/70 opacity-0 group-hover/barra:opacity-100 transition-opacity" />
              </span>
              <span
                onPointerDown={(e) => { e.stopPropagation(); p.onApertar(e, task, p.linhaKey, 'fim', p.periodo, p.podeEditar); }}
                className={`absolute right-0 inset-y-0 ${w >= 40 ? 'w-2.5' : 'w-2'} cursor-ew-resize z-[2] flex items-center justify-center`}
                title="Arraste para mudar o vencimento"
              >
                <span className="w-0.5 h-3/5 rounded-full bg-slate-500/70 opacity-0 group-hover/barra:opacity-100 transition-opacity" />
              </span>
            </>
          )}
        </div>
      </div>
      {p.atrasoPx > 0 && (
        <div
          className="absolute z-[1] pointer-events-none rounded-r-sm"
          style={{ left: p.x + w, width: p.atrasoPx, top: p.top + p.altura / 2 - 3, height: 6, background: FUNDO_ATRASO }}
        />
      )}
      {!dentro && !p.semRotuloFora && (
        <span
          className="absolute z-[1] pointer-events-none whitespace-nowrap text-[11.5px] leading-none text-slate-700"
          style={{ left: p.x + w + p.atrasoPx + 6, top: p.top + p.altura / 2, transform: 'translateY(-50%)' }}
        >
          <span className={concluida || cancelada ? 'line-through text-slate-400' : ''}>{texto}</span>
          {p.extra && <span className="text-slate-400"> {p.extra}</span>}
          {p.atrasoTexto && <span className="text-red-600 font-medium"> · {p.atrasoTexto}</span>}
        </span>
      )}
      {dentro && p.atrasoTexto && (
        <span
          className="absolute z-[1] pointer-events-none whitespace-nowrap text-[11px] leading-none text-red-600 font-medium"
          style={{ left: p.x + w + p.atrasoPx + 6, top: p.top + p.altura / 2, transform: 'translateY(-50%)' }}
        >
          {p.atrasoTexto}
        </span>
      )}
    </>
  );
});
