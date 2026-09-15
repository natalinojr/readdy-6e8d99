// Aba Entrevistas (a 1ª da Contratação): o entrevistador escolhe o dia, vê quem está agendado e, ao
// clicar numa pessoa, preenche o registro ali mesmo — questionário, notas por critério, considerações,
// tomada de decisão (vai também para o candidato) e a fase. Mesmas tabelas da ficha e da Agenda
// (hiring_interviews / hiring_candidates); o histórico do candidato é gravado pelos gatilhos do banco.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Application, type Candidate, type Company, type Decision, type Interview, type InterviewStatus, type Job, type Settings, type Stage,
  BUCKET, DECISIONS, FIT, FORMATS, INTERVIEW_STATUS, ageOf, companyName, dayKey, decisionOf, fitOf, fmtMonths, fmtPhone, fmtTime,
  interviewStatusInfo, stageOf, whatsLink, withEmpresa,
} from '../shared';
import type { CandidatePatch } from './EntrevistaModal';
import { avisar, confirmar } from '../dialog';

interface Props {
  interviews: Interview[];
  candidates: Candidate[];
  companies: Company[];
  stages: Stage[];
  settings: Settings;
  applications: Application[];
  jobs: Job[];
  onSaved: (iv: Interview, patch?: CandidatePatch) => void;
  onOpenCandidate: (candidateId: string) => void;
  onNewInterview: (date: string) => void;
}

const addDias = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
};
// Rascunho no aparelho: no celular o app recarrega ao voltar de outra janela e perdia o que foi digitado.
// Fica salvo por entrevista até "Salvar registro"; a aba também volta no mesmo dia e na mesma pessoa.
const LS_POS = 'contratacao_entrevistas_pos';
const lsDraftKey = (id: string) => `contratacao_rascunho_entrevista_${id}`;
const lsLer = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const lsGravar = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } };
const lsApagar = (k: string) => { try { localStorage.removeItem(k); } catch { /* sem storage */ } };

const rotuloDia = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
};

