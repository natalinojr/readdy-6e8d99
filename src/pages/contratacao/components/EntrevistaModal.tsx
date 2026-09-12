// Agendar uma entrevista e, depois, registrar como foi (ficha com notas por critério,
// recomendação e anotações). Também atualiza a etapa do candidato.
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Candidate, type Interview, type InterviewFormat, type InterviewStatus, type Loja, type Recommendation, type Status,
  CRITERIA, FORMATS, INTERVIEW_STATUS, RECOMMENDATIONS, STATUS, whatsLink, firstName, lojaNome,
} from '../shared';

interface Props {
  interview: Interview | null;
  candidates: Candidate[];
  lojas: Loja[];
  presetCandidateId?: string | null;
  presetDate?: string | null; // AAAA-MM-DD
  onClose: () => void;
  onSaved: (iv: Interview, candidatePatch?: { id: string; status: Status }) => void;
  onDeleted: (id: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
function splitLocal(iso: string) {
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export default function EntrevistaModal({ interview, candidates, lojas, presetCandidateId, presetDate, onClose, onSaved, onDeleted }: Props) {
  const init = interview ? splitLocal(interview.scheduled_at) : { date: presetDate ?? splitLocal(new Date().toISOString()).date, time: '14:00' };
  const [candidateId, setCandidateId] = useState(interview?.candidate_id ?? presetCandidateId ?? '');
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [duration, setDuration] = useState(interview?.duration_min ?? 30);
  const [format, setFormat] = useState<InterviewFormat>(interview?.format ?? 'presencial');
  const [location, setLocation] = useState(interview?.location ?? '');
  const [interviewer, setInterviewer] = useState(interview?.interviewer ?? '');
  const [status, setStatus] = useState<InterviewStatus>(interview?.status ?? 'agendada');
  const [scores, setScores] = useState<Record<string, number>>(interview?.scores ?? {});
  const [recommendation, setRecommendation] = useState<Recommendation | null>(interview?.recommendation ?? null);
  const [notes, setNotes] = useState(interview?.notes ?? '');
  const [busca, setBusca] = useState('');
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cand = candidates.find((c) => c.id === candidateId) ?? null;
  const [candStatus, setCandStatus] = useState<Status | ''>('');
  const isPast = new Date(`${date}T${time}`) <= new Date();
  const [showRegistro, setShowRegistro] = useState(!!interview && (interview.status !== 'agendada' || new Date(interview.scheduled_at) <= new Date()));

  const opcoes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return candidates
      .filter((c) => c.status !== 'descartado' || c.id === candidateId)
      .filter((c) => !q || c.full_name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [candidates, busca, candidateId]);

  const convite = cand && whatsLink(cand.phone,
    `Olá, ${firstName(cand.full_name)}! Recebemos seu currículo e gostaríamos de conversar com você. ` +
    `Entrevista ${format === 'presencial' ? 'presencial' : format === 'telefone' ? 'por telefone' : 'por vídeo'} ` +
    `no dia ${date.split('-').reverse().join('/')} às ${time}${location ? `, ${location}` : ''}. Pode confirmar?`);

  const salvar = async () => {
    if (!candidateId) { setErro('Escolha o candidato.'); return; }
    if (!date || !time) { setErro('Informe data e hora.'); return; }
    setSaving(true); setErro(null);
    const row = {
      candidate_id: candidateId,
      tenant_id: cand?.tenant_id ?? null,
      scheduled_at: new Date(`${date}T${time}`).toISOString(),
      duration_min: duration,
      format,
      location: location.trim() || null,
      interviewer: interviewer.trim() || null,
      status,
      scores,
      recommendation,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const q = interview
      ? supabase.from('hiring_interviews').update(row).eq('id', interview.id).select('*').single()
      : supabase.from('hiring_interviews').insert(row).select('*').single();
    const { data, error } = await q;
    if (error || !data) { setSaving(false); setErro(error?.message ?? 'Falha ao salvar'); return; }

    // Etapa do candidato: a escolhida no modal; senão, agendar leva novo/triagem para "entrevista".
    let novo: Status | null = candStatus || null;
    if (!novo && cand && !interview && (cand.status === 'novo' || cand.status === 'triagem')) novo = 'entrevista';
    if (novo && cand && novo !== cand.status) {
      await supabase.from('hiring_candidates').update({ status: novo, updated_at: new Date().toISOString() }).eq('id', cand.id);
    }
    setSaving(false);
    onSaved(data as Interview, novo && cand && novo !== cand.status ? { id: cand.id, status: novo } : undefined);
  };

  const excluir = async () => {
    if (!interview || !confirm('Excluir esta entrevista?')) return;
    const { error } = await supabase.from('hiring_interviews').delete().eq('id', interview.id);
    if (error) { setErro(error.message); return; }
    onDeleted(interview.id);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-[70] w-full sm:max-w-lg max-h-[92vh] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
          <i className="ri-calendar-event-line text-xl text-violet-600" />
          <h2 className="flex-1 font-black text-zinc-900">{interview ? 'Entrevista' : 'Agendar entrevista'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Candidato */}
          <div>
            <Label>Candidato</Label>
            {cand && (interview || presetCandidateId) ? (
              <p className="text-sm font-bold text-zinc-900">{cand.full_name}
                <span className="font-normal text-zinc-500 text-xs"> · {cand.desired_role ?? 'cargo não informado'} · {lojaNome(lojas, cand.tenant_id)}</span>
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

          {/* Quando e onde */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1"><Label>Data</Label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></div>
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

          {/* Registro: como foi */}
          {!showRegistro ? (
            <button onClick={() => setShowRegistro(true)} className="w-full h-9 rounded-lg border border-dashed border-zinc-300 text-xs font-bold text-zinc-600 cursor-pointer hover:bg-zinc-50">
              <i className="ri-edit-2-line" /> {isPast ? 'Registrar como foi a entrevista' : 'Já registrar o resultado'}
            </button>
          ) : (
            <div className="rounded-2xl border border-zinc-200 p-4 space-y-4 bg-zinc-50/50">
              <p className="text-xs font-black uppercase tracking-wider text-zinc-500">Como foi a entrevista</p>
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
                  <div className="space-y-1.5">
                    {CRITERIA.map((cr) => (
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
                  <div>
                    <Label>Recomendação</Label>
                    <div className="flex gap-1.5">
                      {RECOMMENDATIONS.map((r) => (
                        <button key={r.id} onClick={() => setRecommendation(recommendation === r.id ? null : r.id)}
                          className={`flex-1 h-9 rounded-lg border text-xs font-bold cursor-pointer ${recommendation === r.id ? r.cls : 'bg-white text-zinc-600 border-zinc-200'}`}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div>
                <Label>O que aconteceu</Label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
                  placeholder="Chegou no horário? Como se comunicou? Experiência real, disponibilidade de horários, pretensão, referências, impressão geral…"
                  className={`${inputCls} h-auto py-2`} />
              </div>

              {cand && (
                <div>
                  <Label>Mover o candidato para a etapa</Label>
                  <select value={candStatus} onChange={(e) => setCandStatus(e.target.value as Status | '')} className={inputCls}>
                    <option value="">Manter em "{STATUS.find((s) => s.id === cand.status)?.label}"</option>
                    {STATUS.filter((s) => s.id !== cand.status).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
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
