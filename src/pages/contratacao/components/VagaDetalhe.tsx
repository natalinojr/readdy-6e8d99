// Vaga por dentro: sub-abas Candidatos (ranking, movido verbatim de Vagas.tsx pré-Fase-4) ·
// Divulgação (VagaDivulgacao) · Agendamento pela IA (AgendamentoVaga, como já era usado dentro do
// VagaModal) · Dados da vaga (VagaFormulario, sem invólucro de modal — substitui o toggle "Ver
// dados da vaga" de hoje por uma versão editável).
import { useMemo, useState } from 'react';
import {
  type Application, type Candidate, type Company, type Distance, type Job, type Stage,
  FIT, JOB_STATUS, jobStatusInfo, companyName, fmtDateTime, ageOf, colorOf, stageOf, decisionOf, fitOf, fmtKm, distCls,
} from '../shared';
import { VagaFormulario, type JobDraft } from './VagaModal';
import AgendamentoVaga from './AgendamentoVaga';
import VagaDivulgacao from './VagaDivulgacao';

interface Props {
  job: Job; companies: Company[]; candidates: Candidate[]; applications: Application[]; stages: Stage[]; jobs: Job[];
  analyzing: Set<string>; distancia: (candidateId: string, companyId: string | null) => Distance | null;
  onSelectJob: (id: string | null) => void; onDeleteJob: (job: Job) => void; onAddFromBank: (job: Job) => void;
  onUploadToJob: (job: Job) => void; onReanalyze: (app: Application) => void; onRemoveApplication: (app: Application) => void;
  onOpenCandidate: (id: string) => void; onSaveJob: (draft: JobDraft) => Promise<boolean>;
}

type SubAbaVaga = 'candidatos' | 'divulgacao' | 'agendamento' | 'dados';
// Ícones já usados no módulo: ri-user-search-line (LinksWhatsApp.tsx:482, "Abrir candidato"),
// ri-whatsapp-line (LinksWhatsApp.tsx, várias), ri-robot-2-line (AgendamentoVaga.tsx:90), ri-file-list-3-line
// (ConfiguracoesContratacao.tsx, item "Dados mínimos" do menu de T10) — nenhum ícone novo.
const SUBABAS_VAGA: { id: SubAbaVaga; label: string; icon: string }[] = [
  { id: 'candidatos', label: 'Candidatos', icon: 'ri-user-search-line' },
  { id: 'divulgacao', label: 'Divulgação', icon: 'ri-whatsapp-line' },
  { id: 'agendamento', label: 'Agendamento pela IA', icon: 'ri-robot-2-line' },
  { id: 'dados', label: 'Dados da vaga', icon: 'ri-file-list-3-line' },
];

