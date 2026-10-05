import type { ReactNode } from 'react';
import { btn } from '../../ui';
import { lacunaEntre, sugerirOutro, type IntervaloHorario } from './horarioUtil';

// Lista de horários de um dia (ou de uma data especial): dois campos de hora por linha, "tirar" e
// "+ Outro horário". Entre dois horários seguidos mostra o vão: "Fechado das 14:30 às 18:00".
// Não reordena enquanto a pessoa digita (a ordem certa é feita ao tocar "Pronto").

const MAX_HORARIOS = 6; // o servidor guarda no máximo 6 por dia

function CampoHora({ valor, onChange, rotulo }: { valor: string; onChange: (v: string) => void; rotulo: string }) {
  return (
    <input
      type="time" aria-label={rotulo} value={valor} onChange={(e) => onChange(e.target.value)}
      className="flex-1 min-w-0 h-11 rounded-xl border border-zinc-200 bg-white px-2.5 text-[15px] font-extrabold tabular-nums text-zinc-900 outline-none focus:border-amber-400"
    />
  );
}

export function Aviso({ tom, children }: { tom: 'erro' | 'aviso' | 'info'; children: ReactNode }) {
  const cor = tom === 'erro' ? 'bg-red-50 text-red-700' : tom === 'aviso' ? 'bg-amber-50 text-amber-800' : 'bg-zinc-50 text-zinc-500';
  return (
    <div className={`flex gap-2 rounded-xl px-3 py-2 text-[12.5px] leading-snug mt-3 ${cor}`}>
      <i className={`${tom === 'info' ? 'ri-information-line' : 'ri-alert-line'} text-base flex-shrink-0 leading-snug`} />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export default function EditorIntervalos({ intervals, onChange, rotuloAdd = 'Outro horário neste dia' }: {
  intervals: IntervaloHorario[];
  onChange: (next: IntervaloHorario[]) => void;
  rotuloAdd?: string;
}) {
  const mudar = (k: number, campo: 'open' | 'close', v: string) =>
    onChange(intervals.map((i, n) => (n === k ? { ...i, [campo]: v } : i)));
  return (
    <div>
      {intervals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {intervals.map((i, k) => {
            const lacuna = k > 0 ? lacunaEntre(intervals[k - 1], i) : null;
            return (
              <div key={k} className="flex flex-col gap-1.5">
                {lacuna && (
                  <p className="flex items-center gap-1.5 px-3 text-[11.5px] font-bold text-zinc-400">
                    <i className="ri-time-line text-[14px]" />{lacuna}
                  </p>
                )}
                <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 py-1.5 pl-2 pr-1.5">
                  <CampoHora valor={i.open} onChange={(v) => mudar(k, 'open', v)} rotulo={`Começa (horário ${k + 1})`} />
                  <span className="flex-shrink-0 text-[13px] font-semibold text-zinc-400">às</span>
                  <CampoHora valor={i.close} onChange={(v) => mudar(k, 'close', v)} rotulo={`Termina (horário ${k + 1})`} />
                  <button type="button" aria-label="Tirar este horário" onClick={() => onChange(intervals.filter((_, n) => n !== k))}
                    className="flex h-11 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100">
                    <i className="ri-close-line text-lg" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {intervals.length < MAX_HORARIOS && (
        <button type="button" onClick={() => onChange([...intervals, sugerirOutro(intervals)])} className={`${btn('ghost', 'sm')} mt-1.5`}>
          <i className="ri-add-line" />{rotuloAdd}
        </button>
      )}
    </div>
  );
}
