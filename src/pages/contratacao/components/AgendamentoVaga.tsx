// Entrevistas pelo assistente — configuração POR VAGA (hiring_job_scheduling).
// Candidato inscrito na vaga e colocado na etapa "Chamar p/ entrevista" recebe o convite do assistente
// no WhatsApp com os horários livres daqui. Sem configuração completa (horário + entrevistador com
// WhatsApp + local, se presencial) o assistente NÃO manda nada. Os entrevistadores são os gestores
// da vaga: recebem os agendamentos e respondem quando o candidato pede um horário diferente.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type JobScheduling, type MembroEquipe, type SchedulingInterviewer, type SchedulingSlot, DIAS_SEMANA, ehUsuario, faltasAgendamento } from '../shared';

const PADRAO = (jobId: string): JobScheduling => ({
  job_id: jobId, enabled: false, slots: [], blocked_dates: [], blocked_slots: [], duration_min: 30, gap_min: 0, per_slot: 1,
  min_notice_hours: 12, horizon_days: 7, format: 'presencial', location: '', interviewers: [], candidate_notes: '',
});
// Mesmos valores aceitos por hiring_interviews.format
const FORMATOS = [{ id: 'presencial', label: 'Presencial' }, { id: 'video', label: 'Online (vídeo)' }, { id: 'telefone', label: 'Telefone' }];
// WhatsApp: só números, com DDI 55 quando vier só DDD + número
const normFone = (v: string) => { const d = v.replace(/\D/g, ''); return d.length === 10 || d.length === 11 ? `55${d}` : d; };

