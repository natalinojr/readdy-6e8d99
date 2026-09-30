// Modo entrevista (2026-09-30): o ÚNICO lugar de preencher o registro de uma entrevista. Tela cheia,
// uma pergunta por vez (ou todas numa página), com a "cola" do candidato ao lado (resumo, pontos,
// sugestão da IA, experiências). No fim: avaliação 1–5, considerações, a decisão (vai também para o
// candidato) e, se quiser, a fase. Abre da Minha fila, da ficha e do link "Abrir entrevista de Fulana".
// Rascunho no aparelho por entrevista (mesma chave de antes): no celular o app recarrega ao voltar de
// outra janela e perdia o que foi digitado.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Application, type Candidate, type Company, type Decision, type Interview, type InterviewStatus, type Job, type Settings, type Stage,
  BUCKET, DECISIONS, FIT, FORMATS, INTERVIEW_STATUS, ageOf, companyName, fitOf, fmtDateTime, fmtMonths, fmtPhone, stageOf, whatsLink, withEmpresa,
} from '../shared';
import type { CandidatePatch } from './EntrevistaModal';
import { avisar, confirmar } from '../dialog';

const lsDraftKey = (id: string) => `contratacao_rascunho_entrevista_${id}`;
const lsLer = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const lsGravar = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } };
const lsApagar = (k: string) => { try { localStorage.removeItem(k); } catch { /* sem storage */ } };
const LS_MODO = 'contratacao_entrevista_modo';

interface Props {
  iv: Interview; c: Candidate | null; companies: Company[]; stages: Stage[]; settings: Settings;
  applications: Application[]; jobs: Job[];
  onSaved: (iv: Interview, patch?: CandidatePatch) => void;
  onClose: () => void;
  onOpenFicha?: (candidateId: string) => void;
  onRemarcar?: (iv: Interview) => void;
}

