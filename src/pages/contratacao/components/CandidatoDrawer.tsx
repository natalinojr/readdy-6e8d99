// Ficha do candidato: fase, estrelas, empresa, entrevistas, dados lidos do currículo e anotações.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Application, type Candidate, type Company, type Decision, type Interview, type Job, type Stage, BUCKET, DECISIONS, FIT, fitOf,
  type Distance, fmtKm, distCls, PRECISION_LABEL,
  fmtPhone, whatsLink, fmtMonths, fmtDateTime, interviewStatusInfo, avgScore, FORMATS, stageOf, decisionOf, withEmpresa, ageOf, companyName,
  type FichaCfg, fieldsOf, faltasFicha, onlyDigits,
  type JobScheduling, faltasAgendamento, stageByKind,
} from '../shared';
import { avisar } from '../dialog';

interface Props {
  c: Candidate;
  companies: Company[];
  stages: Stage[];
  ficha: FichaCfg;
  interviews: Interview[];
  jobs: Job[];
  applications: Application[];
  analyzing: Set<string>;
  onApply: (jobId: string) => void;
  onOpenJob: (jobId: string) => void;
  distances: Distance[];
  onCalcDistances: () => Promise<void>;
  onClose: () => void;
  onUpdate: (patch: Partial<Candidate>) => void;
  onDelete: () => void;
  onOrganizar: () => Promise<void>;
  onAgendar: () => void;
  onOpenInterview: (iv: Interview) => void;
}

