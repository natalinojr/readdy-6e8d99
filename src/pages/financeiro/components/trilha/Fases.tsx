// Representações das 6 fases de um caso: linha horizontal (dentro do cartão da tarefa),
// caminho vertical (na gaveta) e a barrinha mini (esteira/matriz).
import { ruim, grave, type CasoTrilha, type EtapaId, type EtapaTrilha, type Atalho } from '@/lib/trilhaDespesas';
import { CHIP, EST, ICONE_ETAPA } from './comum';

const semNaoPrecisa = (s: string) => s.replace(/^Não precisa:? ?/, '');
const mudo = (e: EtapaTrilha) => e.estado === 'na' || e.estado === 'espera';

function bolaCls(e: EtapaTrilha, sombra = true): string {
  const sh = (c: string) => (sombra ? c : '');
  if (e.estado === 'ok') return `bg-emerald-500 text-white ${sh('shadow-emerald-200')}`;
  if (grave(e.estado)) return `bg-red-500 text-white ${sh('shadow-red-200')}`;
  if (e.estado === 'pendente') return `bg-amber-400 text-white ${sh('shadow-amber-200')}`;
  if (e.estado === 'prazo') return `bg-sky-400 text-white ${sh('shadow-sky-200')}`;
  if (e.estado === 'na') return 'bg-white text-zinc-300 border-2 border-dashed border-zinc-200';
  return 'bg-white text-zinc-400 border-2 border-zinc-200';
}

export function MiniBarra({ caso }: { caso: CasoTrilha }) {
  return (
    <div className="flex gap-0.5 mt-2">
      {caso.etapas.map((e) => (
        <span key={e.id} title={`${e.nome}: ${e.resumo}`} className={`h-1.5 flex-1 rounded-full ${EST[e.estado].cor}`} />
      ))}
    </div>
  );
}

/** Linha de fases HORIZONTAL: bolinhas ligadas, trilho verde até onde andou, selo "Resolver aqui". */
export function FasesLinha({ caso, fecha, ir }: { caso: CasoTrilha; fecha: EtapaId[]; ir: (a: Atalho) => void }) {
  const et = caso.etapas;
  const ultOk = et.reduce((m, e, i) => ((e.estado === 'ok' || e.estado === 'na') && et.slice(0, i).every((x) => x.estado === 'ok' || x.estado === 'na') ? i : m), -1);
  const pct = ultOk < 0 ? 0 : (ultOk / (et.length - 1)) * 100;
  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-gradient-to-b from-zinc-50 to-white p-3 md:p-4">
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="relative min-w-[560px] pt-9">
          <div className="absolute left-[8.33%] right-[8.33%] top-[54px] h-1 rounded-full bg-zinc-200" />
          <div className="absolute left-[8.33%] top-[54px] h-1 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all" style={{ width: `calc(${pct}% * 0.8334)` }} />
          <ol className="relative grid grid-cols-6 gap-1.5">
            {et.map((e) => {
              const alvo = fecha.includes(e.id) && ruim(e.estado);
              return (
                <li key={e.id} className="flex flex-col items-center text-center min-w-0">
                  <div className="relative">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base shadow-md ${bolaCls(e)}`}>
                      <i className={e.estado === 'ok' ? 'ri-check-line' : ICONE_ETAPA[e.id]} />
                    </div>
                    {alvo && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap text-[10px] font-bold text-white bg-amber-500 rounded-full px-2 py-0.5 shadow-sm">Resolver aqui</span>
                    )}
                  </div>
                  <div className="mt-2 w-full px-1.5 py-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 leading-tight">{e.nome}</p>
                    <span className={`inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ${CHIP[e.estado]}`}>{EST[e.estado].rot}</span>
                    <p className={`mt-1.5 text-[11px] font-semibold leading-snug break-words ${mudo(e) ? 'text-zinc-400' : 'text-zinc-800'}`}>{semNaoPrecisa(e.resumo)}</p>
                    {e.detalhe && <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 break-words">{e.detalhe}</p>}
                    {e.falta && ruim(e.estado) && (
                      <p className={`mt-1.5 text-[11px] leading-snug font-semibold break-words ${grave(e.estado) ? 'text-red-600' : 'text-amber-700'}`}>
                        <i className="ri-arrow-right-line" /> Falta: {e.falta}
                      </p>
                    )}
                    {e.estado === 'ok' && e.atalho && (
                      <button onClick={() => ir(e.atalho!)} className="mt-1.5 text-[11px] font-semibold text-zinc-500 hover:text-amber-700 cursor-pointer">
                        Abrir <i className="ri-arrow-right-up-line" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** "O caminho desta despesa" — vertical, para a gaveta. */
export function CaminhoVertical({ caso, ir }: { caso: CasoTrilha; ir: (a: Atalho) => void }) {
  return (
    <div className="rounded-xl border border-zinc-200 px-4 py-3">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-zinc-500">O caminho desta despesa</p>
      <ol>
        {caso.etapas.map((e, i) => (
          <li key={e.id} className="flex gap-3 pb-4 last:pb-0 relative">
            {i < caso.etapas.length - 1 && <span className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${e.estado === 'ok' ? 'bg-emerald-300' : 'bg-zinc-200'}`} />}
            <div className={`relative z-10 w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm ${e.estado === 'ok' ? 'bg-emerald-500 text-white' : grave(e.estado) ? 'bg-red-500 text-white' : e.estado === 'pendente' ? 'bg-amber-400 text-white' : e.estado === 'prazo' ? 'bg-sky-400 text-white' : 'bg-zinc-100 text-zinc-400 border border-dashed border-zinc-300'}`}>
              <i className={ICONE_ETAPA[e.id]} />
            </div>
            <div className="pt-0.5 min-w-0 flex-1">
              <p className="text-[11px] text-zinc-400 uppercase tracking-wide font-semibold">{e.nome} · <span className={EST[e.estado].txt}>{EST[e.estado].rot}</span></p>
              <p className={`text-sm font-semibold break-words ${mudo(e) ? 'text-zinc-400' : ''}`}>{semNaoPrecisa(e.resumo)}</p>
              {e.detalhe && <p className="text-xs text-zinc-500 break-words">{e.detalhe}</p>}
              {e.falta && ruim(e.estado) && (
                <p className={`text-xs font-semibold mt-0.5 ${grave(e.estado) ? 'text-red-600' : 'text-amber-700'}`}><i className="ri-arrow-right-line" /> Falta: {e.falta}</p>
              )}
              {e.estado === 'ok' && e.atalho && (
                <button onClick={() => ir(e.atalho!)} className="mt-0.5 text-[11px] font-semibold text-zinc-500 hover:text-amber-700 cursor-pointer">Abrir <i className="ri-arrow-right-up-line" /></button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
