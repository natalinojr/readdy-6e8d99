// Agendar uma entrevista, ou mudar data/hora/formato/local de uma já marcada (e cancelar/excluir).
// O registro (questionário, notas, decisão) NÃO é aqui desde 2026-09-30: fica só no modo entrevista
// (ModoEntrevista.tsx) — o botão "Abrir registro" leva para lá. Agendar tira o candidato de "Novo".
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Candidate, type Company, type Decision, type Interview, type InterviewFormat, type InterviewStatus, type Settings, type Stage,
  FORMATS, whatsLink, firstName, companyName, inviteText, stageOf, stageByKind,
} from '../shared';
import { confirmar, avisar } from '../dialog';

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
  /** Entrevista já salva: abre o modo entrevista (registro). */
  onAbrirRegistro?: (iv: Interview) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
function splitLocal(iso: string) {
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export default function EntrevistaModal({ interview, candidates, companies, stages, settings, presetCandidateId, presetDate, onClose, onSaved, onDeleted, onAbrirRegistro }: Props) {
  const init = interview ? splitLocal(interview.scheduled_at) : { date: presetDate ?? splitLocal(new Date().toISOString()).date, time: '14:00' };
  const [candidateId, setCandidateId] = useState(interview?.candidate_id ?? presetCandidateId ?? '');
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [duration, setDuration] = useState(interview?.duration_min ?? settings.default_duration);
  const [format, setFormat] = useState<InterviewFormat>(interview?.format ?? 'presencial');
  const [location, setLocation] = useState(interview?.location ?? (interview ? '' : settings.default_location));
  const [interviewer, setInterviewer] = useState(interview?.interviewer ?? (interview ? '' : settings.default_interviewer));
  const [status, setStatus] = useState<InterviewStatus>(interview?.status ?? 'agendada');
  const [busca, setBusca] = useState('');
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cand = candidates.find((c) => c.id === candidateId) ?? null;
  const empresa = cand?.company_id ? companyName(companies, cand.company_id) : '';
  const faseAtual = cand ? stageOf(stages, cand.stage_id) : null;

  const descartadoId = stageByKind(stages, 'descartado')?.id;
  const opcoes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return candidates
      .filter((c) => c.stage_id !== descartadoId || c.id === candidateId)
      .filter((c) => !q || c.full_name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [candidates, busca, candidateId, descartadoId]);

  const abrirConversa = cand ? whatsLink(cand.phone) : null;
  const convite = cand && whatsLink(cand.phone, inviteText(settings.invite_template, {
    nome: firstName(cand.full_name),
    empresa,
    formato: FORMATS.find((f) => f.id === format)?.texto ?? '',
    data: date.split('-').reverse().join('/'),
    hora: time,
    local: location.trim(),
  }));

  // Mudou dia/hora de uma entrevista em que a pessoa faltou (ou foi cancelada): é uma remarcação,
  // volta a "agendada" para aparecer de novo na Minha fila e na agenda.
  const remarcou = () => { if (status === 'faltou' || status === 'cancelada') setStatus('agendada'); };

  const salvar = async () => {
    if (!candidateId) { setErro('Escolha o candidato.'); return; }
    if (!date || !time) { setErro('Informe data e hora.'); return; }
    setSaving(true); setErro(null);
    // Só data/hora/formato/local/status: o registro é do modo entrevista e não é regravado daqui.
    const row = {
      candidate_id: candidateId,
      company_id: cand?.company_id ?? null,
      scheduled_at: new Date(`${date}T${time}`).toISOString(),
      duration_min: duration,
      format,
      location: location.trim() || null,
      interviewer: interviewer.trim() || null,
      status,
      updated_at: new Date().toISOString(),
    };
    const q = interview
      ? supabase.from('hiring_interviews').update(row).eq('id', interview.id).select('*').single()
      : supabase.from('hiring_interviews').insert(row).select('*').single();
    const { data, error } = await q;
    if (error || !data) { setSaving(false); setErro(error?.message ?? 'Falha ao salvar'); return; }

    // Candidato: ao agendar, sai de "Novo"/"Chamar p/ entrevista" para "Entrevista agendada".
    const patch: CandidatePatch | null = cand ? { id: cand.id } : null;
    if (cand && patch) {
      let destino: string | null = null;
      if (!interview && (!faseAtual || faseAtual.native_kind === 'novo' || faseAtual.native_kind === 'agendar')) destino = stageByKind(stages, 'entrevista')?.id ?? null;
      if (destino && destino !== cand.stage_id) patch.stage_id = destino;
      const upd: Record<string, unknown> = {};
      if (patch.stage_id) upd.stage_id = patch.stage_id;
      if (patch.decision) upd.decision = patch.decision;
      if (Object.keys(upd).length) {
        const { error: candErr } = await supabase.from('hiring_candidates').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', cand.id);
        // Ficha incompleta (trava do banco): a entrevista fica salva, mas o candidato não muda de fase.
        if (candErr && patch.stage_id) {
          const forcar = await confirmar({
            titulo: 'Entrevista salva — ficha incompleta',
            mensagem: `${candErr.message} Quer mover o candidato de fase mesmo assim?`,
            confirmarLabel: 'Mover mesmo assim',
          });
          const { error: e2 } = forcar
            ? await supabase.from('hiring_candidates').update({ ...upd, required_waived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', cand.id)
            : { error: candErr };
          if (e2) {
            delete patch.stage_id;
            if (patch.decision) await supabase.from('hiring_candidates').update({ decision: patch.decision, updated_at: new Date().toISOString() }).eq('id', cand.id);
            if (forcar) avisar(`Não foi possível mover: ${e2.message}`);
          }
        }
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

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="col-span-2 sm:col-span-1"><Label>Data</Label><input type="date" value={date} onChange={(e) => { setDate(e.target.value); remarcou(); }} className={inputCls} /></div>
            <div><Label>Hora</Label><input type="time" value={time} onChange={(e) => { setTime(e.target.value); remarcou(); }} className={inputCls} /></div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><Label>Local / link</Label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex.: na loja, com o supervisor" className={inputCls} /></div>
            <div><Label>Quem entrevista</Label><input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} placeholder="Ex.: Natalino" className={inputCls} /></div>
          </div>

          {/* Entrevista já salva: só abre a conversa (o convite já foi feito). Nova: manda o convite pronto. */}
          {interview ? (
            abrirConversa && (
              <a href={abrirConversa} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold">
                <i className="ri-whatsapp-line text-sm" /> Abrir WhatsApp
              </a>
            )
          ) : convite && status === 'agendada' && (
            <a href={convite} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold">
              <i className="ri-whatsapp-line text-sm" /> Enviar convite pelo WhatsApp
            </a>
          )}

          {interview && (
            <div className="flex flex-wrap items-center gap-2">
              {onAbrirRegistro && (
                <button onClick={() => onAbrirRegistro(interview)}
                  className="flex-1 h-10 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 text-sm font-bold text-violet-700 cursor-pointer hover:bg-violet-50">
                  <i className="ri-edit-2-line" /> {interview.status === 'agendada' ? 'Abrir o modo entrevista' : 'Abrir o registro'}
                </button>
              )}
              {status === 'realizada' || status === 'faltou' ? null : status !== 'cancelada' ? (
                <button onClick={() => setStatus('cancelada')} className="px-3 h-10 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer">
                  Marcar como cancelada
                </button>
              ) : (
                <button onClick={() => setStatus(interview.status === 'cancelada' ? 'agendada' : interview.status)} className="px-3 h-10 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer">
                  Desfazer cancelamento
                </button>
              )}
            </div>
          )}
          {status === 'cancelada' && <p className="text-xs text-zinc-500">Vai ficar como <b>cancelada</b> ao salvar.</p>}
          {interview && interview.status !== 'agendada' && status === 'agendada' && <p className="text-xs text-violet-700">Remarcada: volta a <b>agendada</b> ao salvar.</p>}
          {interview && status === 'faltou' && <p className="text-xs text-zinc-500">A pessoa faltou. Mude a data ou a hora para remarcar.</p>}
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
