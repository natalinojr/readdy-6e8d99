// Aba Vagas: lista de vagas por empresa e, dentro de cada vaga, o ranking dos candidatos
// inscritos pela aderência calculada pela IA (currículo × vaga × loja).
import { useState } from 'react';
import { type Application, type Candidate, type Company, type Job, type Stage, type Distance, jobStatusInfo, companyName, fmtDate } from '../shared';
import type { JobDraft } from './VagaModal';
import VagaDetalhe from './VagaDetalhe';

interface Props {
  jobs: Job[];
  companies: Company[];
  candidates: Candidate[];
  applications: Application[];
  stages: Stage[];
  mostrarEmpresa: boolean;
  analyzing: Set<string>;
  distancia: (candidateId: string, companyId: string | null) => Distance | null;
  selectedJobId: string | null;
  onSelectJob: (id: string | null) => void;
  onNewJob: () => void;
  onDeleteJob: (job: Job) => void;
  onAddFromBank: (job: Job) => void;
  onUploadToJob: (job: Job) => void;
  onReanalyze: (app: Application) => void;
  onRemoveApplication: (app: Application) => void;
  onOpenCandidate: (id: string) => void;
  onSaveJob: (draft: JobDraft) => Promise<boolean>;
}

export const appKey = (jobId: string, candId: string) => `${jobId}:${candId}`;

export default function Vagas(props: Props) {
  const { jobs, selectedJobId } = props;
  const job = jobs.find((j) => j.id === selectedJobId) ?? null;
  return job ? <VagaDetalhe {...props} job={job} /> : <ListaVagas {...props} />;
}

function ListaVagas({ jobs, companies, applications, mostrarEmpresa, onSelectJob, onNewJob }: Props) {
  const [status, setStatus] = useState<'ativas' | 'todas' | 'fechada'>('ativas');
  const lista = jobs.filter((j) => status === 'todas' || (status === 'fechada' ? j.status === 'fechada' : j.status !== 'fechada'));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {([['ativas', 'Abertas e pausadas'], ['fechada', 'Fechadas'], ['todas', 'Todas']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setStatus(id)}
            className={`px-3 h-8 rounded-full text-xs font-bold border cursor-pointer ${status === id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200'}`}>
            {label}
          </button>
        ))}
        <button onClick={onNewJob} className="ml-auto flex items-center gap-1.5 px-4 h-9 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer">
          <i className="ri-add-line" /> Abrir vaga
        </button>
      </div>

      {lista.length === 0 ? (
        <div className="py-16 text-center text-zinc-400">
          <i className="ri-briefcase-4-line text-4xl" />
          <p className="text-sm font-semibold mt-2">{jobs.length ? 'Nenhuma vaga neste filtro' : 'Nenhuma vaga aberta ainda'}</p>
          {!jobs.length && <p className="text-xs mt-1">Abra uma vaga com os dados do cargo e inscreva currículos para a IA comparar.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lista.map((j) => {
            const apps = applications.filter((a) => a.job_id === j.id);
            const top = apps.filter((a) => a.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            const st = jobStatusInfo(j.status);
            return (
              <button key={j.id} onClick={() => onSelectJob(j.id)}
                className="text-left p-4 rounded-2xl border border-zinc-200 bg-white hover:border-rose-300 hover:shadow-sm transition-all cursor-pointer">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center flex-shrink-0">
                    <i className="ri-briefcase-4-line text-lg" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-zinc-900 truncate">{j.title}{j.openings > 1 ? <span className="text-zinc-400 font-semibold"> · {j.openings} vagas</span> : null}</p>
                    <p className="text-xs text-zinc-500 truncate">
                      {[mostrarEmpresa ? companyName(companies, j.company_id) : null, j.contract_type, j.schedule].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${st.cls}`}>{st.label}</span>
                </div>
                <div className="flex items-center gap-3 mt-3 text-xs text-zinc-500">
                  <span><b className="text-zinc-800">{apps.length}</b> candidato{apps.length === 1 ? '' : 's'}</span>
                  {top[0] && <span>melhor: <b className="text-zinc-800">{top[0].score}</b>/100</span>}
                  {top.length > 0 && <span>{top.filter((a) => (a.score ?? 0) >= 75).length} com alta aderência</span>}
                  <span className="ml-auto text-[10px] text-zinc-400">aberta em {fmtDate(`${j.opened_at}T12:00:00`)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