export default function AgendamentoVaga({ jobId, defaultLocation }: { jobId: string; defaultLocation?: string | null }) {
  const [s, setS] = useState<JobScheduling | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [novaData, setNovaData] = useState('');
  const [novaIni, setNovaIni] = useState('');
  const [novaFim, setNovaFim] = useState('');
  // Quem pode ser entrevistador-usuário. Vem do banco (fn_hiring_team), NUNCA montado aqui: quando o
  // módulo for vendido e houver organização, é a função que passa a filtrar — esta tela não muda.
  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);

  useEffect(() => {
    let vivo = true;
    supabase.rpc('fn_hiring_team').then(({ data }) => { if (vivo) setEquipe((data ?? []) as MembroEquipe[]); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    let vivo = true;
    supabase.from('hiring_job_scheduling').select('*').eq('job_id', jobId).maybeSingle().then(({ data }) => {
      if (!vivo) return;
      const base = PADRAO(jobId);
      setS(data ? { ...base, ...(data as Partial<JobScheduling>) } as JobScheduling : { ...base, location: defaultLocation ?? '' });
    });
    return () => { vivo = false; };
  }, [jobId, defaultLocation]);

  if (!s) return <p className="text-xs text-zinc-400">Carregando agendamento…</p>;
  const set = <K extends keyof JobScheduling>(k: K, v: JobScheduling[K]) => setS((x) => (x ? { ...x, [k]: v } : x));
  const setSlot = (i: number, p: Partial<SchedulingSlot>) => set('slots', s.slots.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setInt = (i: number, novo: SchedulingInterviewer) => set('interviewers', s.interviewers.map((x, j) => (j === i ? novo : x)));
  const faltas = faltasAgendamento(s);
  // Data sem horário = dia inteiro (blocked_dates); com "das/até" = só aquela faixa (blocked_slots).
  const faixaInvalida = !!novaIni !== !!novaFim || (!!novaIni && novaIni >= novaFim);
  const bloquear = () => {
    if (!novaData || faixaInvalida) return;
    if (novaIni) {
      if (!s.blocked_slots.some((b) => b.date === novaData && b.start === novaIni && b.end === novaFim)) {
        set('blocked_slots', [...s.blocked_slots, { date: novaData, start: novaIni, end: novaFim }]
          .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)));
      }
    } else if (!s.blocked_dates.includes(novaData)) set('blocked_dates', [...s.blocked_dates, novaData].sort());
    setNovaData(''); setNovaIni(''); setNovaFim('');
  };

  const salvar = async () => {
    if (s.enabled && faltas.length) { setMsg({ ok: false, text: `Para ligar falta: ${faltas.join(', ')}.` }); return; }
    setSaving(true); setMsg(null);
    const row = {
      ...s,
      slots: s.slots.filter((x) => x.start && x.end && x.start < x.end),
      blocked_slots: s.blocked_slots.filter((b) => b.date && b.start && b.end && b.start < b.end),
      // Usuário sem pessoa escolhida e WhatsApp em branco saem; o jid (@lid) aprendido pelo WhatsApp fica.
      interviewers: s.interviewers
        .filter((i) => (ehUsuario(i) ? !!i.user_id : !!(i.name.trim() || i.phone.trim())))
        .map((i): SchedulingInterviewer => (ehUsuario(i)
          ? { kind: 'usuario', user_id: i.user_id, name: i.name }
          : { kind: 'whatsapp', name: i.name.trim(), phone: normFone(i.phone), ...(i.jid ? { jid: i.jid } : {}) })),
      location: (s.location ?? '').trim() || null,
      candidate_notes: (s.candidate_notes ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('hiring_job_scheduling').upsert(row, { onConflict: 'job_id' });
    setSaving(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: s.enabled ? 'Salvo. O assistente já pode chamar os candidatos desta vaga.' : 'Salvo (desligado: o assistente não chama ninguém).' });
    if (!error) setS({ ...s, ...row } as JobScheduling);
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <i className="ri-robot-2-line text-lg text-amber-600 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-bold text-zinc-800">Entrevistas pelo assistente</p>
          <p className="text-[11px] text-zinc-500">Candidato desta vaga na etapa <b>Chamar p/ entrevista</b> recebe o convite no WhatsApp com os horários livres abaixo. Pedido fora desses horários vai para os entrevistadores decidirem.</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Ligado
        </label>
      </div>

      {faltas.length > 0 && (
        <p className="text-[11px] text-amber-800 bg-amber-100 rounded-lg px-2 py-1.5">
          <i className="ri-error-warning-line" /> Enquanto faltar {faltas.join(', ')}, o assistente não manda mensagem para ninguém desta vaga.
        </p>
      )}

      <div>
        <p className={lbl}>Dias e horários disponíveis</p>
        <div className="space-y-1.5">
          {s.slots.map((sl, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select value={sl.dow} onChange={(e) => setSlot(i, { dow: Number(e.target.value) })} className={`${inp} w-24`}>
                {DIAS_SEMANA.map((d, k) => <option key={k} value={k}>{d}</option>)}
              </select>
              <input type="time" value={sl.start} onChange={(e) => setSlot(i, { start: e.target.value })} className={`${inp} w-28`} />
              <span className="text-xs text-zinc-400">até</span>
              <input type="time" value={sl.end} onChange={(e) => setSlot(i, { end: e.target.value })} className={`${inp} w-28`} />
              <button onClick={() => set('slots', s.slots.filter((_, j) => j !== i))} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer" title="Remover"><i className="ri-delete-bin-line" /></button>
            </div>
          ))}
          <button onClick={() => set('slots', [...s.slots, { dow: 2, start: '14:00', end: '17:00' }])} className={addBtn}><i className="ri-add-line" /> Adicionar dia e horário</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Num label="Duração (min)" v={s.duration_min} min={5} max={240} on={(v) => set('duration_min', v)} />
        <Num label="Intervalo (min)" v={s.gap_min} min={0} max={120} on={(v) => set('gap_min', v)} />
        <Num label="Por horário" v={s.per_slot} min={1} max={20} on={(v) => set('per_slot', v)} />
        <Num label="Antecedência (h)" v={s.min_notice_hours} min={0} max={168} on={(v) => set('min_notice_hours', v)} />
        <Num label="Oferecer até (dias)" v={s.horizon_days} min={1} max={60} on={(v) => set('horizon_days', v)} />
      </div>

      <div>
        <p className={lbl}>Datas e horários sem entrevista (feriado, folga, compromisso…)</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {s.blocked_dates.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 text-[11px] bg-white border border-zinc-200 rounded-full px-2 py-0.5">
              {d.split('-').reverse().join('/')} · dia todo
              <button onClick={() => set('blocked_dates', s.blocked_dates.filter((x) => x !== d))} className="text-zinc-400 hover:text-red-500 cursor-pointer"><i className="ri-close-line" /></button>
            </span>
          ))}
          {s.blocked_slots.map((b, i) => (
            <span key={`${b.date}-${b.start}-${b.end}`} className="inline-flex items-center gap-1 text-[11px] bg-white border border-zinc-200 rounded-full px-2 py-0.5">
              {b.date.split('-').reverse().join('/')} · {b.start}–{b.end}
              <button onClick={() => set('blocked_slots', s.blocked_slots.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-red-500 cursor-pointer"><i className="ri-close-line" /></button>
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} aria-label="Data" className={inp.replace('w-full', 'w-40')} />
          <input type="time" value={novaIni} onChange={(e) => setNovaIni(e.target.value)} aria-label="Das" className={inp.replace('w-full', 'w-28')} />
          <span className="text-xs text-zinc-400">até</span>
          <input type="time" value={novaFim} onChange={(e) => setNovaFim(e.target.value)} aria-label="Até" className={inp.replace('w-full', 'w-28')} />
          <button disabled={!novaData || faixaInvalida} onClick={bloquear} className={addBtn}>Bloquear</button>
        </div>
        <p className="mt-1 text-[10px] text-zinc-400">Sem horário, bloqueia o dia inteiro.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block">
          <span className={lbl}>Formato</span>
          <select value={s.format} onChange={(e) => set('format', e.target.value)} className={inp}>
            {FORMATOS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={lbl}>{s.format === 'video' ? 'Link da reunião' : s.format === 'telefone' ? 'Observação' : 'Local (endereço)'}</span>
          <input value={s.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder={s.format === 'presencial' ? 'Ex.: Rua João Eugênio, 711 — falar com a gerente' : ''} className={inp} />
        </label>
      </div>

      <div>
        <p className={lbl}>Entrevistadores (gestores da vaga) — recebem os agendamentos e decidem os pedidos fora do horário</p>
        <div className="space-y-1.5">
          {s.interviewers.map((it, i) => {
            const remover = (
              <button onClick={() => set('interviewers', s.interviewers.filter((_, j) => j !== i))} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer" title="Remover"><i className="ri-delete-bin-line" /></button>
            );
            if (ehUsuario(it)) {
              const membro = equipe.find((m) => m.user_id === it.user_id);
              // Quem já está marcado em outra linha não aparece de novo.
              const livres = equipe.filter((m) => m.user_id === it.user_id || !s.interviewers.some((x) => ehUsuario(x) && x.user_id === m.user_id));
              return (
                <div key={i}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-violet-50 text-violet-600" title="Usuário do ERPOS: avisado no app"><i className="ri-user-3-line" /></span>
                    <select
                      value={it.user_id}
                      onChange={(e) => {
                        const m = equipe.find((x) => x.user_id === e.target.value);
                        setInt(i, { kind: 'usuario', user_id: e.target.value, name: m?.name ?? '' });
                      }}
                      className={inp.replace('w-full', 'flex-1 min-w-0')}
                    >
                      <option value="">Escolha quem tem acesso à Contratação…</option>
                      {livres.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}{m.email && m.email !== m.name ? ` · ${m.email}` : ''}</option>)}
                    </select>
                    {remover}
                  </div>
                  {/* Sem aparelho inscrito a notificação não chega: melhor dizer agora do que no dia. */}
                  {membro && !membro.has_push && (
                    <p className="ml-10 mt-0.5 text-[11px] text-amber-700">
                      {membro.name} ainda não ativou os avisos em nenhum aparelho — peça para abrir Contratação e tocar em "Ativar avisos".
                    </p>
                  )}
                </div>
              );
            }
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600" title="Avisado pelo WhatsApp"><i className="ri-whatsapp-line" /></span>
                {/* Sem o w-full do inp: com ele o telefone ocupava a linha toda e o nome sumia. */}
                <input value={it.name} onChange={(e) => setInt(i, { ...it, name: e.target.value })} placeholder="Nome" className={inp.replace('w-full', 'flex-1 min-w-0')} />
                <input value={it.phone} onChange={(e) => setInt(i, { ...it, phone: e.target.value })} placeholder="WhatsApp com DDD" inputMode="tel" className={inp.replace('w-full', 'w-40 shrink-0')} />
                {remover}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button onClick={() => set('interviewers', [...s.interviewers, { kind: 'whatsapp', name: '', phone: '' }])} className={addBtn}><i className="ri-whatsapp-line" /> Adicionar pelo WhatsApp</button>
            <button
              onClick={() => set('interviewers', [...s.interviewers, { kind: 'usuario', user_id: '', name: '' }])}
              disabled={!equipe.length}
              title={equipe.length ? 'Pessoa do ERPOS com acesso à Contratação: recebe no app e responde pela tela' : 'Ninguém com acesso ao módulo Contratação'}
              className={addBtn}
            >
              <i className="ri-user-add-line" /> Adicionar usuário do ERPOS
            </button>
          </div>
        </div>
      </div>

      <label className="block">
        <span className={lbl}>O que o assistente deve dizer ao candidato (documentos, como chegar…)</span>
        <textarea value={s.candidate_notes ?? ''} onChange={(e) => set('candidate_notes', e.target.value)} rows={2} placeholder="Ex.: trazer carteira de trabalho; entrar pela porta lateral e perguntar pela Thati" className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:border-amber-300" />
      </label>

      <div className="flex items-center gap-2">
        {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
        <button onClick={salvar} disabled={saving} className="ml-auto px-3 h-8 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-xs font-bold cursor-pointer">
          {saving ? 'Salvando…' : 'Salvar agendamento'}
        </button>
      </div>
    </div>
  );
}

function Num({ label, v, min, max, on }: { label: string; v: number; min: number; max: number; on: (v: number) => void }) {
  return (
    <label className="block">
      <span className={lbl}>{label}</span>
      <input type="number" min={min} max={max} value={v} onChange={(e) => on(Math.min(max, Math.max(min, Number(e.target.value) || min)))} className={inp} />
    </label>
  );
}
const lbl = 'block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1';
const inp = 'w-full h-8 px-2 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:border-amber-300';
const addBtn = 'inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800 disabled:opacity-40 cursor-pointer';
