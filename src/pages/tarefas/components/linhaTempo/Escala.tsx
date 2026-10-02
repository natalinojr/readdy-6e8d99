import { memo, useMemo } from 'react';
import type { ReactElement } from 'react';
import { chaveDia, diaLocal, somarDias } from '../../lib/carga';
import { diferencaDias } from '../../lib/calendario';

const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

interface TrechoMes { x: number; w: number; d: Date }

/** Trechos de mês dentro da faixa [de, de + nDias). */
function trechosDeMes(de: string, nDias: number, px: number): TrechoMes[] {
  const r: TrechoMes[] = [];
  const inicio = diaLocal(de);
  let i = 0;
  while (i < nDias) {
    const d = somarDias(inicio, i);
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const n = Math.min(nDias - i, diferencaDias(chaveDia(d), chaveDia(ultimo)) + 1);
    r.push({ x: i * px, w: n * px, d });
    i += n;
  }
  return r;
}

/** Régua de cima: meses (nome grudado na esquerda) + dias ou semanas, conforme o zoom. */
export const CabecalhoEscala = memo(function CabecalhoEscala({ de, nDias, px, hoje, stickyLeft }: {
  de: string;
  nDias: number;
  px: number;
  hoje: string;
  /** Onde o texto gruda ao rolar (largura da coluna de nomes). */
  stickyLeft: number;
}) {
  const meses = useMemo(() => trechosDeMes(de, nDias, px), [de, nDias, px]);
  const inicio = useMemo(() => diaLocal(de), [de]);
  const idxHoje = diferencaDias(de, hoje);

  let celulas: ReactElement[] = [];
  if (px >= 18) {
    celulas = Array.from({ length: nDias }, (_, i) => {
      const d = somarDias(inicio, i);
      const fds = d.getDay() === 0 || d.getDay() === 6;
      const ehHoje = i === idxHoje;
      return (
        <div
          key={i}
          className={`absolute top-0 bottom-0 flex items-center justify-center text-[11px] tabular-nums ${fds ? 'text-slate-400' : 'text-slate-500'}`}
          style={{ left: i * px, width: px }}
        >
          <span className={`px-1 py-0.5 rounded-md leading-none whitespace-nowrap ${ehHoje ? 'bg-indigo-600 text-white font-semibold' : ''}`}>
            {px >= 40 && <span className={ehHoje ? '' : 'text-slate-400'}>{NOMES_DIA[d.getDay()]} </span>}
            {String(d.getDate()).padStart(2, '0')}
          </span>
        </div>
      );
    });
  } else {
    // Zoom de longe: uma marca por semana (segunda-feira).
    const primeiraSegunda = (8 - inicio.getDay()) % 7; // 0 se já começa numa segunda
    for (let i = primeiraSegunda; i < nDias; i += 7) {
      const d = somarDias(inicio, i);
      celulas.push(
        <div key={i} className="absolute top-0 bottom-0 border-l border-slate-200 flex items-center pl-1 text-[10px] text-slate-400 tabular-nums" style={{ left: i * px, width: 7 * px }}>
          {7 * px >= 34 ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : ''}
        </div>,
      );
    }
    if (idxHoje >= 0 && idxHoje < nDias) {
      celulas.push(
        <div key="hoje" className="absolute top-1 bottom-1 flex items-center" style={{ left: idxHoje * px + px / 2 - 15 }}>
          <span className="px-1 rounded bg-indigo-600 text-white text-[10px] font-semibold leading-4">hoje</span>
        </div>,
      );
    }
  }

  return (
    <div className="relative h-full" style={{ width: nDias * px }}>
      <div className="absolute inset-x-0 top-0 h-5">
        {meses.map((m) => (
          <div key={m.x} className="absolute top-0 h-full border-l border-slate-200 overflow-clip" style={{ left: m.x, width: m.w }}>
            <span className="sticky inline-block px-1.5 text-[11px] font-semibold text-slate-600 capitalize leading-5 whitespace-nowrap" style={{ left: stickyLeft }}>
              {m.w >= 110
                ? m.d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(' de ', ' ')
                : m.w >= 36 ? m.d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') : ''}
            </span>
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 top-5 bottom-0">{celulas}</div>
    </div>
  );
});

/** Fundo do corpo: linhas dos dias (ou semanas), fins de semana, hoje e viradas de mês. */
export const FundoEscala = memo(function FundoEscala({ de, nDias, px, hoje }: {
  de: string;
  nDias: number;
  px: number;
  hoje: string;
}) {
  const inicio = useMemo(() => diaLocal(de), [de]);
  const fds = useMemo(() => {
    if (px < 12) return []; // de longe, listras a cada fim de semana só poluem
    const r: Array<{ x: number; w: number }> = [];
    for (let i = 0; i < nDias; i++) {
      const dow = somarDias(inicio, i).getDay();
      if (dow === 6) r.push({ x: i * px, w: Math.min(2, nDias - i) * px });
      else if (dow === 0 && i === 0) r.push({ x: 0, w: px });
    }
    return r;
  }, [inicio, nDias, px]);
  const meses = useMemo(() => trechosDeMes(de, nDias, px).slice(1), [de, nDias, px]);
  const idxHoje = diferencaDias(de, hoje);
  const primeiraSegunda = (8 - inicio.getDay()) % 7;
  const grade = px >= 18
    ? { backgroundImage: 'linear-gradient(to right, #eef2f7 1px, transparent 1px)', backgroundSize: `${px}px 100%` }
    : { backgroundImage: 'linear-gradient(to right, #eef2f7 1px, transparent 1px)', backgroundSize: `${7 * px}px 100%`, backgroundPosition: `${primeiraSegunda * px}px 0` };

  return (
    <div className="absolute inset-y-0 pointer-events-none" style={{ width: nDias * px, ...grade }}>
      {fds.map((f) => <div key={f.x} className="absolute inset-y-0 bg-slate-100/60" style={{ left: f.x, width: f.w }} />)}
      {meses.map((m) => <div key={m.x} className="absolute inset-y-0 w-px bg-slate-200" style={{ left: m.x }} />)}
      {idxHoje >= 0 && idxHoje < nDias && (
        <>
          <div className="absolute inset-y-0 bg-indigo-50/70" style={{ left: idxHoje * px, width: px }} />
          <div className="absolute inset-y-0 w-0.5 bg-indigo-400/80" style={{ left: idxHoje * px + px / 2 - 1 }} />
        </>
      )}
    </div>
  );
});