export default function ModoEntrevista({ iv, c, companies, stages, settings, applications, jobs, onSaved, onClose, onOpenFicha, onRemarcar }: Props) {
  const inicial = {
    // Agendada com horário já passado: quem abre está registrando o que aconteceu.
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
  const [saving, setSaving] = useState(false);
  const [passo, setPasso] = useState(0);
  const [todas, setTodas] = useState(() => lsLer<boolean>(LS_MODO) ?? false);
  useEffect(() => { lsGravar(LS_MODO, todas); }, [todas]);

  // Começou a preencher uma entrevista "agendada" → vira "realizada".
  const preencher = () => { if (status === 'agendada') setStatus('realizada'); };
  const comRegistro = status !== 'faltou' && status !== 'cancelada';
  // Compara com o estado de abertura (não com a linha do banco): abrir e sair sem mexer não vira rascunho.
  const mudou = status !== inicial.status || JSON.stringify(answers) !== JSON.stringify(iv.answers ?? {}) || JSON.stringify(scores) !== JSON.stringify(iv.scores ?? {})
    || notes !== (iv.notes ?? '') || decision !== (iv.recommendation ?? null) || !!novaFase;
  const dirty = mudou;
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
  const fase = c ? stageOf(stages, c.stage_id) : null;
  const perguntas = [
    ...settings.questions,
    ...Object.keys(answers).filter((k) => answers[k]?.trim() && !settings.questions.some((q) => q.id === k)).map((k) => ({ id: k, label: `${k} (pergunta removida)` })),
  ];
  const nPassos = perguntas.length + 1; // + fechamento
  const noFechamento = todas || passo >= perguntas.length;

  const sair = async () => {
    if (dirty) {
      const ok = await confirmar({ titulo: 'Sair sem salvar?', mensagem: 'O que você escreveu fica guardado neste aparelho como rascunho e volta quando abrir de novo.', confirmarLabel: 'Sair' });
      if (!ok) return;
    }
    onClose();
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
    lsApagar(lsDraftKey(iv.id));
    onSaved(data as Interview, patch && (patch.stage_id || patch.decision) ? patch : undefined);
    onClose();
  };

  const verCurriculo = async () => {
    if (!c?.file_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(c.file_path, 300);
    if (error || !data?.signedUrl) { avisar('Não foi possível abrir o currículo.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const app = c ? applications.filter((a) => a.candidate_id === c.id).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] : undefined;
  const vaga = app ? jobs.find((j) => j.id === app.job_id) : undefined;
  const fit = app ? app.fit ?? fitOf(app.score) : null;
  const idade = c ? ageOf(c) : null;
  const wa = c ? whatsLink(c.whatsapp || c.phone) : null;
  const formato = FORMATS.find((f) => f.id === iv.format);
  const inputCls = 'w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm focus:outline-none focus:border-violet-400';

  const pergunta = (q: { id: string; label: string }, i: number, grande: boolean) => (
    <div key={q.id}>
      {grande && <p className="text-xs font-bold text-zinc-400">Pergunta {i + 1} de {perguntas.length}</p>}
      <p className={grande ? 'text-lg sm:text-xl font-black text-zinc-900 mt-1 mb-3' : 'text-sm font-semibold text-zinc-800 mb-1'}>
        {!grande && `${i + 1}. `}{withEmpresa(q.label, empresa)}
      </p>
      <textarea value={answers[q.id] ?? ''} rows={grande ? 5 : 2} autoFocus={grande}
        onChange={(e) => { preencher(); setAnswers((a) => ({ ...a, [q.id]: e.target.value })); }}
        placeholder={grande ? 'Anote a resposta (dá para usar o microfone do teclado)…' : undefined}
        className={`${inputCls} ${grande ? 'text-base px-4 py-3' : ''}`} />
    </div>
  );

  const fechamento = (
    <div className="space-y-5">
      {!todas && <h3 className="text-lg sm:text-xl font-black text-zinc-900">Fechamento</h3>}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Como foi</p>
        <div className="flex flex-wrap gap-1.5">
          {INTERVIEW_STATUS.map((s) => (
            <button key={s.id} onClick={() => setStatus(s.id)}
              className={`px-3 h-8 rounded-full border text-xs font-bold cursor-pointer ${status === s.id ? `${s.cls} ring-2 ring-offset-1 ring-zinc-300` : 'bg-white text-zinc-500 border-zinc-200'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {comRegistro && settings.criteria.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Avaliação (1 a 5, opcional)</p>
          {settings.criteria.map((cr) => (
            <div key={cr.id} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-zinc-700">{cr.label}</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => { preencher(); setScores((s) => ({ ...s, [cr.id]: s[cr.id] === n ? 0 : n })); }}
                  className={`w-8 h-8 rounded-md text-xs font-bold border cursor-pointer ${(scores[cr.id] ?? 0) >= n ? 'bg-amber-400 border-amber-400 text-white' : 'bg-white border-zinc-200 text-zinc-400'}`}>{n}</button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">{comRegistro ? 'Considerações adicionais' : 'Observações'}</p>
        <textarea value={notes} onChange={(e) => { if (comRegistro) preencher(); setNotes(e.target.value); }} rows={3} className={inputCls}
          placeholder={comRegistro ? 'Impressão geral, postura, referências, o que mais chamou atenção…' : 'Ex.: avisou que não viria, remarcar…'} />
      </div>

      {comRegistro && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Tomada de decisão</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {DECISIONS.map((d) => (
              <button key={d.id} onClick={() => { preencher(); setDecision(decision === d.id ? null : d.id); }}
                className={`flex items-center gap-2 px-3 h-11 rounded-xl border text-left text-xs font-semibold cursor-pointer ${decision === d.id ? d.cls : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300'}`}>
                <span className="font-black text-sm w-9">{d.sigla}</span>
                <span className="leading-tight">{withEmpresa(d.label, empresa)}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-zinc-400 mt-1">Pode deixar para depois: sem decisão, a pessoa fica em "Decidir" na Minha fila.</p>
        </div>
      )}

      {c && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Mover para a fase</p>
          <select value={novaFase} onChange={(e) => setNovaFase(e.target.value)} className="h-9 px-3 rounded-lg border border-zinc-200 text-sm bg-white">
            <option value="">Manter em "{fase?.name ?? '—'}"</option>
            {stages.filter((s) => s.id !== fase?.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[55] bg-zinc-50 flex flex-col">
      {/* Cabeçalho */}
      <div className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-700 font-black flex items-center justify-center flex-shrink-0">
          {(c?.full_name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-zinc-900 truncate">Entrevista · {c?.full_name ?? 'Candidato removido'}</p>
          <p className="text-xs text-zinc-500 truncate">
            {[fmtDateTime(iv.scheduled_at), formato?.label, iv.location, iv.interviewer ? `com ${iv.interviewer}` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="hidden sm:inline text-xs">
          {dirty ? <span className="text-amber-700 font-semibold"><i className="ri-draft-line" /> rascunho neste aparelho</span>
            : <span className="text-zinc-400">sem alterações</span>}
        </span>
        {onRemarcar && iv.status === 'agendada' && (
          <button onClick={() => onRemarcar(iv)} title="Remarcar" className="flex items-center gap-1 px-2.5 sm:px-3 h-9 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer">
            <i className="ri-calendar-2-line" /> <span className="hidden sm:inline">Remarcar</span>
          </button>
        )}
        <button onClick={sair} className="px-3 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer">Sair</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-4 items-start">
          <div className="rounded-2xl bg-white border border-zinc-200 p-4 sm:p-5 space-y-5">
            {recuperado && dirty && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <i className="ri-draft-line" />
                <span className="flex-1">Rascunho recuperado: o que você tinha digitado voltou, mas ainda <b>não foi salvo</b>.</span>
                <button onClick={descartarRascunho} className="font-bold text-amber-800 underline cursor-pointer">Descartar</button>
              </div>
            )}

            <div className="flex items-center gap-2">
              {!todas && (
                <div className="flex-1 flex gap-1">
                  {Array.from({ length: nPassos }, (_, i) => (
                    <button key={i} onClick={() => setPasso(i)} title={i < perguntas.length ? `Pergunta ${i + 1}` : 'Fechamento'}
                      className={`flex-1 h-1.5 rounded-full cursor-pointer ${i === passo ? 'bg-violet-600' : i < passo ? 'bg-violet-300' : 'bg-zinc-200'}`} />
                  ))}
                </div>
              )}
              <button onClick={() => setTodas((v) => !v)} className={`${todas ? '' : 'ml-2'} text-[11px] font-bold text-violet-700 whitespace-nowrap cursor-pointer`}>
                {todas ? <><i className="ri-play-list-line" /> Uma por vez</> : <><i className="ri-list-check" /> Ver todas</>}
              </button>
              {iv.status === 'agendada' && status !== 'faltou' && (
                <button onClick={() => { setStatus('faltou'); setPasso(perguntas.length); }} className="ml-auto text-[11px] font-bold text-zinc-500 hover:text-zinc-800 whitespace-nowrap cursor-pointer">
                  Não veio?
                </button>
              )}
            </div>

            {todas ? (
              <>
                {comRegistro && perguntas.map((q, i) => pergunta(q, i, false))}
                {fechamento}
              </>
            ) : !noFechamento ? pergunta(perguntas[passo], passo, true) : fechamento}

            <div className="flex items-center gap-2 pt-1">
              {!todas && passo > 0 && (
                <button onClick={() => setPasso((p) => p - 1)} className="px-4 h-11 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 cursor-pointer">Voltar</button>
              )}
              {!todas && !noFechamento ? (
                <button onClick={() => setPasso((p) => p + 1)} className="ml-auto px-5 h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold cursor-pointer">
                  Próxima <i className="ri-arrow-right-line" />
                </button>
              ) : (
                <button onClick={salvar} disabled={saving || !dirty}
                  className="ml-auto px-5 h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer">
                  {saving ? 'Salvando…' : 'Salvar registro'}
                </button>
              )}
            </div>
          </div>

          {/* Cola da entrevista */}
          {c && (
            <aside className="rounded-2xl bg-white border border-zinc-200 p-4 space-y-3 lg:sticky lg:top-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Cola da entrevista</p>
              <p className="text-sm text-zinc-800">
                {[idade != null ? `${idade} anos` : null, [c.neighborhood, c.city].filter(Boolean).join(', ') || null, c.marital_status].filter(Boolean).join(' · ') || '—'}
              </p>
              {app && vaga && (
                <p className="text-xs text-zinc-700">
                  <b>{vaga.title}</b>{app.score != null && <> · aderência <b>{app.score}/100</b></>}
                  {fit && <span className={`ml-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${FIT[fit].cls}`}>{FIT[fit].label}</span>}
                </p>
              )}
              {c.summary && <p className="text-xs text-zinc-600 leading-relaxed">{c.summary}</p>}
              {c.strengths.length > 0 && <p className="text-xs text-emerald-800"><b>Fortes:</b> {c.strengths.slice(0, 4).join('; ')}</p>}
              {c.concerns.length > 0 && <p className="text-xs text-orange-800"><b>Atenção:</b> {c.concerns.slice(0, 4).join('; ')}</p>}
              {(app?.analysis?.perguntas_entrevista?.length ?? 0) > 0 && (
                <div className="text-xs text-violet-800">
                  <b>Sugestão da IA para perguntar:</b>
                  <ul className="mt-0.5 space-y-0.5">{app!.analysis!.perguntas_entrevista.slice(0, 3).map((p, i) => <li key={i}>• {p}</li>)}</ul>
                </div>
              )}
              {c.experiences.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">Experiência{c.total_experience_months != null ? ` · ${fmtMonths(c.total_experience_months)}` : ''}</p>
                  <ul className="space-y-0.5 text-xs text-zinc-700">
                    {c.experiences.slice(0, 4).map((e, i) => <li key={i}>• {[e.cargo, e.empresa].filter(Boolean).join(' — ') || e.descricao}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="px-2.5 h-8 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center gap-1"><i className="ri-whatsapp-line" /> {fmtPhone(c.whatsapp || c.phone)}</a>}
                {c.file_path && <button onClick={verCurriculo} className="px-2.5 h-8 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer"><i className="ri-file-text-line" /> Currículo</button>}
                {onOpenFicha && <button onClick={() => onOpenFicha(c.id)} className="px-2.5 h-8 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer"><i className="ri-user-line" /> Ficha</button>}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