export default function VagaDetalhe({
  job, companies, candidates, applications, stages, jobs, analyzing, distancia, onSelectJob, onDeleteJob,
  onAddFromBank, onUploadToJob, onReanalyze, onRemoveApplication, onOpenCandidate, onSaveJob,
}: Props) {
  const [subaba, setSubaba] = useState<SubAbaVaga>('candidatos'); // Decisão 8: default = ranking, sem persistir
  const [aberto, setAberto] = useState<string | null>(null);
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
          {/* Editar vaga (lápis) saiu daqui — a aba "Dados da vaga" abaixo é o único caminho agora (Decisão 10). */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onUploadToJob(job)} className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer">
              <i className="ri-upload-2-line" /> Enviar currículos
            </button>
            <button onClick={() => onAddFromBank(job)} className="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-bold text-zinc-700 cursor-pointer">
              <i className="ri-database-2-line" /> Do banco de currículos
            </button>
            <button onClick={() => onDeleteJob(job)} title="Excluir vaga" className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
          </div>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-zinc-200 overflow-x-auto">
        {SUBABAS_VAGA.map((t) => (
          <button key={t.id} onClick={() => setSubaba(t.id)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
              subaba === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
            <i className={t.icon} /> {t.label}
          </button>
        ))}
      </div>

      {subaba === 'candidatos' ? (
        apps.length === 0 ? (
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
              const dist = distancia(c.id, job.company_id);
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
                      <div className="sm:hidden flex flex-wrap gap-1 mt-1">
                        {dist && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${distCls(dist.km)}`}><i className="ri-car-line" /> {fmtKm(dist.km)}</span>}
                        {stg && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${colorOf(stg.color).cls}`}>{stg.name}</span>}
                        {dec && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${dec.cls}`}>{dec.sigla}</span>}
                      </div>
                    </button>
                    <div className="hidden sm:flex items-center gap-1.5">
                      {dist && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${distCls(dist.km)}`}
                          title={dist.precision === 'bairro' || dist.precision === 'cidade' ? 'Endereço aproximado' : 'Rota de carro até a loja'}>
                          <i className="ri-car-line" /> {fmtKm(dist.km)}{dist.minutes != null ? ` · ${dist.minutes} min` : ''}
                        </span>
                      )}
                      {fit &&<span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${FIT[fit].cls}`}>{FIT[fit].label}</span>}
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
        )
      ) : subaba === 'divulgacao' ? (
        <VagaDivulgacao job={job} companies={companies} jobs={jobs} onOpenCandidate={onOpenCandidate} />
      ) : subaba === 'agendamento' ? (
        <AgendamentoVaga jobId={job.id} defaultLocation={comp?.address ?? null} />
      ) : (
        <div className="max-w-2xl">
          <AbaDadosVaga job={job} companies={companies} onSave={onSaveJob} />
        </div>
      )}

      <p className="text-[11px] text-zinc-400 mt-3">
        A nota é uma ajuda para a triagem, calculada só com critérios profissionais (experiência, requisitos, horário, salário, deslocamento).
        Cada análise custa uns centavos. <span className="whitespace-nowrap">Situações: {JOB_STATUS.map((s) => s.label).join(', ')}.</span>
      </p>
    </div>
  );
}

// "Dados da vaga": VagaFormulario sem invólucro de modal + botão Salvar próprio. Substitui o
// toggle "Ver/Esconder dados da vaga" de hoje — agora edita em vez de só mostrar (Decisão 2/9 de T11).
// Correção do orquestrador (2026-09-20), Constraint 11: das 6 linhas do <dl> antigo (Vagas.tsx:143-152),
// 5 (description/requirements/desirable/benefits/notes) viraram campos do VagaFormulario; a 6ª
// (<Dado t="Loja" .../>, Vagas.tsx:149) mostra o endereço/cidade da empresa — não é campo da vaga, então
// é renderizada aqui, abaixo do <select> de empresa do formulário, reagindo à empresa escolhida (não à
// do job, para acompanhar a troca antes de salvar), com as mesmas classes do Dado de origem.
function AbaDadosVaga({ job, companies, onSave }: { job: Job; companies: Company[]; onSave: (draft: JobDraft) => Promise<boolean> }) {
  const [d, setD] = useState<JobDraft>(() => ({ ...job }));
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof JobDraft>(k: K, v: JobDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const comp = companies.find((c) => c.id === d.company_id) ?? null;
  const loja = comp ? [comp.address, comp.city].filter(Boolean).join(', ') || 'Endereço não cadastrado (Configurações › Empresas)' : null;
  const salvar = async () => {
    if (!d.title.trim()) { setErro('Informe o cargo da vaga.'); return; }
    setSaving(true); setErro(null);
    const ok = await onSave({ ...d, title: d.title.trim() });
    setSaving(false);
    if (ok) setErro(null);
  };
  return (
    <>
      <VagaFormulario d={d} set={set} companies={companies} job={job} />
      {loja && (
        <dl className="mt-3">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Loja</dt>
          <dd className="text-zinc-700 whitespace-pre-line">{loja}</dd>
        </dl>
      )}
      {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
      <div className="flex justify-end pt-3">
        <button onClick={salvar} disabled={saving} className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-bold cursor-pointer">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </>
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
