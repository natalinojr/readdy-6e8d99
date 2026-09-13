// Kanban das fases do processo. Arrasta o card para mudar de fase; clique abre a ficha.
import { useState } from 'react';
import { type Candidate, type Company, type Interview, type Stage, colorOf, companyName } from '../shared';
import { CandidateCard } from './CandidatosLista';

interface Props {
  items: Candidate[];
  stages: Stage[];
  companies: Company[];
  mostrarEmpresa: boolean;
  proximaEntrevista: Map<string, Interview>;
  onOpen: (id: string) => void;
  onMove: (candidateId: string, stageId: string) => void;
}

export default function Kanban({ items, stages, companies, mostrarEmpresa, proximaEntrevista, onOpen, onMove }: Props) {
  const [over, setOver] = useState<string | null>(null);
  const novoId = stages.find((s) => s.native_kind === 'novo')?.id ?? null;
  // Candidato sem fase (ou numa fase apagada) aparece em "Novo".
  const stageIds = new Set(stages.map((s) => s.id));
  const colOf = (c: Candidate) => (c.stage_id && stageIds.has(c.stage_id) ? c.stage_id : novoId);

  return (
    <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1" style={{ minHeight: '60vh' }}>
      {stages.map((s) => {
        const list = items.filter((c) => colOf(c) === s.id);
        const col = colorOf(s.color);
        return (
          <div key={s.id}
            onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
            onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault(); setOver(null);
              const id = e.dataTransfer.getData('text/plain');
              if (id) onMove(id, s.id);
            }}
            className={`flex-shrink-0 w-72 rounded-2xl border flex flex-col transition-colors ${over === s.id ? 'border-rose-300 bg-rose-50/60' : 'border-zinc-200 bg-zinc-50/70'}`}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-200/70">
              <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
              <p className="flex-1 text-sm font-black text-zinc-800 truncate">{s.name}</p>
              <span className="text-xs font-bold text-zinc-400">{list.length}</span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[70vh]">
              {list.map((c) => (
                <div key={c.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; }}>
                  <CandidateCard compact c={c} companies={companies} stage={s} empresa={mostrarEmpresa ? companyName(companies, c.company_id) : null}
                    entrevista={proximaEntrevista.get(c.id) ?? null} onOpen={() => onOpen(c.id)} />
                </div>
              ))}
              {list.length === 0 && <p className="text-xs text-zinc-400 text-center py-6">Arraste candidatos para cá</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
