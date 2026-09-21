import { useEffect, useState } from 'react';
import EntrevistasDoDia from '../components/EntrevistasDoDia';
import AgendaEntrevistas from '../components/AgendaEntrevistas';
import AgendamentosPainel from '../components/AgendamentosPainel';
import type { Application, Candidate, Company, Interview, Job, Settings, Stage } from '../shared';
import type { CandidatePatch } from '../components/EntrevistaModal';
import type { SubAbaEntrevistas } from '../navegacao';

interface Props {
  interviews: Interview[]; candidates: Candidate[]; companies: Company[]; stages: Stage[]; settings: Settings;
  applications: Application[]; jobs: Job[]; mostrarEmpresa: boolean;
  onSaved: (iv: Interview, candidatePatch?: CandidatePatch) => void;
  onOpenCandidate: (id: string) => void;
  onOpenInterview: (iv: Interview) => void;
  onNewInterview: (date: string) => void;
  focoId: string | null;
  onFocoUsado: () => void;
  subabaInicial: SubAbaEntrevistas | null;
  onSubabaInicialUsada: () => void;
}

const SUBABAS: { id: SubAbaEntrevistas; label: string; icon: string }[] = [
  { id: 'dia', label: 'Do dia', icon: 'ri-calendar-event-line' },
  { id: 'calendario', label: 'Calendário', icon: 'ri-calendar-2-line' },
  { id: 'conversas', label: 'Conversas da IA', icon: 'ri-chat-check-line' },
];

export default function AreaEntrevistas(props: Props) {
  const [subaba, setSubaba] = useState<SubAbaEntrevistas>('dia');
  useEffect(() => {
    if (props.subabaInicial) { setSubaba(props.subabaInicial); props.onSubabaInicialUsada(); }
  }, [props.subabaInicial]);

  return (
    <>
      <div className="flex gap-1 mb-4 border-b border-zinc-200 overflow-x-auto">
        {SUBABAS.map((t) => (
          <button key={t.id} onClick={() => setSubaba(t.id)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
              subaba === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
            <i className={t.icon} /> {t.label}
          </button>
        ))}
      </div>
      {subaba === 'dia' ? (
        <EntrevistasDoDia interviews={props.interviews} candidates={props.candidates} companies={props.companies} stages={props.stages}
          settings={props.settings} applications={props.applications} jobs={props.jobs} onSaved={props.onSaved} onOpenCandidate={props.onOpenCandidate}
          onNewInterview={props.onNewInterview} focoId={props.focoId} onFocoUsado={props.onFocoUsado} />
      ) : subaba === 'calendario' ? (
        <AgendaEntrevistas interviews={props.interviews} candidates={props.candidates} companies={props.companies} mostrarEmpresa={props.mostrarEmpresa}
          onOpenInterview={props.onOpenInterview} onNew={props.onNewInterview} />
      ) : (
        <AgendamentosPainel candidates={props.candidates} jobs={props.jobs} companies={props.companies} stages={props.stages}
          mostrarEmpresa={props.mostrarEmpresa} onOpenCandidate={props.onOpenCandidate} />
      )}
    </>
  );
}