export default function CandidatoDrawer({
  c, companies, stages, ficha, interviews, jobs, applications, analyzing, onApply, onOpenJob, distances, onCalcDistances,
  onClose, onUpdate, onDelete, onOrganizar, onAgendar, onOpenInterview,
}: Props) {
  // Distância só até a loja escolhida na ficha (regra do dono). Calcula sozinha ao abrir quando a
  // loja tem pin, o candidato tem endereço e ainda não há distância (uma tentativa por abertura/loja).
  const [distBusy, setDistBusy] = useState(false);
  const [distErro, setDistErro] = useState<string | null>(null);
  const tentouDist = useRef<string | null>(null);
  const loja = companies.find((x) => x.id === c.company_id) ?? null;
  const lojaTemPin = loja?.lat != null && loja?.lng != null;
  const dist = distances.find((d) => d.company_id === c.company_id) ?? null;
  const temEndereco = !!(c.address || c.neighborhood || c.city || c.lat != null);
  const calcular = async () => {
    setDistBusy(true); setDistErro(null);
    try { await onCalcDistances(); } catch (e) { setDistErro((e as Error).message); } finally { setDistBusy(false); }
  };
  useEffect(() => {
    const chave = `${c.id}:${c.company_id ?? ''}`;
    if (tentouDist.current === chave) return;
    tentouDist.current = chave;
    if (!lojaTemPin || !temEndereco || dist || c.geo_precision === 'nao_encontrado') return;
    calcular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, c.company_id]);
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
  const faltam = faltasFicha(c, ficha);
  const extras = (ficha.custom_fields ?? []).filter((f) => String(c.extra_fields?.[f.id] ?? '').trim());
  const [editando, setEditando] = useState(false);
  useEffect(() => { setEditando(false); }, [c.id]);

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
              className="w-full sm:w-auto sm:ml-auto sm:max-w-[190px] h-9 px-3 rounded-lg border border-zinc-200 text-sm cursor-pointer" title="Empresa da vaga">
              <option value="">Sem empresa</option>
              {companies.filter((x) => x.is_active || x.id === c.company_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>

          {/* Dados mínimos: aviso do que falta + edição */}
          {(faltam.length > 0 || editando) ? (
            <div className={`rounded-xl border p-3 ${faltam.length ? 'border-amber-200 bg-amber-50' : 'border-zinc-200 bg-zinc-50'}`}>
              {faltam.length > 0 ? (
                <p className="text-xs text-amber-900">
                  <b><i className="ri-error-warning-line" /> Ficha incompleta.</b> Faltam: {faltam.map((f) => f.label.toLowerCase()).join(', ')}.
                  {' '}Sem esses dados o candidato não sai de "{stages.find((s) => s.native_kind === 'novo')?.name ?? 'Novo'}".
                  {c.source?.startsWith('whatsapp_link') && ' O atendente do WhatsApp está perguntando ao candidato.'}
                </p>
              ) : <p className="text-xs font-bold text-zinc-600">Dados mínimos</p>}
              <DadosMinimosForm key={c.id} c={c} campos={editando ? fieldsOf(ficha).filter((f) => ficha.required_fields.includes(f.id)) : faltam}
                onSave={(patch) => { onUpdate(patch); setEditando(false); }} onCancel={editando ? () => setEditando(false) : undefined} />
            </div>
          ) : ficha.required_fields.length > 0 && (
            <button onClick={() => setEditando(true)} className="text-xs font-semibold text-emerald-700 cursor-pointer">
              <i className="ri-checkbox-circle-line" /> Dados mínimos completos · editar
            </button>
          )}

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

          {/* Agendamento pela IA (só com vaga que tem o agendamento ligado e completo) */}
          <AgendamentoIA c={c} stages={stages} applications={applications} jobs={jobs}
            onSend={(stageId) => onUpdate({ stage_id: stageId })} />

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

          <Section title={loja ? `Distância até ${loja.name}` : 'Distância até a loja'}>
            {!loja ? (
              <p className="text-xs text-zinc-400">Escolha a loja da ficha (no topo) para calcular a distância.</p>
            ) : !lojaTemPin ? (
              <p className="text-xs text-zinc-400">Marque a localização de {loja.name} em Configurações › Empresas (ícone de mapa) para calcular.</p>
            ) : !temEndereco ? (
              <p className="text-xs text-zinc-400">O currículo não tem endereço, bairro nem cidade.</p>
            ) : (
              <>
                {c.geo_precision === 'nao_encontrado' && !dist && (
                  <p className="text-xs text-orange-700 mb-1.5">Não achei o endereço deste currículo no mapa.</p>
                )}
                {dist && (
                  <div className="flex items-center gap-2 mb-1">
                    <i className="ri-car-line text-zinc-400" />
                    <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full border ${distCls(dist.km)}`}>{fmtKm(dist.km)}</span>
                    {dist.minutes != null && <span className="text-sm text-zinc-600">~{dist.minutes} min de carro</span>}
                  </div>
                )}
                {dist?.precision && (
                  <p className="text-[11px] text-zinc-400">
                    {dist.method === 'rota' ? 'Pela rota' : 'Estimativa em linha reta'} · endereço {PRECISION_LABEL[dist.precision]}
                    {c.geo_label ? ` (${c.geo_label})` : ''}
                  </p>
                )}
                <button onClick={calcular} disabled={distBusy} className="mt-1 text-xs font-semibold text-sky-700 disabled:opacity-50 cursor-pointer">
                  {distBusy ? 'Calculando…' : dist ? 'Recalcular' : 'Calcular distância'}
                </button>
                {distErro && <p className="text-xs text-red-600 mt-1">{distErro}</p>}
              </>
            )}
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

          {(c.availability || c.salary_expectation || c.driver_license || extras.length > 0) && (
            <Section title="Outras informações">
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                {c.availability && <><dt className="text-zinc-400">Disponibilidade</dt><dd>{c.availability}</dd></>}
                {c.salary_expectation && <><dt className="text-zinc-400">Pretensão</dt><dd>{c.salary_expectation}</dd></>}
                {c.driver_license && <><dt className="text-zinc-400">CNH</dt><dd>{c.driver_license}</dd></>}
                {extras.flatMap((f) => [
                  <dt key={`${f.id}-t`} className="text-zinc-400">{f.label}</dt>,
                  <dd key={`${f.id}-v`}>{c.extra_fields?.[f.id]}</dd>,
                ])}
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

// Atalho para o agendamento pela IA: move o candidato para a fase "Chamar p/ entrevista" (native_kind
// 'agendar'); o hiring-scheduler convida no próximo ciclo (8h–20h, até 4 por hora). Com convite já
// enviado, mostra em que pé está a conversa.
const SESS_LABEL: Record<string, string> = {
  convidado: 'Convite enviado — aguardando resposta',
  negociando: 'Conversando sobre o horário',
  aguardando_gestor: 'Esperando o entrevistador aceitar um horário pedido',
  agendado: 'Entrevista marcada pela IA',
};
function AgendamentoIA({ c, stages, applications, jobs, onSend }: {
  c: Candidate; stages: Stage[]; applications: Application[]; jobs: Job[]; onSend: (stageId: string) => void;
}) {
  const [cfgs, setCfgs] = useState<JobScheduling[] | null>(null);
  const [sess, setSess] = useState<{ status: string; job_id: string }[]>([]);
  const jobIds = applications.map((a) => a.job_id);
  const chave = jobIds.join(',');
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!jobIds.length) { if (vivo) setCfgs([]); return; }
      const [{ data: s }, { data: ss }] = await Promise.all([
        supabase.from('hiring_job_scheduling').select('*').in('job_id', jobIds),
        supabase.from('hiring_scheduling_sessions').select('status, job_id').eq('candidate_id', c.id).order('updated_at', { ascending: false }),
      ]);
      if (!vivo) return;
      setCfgs((s ?? []) as JobScheduling[]);
      setSess((ss ?? []) as { status: string; job_id: string }[]);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, c.stage_id, chave]);

  const prontas = (cfgs ?? []).filter((x) => x.enabled && faltasAgendamento(x).length === 0);
  const agendar = stageByKind(stages, 'agendar');
  if (!cfgs || !prontas.length || !agendar) return null;
  const ativa = sess.find((s) => SESS_LABEL[s.status]);
  const naFila = !ativa && c.stage_id === agendar.id;
  const vagas = prontas.map((p) => jobs.find((j) => j.id === p.job_id)?.title).filter(Boolean).join(', ');

  return (
    <Section title="Agendamento pela IA">
      {ativa ? (
        <p className="flex items-center gap-2 text-sm text-violet-800"><i className="ri-robot-2-line" /> {SESS_LABEL[ativa.status]}</p>
      ) : naFila ? (
        <p className="text-xs text-zinc-500"><i className="ri-time-line" /> Na fila: o convite sai no próximo ciclo do assistente (das 8h às 20h, até 4 por hora).</p>
      ) : (
        <>
          <button onClick={() => onSend(agendar.id)}
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg border border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-800 text-xs font-bold cursor-pointer">
            <i className="ri-robot-2-line" /> Enviar para o agendamento da IA
          </button>
          <p className="text-[11px] text-zinc-400 mt-1">O assistente chama {firstNameOf(c.full_name)} no WhatsApp com os horários livres{vagas ? ` da vaga ${vagas}` : ''} e marca a entrevista sozinho.</p>
        </>
      )}
    </Section>
  );
}
const firstNameOf = (s: string) => s.trim().split(/\s+/)[0] ?? s;

// Campos dos dados mínimos. Escolaridade e experiências viram um item de texto livre (não apaga
// os itens lidos do currículo: quando já existem, só mostra quantos são).
function DadosMinimosForm({ c, campos, onSave, onCancel }: {
  c: Candidate; campos: { id: string; label: string; custom?: boolean }[];
  onSave: (patch: Partial<Candidate>) => void; onCancel?: () => void;
}) {
  const atual = (f: { id: string; custom?: boolean }): unknown =>
    (f.custom ? c.extra_fields?.[f.id] : (c as unknown as Record<string, unknown>)[f.id]) ?? null;
  const inicial = (f: { id: string; custom?: boolean }) => (f.id === 'education' || f.id === 'experiences' ? '' : String(atual(f) ?? ''));
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((f) => [f.id, inicial(f)])));
  if (!campos.length) return null;
  const set = (k: string, x: string) => setV((o) => ({ ...o, [k]: x }));
  const salvar = () => {
    const patch: Record<string, unknown> = {};
    const extra: Record<string, string> = { ...(c.extra_fields ?? {}) };
    let extraMudou = false;
    for (const f of campos) {
      const x = (v[f.id] ?? '').trim();
      if (f.custom) { if (x !== (extra[f.id] ?? '')) { if (x) extra[f.id] = x; else delete extra[f.id]; extraMudou = true; } continue; }
      if (f.id === 'education') { if (x) patch.education = [...(c.education ?? []), { instituicao: null, curso: null, nivel: x, situacao: null }]; continue; }
      if (f.id === 'experiences') { if (x) patch.experiences = [...(c.experiences ?? []), { empresa: null, cargo: null, inicio: null, fim: null, atual: false, descricao: x }]; continue; }
      const val = f.id === 'phone' ? onlyDigits(x) || null : x || null;
      if (val !== atual(f)) patch[f.id] = f.id === 'full_name' ? (val ?? c.full_name) : val;
    }
    if (extraMudou) patch.extra_fields = extra;
    // Endereço mudou: a localização antiga deixa de valer (o "Recalcular" refaz).
    if (['address', 'neighborhood', 'city'].some((k) => k in patch)) Object.assign(patch, { lat: null, lng: null, geo_label: null, geo_precision: null });
    onSave(patch as Partial<Candidate>);
  };
  const inputCls = 'w-full h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm mt-0.5';
  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {campos.map((f) => {
          const lista = f.id === 'education' ? c.education : f.id === 'experiences' ? c.experiences : null;
          const longo = lista != null;
          return (
            <label key={f.id} className={`block ${longo ? 'sm:col-span-2' : ''}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{f.label}</span>
              {longo ? (
                <>
                  {lista!.length > 0 && <span className="block text-[10px] text-zinc-400">{lista!.length} já na ficha — escreva só para acrescentar</span>}
                  <textarea value={v[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} rows={2}
                    placeholder={f.id === 'education' ? 'Ex.: Ensino médio completo' : 'Ex.: Atendente no Burger X, 1 ano (ou "sem experiência anterior")'}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm mt-0.5" />
                </>
              ) : (
                <input type={f.id === 'birth_date' ? 'date' : f.id === 'email' ? 'email' : 'text'} value={v[f.id] ?? ''}
                  onChange={(e) => set(f.id, e.target.value)} className={inputCls} />
              )}
            </label>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <button onClick={onCancel} className="px-3 h-8 rounded-lg text-xs font-semibold text-zinc-500 hover:bg-zinc-100 cursor-pointer">Cancelar</button>}
        <button onClick={salvar} className="px-4 h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold cursor-pointer">Salvar dados</button>
      </div>
    </div>
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
