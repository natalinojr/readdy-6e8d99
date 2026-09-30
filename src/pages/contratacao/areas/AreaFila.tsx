// Área "Minha fila" (2026-09-30) — a porta de entrada de Contratação: tudo que depende de você, na
// ordem de urgência. Cada item tem uma ação principal; resolveu, sai da lista.
//   1. Responder agora  — a IA do agendamento está esperando (pedido de horário, conversa travada, erro)
//   2. Entrevistas de hoje — "Começar entrevista" abre o modo entrevista
//   3. Registrar entrevista — passou do horário e ninguém preencheu
//   4. Decidir — entrevista registrada, falta GPC/PC/R/NA
//   5. Currículos novos — "Começar triagem"
// Ao lado: agenda dos próximos 7 dias e vagas abertas. Substitui as antigas áreas Hoje e Entrevistas.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import BotaoAvisos from '@/components/feature/BotaoAvisos';
import { DecidirPedido, type Sess } from '../components/AgendamentosPainel';
import { formatarDiaCurto, diaKeyBR, montarPrecisaDeVoce, type ConversaNeedsHuman, type ItemPrecisaDeVoce, type SessaoAgendamento } from '../hoje';
import { agendaDosProximosDias, montarFila, type EntrevistaDaFila } from '../fila';
import {
  type Application, type Candidate, type Company, type Decision, type Interview, type Job, type Stage,
  DECISIONS, companyName, withEmpresa,
} from '../shared';

export interface SessaoIA {
  id: string; candidate_id: string; job_id: string; status: string; updated_at: string;
  error: string | null; confirmed_at: string | null; confirm_requested_at: string | null; interview_id: string | null;
  pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
}

interface Props {
  interviews: Interview[];
  /** Candidatos da empresa filtrada (a fila só olha estes). */
  candidates: Candidate[];
  /** Todos os candidatos (para achar o nome em sessão/conversa de outra empresa). */
  todosCandidatos: Candidate[];
  stages: Stage[]; jobs: Job[]; applications: Application[]; companies: Company[];
  mostrarEmpresa: boolean; schedSessions: SessaoIA[]; tenantId: string | null | undefined;
  onOpenCandidate: (id: string) => void;
  /** Abre a ficha já na conversa do WhatsApp. */
  onOpenConversa: (id: string) => void;
  onAbrirEntrevista: (iv: Interview) => void;
  onTriagem: () => void;
  onDecidir: (candidateId: string, interviewId: string, decision: Decision) => void;
  onAbrirVaga: (jobId: string) => void;
  onAbrirConversasIA: () => void;
  onAgendar: () => void;
  onSessaoAtualizada: () => void;
}

