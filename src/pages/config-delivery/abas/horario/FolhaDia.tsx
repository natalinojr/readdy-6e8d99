import { useMemo, useState } from 'react';
import { btn, Folha, LinhaInterruptor } from '../../ui';
import EditorIntervalos, { Aviso } from './EditorIntervalos';
import Trilho, { EixoHoras } from './Trilho';
import {
  DIAS_CURTO, DIAS_FOLHA, DIAS_MINUSCULO, TODOS_OS_DIAS, intervalosDoDia, janelasDoDia, problemasIntervalos, sugerirOutro,
  type HorarioDelivery, type IntervaloHorario,
} from './horarioUtil';

// Editar um dia da semana: abre/fecha, lista de horários e "usar o mesmo horário em" outros dias.
// Nada vai para o rascunho até o "Pronto"; "Cancelar" descarta.
export default function FolhaDia({ dow, horario, aoFechar, aoPronto }: {
  dow: number;
  horario: HorarioDelivery;
  aoFechar: () => void;
  /** `dias` = o próprio dia mais os marcados em "Usar o mesmo horário em". */
  aoPronto: (dias: number[], ligado: boolean, intervals: IntervaloHorario[]) => void;
}) {
  const dia = horario.days?.[String(dow)];
  const [ligado, setLigado] = useState(() => janelasDoDia(dia).length > 0);
  const [ints, setInts] = useState<IntervaloHorario[]>(() => intervalosDoDia(dia));
  const [copiarPara, setCopiarPara] = useState<number[]>([]);

  const problemas = useMemo(() => problemasIntervalos(ints), [ints]);
  const janelas = useMemo(() => janelasDoDia({ enabled: true, intervals: ints }), [ints]);
  const bloqueado = ligado && !!problemas.erro;

  const ligar = (v: boolean) => {
    setLigado(v);
    if (v && ints.length === 0) setInts([sugerirOutro([])]);
  };
  const marcar = (d: number) => setCopiarPara((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));

  return (
    <Folha
      aberta titulo={DIAS_FOLHA[dow]} subtitulo="Pode ter mais de um horário no mesmo dia" onFechar={aoFechar}
      rodape={(
        <>
          <button type="button" onClick={aoFechar} className={`${btn('out')} flex-1`}>Cancelar</button>
          <button type="button" disabled={bloqueado} onClick={() => aoPronto([dow, ...copiarPara], ligado, ints)} className={`${btn('p')} flex-1`}>Pronto</button>
        </>
      )}
    >
      <div className="pb-2">
        <div className="mt-1 mb-3">
          <LinhaInterruptor titulo="Abre neste dia" ligado={ligado} onChange={ligar}
            texto={ligado ? undefined : 'Fechado neste dia.'} />
        </div>

        {ligado && (
          <>
            <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-zinc-400">Horários</p>
            <EditorIntervalos intervals={ints} onChange={setInts} />
            {ints.length === 0 && <Aviso tom="aviso">Sem nenhum horário o dia fica fechado.</Aviso>}
            {problemas.erro && <Aviso tom="erro">{problemas.erro}</Aviso>}
            {!problemas.erro && problemas.aviso && <Aviso tom="aviso">{problemas.aviso}</Aviso>}
            <div className="mt-3">
              <EixoHoras />
              <Trilho janelas={janelas} grande />
            </div>
            <Aviso tom="info">
              Passa da meia-noite? Pode: 18:00 às 00:30 conta como {DIAS_MINUSCULO[dow]} até 00:30 de {DIAS_MINUSCULO[(dow + 1) % 7]}.
            </Aviso>
          </>
        )}

        <p className="mb-1.5 mt-4 text-[11px] font-extrabold uppercase tracking-wide text-zinc-400">
          Usar o mesmo horário em <span className="font-semibold normal-case tracking-normal text-zinc-400">· copia só para os dias marcados</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TODOS_OS_DIAS.filter((d) => d !== dow).map((d) => {
            const on = copiarPara.includes(d);
            return (
              <button key={d} type="button" aria-pressed={on} onClick={() => marcar(d)}
                className={`inline-flex h-9 min-w-[52px] cursor-pointer items-center justify-center rounded-full border px-3 text-[12.5px] font-bold ${on ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'}`}>
                {DIAS_CURTO[d]}
              </button>
            );
          })}
        </div>
      </div>
    </Folha>
  );
}
