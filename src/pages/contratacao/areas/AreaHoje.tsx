// Área "Hoje" (RF-08): porta de entrada do módulo — 3 números, "Precisa de você", próximas
// entrevistas e vagas abertas. Monta com cards/listas que já existem no módulo (Regra nº 1):
// Kpi/Card duplicados de RelatoriosContratacao.tsx:222-234, selo de presença duplicado de
// EntrevistasDoDia.tsx:180-188, card de vaga reduzido a partir de Vagas.tsx:69-90 — nenhum dos três
// arquivos é importado (todos "nenhuma" no Mapa) nem editado.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import BotaoAvisos from '@/components/feature/BotaoAvisos';
import { DecidirPedido, type Sess } from '../components/AgendamentosPainel';
import {
  contagensHoje, formatarDiaCurto, montarPrecisaDeVoce,
  type ConversaNeedsHuman, type ItemPrecisaDeVoce, type SessaoAgendamento,
} from '../hoje';
import { type Application, type Candidate, type Company, type Interview, type Job, companyName, mergeSettings } from '../shared';

interface AgendamentoIASessao {
  id: string; candidate_id: string; job_id: string; status: string; updated_at: string;
  error: string | null; confirmed_at: string | null; confirm_requested_at: string | null; interview_id: string | null;
  pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
}
interface Props {
  interviews: Interview[]; candidates: Candidate[]; jobs: Job[]; applications: Application[]; companies: Company[];
  mostrarEmpresa: boolean; schedSessions: AgendamentoIASessao[]; tenantId: string | null | undefined;
  onOpenCandidate: (id: string) => void; onAbrirConversas: () => void; onAbrirVaga: (jobId: string) => void;
  onNewInterview: (date: string) => void; onSessaoAtualizada: () => void;
}

// Kpi/Card: mesmo componente de RelatoriosContratacao.tsx:222-234 (arquivo "nenhuma" no Mapa,
// duplicado com comentário — mesma técnica de Section em T05 e AGENDAMENTO_IA em T18).
function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="text-2xl font-black text-zinc-900 tabular-nums mt-1">{value}</p>
      {hint && <p className="text-[10px] text-zinc-400 mt-0.5">{hint}</p>}
    </div>
  );
}
function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-black uppercase tracking-wider text-zinc-500 mb-3">{titulo}</p>
      {children}
    </section>
  );
}
// Selo Confirmou/Aguardando: mesmo par de <span> de EntrevistasDoDia.tsx:180-188 (arquivo
// "nenhuma" no Mapa, protegido por teste — duplicado, não importado nem editado).
function SeloPresenca({ confirmada, pedida }: { confirmada: boolean; pedida: boolean }) {
  if (confirmada) return (
    <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200" title="Confirmou presença pelo WhatsApp">
      <i className="ri-checkbox-circle-fill" /> Confirmou
    </span>
  );
  if (pedida) return (
    <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200" title="O assistente pediu a confirmação e ainda não teve resposta">
      <i className="ri-time-line" /> Aguardando
    </span>
  );
  return null;
}

