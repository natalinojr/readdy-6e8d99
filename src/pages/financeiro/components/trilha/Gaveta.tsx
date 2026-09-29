// Gaveta lateral de um caso: as tarefas dele (mesmos cartões) + o caminho completo.
import { diaBR, type CasoTrilha } from '@/lib/trilhaDespesas';
import { CaminhoVertical } from './Fases';
import TarefaCard from './TarefaCard';
import { GRUPO_POR_ID, ROTULO_TIPO, fmtBRL, type AcoesTrilha } from './comum';

interface Props {
  caso: CasoTrilha; expandidos: Set<string>; onToggle: (key: string) => void; acoes: AcoesTrilha; onFechar: () => void;
}

export default function Gaveta({ caso, expandidos, onToggle, acoes, onFechar }: Props) {
  const tp = ROTULO_TIPO[caso.tipo];
  const ts = [...caso.tarefas].sort((a, b) => Number(b.urgente) - Number(a.urgente));
  return (
    <>
      <div className="fixed inset-0 z-40 bg-zinc-900/20" onClick={onFechar} />
      <aside className="fixed top-0 right-0 z-50 h-full w-full sm:w-[460px] bg-white shadow-2xl border-l border-zinc-200 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-zinc-100 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${tp.cls}`}>{tp.t}</span>
            <p className="text-base font-bold mt-1.5 break-words">{caso.titulo}</p>
            <p className="text-xs text-zinc-400 break-words">{diaBR(caso.data)} · {caso.subtitulo}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold tabular-nums">{fmtBRL(caso.valor)}</p>
            <button onClick={onFechar} aria-label="Fechar" className="text-zinc-400 hover:text-zinc-700 text-xl cursor-pointer"><i className="ri-close-line" /></button>
          </div>
        </div>
        <div className="px-4 py-4 space-y-4">
          {ts.length > 0 ? (
            <div>
              <p className="px-1 mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500"><i className="ri-checkbox-multiple-line" /> Resolver aqui mesmo · {ts.length} {ts.length > 1 ? 'tarefas' : 'tarefa'}</p>
              <div className="space-y-2">
                {ts.map((t) => {
                  const g = GRUPO_POR_ID[t.grupo];
                  return (
                    <div key={t.key}>
                      <p className={`px-1 mb-1 text-[11px] font-semibold ${g.cor === 'red' ? 'text-red-600' : 'text-amber-700'}`}><i className={g.icone} /> {g.nome}</p>
                      <TarefaCard caso={caso} tarefa={t} expandido={expandidos.has(t.key)} onToggle={() => onToggle(t.key)} acoes={acoes} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              <i className="ri-checkbox-circle-fill" /> {caso.situacao === 'ok' ? 'Tudo certo — da nota fiscal ao extrato do banco.' : 'Nada para resolver agora — falta só o que depende do prazo (ex.: pagar até o vencimento).'}
            </div>
          )}
          {ts.length === 0 && caso.avisos.length > 0 && (
            <div className="space-y-1">
              {caso.avisos.map((a) => (
                <p key={a} className={`text-xs flex items-start gap-1 ${a.startsWith('Juros') ? 'text-zinc-600' : 'text-red-600'}`}><i className="ri-error-warning-line mt-px" />{a}</p>
              ))}
            </div>
          )}
          <CaminhoVertical caso={caso} ir={acoes.ir} />
        </div>
      </aside>
    </>
  );
}
