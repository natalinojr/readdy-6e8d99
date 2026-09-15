// Aba Agendamentos: status de cada conversa do assistente com candidato (hiring_scheduling_sessions).
// Linha do tempo: Enviada → Entregue → Lida → Respondeu → Agendada → Confirmada. Mostra também quem
// está na etapa "Chamar p/ entrevista" e ainda não recebeu convite, com o motivo (vaga sem
// configuração, sem telefone, fora do horário comercial…). Os recibos (entregue/lida) vêm do WhatsApp
// pelo assistente-webhook; a conversa fica em history. Quem manda as mensagens é o hiring-scheduler.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type Candidate, type Company, type Job, type JobScheduling, type Stage, companyName, faltasAgendamento, stageByKind } from '../shared';

interface Hist { at: string; de: string; texto: string }
interface Sess {
  id: string; candidate_id: string; job_id: string; phone: string | null; status: string; code: string | null; error: string | null;
  created_at: string; updated_at: string; last_out_at: string | null; last_in_at: string | null; delivered_at: string | null; read_at: string | null;
  confirm_requested_at: string | null; confirmed_at: string | null; pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
  history: Hist[]; attempts: number;
  hiring_interviews: { scheduled_at: string; status: string } | null;
}
type Filtro = 'todos' | 'espera' | 'enviados' | 'responderam' | 'gestor' | 'agendadas' | 'confirmadas' | 'encerrados';