const TZ = 'America/Sao_Paulo';
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const diaHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function AreaFila(props: Props) {
  const { interviews, candidates, todosCandidatos, stages, jobs, applications, companies, mostrarEmpresa, schedSessions, tenantId } = props;
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60_000); return () => clearInterval(t); }, []);
  const fila = useMemo(() => montarFila({ interviews, candidates, stages, agora }), [interviews, candidates, stages, agora]);
  const semana = useMemo(() => agendaDosProximosDias(interviews, agora), [interviews, agora]);
  const hojeKey = diaKeyBR(agora.toISOString());

  // Conversas que a IA não segue sozinha (bot_conversations.needs_human): leitura própria, a cada minuto.
  const [conversas, setConversas] = useState<ConversaNeedsHuman[]>([]);
  useEffect(() => {
    let vivo = true;
    const carregar = () => {
      supabase.from('bot_conversations').select('id, contact_name, contact_phone, candidate_ids, last_message_at')
        .eq('needs_human', true).order('last_message_at', { ascending: false }).limit(50)
        .then(({ data }) => { if (vivo) setConversas((data ?? []) as ConversaNeedsHuman[]); });
    };
    carregar();
    const t = setInterval(() => { if (!document.hidden) carregar(); }, 60000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  const sessoesPorId = useMemo(() => new Map(schedSessions.map((s) => [s.id, s])), [schedSessions]);
  const agoraItens: ItemPrecisaDeVoce[] = useMemo(() => montarPrecisaDeVoce({
    sessoes: schedSessions as SessaoAgendamento[], candidates: todosCandidatos, jobs, conversas,
  }), [schedSessions, todosCandidatos, jobs, conversas]);

  const presenca = useMemo(() => {
    const m = new Map<string, { confirmada: boolean; pedida: boolean }>();
    for (const s of schedSessions) if (s.interview_id) m.set(s.interview_id, { confirmada: !!s.confirmed_at, pedida: !!s.confirm_requested_at });
    return m;
  }, [schedSessions]);
  const vagaDe = useMemo(() => {
    const titulo = new Map(jobs.map((j) => [j.id, j.title]));
    const m = new Map<string, string>();
    for (const a of applications) { const t = titulo.get(a.job_id); if (t && !m.has(a.candidate_id)) m.set(a.candidate_id, t); }
    return m;
  }, [applications, jobs]);
  const empresaDe = (c: Candidate) => (mostrarEmpresa && c.company_id ? companyName(companies, c.company_id) : null);
  const contexto = (c: Candidate) => [vagaDe.get(c.id), empresaDe(c)].filter(Boolean).join(' · ');

  const total = agoraItens.length + fila.hoje.length + fila.registrar.length + fila.decidir.length + fila.triar.length;
  const vagasAbertas = jobs.filter((j) => j.status !== 'fechada');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-4 items-start">
      <div className="space-y-4 min-w-0">
        <div>
          <h2 className="text-lg font-black text-zinc-900">{total ? `${total} ${total === 1 ? 'coisa' : 'coisas'} para fazer` : 'Tudo em dia'}</h2>
          <p className="text-xs text-zinc-500">Tudo que depende de você, na ordem de urgência. Resolveu, sai da lista.</p>
        </div>

        {agoraItens.length > 0 && (
          <Grupo icone="ri-flashlight-line text-rose-600" titulo="Responder agora" sub="a IA do agendamento está esperando você" n={agoraItens.length}>
            {agoraItens.map((item) => {
              if (item.tipo === 'aguardando_gestor') {
                const sess: Pick<Sess, 'id' | 'pending_request'> | undefined = sessoesPorId.get(item.sessionId);
                return (
                  <div key={item.sessionId} className="px-4 py-3">
                    <Pessoa nome={item.candidateName} sub={`${item.jobTitle ?? 'Sem vaga'} · pediu ${item.pedidoDataHora ? diaHora(item.pedidoDataHora) : `"${item.pedidoTextoLivre ?? ''}"`}`}
                      onClick={() => props.onOpenCandidate(item.candidateId)} />
                    {sess && <DecidirPedido sess={sess} onFeito={props.onSessaoAtualizada} />}
                  </div>
                );
              }
              if (item.tipo === 'needs_human') {
                return (
                  <Linha key={item.conversationId}>
                    <Pessoa nome={item.nome} sub="O assistente não conseguiu seguir sozinho na conversa"
                      onClick={() => (item.candidateId ? props.onOpenConversa(item.candidateId) : props.onAbrirConversasIA())} />
                    <Botao pri onClick={() => (item.candidateId ? props.onOpenConversa(item.candidateId) : props.onAbrirConversasIA())}>Ver conversa</Botao>
                  </Linha>
                );
              }
              return (
                <Linha key={item.sessionId}>
                  <Pessoa nome={item.candidateName} sub={`${item.jobTitle ?? 'Sem vaga'} · ${item.mensagem}`} erro onClick={() => props.onOpenCandidate(item.candidateId)} />
                  <Botao onClick={() => props.onOpenCandidate(item.candidateId)}>Abrir ficha</Botao>
                </Linha>
              );
            })}
          </Grupo>
        )}

        {fila.hoje.length > 0 && (
          <Grupo icone="ri-calendar-event-line text-violet-600" titulo="Entrevistas de hoje" n={fila.hoje.length}>
            {fila.hoje.map(({ iv, c }) => {
              const p = presenca.get(iv.id);
              return (
                <Linha key={iv.id}>
                  <Pessoa nome={c.full_name} onClick={() => props.onOpenCandidate(c.id)}
                    sub={<>{hora(iv.scheduled_at)}{contexto(c) ? ` · ${contexto(c)}` : ''}
                      {p?.confirmada ? <span className="text-emerald-700 font-semibold"> · <i className="ri-checkbox-circle-fill" /> confirmou</span>
                        : p?.pedida ? <span className="text-amber-700"> · aguardando confirmação</span> : null}</>} />
                  <Botao pri onClick={() => props.onAbrirEntrevista(iv)}><i className="ri-play-fill" /> Começar entrevista</Botao>
                </Linha>
              );
            })}
          </Grupo>
        )}

        {fila.registrar.length > 0 && (
          <Grupo icone="ri-edit-2-line text-amber-600" titulo="Registrar entrevista" sub="já passou do horário e ninguém preencheu" n={fila.registrar.length}>
            {fila.registrar.map(({ iv, c }) => (
              <Linha key={iv.id}>
                <Pessoa nome={c.full_name} onClick={() => props.onOpenCandidate(c.id)}
                  sub={`${diaKeyBR(iv.scheduled_at) === hojeKey ? `hoje, ${hora(iv.scheduled_at)}` : diaHora(iv.scheduled_at)}${contexto(c) ? ` · ${contexto(c)}` : ''}`} />
                <Botao pri onClick={() => props.onAbrirEntrevista(iv)}>Preencher registro</Botao>
              </Linha>
            ))}
          </Grupo>
        )}

        {fila.decidir.length > 0 && (
          <Grupo icone="ri-scales-3-line text-sky-600" titulo="Decidir" sub="entrevista registrada, falta a decisão" n={fila.decidir.length}>
            {fila.decidir.map((x: EntrevistaDaFila) => (
              <Linha key={x.iv.id}>
                <Pessoa nome={x.c.full_name} onClick={() => props.onOpenCandidate(x.c.id)}
                  sub={<>entrevista {diaHora(x.iv.scheduled_at)}{contexto(x.c) ? ` · ${contexto(x.c)}` : ''} · <button onClick={() => props.onAbrirEntrevista(x.iv)} className="text-violet-700 font-semibold hover:underline cursor-pointer">ver registro</button></>} />
                <div className="flex gap-1 w-full sm:w-auto">
                  {DECISIONS.map((d) => (
                    <button key={d.id} title={withEmpresa(d.label, x.c.company_id ? companyName(companies, x.c.company_id) : '')}
                      onClick={() => props.onDecidir(x.c.id, x.iv.id, d.id)}
                      className="flex-1 sm:flex-none px-3 h-9 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-900 hover:text-white hover:border-zinc-900 text-xs font-black cursor-pointer">
                      {d.sigla}
                    </button>
                  ))}
                </div>
              </Linha>
            ))}
          </Grupo>
        )}

        {fila.triar.length > 0 && (
          <Grupo icone="ri-inbox-2-line text-zinc-600" titulo="Currículos novos" n={fila.triar.length}>
            <div className="px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="flex -space-x-2">
                {fila.triar.slice(0, 5).map((c) => (
                  <span key={c.id} className="w-9 h-9 rounded-full bg-rose-100 text-rose-700 text-xs font-black flex items-center justify-center ring-2 ring-white">
                    {(c.full_name || '?').charAt(0).toUpperCase()}
                  </span>
                ))}
              </div>
              <p className="flex-1 min-w-[180px] text-sm text-zinc-600">
                {fila.triar.length === 1 ? '1 currículo esperando' : `${fila.triar.length} currículos esperando`}. Olhe um por vez e decida: chamar, guardar ou descartar.
              </p>
              <button onClick={props.onTriagem} className="px-4 h-10 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-bold cursor-pointer">
                <i className="ri-play-fill" /> Começar triagem
              </button>
            </div>
          </Grupo>
        )}

        {total === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-400">
            <i className="ri-checkbox-circle-line text-3xl text-emerald-500" />
            <p className="mt-1">Nada pendente. A IA segue agendando sozinha.</p>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <BotaoAvisos tenantId={tenantId} titulo="Receber no celular os avisos de entrevista (agendada, confirmada, cancelada…)" />
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex items-center mb-2">
            <p className="flex-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Próximos 7 dias</p>
            <button onClick={props.onAgendar} className="text-xs font-bold text-violet-700 cursor-pointer"><i className="ri-add-line" /> Agendar</button>
          </div>
          {semana.length === 0 ? <p className="text-sm text-zinc-400">Nenhuma entrevista marcada.</p> : (
            <div className="divide-y divide-zinc-100">
              {semana.map(({ diaKey, itens }) => (
                <div key={diaKey} className="flex gap-3 py-2">
                  <span className="w-16 text-xs font-bold text-zinc-500 capitalize">{diaKey === hojeKey ? 'Hoje' : formatarDiaCurto(diaKey)}</span>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    {itens.map((iv) => {
                      const c = todosCandidatos.find((x) => x.id === iv.candidate_id);
                      return (
                        <button key={iv.id} onClick={() => props.onOpenCandidate(iv.candidate_id)} className="block w-full text-left text-sm text-zinc-800 truncate hover:text-violet-700 cursor-pointer">
                          <b className="tabular-nums">{hora(iv.scheduled_at)}</b> · {c?.full_name ?? 'Candidato removido'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Vagas abertas</p>
          {vagasAbertas.length === 0 ? <p className="text-sm text-zinc-400">Nenhuma vaga aberta.</p> : vagasAbertas.map((j) => {
            const n = applications.filter((a) => a.job_id === j.id).length;
            return (
              <button key={j.id} onClick={() => props.onAbrirVaga(j.id)} className="w-full flex items-center gap-2 py-1.5 text-left hover:text-violet-700 cursor-pointer">
                <span className="flex-1 min-w-0 text-sm font-semibold truncate">{j.title}{mostrarEmpresa && j.company_id ? <span className="font-normal text-zinc-400"> · {companyName(companies, j.company_id)}</span> : null}</span>
                <span className="text-xs text-zinc-400">{n} pessoa{n === 1 ? '' : 's'}</span>
                <i className="ri-arrow-right-s-line text-zinc-300" />
              </button>
            );
          })}
        </section>
      </aside>
    </div>
  );
}

function Grupo({ icone, titulo, sub, n, children }: { icone: string; titulo: string; sub?: string; n: number; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-zinc-100">
        <i className={icone} />
        <h3 className="text-sm font-bold text-zinc-900">{titulo}</h3>
        <span className="text-xs text-zinc-400 truncate">{n}{sub ? ` · ${sub}` : ''}</span>
      </div>
      <div className="divide-y divide-zinc-100">{children}</div>
    </section>
  );
}
function Linha({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3">{children}</div>;
}
function Pessoa({ nome, sub, onClick, erro }: { nome: string; sub: React.ReactNode; onClick: () => void; erro?: boolean }) {
  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <span className={`w-9 h-9 rounded-full ${erro ? 'bg-red-100 text-red-700' : 'bg-violet-100 text-violet-700'} text-sm font-black flex items-center justify-center flex-shrink-0`}>
        {(nome || '?').charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0">
        <button onClick={onClick} className="block text-sm font-semibold text-zinc-900 truncate hover:text-violet-700 text-left cursor-pointer">{nome}</button>
        <span className={`block text-xs truncate ${erro ? 'text-red-600' : 'text-zinc-500'}`}>{sub}</span>
      </span>
    </div>
  );
}
function Botao({ children, onClick, pri }: { children: React.ReactNode; onClick: () => void; pri?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-full sm:w-auto px-3 h-9 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${pri ? 'bg-violet-600 hover:bg-violet-500 text-white' : 'border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700'}`}>
      {children}
    </button>
  );
}