export default function EntrevistasDoDia({ interviews, candidates, companies, stages, settings, applications, jobs, onSaved, onOpenCandidate, onNewInterview }: Props) {
  const hoje = dayKey(new Date());
  // Volta onde estava (dia e pessoa) se saiu há menos de 12 h.
  const pos = lsLer<{ dia: string; sel: string | null; at: number }>(LS_POS);
  const posValida = pos && Date.now() - pos.at < 12 * 3600_000 ? pos : null;
  const [dia, setDia] = useState(posValida?.dia ?? hoje);
  const [selId, setSelId] = useState<string | null>(posValida?.sel ?? null);
  useEffect(() => { lsGravar(LS_POS, { dia, sel: selId, at: Date.now() }); }, [dia, selId]);

  const porDia = useMemo(() => {
    const m = new Map<string, Interview[]>();
    for (const iv of interviews) {
      const k = dayKey(new Date(iv.scheduled_at));
      m.set(k, [...(m.get(k) ?? []), iv]);
    }
    for (const l of m.values()) l.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    return m;
  }, [interviews]);
  const doDia = porDia.get(dia) ?? [];
  const candOf = (id: string) => candidates.find((c) => c.id === id) ?? null;
  const sel = doDia.find((iv) => iv.id === selId) ?? null;

  // Trocou o dia: abre a 1ª entrevista ainda não registrada (ou a 1ª do dia) — no computador.
  useEffect(() => {
    if (!doDia.length) return; // ainda carregando: não apaga a pessoa que estava aberta
    if (doDia.some((iv) => iv.id === selId)) return;
    const prox = doDia.find((iv) => iv.status === 'agendada') ?? doDia[0];
    setSelId(window.matchMedia('(min-width: 1024px)').matches ? prox?.id ?? null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, doDia.length]);

  const semana = Array.from({ length: 7 }, (_, i) => addDias(dia, i - 3));

  return (
    <div className="space-y-4">
      {/* Dia */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setDia(addDias(dia, -1))} className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 cursor-pointer" title="Dia anterior"><i className="ri-arrow-left-s-line" /></button>
          <input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} className="h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
          <button onClick={() => setDia(addDias(dia, 1))} className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 cursor-pointer" title="Próximo dia"><i className="ri-arrow-right-s-line" /></button>
          {dia !== hoje && <button onClick={() => setDia(hoje)} className="px-3 h-9 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer">Hoje</button>}
          <p className="text-sm font-bold text-zinc-800 capitalize">{rotuloDia(dia)}</p>
          <button onClick={() => onNewInterview(dia)} className="ml-auto flex items-center gap-1.5 px-3 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer">
            <i className="ri-add-line" /> Agendar neste dia
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 mt-3">
          {semana.map((k) => {
            const n = (porDia.get(k) ?? []).filter((iv) => iv.status !== 'cancelada').length;
            const [, , d] = k.split('-');
            const wd = new Date(`${k}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
            return (
              <button key={k} onClick={() => setDia(k)}
                className={`rounded-xl py-1.5 text-center cursor-pointer border ${k === dia ? 'bg-zinc-900 border-zinc-900 text-white' : k === hoje ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-zinc-100 hover:bg-zinc-50 text-zinc-600'}`}>
                <p className="text-[10px] uppercase">{wd}</p>
                <p className="text-sm font-black">{d}</p>
                <p className={`text-[10px] ${n ? 'font-bold' : 'opacity-50'}`}>{n ? `${n} entrev.` : '—'}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-4 items-start">
        {/* Lista do dia */}
        <div className={`rounded-2xl border border-zinc-200 bg-white overflow-hidden ${sel ? 'hidden lg:block' : ''}`}>
          {doDia.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-400">Ninguém agendado neste dia.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {doDia.map((iv) => {
                const c = candOf(iv.candidate_id);
                const st = interviewStatusInfo(iv.status);
                const dec = decisionOf(iv.recommendation);
                const preenchida = Object.values(iv.answers ?? {}).some((v) => String(v ?? '').trim()) || !!iv.notes || !!dec;
                return (
                  <li key={iv.id}>
                    <button onClick={() => setSelId(iv.id)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer ${iv.id === selId ? 'bg-violet-50' : 'hover:bg-zinc-50'} ${iv.status === 'cancelada' ? 'opacity-50' : ''}`}>
                      <span className="w-12 text-sm font-black text-zinc-900">{fmtTime(iv.scheduled_at)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-zinc-800 truncate">{c?.full_name ?? 'Candidato removido'}</span>
                        <span className="block text-[11px] text-zinc-500 truncate">
                          {[c ? (ageOf(c) != null ? `${ageOf(c)} anos` : null) : null, c?.neighborhood || c?.city, preenchida ? 'registro preenchido' : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {dec ? <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${dec.cls}`}>{dec.sigla}</span>
                        : <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Registro */}
        {sel ? (
          <RegistroPainel key={sel.id} iv={sel} c={candOf(sel.candidate_id)} companies={companies} stages={stages} settings={settings}
            applications={applications} jobs={jobs} onSaved={onSaved} onOpenCandidate={onOpenCandidate} onBack={() => setSelId(null)} />
        ) : (
          <div className="hidden lg:flex rounded-2xl border border-dashed border-zinc-200 p-10 items-center justify-center text-sm text-zinc-400">
            {doDia.length ? 'Escolha uma pessoa na lista para registrar a entrevista.' : 'Sem entrevistas neste dia.'}
          </div>
        )}
      </div>
    </div>
  );
}

function RegistroPainel({ iv, c, companies, stages, settings, applications, jobs, onSaved, onOpenCandidate, onBack }: {
  iv: Interview; c: Candidate | null; companies: Company[]; stages: Stage[]; settings: Settings; applications: Application[]; jobs: Job[];
  onSaved: (iv: Interview, patch?: CandidatePatch) => void; onOpenCandidate: (id: string) => void; onBack: () => void;
}) {
  const inicial = {
    status: (iv.status === 'agendada' && new Date(iv.scheduled_at) <= new Date() ? 'realizada' : iv.status) as InterviewStatus,
    answers: (iv.answers ?? {}) as Record<string, string>,
    scores: (iv.scores ?? {}) as Record<string, number>,
    notes: iv.notes ?? '',
    decision: (iv.recommendation ?? null) as Decision | null,
  };
  type Rascunho = typeof inicial & { novaFase: string; at: number };
  const [rasc] = useState(() => lsLer<Rascunho>(lsDraftKey(iv.id)));
  const base = rasc ?? inicial;
  const [status, setStatus] = useState<InterviewStatus>(base.status);
  const [answers, setAnswers] = useState<Record<string, string>>(base.answers);
  const [scores, setScores] = useState<Record<string, number>>(base.scores);
  const [notes, setNotes] = useState(base.notes);
  const [decision, setDecision] = useState<Decision | null>(base.decision);
  const [novaFase, setNovaFase] = useState(rasc?.novaFase ?? '');
  const [recuperado, setRecuperado] = useState(!!rasc);
  // Formulário sempre disponível; começou a preencher uma entrevista "agendada" → vira "realizada".
  const preencher = () => { if (status === 'agendada') setStatus('realizada'); };
  const comRegistro = status !== 'faltou' && status !== 'cancelada';
  const [saving, setSaving] = useState(false);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const dirty = status !== iv.status || JSON.stringify(answers) !== JSON.stringify(iv.answers ?? {}) || JSON.stringify(scores) !== JSON.stringify(iv.scores ?? {})
    || notes !== (iv.notes ?? '') || decision !== (iv.recommendation ?? null) || !!novaFase;
  // Cada alteração vai para o rascunho do aparelho (some ao salvar ou descartar).
  useEffect(() => {
    const t = setTimeout(() => {
      if (dirty) lsGravar(lsDraftKey(iv.id), { status, answers, scores, notes, decision, novaFase, at: Date.now() });
      else lsApagar(lsDraftKey(iv.id));
    }, 300);
    return () => clearTimeout(t);
  }, [dirty, status, answers, scores, notes, decision, novaFase, iv.id]);
  const descartarRascunho = () => {
    lsApagar(lsDraftKey(iv.id));
    setStatus(inicial.status); setAnswers(inicial.answers); setScores(inicial.scores); setNotes(inicial.notes); setDecision(inicial.decision); setNovaFase('');
    setRecuperado(false);
  };

  const empresa = c?.company_id ? companyName(companies, c.company_id) : '';
  const idade = c ? ageOf(c) : null;
  const fase = c ? stageOf(stages, c.stage_id) : null;
  const app = c ? applications.filter((a) => a.candidate_id === c.id).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] : undefined;
  const vaga = app ? jobs.find((j) => j.id === app.job_id) : undefined;
  const fit = app ? app.fit ?? fitOf(app.score) : null;
  const wa = c ? whatsLink(c.whatsapp || c.phone) : null;
  const formato = FORMATS.find((f) => f.id === iv.format);
  const perguntas = [
    ...settings.questions,
    ...Object.keys(answers).filter((k) => answers[k]?.trim() && !settings.questions.some((q) => q.id === k)).map((k) => ({ id: k, label: `${k} (pergunta removida)` })),
  ];

  const verCurriculo = async () => {
    if (!c?.file_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(c.file_path, 300);
    if (error || !data?.signedUrl) { avisar('Não foi possível abrir o currículo.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const salvar = async () => {
    setSaving(true);
    const cleanAnswers = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v));
    const { data, error } = await supabase.from('hiring_interviews').update({
      status, answers: cleanAnswers, scores, recommendation: status === 'realizada' ? decision : null, notes: notes.trim() || null, updated_at: new Date().toISOString(),
    }).eq('id', iv.id).select('*').single();
    if (error || !data) { setSaving(false); avisar(`Não foi possível salvar: ${error?.message ?? 'sem retorno'}`); return; }

    // Candidato: tomada de decisão e, se escolhida, a fase.
    const patch: CandidatePatch | undefined = c ? { id: c.id } : undefined;
    if (c && patch) {
      const upd: Record<string, unknown> = {};
      if (status === 'realizada' && decision && decision !== c.decision) { upd.decision = decision; patch.decision = decision; }
      if (novaFase && novaFase !== c.stage_id) { upd.stage_id = novaFase; patch.stage_id = novaFase; }
      if (Object.keys(upd).length) {
        const agora = new Date().toISOString();
        let { error: e1 } = await supabase.from('hiring_candidates').update({ ...upd, updated_at: agora }).eq('id', c.id);
        if (e1 && upd.stage_id) {
          // Trava dos dados mínimos: pergunta se move mesmo assim.
          const ok = await confirmar({ titulo: 'Ficha incompleta', mensagem: `${e1.message} Quer mover de fase mesmo assim?`, confirmarLabel: 'Mover mesmo assim' });
          if (ok) ({ error: e1 } = await supabase.from('hiring_candidates').update({ ...upd, required_waived_at: agora, updated_at: agora }).eq('id', c.id));
          if (!ok || e1) {
            delete patch.stage_id;
            if (patch.decision) await supabase.from('hiring_candidates').update({ decision: patch.decision, updated_at: agora }).eq('id', c.id);
            if (ok && e1) avisar(`Não foi possível mover: ${e1.message}`);
          }
        } else if (e1) avisar(`Registro salvo, mas o candidato não foi atualizado: ${e1.message}`);
      }
    }
    setSaving(false);
    setNovaFase('');
    lsApagar(lsDraftKey(iv.id));
    setRecuperado(false);
    setSalvoEm(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    onSaved(data as Interview, patch && (patch.stage_id || patch.decision) ? patch : undefined);
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-violet-300';
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      {/* Cabeçalho do candidato */}
      <div className="p-4 border-b border-zinc-100">
        <button onClick={onBack} className="lg:hidden mb-2 text-xs font-bold text-zinc-500 cursor-pointer"><i className="ri-arrow-left-line" /> Voltar para a lista</button>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[200px]">
            <h2 className="text-lg font-black text-zinc-900">{c?.full_name ?? 'Candidato removido'}</h2>
            <p className="text-xs text-zinc-500">
              {[fmtTime(iv.scheduled_at), formato?.label, iv.location, iv.interviewer ? `com ${iv.interviewer}` : null].filter(Boolean).join(' · ')}
            </p>
            {c && (
              <p className="text-xs text-zinc-600 mt-1">
                {[idade != null ? `${idade} anos` : null, [c.neighborhood, c.city].filter(Boolean).join(', ') || null, c.desired_role, fase ? `fase: ${fase.name}` : null].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          {c && (
            <div className="flex flex-wrap gap-1.5">
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="px-3 h-8 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center gap-1"><i className="ri-whatsapp-line" /> {fmtPhone(c.whatsapp || c.phone)}</a>}
              {c.file_path && <button onClick={verCurriculo} className="px-3 h-8 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer"><i className="ri-file-text-line" /> Currículo</button>}
              <button onClick={() => onOpenCandidate(c.id)} className="px-3 h-8 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer"><i className="ri-user-line" /> Ficha completa</button>
            </div>
          )}
        </div>

        {/* Resumo rápido para a conversa */}
        {c && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {(app || c.summary) && (
              <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3 md:col-span-2">
                {app && vaga && (
                  <p className="text-xs text-zinc-700 mb-1">
                    <b>{vaga.title}</b>{app.score != null && <> · aderência <b>{app.score}/100</b></>}
                    {fit && <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full border ${FIT[fit].cls}`}>{FIT[fit].label}</span>}
                  </p>
                )}
                {c.summary && <p className="text-xs text-zinc-600 leading-relaxed">{c.summary}</p>}
              </div>
            )}
            {c.experiences.length > 0 && (
              <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Experiência{c.total_experience_months != null ? ` · ${fmtMonths(c.total_experience_months)}` : ''}</p>
                <ul className="space-y-0.5 text-xs text-zinc-700">
                  {c.experiences.slice(0, 4).map((e, i) => <li key={i}>• {[e.cargo, e.empresa].filter(Boolean).join(' — ') || e.descricao}</li>)}
                </ul>
              </div>
            )}
            {(c.strengths.length > 0 || c.concerns.length > 0 || (app?.analysis?.perguntas_entrevista?.length ?? 0) > 0) && (
              <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
                {c.strengths.length > 0 && <p className="text-xs text-emerald-800"><b>Fortes:</b> {c.strengths.slice(0, 3).join('; ')}</p>}
                {c.concerns.length > 0 && <p className="text-xs text-orange-800 mt-0.5"><b>Atenção:</b> {c.concerns.slice(0, 3).join('; ')}</p>}
                {(app?.analysis?.perguntas_entrevista?.length ?? 0) > 0 && (
                  <p className="text-xs text-violet-800 mt-0.5"><b>Sugestão da IA para perguntar:</b> {app!.analysis!.perguntas_entrevista.slice(0, 2).join(' / ')}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Formulário */}
      <div className="p-4 space-y-4">
        {recuperado && dirty && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <i className="ri-draft-line" />
            <span className="flex-1">Rascunho recuperado: o que você tinha digitado voltou, mas ainda <b>não foi salvo</b>.</span>
            <button onClick={descartarRascunho} className="font-bold text-amber-800 underline cursor-pointer">Descartar</button>
          </div>
        )}
        {status === 'agendada' && (
          <p className="text-xs text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
            <i className="ri-information-line" /> Pode preencher durante a conversa: ao começar, a entrevista passa para <b>Realizada</b>. Não se esqueça de clicar em <b>Salvar registro</b>.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {INTERVIEW_STATUS.map((s) => (
            <button key={s.id} onClick={() => setStatus(s.id)}
              className={`px-3 h-8 rounded-full border text-xs font-bold cursor-pointer ${status === s.id ? `${s.cls} ring-2 ring-offset-1 ring-zinc-300` : 'bg-white text-zinc-500 border-zinc-200'}`}>
              {s.label}
            </button>
          ))}
        </div>

        {comRegistro && (
          <>
            {perguntas.map((q, i) => (
              <div key={q.id}>
                <p className="text-sm font-semibold text-zinc-800 mb-1">{i + 1}. {withEmpresa(q.label, empresa)}</p>
                <textarea value={answers[q.id] ?? ''} rows={2} onChange={(e) => { preencher(); setAnswers((a) => ({ ...a, [q.id]: e.target.value })); }} className={inputCls} />
              </div>
            ))}
            {settings.criteria.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Avaliação (1 a 5)</p>
                {settings.criteria.map((cr) => (
                  <div key={cr.id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-zinc-700">{cr.label}</span>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => { preencher(); setScores((s) => ({ ...s, [cr.id]: s[cr.id] === n ? 0 : n })); }}
                        className={`w-7 h-7 rounded-md text-xs font-bold border cursor-pointer ${(scores[cr.id] ?? 0) >= n ? 'bg-amber-400 border-amber-400 text-white' : 'bg-white border-zinc-200 text-zinc-400'}`}>{n}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">{comRegistro ? 'Considerações adicionais' : 'Observações'}</p>
          <textarea value={notes} onChange={(e) => { if (comRegistro) preencher(); setNotes(e.target.value); }} rows={4} className={inputCls}
            placeholder={comRegistro ? 'Impressão geral, postura, referências, o que mais chamou atenção…' : 'Ex.: avisou que não viria, remarcar…'} />
        </div>

        {comRegistro && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Tomada de decisão</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {DECISIONS.map((d) => (
                <button key={d.id} onClick={() => { preencher(); setDecision(decision === d.id ? null : d.id); }}
                  className={`flex items-center gap-2 px-3 h-10 rounded-lg border text-left text-xs font-semibold cursor-pointer ${decision === d.id ? d.cls : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300'}`}>
                  <span className="font-black text-sm w-9">{d.sigla}</span>
                  <span className="leading-tight">{withEmpresa(d.label, empresa)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {c && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Mover o candidato para a fase</p>
            <select value={novaFase} onChange={(e) => setNovaFase(e.target.value)} className="h-9 px-3 rounded-lg border border-zinc-200 text-sm">
              <option value="">Manter em "{fase?.name ?? '—'}"</option>
              {stages.filter((s) => s.id !== fase?.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex items-center gap-3 px-4 py-3 border-t border-zinc-100 bg-white rounded-b-2xl">
        <p className="flex-1 text-xs text-zinc-500">
          {dirty ? <span className="text-amber-700 font-semibold"><i className="ri-edit-line" /> Não salvo ainda (rascunho guardado neste aparelho)</span>
            : salvoEm ? <span className="text-emerald-700 font-semibold"><i className="ri-check-line" /> Salvo às {salvoEm}</span> : 'Tudo salvo'}
        </p>
        <button onClick={salvar} disabled={saving || !dirty}
          className="px-5 h-10 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer">
          {saving ? 'Salvando…' : 'Salvar registro'}
        </button>
      </div>
    </div>
  );
}
