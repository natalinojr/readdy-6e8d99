// Aba Vagas: lista de vagas por empresa e, dentro de cada vaga, o ranking dos candidatos
// inscritos pela aderência calculada pela IA (currículo × vaga × loja).
import { useMemo, useState } from 'react';
import {
  type Application, type Candidate, type Company, type Job, type Stage, FIT, JOB_STATUS, jobStatusInfo, companyName,
  fmtDate, fmtDateTime, ageOf, colorOf, stageOf, decisionOf, fitOf,
} from '../shared';

interface Props {
  jobs: Job[];
  companies: Company[];
  candidates: Candidate[];
  applications: Application[];
  stages: Stage[];
  mostrarEmpresa: boolean;
  analyzing: Set<string>;
  selectedJobId: string | null;
  onSelectJob: (id: string | null) => void;
  onNewJob: () => void;
  onEditJob: (job: Job) => void;
  onDeleteJob: (job: Job) => void;
  onAddFromBank: (job: Job) => void;
  onUploadToJob: (job: Job) => void;
  onReanalyze: (app: Application) => void;
  onRemoveApplication: (app: Application) => void;
  onOpenCandidate: (id: string) => void;
}

export const appKey = (jobId: string, candId: string) => `${jobId}:${candId}`;

export default function Vagas(props: Props) {
  const { jobs, selectedJobId } = props;
  const job = jobs.find((j) => j.id === selectedJobId) ?? null;
  return job ? <DetalheVaga {...props} job={job} /> : <ListaVagas {...props} />;
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

function DetalheVaga({
  job, companies, candidates, applications, stages, analyzing, onSelectJob, onEditJob, onDeleteJob,
  onAddFromBank, onUploadToJob, onReanalyze, onRemoveApplication, onOpenCandidate,
}: Props & { job: Job }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [verDados, setVerDados] = useState(false);
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const apps = applications
    .filter((a) => a.job_id === job.id && byId.has(a.candidate_id))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const st = jobStatusInfo(job.status);
  const comp = companies.find((c) => c.id === job.company_id) ?? null;

  return (
    <div>
      <button onClick={() => onSelectJob(null)} className="flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-800 mb-3 cursor-pointer">
        <i className="ri-arrow-left-line" /> Todas as vagas
      </button>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 mb-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-zinc-900">{job.title}</h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
            </div>
            <p className="text-xs text-zinc-500">
              {[companyName(companies, job.company_id), job.contract_type, job.openings > 1 ? `${job.openings} vagas` : null, job.salary].filter(Boolean).join(' · ')}
            </p>
            {job.schedule && <p className="text-xs text-zinc-500"><i className="ri-time-line" /> {job.schedule}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onUploadToJob(job)} className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer">
              <i className="ri-upload-2-line" /> Enviar currículos
            </button>
            <button onClick={() => onAddFromBank(job)} className="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-bold text-zinc-700 cursor-pointer">
              <i className="ri-database-2-line" /> Do banco de currículos
            </button>
            <button onClick={() => onEditJob(job)} title="Editar vaga" className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-600 cursor-pointer"><i className="ri-pencil-line" /></button>
            <button onClick={() => onDeleteJob(job)} title="Excluir vaga" className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
          </div>
        </div>
        <button onClick={() => setVerDados((v) => !v)} className="text-xs font-semibold text-sky-700 mt-2 cursor-pointer">
          {verDados ? 'Esconder dados da vaga' : 'Ver dados da vaga'}
        </button>
        {verDados && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-sm">
            <Dado t="Atividades" v={job.description} />
            <Dado t="Requisitos obrigatórios" v={job.requirements} />
            <Dado t="Desejável" v={job.desirable} />
            <Dado t="Benefícios" v={job.benefits} />
            <Dado t="Loja" v={comp ? [comp.address, comp.city].filter(Boolean).join(', ') || 'Endereço não cadastrado (Configurações › Empresas)' : null} />
            <Dado t="Observações internas" v={job.notes} />
          </dl>
        )}
      </div>

      {apps.length === 0 ? (
        <div className="py-14 text-center text-zinc-400 rounded-2xl border border-dashed border-zinc-200">
          <i className="ri-user-add-line text-4xl" />
          <p className="text-sm font-semibold mt-2">Nenhum candidato nesta vaga ainda</p>
          <p className="text-xs mt-1">Envie currículos novos ou escolha do banco; a IA compara cada um com a vaga.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Ranking por aderência · {apps.length} candidato{apps.length === 1 ? '' : 's'}</p>
          {apps.map((a, i) => {
            const c = byId.get(a.candidate_id)!;
            const loading = analyzing.has(`${a.job_id}:${a.candidate_id}`);
            const fit = a.fit ?? fitOf(a.score);
            const stg = stageOf(stages, c.stage_id);
            const dec = decisionOf(c.decision);
            const idade = ageOf(c);
            const open = aberto === a.id;
            return (
              <div key={a.id} className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                <div className="flex items-center gap-3 p-3">
                  <span className="w-6 text-center text-xs font-black text-zinc-400">{i + 1}</span>
                  <ScoreRing score={a.score} loading={loading} />
                  <button onClick={() => onOpenCandidate(c.id)} className="flex-1 min-w-0 text-left cursor-pointer">
                    <p className="font-bold text-zinc-900 truncate hover:text-rose-700">{c.full_name}</p>
                    <p className="text-xs text-zinc-500 truncate">
                      {[c.desired_role, idade != null ? `${idade} anos` : null, c.neighborhood || c.city].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </button>
                  <div className="hidden sm:flex items-center gap-1.5">
                    {fit && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${FIT[fit].cls}`}>{FIT[fit].label}</span>}
                    {stg && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${colorOf(stg.color).cls}`}>{stg.name}</span>}
                    {dec && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${dec.cls}`}>{dec.sigla}</span>}
                  </div>
                  <button onClick={() => setAberto(open ? null : a.id)} title="Ver análise"
                    className="w-8 h-8 rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer">
                    <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                  </button>
                </div>
                {a.error && !loading && (
                  <p className="px-4 pb-2 text-xs text-red-600">Análise falhou: {a.error} <button onClick={() => onReanalyze(a)} className="font-bold underline cursor-pointer">tentar de novo</button></p>
                )}
                {open && (
                  <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 space-y-3 text-sm">
                    {a.analysis ? (
                      <>
                        <p className="text-zinc-700">{a.analysis.resumo}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Lista titulo="Pontos a favor" itens={a.analysis.pontos_fortes} cls="text-emerald-800" />
                          <Lista titulo="Lacunas" itens={a.analysis.lacunas} cls="text-orange-800" />
                        </div>
                        {a.analysis.deslocamento && <p className="text-xs text-zinc-600"><i className="ri-map-pin-line" /> <b>Deslocamento:</b> {a.analysis.deslocamento}</p>}
                        <Lista titulo="Perguntas para a entrevista" itens={a.analysis.perguntas_entrevista} cls="text-zinc-700" />
                        {a.analysis.alertas.length > 0 && <Lista titulo="Alertas" itens={a.analysis.alertas} cls="text-red-700" />}
                      </>
                    ) : <p className="text-xs text-zinc-400">{loading ? 'Analisando…' : 'Ainda sem análise.'}</p>}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {a.analyzed_at && <span className="text-[10px] text-zinc-400">analisado em {fmtDateTime(a.analyzed_at)}</span>}
                      <button onClick={() => onReanalyze(a)} disabled={loading} className="ml-auto px-3 h-8 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 disabled:opacity-50 cursor-pointer">
                        <i className="ri-refresh-line" /> Reanalisar
                      </button>
                      <button onClick={() => onRemoveApplication(a)} className="px-3 h-8 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer">
                        Tirar da vaga
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-zinc-400 mt-3">
        A nota é uma ajuda para a triagem, calculada só com critérios profissionais (experiência, requisitos, horário, salário, deslocamento).
        Cada análise custa uns centavos. <span className="whitespace-nowrap">Situações: {JOB_STATUS.map((s) => s.label).join(', ')}.</span>
      </p>
    </div>
  );
}

function ScoreRing({ score, loading }: { score: number | null; loading: boolean }) {
  if (loading) return <div className="w-11 h-11 flex items-center justify-center"><div className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (score == null) return <div className="w-11 h-11 rounded-full border-2 border-dashed border-zinc-200 flex items-center justify-center text-[10px] text-zinc-400">—</div>;
  const fit = fitOf(score)!;
  const color = fit === 'alta' ? '#10b981' : fit === 'media' ? '#f59e0b' : '#a1a1aa';
  return (
    <div className="relative w-11 h-11 flex-shrink-0" title={`${score}/100`}>
      <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f4f4f5" strokeWidth="4" />
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 97.4} 97.4`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-black text-zinc-800">{score}</span>
    </div>
  );
}

function Lista({ titulo, itens, cls }: { titulo: string; itens: string[]; cls: string }) {
  if (!itens.length) return null;
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">{titulo}</p>
      <ul className={`space-y-0.5 text-xs ${cls}`}>{itens.map((t, i) => <li key={i}>• {t}</li>)}</ul>
    </div>
  );
}

function Dado({ t, v }: { t: string; v: string | null }) {
  if (!v) return null;
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{t}</dt>
      <dd className="text-zinc-700 whitespace-pre-line">{v}</dd>
    </div>
  );
}
