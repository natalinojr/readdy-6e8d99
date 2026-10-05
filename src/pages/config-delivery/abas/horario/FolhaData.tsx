import { useMemo, useState } from 'react';
import { btn, Chips, Folha, Nota } from '../../ui';
import EditorIntervalos, { Aviso } from './EditorIntervalos';
import { problemasIntervalos, sugerirOutro, intervalosDoDia, type DataEspecial, type IntervaloHorario, type NovaData } from './horarioUtil';

type Modo = 'fechado' | 'diferente';

// Criar ou mudar uma data especial (feriado, evento, folga). Vale só naquele dia e troca o horário da semana
// inteiro daquele dia. Nada vai para o rascunho até o "Pronto".
export default function FolhaData({ original, hoje, outrasDatas, aoFechar, aoPronto, aoApagar }: {
  /** null = data nova. */
  original: DataEspecial | null;
  /** Hoje em Brasília (AAAA-MM-DD). */
  hoje: string;
  /** Dias que já têm data especial (menos o que está sendo editado). */
  outrasDatas: string[];
  aoFechar: () => void;
  aoPronto: (d: NovaData) => void;
  aoApagar?: () => void;
}) {
  const [date, setDate] = useState(original?.date ?? '');
  const [label, setLabel] = useState(original?.label ?? '');
  const [modo, setModo] = useState<Modo>(original && !original.closed ? 'diferente' : 'fechado');
  const [ints, setInts] = useState<IntervaloHorario[]>(() => intervalosDoDia({ enabled: true, intervals: original?.intervals }));

  const dataOk = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const problemas = useMemo(() => problemasIntervalos(ints), [ints]);
  const semHorario = modo === 'diferente' && ints.length === 0;
  const bloqueado = !dataOk || (modo === 'diferente' && (!!problemas.erro || semHorario));

  const escolherModo = (m: Modo) => {
    setModo(m);
    if (m === 'diferente' && ints.length === 0) setInts([sugerirOutro([])]);
  };

  return (
    <Folha
      aberta titulo={original ? 'Mudar data especial' : 'Nova data especial'} subtitulo="Feriado, evento ou folga da equipe" onFechar={aoFechar}
      rodape={(
        <>
          {aoApagar && <button type="button" onClick={aoApagar} className={btn('perigo')}>Apagar</button>}
          <button type="button" onClick={aoFechar} className={`${btn('out')} ${aoApagar ? '' : 'flex-1'}`}>Cancelar</button>
          <button type="button" disabled={bloqueado} onClick={() => aoPronto({ date, label, fechado: modo === 'fechado', ints })} className={`${btn('p')} flex-1`}>Pronto</button>
        </>
      )}
    >
      <div className="pb-2">
        <p className="mb-1.5 mt-1 text-[11px] font-extrabold uppercase tracking-wide text-zinc-400">Qual dia?</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input type="date" aria-label="Data" value={date} onChange={(e) => setDate(e.target.value)}
            className="h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-[15px] font-bold text-zinc-900 outline-none focus:border-amber-400" />
          <input type="text" aria-label="Nome (opcional)" placeholder="Nome (opcional), ex.: Natal" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)}
            className="h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-[15px] font-semibold text-zinc-900 outline-none placeholder:font-normal placeholder:text-zinc-400 focus:border-amber-400" />
        </div>
        {!dataOk && <Aviso tom="aviso">Escolha o dia.</Aviso>}
        {dataOk && date < hoje && <Aviso tom="aviso">Esse dia já passou, então não vai mudar nada.</Aviso>}
        {dataOk && outrasDatas.includes(date) && <Aviso tom="aviso">Esse dia já tem uma data especial. Ao tocar em Pronto, ela é trocada por esta.</Aviso>}

        <p className="mb-1.5 mt-4 text-[11px] font-extrabold uppercase tracking-wide text-zinc-400">Nesse dia</p>
        <Chips<Modo> valor={modo} onChange={escolherModo}
          opcoes={[{ id: 'fechado', rotulo: 'Fechado o dia todo' }, { id: 'diferente', rotulo: 'Horário diferente' }]} />

        {modo === 'diferente' && (
          <div className="mt-3">
            <EditorIntervalos intervals={ints} onChange={setInts} rotuloAdd="Outro horário nesse dia" />
            {semHorario && <Aviso tom="erro">Coloque pelo menos um horário, ou escolha &quot;Fechado o dia todo&quot;.</Aviso>}
            {problemas.erro && <Aviso tom="erro">{problemas.erro}</Aviso>}
            {!problemas.erro && problemas.aviso && <Aviso tom="aviso">{problemas.aviso}</Aviso>}
          </div>
        )}

        <Nota className="mt-4">A semana normal fica como está. Nesse dia o topo do delivery e o assistente do WhatsApp já mostram esse horário.</Nota>
      </div>
    </Folha>
  );
}
