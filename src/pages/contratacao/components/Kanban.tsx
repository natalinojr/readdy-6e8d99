// Kanban das fases do processo. Arrasta o card para mudar de fase; clique abre a ficha.
// No celular/tablet (toque não arrasta) cada card tem botões ◀ ▶ para a fase vizinha, e as
// colunas ocupam quase a tela inteira com rolagem que "encaixa" em cada coluna.
import { useState } from 'react';
import { type Candidate, type Company, type Interview, type Stage, colorOf, companyName } from '../shared';
import type { Aderencia } from '../aderencia';
import { CandidateCard } from './CandidatosLista';

interface Props {
  items: Candidate[];
  stages: Stage[];
  companies: Company[];
  mostrarEmpresa: boolean;
  proximaEntrevista: Map<string, Interview>;
  onOpen: (id: string) => void;
  aderenciaDe: (c: Candidate) => Aderencia | null;
  faltasDe: (c: Candidate) => number;
  agendamentoIADe: (c: Candidate) => string | null;
  onMove: (candidateId: string, stageId: string) => void;
  selecionados: Set<string>;
  onToggleSelecao: (id: string) => void;
}

export default function Kanban({ items, stages, companies, mostrarEmpresa, proximaEntrevista, onOpen, aderenciaDe, faltasDe, agendamentoIADe, onMove, selecionados, onToggleSelecao }: Props) {
  const [over, setOver] = useState<string | null>(null);
  const novoId = stages.find((s) => s.native_kind === 'novo')?.id ?? null;
  // Candidato sem fase (ou numa fase apagada) aparece em "Novo".
  const stageIds = new Set(stages.map((s) => s.id));
  const colOf = (c: Candidate) => (c.stage_id && stageIds.has(c.stage_id) ? c.stage_id : novoId);

  return (
    <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory lg:snap-none" style={{ minHeight: '60vh' }}>
      {stages.map((s, idx) => {
        const list = items.filter((c) => colOf(c) === s.id);
        const col = colorOf(s.color);
        const prev = stages[idx - 1] ?? null;
        const next = stages[idx + 1] ?? null;
        return (
          <div key={s.id}
            onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
            onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault(); setOver(null);
              const id = e.dataTransfer.getData('text/plain');
              if (id) onMove(id, s.id);
            }}
            className={`flex-shrink-0 w-[85vw] sm:w-72 snap-start rounded-2xl border flex flex-col transition-colors ${over === s.id ? 'border-rose-300 bg-rose-50/60' : 'border-zinc-200 bg-zinc-50/70'}`}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-200/70">
              <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
              <p className="flex-1 text-sm font-black text-zinc-800 truncate">{s.name}</p>
              <span className="text-xs font-bold text-zinc-400">{list.length}</span>
              <span className="lg:hidden text-[10px] text-zinc-400">{idx + 1}/{stages.length}</span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[70vh]">
              {list.map((c) => (
                <div key={c.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; }}>
                  <CandidateCard compact c={c} companies={companies} stage={s} empresa={mostrarEmpresa ? companyName(companies, c.company_id) : null}
                    entrevista={proximaEntrevista.get(c.id) ?? null} onOpen={() => onOpen(c.id)}
                    aderencia={aderenciaDe(c)} faltas={faltasDe(c)} agendamentoIA={agendamentoIADe(c)}
                    selecionado={selecionados.has(c.id)} onToggleSelecao={() => onToggleSelecao(c.id)} />
                  {(prev || next) && (
                    <div className="lg:hidden flex gap-1 mt-1">
                      {prev && (
                        <button onClick={() => onMove(c.id, prev.id)}
                          className="flex-1 min-w-0 flex items-center gap-1 px-2 h-8 rounded-lg border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-600 active:bg-zinc-100 cursor-pointer">
                          <i className="ri-arrow-left-s-line" /><span className="truncate">{prev.name}</span>
                        </button>
                      )}
                      {next && (
                        <button onClick={() => onMove(c.id, next.id)}
                          className="flex-1 min-w-0 flex items-center justify-end gap-1 px-2 h-8 rounded-lg border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-600 active:bg-zinc-100 cursor-pointer">
                          <span className="truncate">{next.name}</span><i className="ri-arrow-right-s-line" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {list.length === 0 && <p className="text-xs text-zinc-400 text-center py-6"><span className="hidden lg:inline">Arraste candidatos para cá</span><span className="lg:hidden">Nenhum candidato nesta fase</span></p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