export default function AreaHoje(props: Props) {
  const { interviews, candidates, jobs, applications, companies, mostrarEmpresa, schedSessions, tenantId } = props;
  const agora = useMemo(() => new Date(), []); // 1 leitura do relógio por render; o polling de 60s do shell recalcula
  const settings = useMemo(() => mergeSettings(null), []); // dados mínimos: mesmo default do resto do módulo quando settings não é prop aqui
  const contagens = useMemo(() => contagensHoje(interviews, candidates, settings, agora), [interviews, candidates, settings, agora]);

  // needs_human: leitura própria (Decisão 3) — bot_conversations já é lida pelo módulo (LinksWhatsApp.tsx),
  // só que fora desta tela; select enxuto, mesmo padrão de polling do selo de presença (E1).
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
  const itens: ItemPrecisaDeVoce[] = useMemo(() => montarPrecisaDeVoce({
    sessoes: schedSessions as SessaoAgendamento[], candidates, jobs, conversas,
  }), [schedSessions, candidates, jobs, conversas]);

  const candNome = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  // Presença confirmada (selo): a partir de schedSessions (mesma tabela, sem 3ª leitura — Decisão 6).
  const presencaPorEntrevista = useMemo(() => {
    const m = new Map<string, { confirmada: boolean; pedida: boolean }>();
    for (const s of schedSessions) if (s.interview_id) m.set(s.interview_id, { confirmada: !!s.confirmed_at, pedida: !!s.confirm_requested_at });
    return m;
  }, [schedSessions]);
  const proximas = useMemo(() => interviews
    .filter((iv) => iv.status === 'agendada' && iv.scheduled_at >= agora.toISOString())
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, 5), [interviews, agora]);

  // Vagas abertas: mesmos dados de Vagas.tsx (jobs/applications já filtrados pela empresa no shell).
  const vagasAbertas = useMemo(() => jobs.filter((j) => j.status !== 'fechada').map((j) => {
    const apps = applications.filter((a) => a.job_id === j.id);
    const melhor = apps.filter((a) => a.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
    return { job: j, total: apps.length, melhor };
  }), [jobs, applications]);

  const semPrecisaDeVoce = itens.length === 0; // BotaoAvisos ainda pode aparecer sozinho — ver JSX abaixo

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label="Entrevistas hoje" value={contagens.entrevistasHoje}
          hint={contagens.entrevistasHoje === 0 && contagens.proximaComEntrevistas
            ? `próxima: ${formatarDiaCurto(contagens.proximaComEntrevistas.diaKey)} · ${contagens.proximaComEntrevistas.quantidade}` : undefined} />
        <Kpi label="Currículos novos" value={contagens.curriculosNovos}
          hint={contagens.curriculosComFichaIncompleta > 0 ? `${contagens.curriculosComFichaIncompleta} com ficha incompleta` : undefined} />
        <Kpi label="Entrevistas sem registro" value={contagens.entrevistasPassadasSemRegistro} />
      </div>

      {(!semPrecisaDeVoce || tenantId !== undefined) && (
        <Card titulo="Precisa de você">
          <div className="space-y-2">
            <BotaoAvisos tenantId={tenantId} titulo="Receber no celular os avisos de entrevista (agendada, confirmada, cancelada…)" />
            {semPrecisaDeVoce ? (
              <p className="text-sm text-zinc-400">Nada pendente por aqui.</p>
            ) : itens.map((item) => {
              if (item.tipo === 'aguardando_gestor') {
                const sess: Pick<Sess, 'id' | 'pending_request'> | undefined = sessoesPorId.get(item.sessionId);
                return (
                  <div key={item.sessionId} className="p-2.5 rounded-xl border border-amber-200 bg-amber-50">
                    <p className="text-xs font-bold text-amber-900">
                      <button onClick={() => props.onOpenCandidate(item.candidateId)} className="hover:underline cursor-pointer">{item.candidateName}</button>
                      {item.jobTitle ? ` · ${item.jobTitle}` : ''} pediu {item.pedidoDataHora ? new Date(item.pedidoDataHora).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : `"${item.pedidoTextoLivre ?? ''}"`}
                    </p>
                    {sess && <DecidirPedido sess={sess} onFeito={props.onSessaoAtualizada} />}
                  </div>
                );
              }
              if (item.tipo === 'needs_human') {
                return (
                  <button key={item.conversationId}
                    onClick={() => (item.candidateId ? props.onOpenCandidate(item.candidateId) : props.onAbrirConversas())}
                    className="w-full text-left flex items-center gap-2 p-2.5 rounded-xl border border-amber-200 bg-amber-50 cursor-pointer hover:bg-amber-100">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">Atenção</span>
                    <span className="text-xs font-bold text-amber-900">{item.nome} — o assistente não conseguiu seguir sozinho</span>
                  </button>
                );
              }
              return (
                <button key={item.sessionId} onClick={() => props.onOpenCandidate(item.candidateId)}
                  className="w-full text-left p-2.5 rounded-xl border border-red-200 bg-red-50 cursor-pointer hover:bg-red-100">
                  <p className="text-xs font-bold text-red-700">{item.candidateName}{item.jobTitle ? ` · ${item.jobTitle}` : ''}: {item.mensagem}</p>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <Card titulo="Próximas entrevistas">
        {proximas.length === 0 ? <p className="text-sm text-zinc-400">Nenhuma entrevista agendada.</p> : (
          <ul className="divide-y divide-zinc-100">
            {proximas.map((iv) => {
              const c = candNome.get(iv.candidate_id);
              const presenca = presencaPorEntrevista.get(iv.id);
              return (
                <li key={iv.id}>
                  <button onClick={() => props.onOpenCandidate(iv.candidate_id)} className="w-full text-left px-2 py-2.5 flex items-center gap-2 hover:bg-zinc-50 cursor-pointer">
                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-zinc-800 truncate">{c?.full_name ?? 'Candidato removido'}</span>
                      {presenca && <SeloPresenca confirmada={presenca.confirmada} pedida={presenca.pedida} />}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {new Date(iv.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {mostrarEmpresa && iv.company_id ? ` · ${companyName(companies, iv.company_id)}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card titulo="Vagas abertas">
        {vagasAbertas.length === 0 ? <p className="text-sm text-zinc-400">Nenhuma vaga aberta.</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {vagasAbertas.map(({ job, total, melhor }) => (
              <button key={job.id} onClick={() => props.onAbrirVaga(job.id)}
                className="text-left p-4 rounded-2xl border border-zinc-200 bg-white hover:border-rose-300 hover:shadow-sm transition-all cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center flex-shrink-0">
                    <i className="ri-briefcase-4-line text-lg" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-zinc-900 truncate">{job.title}</p>
                    <p className="text-xs text-zinc-500">
                      <b className="text-zinc-800">{total}</b> candidato{total === 1 ? '' : 's'}
                      {melhor && <> · melhor: <b className="text-zinc-800">{melhor.score}</b>/100</>}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
