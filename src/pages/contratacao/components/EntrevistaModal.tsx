// Agendar uma entrevista e, depois, registrar como foi: questionário (perguntas das
// Configurações), notas por critério, considerações adicionais e a tomada de decisão
// (GPC/PC/R/NA, gravada também no candidato). Também move o candidato de fase.
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Candidate, type Company, type Decision, type Interview, type InterviewFormat, type InterviewStatus, type Settings, type Stage,
  FORMATS, INTERVIEW_STATUS, DECISIONS, whatsLink, firstName, companyName, inviteText, stageOf, stageByKind, withEmpresa,
} from '../shared';
import { confirmar } from '../dialog';

export type CandidatePatch = { id: string; stage_id?: string; decision?: Decision | null };

interface Props {
  interview: Interview | null;
  candidates: Candidate[];
  companies: Company[];
  stages: Stage[];
  settings: Settings;
  presetCandidateId?: string | null;
  presetDate?: string | null; // AAAA-MM-DD
  onClose: () => void;
  onSaved: (iv: Interview, candidatePatch?: CandidatePatch) => void;
  onDeleted: (id: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
function splitLocal(iso: string) {
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export default function EntrevistaModal({ interview, candidates, companies, stages, settings, presetCandidateId, presetDate, onClose, onSaved, onDeleted }: Props) {
  const init = interview ? splitLocal(interview.scheduled_at) : { date: presetDate ?? splitLocal(new Date().toISOString()).date, time: '14:00' };
  const [candidateId, setCandidateId] = useState(interview?.candidate_id ?? presetCandidateId ?? '');
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [duration, setDuration] = useState(interview?.duration_min ?? settings.default_duration);
  const [format, setFormat] = useState<InterviewFormat>(interview?.format ?? 'presencial');
  const [location, setLocation] = useState(interview?.location ?? (interview ? '' : settings.default_location));
  const [interviewer, setInterviewer] = useState(interview?.interviewer ?? (interview ? '' : settings.default_interviewer));
  const [status, setStatus] = useState<InterviewStatus>(interview?.status ?? 'agendada');
  const [scores, setScores] = useState<Record<string, number>>(interview?.scores ?? {});
  const [answers, setAnswers] = useState<Record<string, string>>(interview?.answers ?? {});
  const [decision, setDecision] = useState<Decision | null>(interview?.recommendation ?? null);
  const [notes, setNotes] = useState(interview?.notes ?? '');
  const [busca, setBusca] = useState('');
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [novaFase, setNovaFase] = useState<string>('');

  const cand = candidates.find((c) => c.id === candidateId) ?? null;
  const empresa = cand?.company_id ? companyName(companies, cand.company_id) : '';
  const faseAtual = cand ? stageOf(stages, cand.stage_id) : null;
  const isPast = new Date(`${date}T${time}`) <= new Date();
  const [showRegistro, setShowRegistro] = useState(!!interview && (interview.status !== 'agendada' || new Date(interview.scheduled_at) <= new Date()));

  const descartadoId = stageByKind(stages, 'descartado')?.id;
  const opcoes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return candidates
      .filter((c) => c.stage_id !== descartadoId || c.id === candidateId)
      .filter((c) => !q || c.full_name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [candidates, busca, candidateId, descartadoId]);

  const convite = cand && whatsLink(cand.phone, inviteText(settings.invite_template, {
    nome: firstName(cand.full_name),
    empresa,
    formato: FORMATS.find((f) => f.id === format)?.texto ?? '',
    data: date.split('-').reverse().join('/'),
    hora: time,
    local: location.trim(),
  }));

  const abrirRegistro = () => {
    setShowRegistro(true);
    if (status === 'agendada') setStatus('realizada');
  };

  const salvar = async () => {
    if (!candidateId) { setErro('Escolha o candidato.'); return; }
    if (!date || !time) { setErro('Informe data e hora.'); return; }
    setSaving(true); setErro(null);
    const cleanAnswers = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const row = {
      candidate_id: candidateId,
      company_id: cand?.company_id ?? null,
      scheduled_at: new Date(`${date}T${time}`).toISOString(),
      duration_min: duration,
      format,
      location: location.trim() || null,
      interviewer: interviewer.trim() || null,
      status,
      scores,
      answers: cleanAnswers,
      recommendation: decision,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const q = interview
      ? supabase.from('hiring_interviews').update(row).eq('id', interview.id).select('*').single()
      : supabase.from('hiring_interviews').insert(row).select('*').single();
    const { data, error } = await q;
    if (error || !data) { setSaving(false); setErro(error?.message ?? 'Falha ao salvar'); return; }

    // Candidato: fase escolhida (ou "Novo" → "Entrevista agendada" ao agendar) e a tomada de decisão.
    const patch: CandidatePatch | null = cand ? { id: cand.id } : null;
    if (cand && patch) {
      let destino: string | null = novaFase || null;
      if (!destino && !interview && (!faseAtual || faseAtual.native_kind === 'novo')) destino = stageByKind(stages, 'entrevista')?.id ?? null;
      if (destino && destino !== cand.stage_id) patch.stage_id = destino;
      if (decision && decision !== cand.decision) patch.decision = decision;
      const upd: Record<string, unknown> = {};
      if (patch.stage_id) upd.stage_id = patch.stage_id;
      if (patch.decision) upd.decision = patch.decision;
      if (Object.keys(upd).length) {
        await supabase.from('hiring_candidates').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', cand.id);
      }
    }
    setSaving(false);
    onSaved(data as Interview, patch && (patch.stage_id || patch.decision) ? patch : undefined);
  };

  const excluir = async () => {
    if (!interview) return;
    const ok = await confirmar({
      titulo: 'Excluir entrevista?',
      mensagem: 'O agendamento e tudo o que foi preenchido nela serão apagados.',
      confirmarLabel: 'Excluir',
      perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('hiring_interviews').delete().eq('id', interview.id);
    if (error) { setErro(error.message); return; }
    onDeleted(interview.id);
  };

  // Perguntas/critérios atuais + respostas/notas antigas de itens que foram removidos (continuam visíveis).
  const perguntas = [
    ...settings.questions,
    ...Object.keys(answers).filter((k) => answers[k]?.trim() && !settings.questions.some((q) => q.id === k)).map((k) => ({ id: k, label: `${k} (pergunta removida)` })),
  ];
  const criterios = [
    ...settings.criteria,
    ...Object.keys(scores).filter((k) => scores[k] > 0 && !settings.criteria.some((c) => c.id === k)).map((k) => ({ id: k, label: `${k} (removido)` })),
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-[70] w-full sm:max-w-2xl max-h-[94vh] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
          <i className="ri-calendar-event-line text-xl text-violet-600" />
          <h2 className="flex-1 font-black text-zinc-900">{interview ? 'Entrevista' : 'Agendar entrevista'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <Label>Candidato</Label>
            {cand && (interview || presetCandidateId) ? (
              <p className="text-sm font-bold text-zinc-900">{cand.full_name}
                <span className="font-normal text-zinc-500 text-xs"> · {cand.desired_role ?? 'cargo não informado'} · {companyName(companies, cand.company_id)}</span>
              </p>
            ) : (
              <>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar candidato…" className={inputCls} />
                <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)} size={5} className={`${inputCls} mt-1.5 h-auto`}>
                  {opcoes.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.desired_role ? ` — ${c.desired_role}` : ''}</option>)}
                </select>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div><Label>Data</Label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></div>
            <div><Label>Hora</Label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} /></div>
            <div><Label>Duração</Label>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputCls}>
                {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label>Formato</Label>
            <div className="flex gap-1.5">
              {FORMATS.map((f) => (
                <button key={f.id} onClick={() => setFormat(f.id)}
                  className={`flex-1 h-9 rounded-lg border text-xs font-bold cursor-pointer ${format === f.id ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-zinc-600 border-zinc-200'}`}>
                  <i className={f.icon} /> {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Local / link</Label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex.: na loja, com o gerente" className={inputCls} /></div>
            <div><Label>Quem entrevista</Label><input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} placeholder="Ex.: Natalino" className={inputCls} /></div>
          </div>

          {convite && status === 'agendada' && (
            <a href={convite} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold">
              <i className="ri-whatsapp-line text-sm" /> Enviar convite pelo WhatsApp
            </a>
          )}

          {!showRegistro ? (
            <button onClick={abrirRegistro} className="w-full h-10 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 text-sm font-bold text-violet-700 cursor-pointer hover:bg-violet-50">
              <i className="ri-edit-2-line" /> {isPast ? 'Preencher a entrevista' : 'Já preencher a entrevista'}
            </button>
          ) : (
            <div className="rounded-2xl border border-zinc-200 p-4 space-y-4 bg-zinc-50/50">
              <p className="text-xs font-black uppercase tracking-wider text-zinc-500">Registro da entrevista</p>
              <div className="flex flex-wrap gap-1.5">
                {INTERVIEW_STATUS.map((s) => (
                  <button key={s.id} onClick={() => setStatus(s.id)}
                    className={`px-3 h-8 rounded-full border text-xs font-bold cursor-pointer ${status === s.id ? s.cls + ' ring-2 ring-offset-1 ring-zinc-300' : 'bg-white text-zinc-500 border-zinc-200'}`}>
                    {s.label}
                  </button>
                ))}
              </div>

              {status === 'realizada' && (
                <>
                  {perguntas.length > 0 && (
                    <div className="space-y-3">
                      {perguntas.map((q, i) => (
                        <div key={q.id}>
                          <p className="text-sm font-semibold text-zinc-800 mb-1">{i + 1}. {withEmpresa(q.label, empresa)}</p>
                          <textarea value={answers[q.id] ?? ''} rows={2}
                            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                            className={`${inputCls} h-auto py-2`} />
                        </div>
                      ))}
                    </div>
                  )}

                  {criterios.length > 0 && (
                    <div className="space-y-1.5">
                      <Label>Avaliação (1 a 5)</Label>
                      {criterios.map((cr) => (
                        <div key={cr.id} className="flex items-center gap-2">
                          <span className="flex-1 text-sm text-zinc-700">{cr.label}</span>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button key={n} onClick={() => setScores((s) => ({ ...s, [cr.id]: s[cr.id] === n ? 0 : n }))}
                              className={`w-7 h-7 rounded-md text-xs font-bold border cursor-pointer ${
                                (scores[cr.id] ?? 0) >= n ? 'bg-amber-400 border-amber-400 text-white' : 'bg-white border-zinc-200 text-zinc-400'}`}>
                              {n}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div>
                <Label>{status === 'realizada' ? 'Considerações adicionais' : 'Observações'}</Label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
                  placeholder={status === 'realizada' ? 'Impressão geral, postura, referências, o que mais chamou atenção…' : 'Ex.: avisou que não viria, remarcar…'}
                  className={`${inputCls} h-auto py-2`} />
              </div>

              {status === 'realizada' && (
                <div>
                  <Label>Tomada de decisão</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {DECISIONS.map((d) => (
                      <button key={d.id} onClick={() => setDecision(decision === d.id ? null : d.id)}
                        className={`flex items-center gap-2 px-3 h-10 rounded-lg border text-left text-xs font-semibold cursor-pointer ${
                          decision === d.id ? d.cls : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300'}`}>
                        <span className="font-black text-sm w-9">{d.sigla}</span>
                        <span className="leading-tight">{withEmpresa(d.label, empresa)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {cand && (
                <div>
                  <Label>Mover o candidato para a fase</Label>
                  <select value={novaFase} onChange={(e) => setNovaFase(e.target.value)} className={inputCls}>
                    <option value="">Manter em "{faseAtual?.name ?? '—'}"</option>
                    {stages.filter((s) => s.id !== faseAtual?.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          {erro && <p className="text-xs text-red-600">{erro}</p>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-100">
          {interview && (
            <button onClick={excluir} className="px-3 h-9 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 cursor-pointer"><i className="ri-delete-bin-line" /></button>
          )}
          <button onClick={onClose} className="ml-auto px-4 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer">Cancelar</button>
          <button onClick={salvar} disabled={saving} className="px-4 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-bold cursor-pointer">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </>
  );
}

const inputCls = 'w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:border-violet-300';
function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">{children}</p>;
}
