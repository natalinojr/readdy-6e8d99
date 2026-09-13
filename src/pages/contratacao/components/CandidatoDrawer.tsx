// Ficha do candidato: fase, estrelas, empresa, entrevistas, dados lidos do currículo e anotações.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Application, type Candidate, type Company, type Decision, type Interview, type Job, type Stage, BUCKET, DECISIONS, FIT, fitOf,
  fmtPhone, whatsLink, fmtMonths, fmtDateTime, interviewStatusInfo, avgScore, FORMATS, stageOf, decisionOf, withEmpresa, ageOf, companyName,
} from '../shared';
import { avisar } from '../dialog';

interface Props {
  c: Candidate;
  companies: Company[];
  stages: Stage[];
  interviews: Interview[];
  jobs: Job[];
  applications: Application[];
  analyzing: Set<string>;
  onApply: (jobId: string) => void;
  onOpenJob: (jobId: string) => void;
  onClose: () => void;
  onUpdate: (patch: Partial<Candidate>) => void;
  onDelete: () => void;
  onOrganizar: () => Promise<void>;
  onAgendar: () => void;
  onOpenInterview: (iv: Interview) => void;
}

export default function CandidatoDrawer({
  c, companies, stages, interviews, jobs, applications, analyzing, onApply, onOpenJob,
  onClose, onUpdate, onDelete, onOrganizar, onAgendar, onOpenInterview,
}: Props) {
  const vagasAbertas = jobs.filter((j) => j.status !== 'fechada' && !applications.some((a) => a.job_id === j.id));
  const [notes, setNotes] = useState(c.notes ?? '');
  const [iaBusy, setIaBusy] = useState(false);
  const [iaErro, setIaErro] = useState<string | null>(null);
  const [verTexto, setVerTexto] = useState(false);
  useEffect(() => { setNotes(c.notes ?? ''); }, [c.id, c.notes]);
  useEffect(() => { setIaErro(null); setVerTexto(false); }, [c.id]);
  const wa = whatsLink(c.phone);

  const organizar = async () => {
    setIaBusy(true); setIaErro(null);
    try { await onOrganizar(); } catch (e) { setIaErro((e as Error).message); } finally { setIaBusy(false); }
  };

  const abrirArquivo = async () => {
    if (!c.file_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(c.file_path, 300);
    if (error || !data?.signedUrl) { avisar('Não foi possível abrir o arquivo do currículo.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const minhas = [...interviews].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
  const empresa = c.company_id ? companyName(companies, c.company_id) : '';
  const idade = ageOf(c);
  const dec = decisionOf(c.decision);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black text-zinc-900">{c.full_name}</h2>
            <p className="text-xs text-zinc-500">{[c.desired_role, idade != null ? `${idade} anos` : null, c.marital_status].filter(Boolean).join(' · ')}</p>
          </div>
          {dec && <span className={`text-xs font-black px-2.5 py-1 rounded-lg border ${dec.cls}`} title={withEmpresa(dec.label, empresa)}>{dec.sigla}</span>}
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Fase, nota e empresa */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={stageOf(stages, c.stage_id)?.id ?? ''} onChange={(e) => onUpdate({ stage_id: e.target.value })}
              className="h-9 px-3 rounded-lg border border-zinc-200 text-sm font-semibold cursor-pointer">
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex items-center">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => onUpdate({ rating: c.rating === n ? null : n })}
                  className={`text-xl px-0.5 cursor-pointer ${c.rating && n <= c.rating ? 'text-amber-500' : 'text-zinc-300 hover:text-amber-300'}`}
                  title={`${n} estrela${n > 1 ? 's' : ''}`}>★</button>
              ))}
            </div>
            <select value={c.company_id ?? ''} onChange={(e) => onUpdate({ company_id: e.target.value || null })}
              className="ml-auto h-9 px-3 rounded-lg border border-zinc-200 text-sm cursor-pointer max-w-[190px]" title="Empresa da vaga">
              <option value="">Sem empresa</option>
              {companies.filter((x) => x.is_active || x.id === c.company_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>

          {/* Tomada de decisão */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1.5">Tomada de decisão</p>
            <div className="grid grid-cols-4 gap-1.5">
              {DECISIONS.map((d) => (
                <button key={d.id} title={withEmpresa(d.label, empresa)}
                  onClick={() => onUpdate({ decision: c.decision === d.id ? null : (d.id as Decision) })}
                  className={`h-9 rounded-lg border text-xs font-black cursor-pointer ${c.decision === d.id ? d.cls : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300'}`}>
                  {d.sigla}
                </button>
              ))}
            </div>
            {dec && <p className="text-[11px] text-zinc-500 mt-1">{withEmpresa(dec.label, empresa)}</p>}
          </div>

          {!c.ai_processed && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
              <p className="text-xs text-sky-900">
                <b>Leitura simples (grátis):</b> só contato, cidade e o texto completo, com os campos adivinhados por regra.
                Para ver experiências, resumo e pontos fortes e de atenção, organize com IA (alguns centavos).
              </p>
              <button onClick={organizar} disabled={iaBusy}
                className="mt-2 flex items-center gap-1.5 px-3 h-8 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-bold cursor-pointer">
                {iaBusy ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-sparkling-line" />}
                {iaBusy ? 'Organizando…' : 'Organizar com IA'}
              </button>
              {iaErro && <p className="text-xs text-red-600 mt-1.5">{iaErro}</p>}
            </div>
          )}

          {/* Vagas em que está inscrito (com a aderência calculada pela IA) */}
          <Section title="Vagas">
            {applications.length > 0 && (
              <ul className="space-y-1.5 mb-2">
                {applications.map((a) => {
                  const job = jobs.find((j) => j.id === a.job_id);
                  const fit = a.fit ?? fitOf(a.score);
                  const loading = analyzing.has(`${a.job_id}:${a.candidate_id}`);
                  return (
                    <li key={a.id}>
                      <button onClick={() => onOpenJob(a.job_id)} className="w-full text-left rounded-xl border border-zinc-200 hover:border-rose-300 p-2.5 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <i className="ri-briefcase-4-line text-zinc-400" />
                          <span className="flex-1 text-sm font-semibold text-zinc-800 truncate">{job?.title ?? 'Vaga removida'}</span>
                          {loading ? <span className="text-[10px] text-zinc-400">analisando…</span>
                            : a.score != null ? <b className="text-sm text-zinc-900">{a.score}<span className="text-[10px] text-zinc-400">/100</span></b> : null}
                          {fit && !loading && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${FIT[fit].cls}`}>{FIT[fit].label}</span>}
                        </div>
                        {a.analysis?.resumo && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{a.analysis.resumo}</p>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {vagasAbertas.length > 0 ? (
              <select value="" onChange={(e) => { if (e.target.value) onApply(e.target.value); }}
                className="h-8 px-2 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-700 cursor-pointer">
                <option value="">+ Inscrever em uma vaga…</option>
                {vagasAbertas.map((j) => <option key={j.id} value={j.id}>{j.title}{j.company_id ? ` — ${companyName(companies, j.company_id)}` : ''}</option>)}
              </select>
            ) : applications.length === 0 && <p className="text-xs text-zinc-400">Nenhuma vaga aberta. Abra na aba Vagas.</p>}
          </Section>

          {/* Entrevistas */}
          <Section title="Entrevistas">
            {minhas.length > 0 && (
              <ul className="space-y-1.5 mb-2">
                {minhas.map((iv) => {
                  const st = interviewStatusInfo(iv.status);
                  const media = avgScore(iv.scores);
                  const rec = decisionOf(iv.recommendation);
                  return (
                    <li key={iv.id}>
                      <button onClick={() => onOpenInterview(iv)} className="w-full text-left rounded-xl border border-zinc-200 hover:border-violet-300 p-2.5 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <i className={`${FORMATS.find((f) => f.id === iv.format)?.icon} text-zinc-400`} />
                          <span className="text-sm font-semibold text-zinc-800">{fmtDateTime(iv.scheduled_at)}</span>
                          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                        </div>
                        {(media != null || rec || iv.notes) && (
                          <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                            {media != null && <b className="text-zinc-700">Nota {media.toFixed(1)} · </b>}
                            {rec && <b className="text-zinc-700">{rec.sigla} · </b>}
                            {iv.notes}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button onClick={onAgendar} className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer">
              <i className="ri-calendar-event-line" /> Agendar entrevista
            </button>
          </Section>

          {/* Contato */}
          <Section title="Contato">
            <div className="space-y-1.5 text-sm">
              {c.phone && (
                <p className="flex items-center gap-2">
                  <i className="ri-phone-line text-zinc-400" /> {fmtPhone(c.phone)}
                  {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-semibold text-xs ml-1"><i className="ri-whatsapp-line" /> WhatsApp</a>}
                </p>
              )}
              {c.email && <p className="flex items-center gap-2"><i className="ri-mail-line text-zinc-400" /> <a href={`mailto:${c.email}`} className="text-sky-700">{c.email}</a></p>}
              {(c.address || c.city || c.neighborhood) && (
                <p className="flex items-start gap-2"><i className="ri-map-pin-line text-zinc-400 mt-0.5" /> {[c.address, c.neighborhood, c.city].filter(Boolean).join(', ')}</p>
              )}
              {c.birth_date && (
                <p className="flex items-center gap-2"><i className="ri-cake-2-line text-zinc-400" /> {c.birth_date.split('-').reverse().join('/')}
                  {idade != null && <span className="text-zinc-500">({idade} anos)</span>}</p>
              )}
              {c.marital_status && <p className="flex items-center gap-2"><i className="ri-user-heart-line text-zinc-400" /> {c.marital_status}</p>}
              {!c.phone && !c.email && !c.city && <p className="text-zinc-400 text-xs">Sem dados de contato no currículo.</p>}
            </div>
          </Section>

          {c.summary && <Section title="Resumo"><p className="text-sm text-zinc-700 leading-relaxed">{c.summary}</p></Section>}

          {(c.strengths.length > 0 || c.concerns.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {c.strengths.length > 0 && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1.5">Pontos fortes</p>
                  <ul className="space-y-1 text-xs text-emerald-900">{c.strengths.map((s, i) => <li key={i}>• {s}</li>)}</ul>
                </div>
              )}
              {c.concerns.length > 0 && (
                <div className="rounded-xl bg-orange-50 border border-orange-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-orange-700 mb-1.5">Pontos de atenção</p>
                  <ul className="space-y-1 text-xs text-orange-900">{c.concerns.map((s, i) => <li key={i}>• {s}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {c.ai_processed && (
            <Section title={`Experiência${c.total_experience_months != null ? ` · ${fmtMonths(c.total_experience_months)}` : ''}`}>
              {c.experiences.length === 0 ? <p className="text-xs text-zinc-400">Nenhuma experiência informada.</p> : (
                <ol className="space-y-3 border-l-2 border-zinc-100 pl-4">
                  {c.experiences.map((e, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-rose-400" />
                      <p className="text-sm font-bold text-zinc-800">{e.cargo || 'Cargo não informado'}</p>
                      <p className="text-xs text-zinc-500">
                        {[e.empresa, [e.inicio, e.atual ? 'atual' : e.fim].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
                      </p>
                      {e.descricao && <p className="text-xs text-zinc-600 mt-1 leading-relaxed">{e.descricao}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          )}

          {c.education.length > 0 && (
            <Section title="Formação">
              <ul className="space-y-1.5 text-sm">
                {c.education.map((e, i) => (
                  <li key={i}>
                    <span className="font-semibold text-zinc-800">{[e.nivel, e.curso].filter(Boolean).join(' — ') || 'Formação'}</span>
                    <span className="text-xs text-zinc-500"> {[e.instituicao, e.situacao].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {c.courses.length > 0 && (
            <Section title="Outros cursos">
              <ul className="space-y-1 text-sm text-zinc-700">{c.courses.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </Section>
          )}

          {(c.skills.length > 0 || c.languages.length > 0) && (
            <Section title="Habilidades e idiomas">
              <div className="flex flex-wrap gap-1.5">
                {[...c.skills, ...c.languages].map((s, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700">{s}</span>
                ))}
              </div>
            </Section>
          )}

          {(c.availability || c.salary_expectation || c.driver_license) && (
            <Section title="Outras informações">
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                {c.availability && <><dt className="text-zinc-400">Disponibilidade</dt><dd>{c.availability}</dd></>}
                {c.salary_expectation && <><dt className="text-zinc-400">Pretensão</dt><dd>{c.salary_expectation}</dd></>}
                {c.driver_license && <><dt className="text-zinc-400">CNH</dt><dd>{c.driver_license}</dd></>}
              </dl>
            </Section>
          )}

          {c.raw_text && (
            <Section title="Texto do currículo">
              <button onClick={() => setVerTexto((v) => !v)} className="text-xs font-semibold text-sky-700 cursor-pointer">
                {verTexto ? 'Esconder texto' : 'Mostrar texto completo'}
              </button>
              {verTexto && (
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-50 border border-zinc-100 p-3 text-xs text-zinc-700 font-sans">{c.raw_text}</pre>
              )}
            </Section>
          )}

          <Section title="Minhas anotações">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (c.notes ?? '')) onUpdate({ notes: notes || null }); }}
              rows={4} placeholder="Referências, observações gerais, próximo passo…"
              className="w-full rounded-xl border border-zinc-200 p-3 text-sm focus:outline-none focus:border-rose-300" />
          </Section>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-100">
          {c.file_path && (
            <button onClick={abrirArquivo} className="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-sm font-semibold text-zinc-700 cursor-pointer">
              <i className="ri-file-text-line" /> Ver currículo original
            </button>
          )}
          <button onClick={onDelete} className="ml-auto flex items-center gap-1.5 px-3 h-9 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 cursor-pointer">
            <i className="ri-delete-bin-line" /> Excluir
          </button>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">{title}</p>
      {children}
    </section>
  );
}