const TZ = 'America/Sao_Paulo';
const quando = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const quandoLongo = (s: string) => new Date(s).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Status principal (uma etiqueta) de uma conversa
function statusDe(s: Sess): { label: string; cls: string; grupo: Filtro } {
  const iv = s.hiring_interviews?.status === 'agendada' ? s.hiring_interviews : null;
  if (s.status === 'erro') return { label: `Erro: ${s.error ?? 'falhou'}`, cls: 'bg-red-50 text-red-700 border-red-200', grupo: 'encerrados' };
  if (s.status === 'recusou') return { label: 'Recusou', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', grupo: 'encerrados' };
  if (s.status === 'sem_resposta') return { label: 'Sem resposta', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', grupo: 'encerrados' };
  if (s.status === 'cancelado') return { label: 'Cancelado', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', grupo: 'encerrados' };
  if (s.status === 'agendado' && iv) {
    if (s.confirmed_at) return { label: 'Confirmada', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', grupo: 'confirmadas' };
    return { label: s.confirm_requested_at ? 'Agendada · aguardando confirmação' : 'Agendada', cls: 'bg-violet-50 text-violet-700 border-violet-200', grupo: 'agendadas' };
  }
  if (s.status === 'aguardando_gestor') return { label: 'Aguardando entrevistador', cls: 'bg-amber-50 text-amber-800 border-amber-200', grupo: 'gestor' };
  const respondeu = s.last_in_at && (!s.last_out_at || s.last_in_at > s.last_out_at);
  if (respondeu) return { label: 'Respondeu', cls: 'bg-sky-50 text-sky-700 border-sky-200', grupo: 'responderam' };
  if (s.read_at) return { label: 'Lida', cls: 'bg-blue-50 text-blue-700 border-blue-200', grupo: 'enviados' };
  if (s.delivered_at) return { label: 'Entregue', cls: 'bg-blue-50 text-blue-700 border-blue-200', grupo: 'enviados' };
  return { label: 'Enviada', cls: 'bg-blue-50 text-blue-700 border-blue-200', grupo: 'enviados' };
}

// Linha do tempo: cada passo aceso ou apagado, com a hora
function passos(s: Sess) {
  const iv = s.hiring_interviews?.status === 'agendada' ? s.hiring_interviews : null;
  return [
    { k: 'Enviada', icon: 'ri-send-plane-line', at: s.last_out_at ?? s.created_at, on: !!(s.last_out_at || s.history?.length) },
    { k: 'Entregue', icon: 'ri-check-double-line', at: s.delivered_at, on: !!s.delivered_at || !!s.read_at },
    { k: 'Lida', icon: 'ri-eye-line', at: s.read_at, on: !!s.read_at },
    { k: 'Respondeu', icon: 'ri-chat-3-line', at: s.last_in_at, on: !!s.last_in_at },
    { k: 'Agendada', icon: 'ri-calendar-check-line', at: iv?.scheduled_at ?? null, on: !!iv, showWhen: true },
    { k: 'Confirmada', icon: 'ri-shield-check-line', at: s.confirmed_at, on: !!s.confirmed_at },
  ];
}

interface Props { candidates: Candidate[]; jobs: Job[]; companies: Company[]; stages: Stage[]; mostrarEmpresa: boolean; onOpenCandidate?: (id: string) => void }

export default function AgendamentosPainel({ candidates, jobs, companies, stages, mostrarEmpresa, onOpenCandidate }: Props) {
  const [sess, setSess] = useState<Sess[]>([]);
  const [cfgs, setCfgs] = useState<JobScheduling[]>([]);
  const [apps, setApps] = useState<{ candidate_id: string; job_id: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [vaga, setVaga] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [{ data: s }, { data: c }, { data: a }] = await Promise.all([
      supabase.from('hiring_scheduling_sessions').select('*, hiring_interviews!hiring_scheduling_sessions_interview_id_fkey(scheduled_at, status)').order('updated_at', { ascending: false }).limit(500),
      supabase.from('hiring_job_scheduling').select('*'),
      supabase.from('hiring_applications').select('candidate_id, job_id, created_at'),
    ]);
    setSess((s ?? []) as unknown as Sess[]);
    setCfgs((c ?? []) as JobScheduling[]);
    setApps((a ?? []) as { candidate_id: string; job_id: string; created_at: string }[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30_000); // reserva; o normal é o tempo real abaixo
    // Tempo real: recibos, respostas e agendamentos do robô entram na hora (recarrega em lote, 300 ms).
    let espera: ReturnType<typeof setTimeout> | null = null;
    const agenda = () => { if (espera) clearTimeout(espera); espera = setTimeout(carregar, 300); };
    const ch = supabase.channel('contratacao-agendamentos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hiring_scheduling_sessions' }, agenda)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hiring_interviews' }, agenda)
      .subscribe();
    return () => { clearInterval(t); if (espera) clearTimeout(espera); supabase.removeChannel(ch); };
  }, [carregar]);

  const candBy = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const jobBy = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const cfgBy = useMemo(() => new Map(cfgs.map((c) => [c.job_id, c])), [cfgs]);

  // Na etapa "Chamar p/ entrevista" e ainda sem conversa: por que ainda não recebeu o convite?
  const espera = useMemo(() => {
    const st = stageByKind(stages, 'agendar');
    if (!st) return [];
    const comSessao = new Set(sess.map((s) => s.candidate_id));
    const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    return candidates.filter((c) => c.stage_id === st.id && !comSessao.has(c.id)).map((c) => {
      const inscr = apps.filter((a) => a.candidate_id === c.id);
      let motivo = '';
      if (!inscr.length) motivo = 'não está inscrito em nenhuma vaga';
      else {
        const configuradas = inscr.filter((a) => { const cf = cfgBy.get(a.job_id); return cf?.enabled && faltasAgendamento(cf).length === 0; });
        if (!configuradas.length) {
          const cf = cfgBy.get(inscr[0].job_id);
          motivo = !cf || !cf.enabled ? `vaga "${jobBy.get(inscr[0].job_id)?.title ?? '?'}" sem agendamento ligado` : `vaga incompleta: falta ${faltasAgendamento(cf).join(', ')}`;
        } else if ((c.phone ?? '').replace(/\D/g, '').length < 10) motivo = 'candidato sem telefone';
        else if (hora < 8 || hora >= 20) motivo = 'fora do horário comercial (sai a partir das 8h)';
        else motivo = 'na fila: sai no próximo minuto (até 10 convites por hora)';
      }
      return { c, motivo, jobId: inscr[0]?.job_id ?? null };
    });
  }, [stages, sess, candidates, apps, cfgBy, jobBy]);

  const linhas = useMemo(() => sess.filter((s) => !vaga || s.job_id === vaga).map((s) => ({ s, st: statusDe(s) })), [sess, vaga]);
  const cont = useMemo(() => {
    const m: Record<Filtro, number> = { todos: linhas.length, espera: espera.length, enviados: 0, responderam: 0, gestor: 0, agendadas: 0, confirmadas: 0, encerrados: 0 };
    for (const l of linhas) m[l.st.grupo]++;
    return m;
  }, [linhas, espera]);
  const visiveis = filtro === 'todos' ? linhas : linhas.filter((l) => l.st.grupo === filtro);
  const vagasComAgenda = jobs.filter((j) => cfgBy.get(j.id)?.enabled || sess.some((s) => s.job_id === j.id));

  const FILTROS: [Filtro, string][] = [['todos', 'Todas'], ['espera', 'Esperando convite'], ['enviados', 'Enviadas'], ['responderam', 'Responderam'], ['gestor', 'Aguardando entrevistador'], ['agendadas', 'Agendadas'], ['confirmadas', 'Confirmadas'], ['encerrados', 'Encerradas']];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-sm font-black text-zinc-900">Agendamentos pelo assistente</h2>
          <p className="text-[11px] text-zinc-500">Conversas no WhatsApp para marcar entrevista. Atualiza sozinho a cada 30 s.</p>
        </div>
        <select value={vaga} onChange={(e) => setVaga(e.target.value)} className="ml-auto h-8 px-2 rounded-lg border border-zinc-200 text-xs bg-white">
          <option value="">Todas as vagas</option>
          {vagasComAgenda.map((j) => <option key={j.id} value={j.id}>{j.title}{mostrarEmpresa ? ` · ${companyName(companies, j.company_id)}` : ''}</option>)}
        </select>
        <button onClick={carregar} className="h-8 px-2 rounded-lg border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-50 cursor-pointer" title="Atualizar"><i className="ri-refresh-line" /></button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${filtro === id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}>
            {label} <span className="opacity-70">{cont[id]}</span>
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-zinc-400 py-6 text-center">Carregando…</p> : (
        <>
          {(filtro === 'todos' || filtro === 'espera') && espera.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50">
              <p className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-amber-800 border-b border-amber-200">Na etapa "Chamar p/ entrevista" e ainda sem convite</p>
              {espera.map(({ c, motivo, jobId }) => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-2 border-b border-amber-100 last:border-0">
                  <button onClick={() => onOpenCandidate?.(c.id)} className="font-semibold text-sm text-zinc-800 hover:underline cursor-pointer text-left">{c.full_name}</button>
                  {jobId && <span className="text-[11px] text-zinc-500">{jobBy.get(jobId)?.title}</span>}
                  <span className="ml-auto text-[11px] text-amber-800">{motivo}</span>
                </div>
              ))}
            </div>
          )}

          {filtro !== 'espera' && (visiveis.length === 0 ? (
            <div className="text-center py-10 text-sm text-zinc-400">
              <i className="ri-chat-off-line text-3xl text-zinc-300" />
              <p className="mt-1">{sess.length === 0 ? 'Nenhuma conversa ainda. Coloque um candidato inscrito numa vaga configurada na etapa "Chamar p/ entrevista".' : 'Nada neste filtro.'}</p>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
              {visiveis.map(({ s, st }) => {
                const cand = candBy.get(s.candidate_id);
                const job = jobBy.get(s.job_id);
                const open = aberto === s.id;
                return (
                  <div key={s.id}>
                    <button onClick={() => setAberto(open ? null : s.id)} className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 cursor-pointer">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-zinc-900">{cand?.full_name ?? 'Candidato removido'}</span>
                        <span className="text-[11px] text-zinc-500">{job?.title ?? '—'}{mostrarEmpresa && job ? ` · ${companyName(companies, job.company_id)}` : ''}</span>
                        <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                        <i className={`ri-arrow-${open ? 'up' : 'down'}-s-line text-zinc-400`} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {passos(s).map((p, i) => (
                          <span key={p.k} className="flex items-center gap-1">
                            {i > 0 && <span className={`w-3 h-px ${p.on ? 'bg-emerald-400' : 'bg-zinc-200'}`} />}
                            <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md ${p.on ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-50 text-zinc-300'}`}
                              title={p.on && p.at ? quando(p.at) : 'ainda não'}>
                              <i className={p.icon} /> {p.k}{p.on && p.at && p.k === 'Agendada' ? ` ${quandoLongo(p.at)}` : ''}
                            </span>
                          </span>
                        ))}
                      </div>
                      {s.status === 'aguardando_gestor' && s.pending_request && (
                        <p className="mt-1 text-[11px] text-amber-800">
                          Pediu {s.pending_request.starts_at ? quandoLongo(s.pending_request.starts_at) : `"${s.pending_request.texto ?? ''}"`} — esperando entrevistador responder <b>#{s.code}</b> 1 / 2 / data
                        </p>
                      )}
                    </button>
                    {open && (
                      <div className="px-3 pb-3 bg-zinc-50/60">
                        <div className="flex flex-wrap items-center gap-2 py-2 text-[11px] text-zinc-500">
                          <span><i className="ri-whatsapp-line" /> {s.phone ?? 'sem telefone'}</span>
                          <span>· {s.attempts} tentativa(s)</span>
                          {s.code && <span>· código #{s.code}</span>}
                          {cand && onOpenCandidate && <button onClick={() => onOpenCandidate(cand.id)} className="ml-auto text-rose-600 font-semibold hover:underline cursor-pointer">Abrir candidato</button>}
                        </div>
                        <div className="space-y-1.5 max-h-80 overflow-y-auto">
                          {(s.history ?? []).length === 0 && <p className="text-xs text-zinc-400">Sem mensagens registradas.</p>}
                          {(s.history ?? []).map((h, i) => {
                            const meu = h.de === 'assistente';
                            return (
                              <div key={i} className={`flex ${meu ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] rounded-xl px-2.5 py-1.5 text-xs whitespace-pre-wrap ${meu ? 'bg-emerald-100 text-emerald-950' : h.de === 'gestor' ? 'bg-amber-100 text-amber-950' : 'bg-white border border-zinc-200 text-zinc-800'}`}>
                                  <p className="text-[9px] font-bold uppercase tracking-wider opacity-60 mb-0.5">{meu ? 'Assistente' : h.de === 'gestor' ? 'Entrevistador' : 'Candidato'} · {quando(h.at)}</p>
                                  {h.texto}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
