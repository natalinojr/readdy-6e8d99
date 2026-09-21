// Tela Hoje de Contratação (RF-08): os 3 números e a montagem de "Precisa de você". Lógica pura —
// recebe os dados já carregados pelo shell/AreaHoje, nunca faz query, nunca importa page.tsx (evita
// ciclo, mesma regra de aderencia.ts/navegacao.ts). Datas em horário de Brasília (AGENTS.md linha 75:
// corte por dia nunca em UTC cru) — fuso fixo, não depende da máquina que roda o código/teste.
import { type Candidate, type FichaCfg, type Interview, type Job, faltasFicha } from './shared';

const TZ = 'America/Sao_Paulo';

/** Chave AAAA-MM-DD do dia, em horário de Brasília, a partir de um ISO qualquer. */
export function diaKeyBR(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/**
 * "seg 21/09" — mesmo formato da tira de dias de EntrevistasDoDia.tsx (dia às 12h locais só para
 * achar o nome da semana; a chave em si já veio de diaKeyBR, então não precisa de TZ aqui de novo).
 */
export function formatarDiaCurto(diaKey: string): string {
  const [, m, d] = diaKey.split('-');
  const semana = new Date(`${diaKey}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: TZ }).replace('.', '');
  return `${semana} ${d}/${m}`;
}

export interface ProximoDiaComEntrevistas { diaKey: string; quantidade: number }

/**
 * 1º dia estritamente depois de `apartirDe` (Brasília) com pelo menos 1 entrevista não cancelada.
 * RF-05 (dia vazio: "Ir para a próxima: seg 21/09 · 7 entrevistas") e RF-08 (3º número, mesma conta).
 */
export function proximoDiaComEntrevistas(interviews: Interview[], apartirDe: Date): ProximoDiaComEntrevistas | null {
  const hojeKey = diaKeyBR(apartirDe.toISOString());
  const porDia = new Map<string, number>();
  for (const iv of interviews) {
    if (iv.status === 'cancelada') continue;
    const k = diaKeyBR(iv.scheduled_at);
    if (k <= hojeKey) continue; // só estritamente depois de hoje
    porDia.set(k, (porDia.get(k) ?? 0) + 1);
  }
  const diaKey = [...porDia.keys()].sort()[0];
  return diaKey ? { diaKey, quantidade: porDia.get(diaKey)! } : null;
}

export interface ContagensHoje {
  entrevistasHoje: number;
  /** Só preenchido quando entrevistasHoje === 0 (RF-08: o atalho só faz sentido em dia vazio). */
  proximaComEntrevistas: ProximoDiaComEntrevistas | null;
  curriculosNovos: number;
  curriculosComFichaIncompleta: number;
  entrevistasPassadasSemRegistro: number;
}

/**
 * Os 3 números da tela Hoje (RF-08). `agora` é injetado (nunca `new Date()` interno) para o teste
 * fixar a virada de dia sem depender do relógio de quem roda o teste.
 */
export function contagensHoje(interviews: Interview[], candidates: Candidate[], ficha: FichaCfg, agora: Date): ContagensHoje {
  const hojeKey = diaKeyBR(agora.toISOString());
  const agoraIso = agora.toISOString();
  const entrevistasDeHoje = interviews.filter((iv) => iv.status !== 'cancelada' && diaKeyBR(iv.scheduled_at) === hojeKey);
  const curriculosDeHoje = candidates.filter((c) => diaKeyBR(c.created_at) === hojeKey);
  return {
    entrevistasHoje: entrevistasDeHoje.length,
    proximaComEntrevistas: entrevistasDeHoje.length === 0 ? proximoDiaComEntrevistas(interviews, agora) : null,
    curriculosNovos: curriculosDeHoje.length,
    curriculosComFichaIncompleta: curriculosDeHoje.filter((c) => faltasFicha(c, ficha).length > 0).length,
    // "agendada" e o horário já passou: ninguém marcou realizada/faltou/cancelada.
    entrevistasPassadasSemRegistro: interviews.filter((iv) => iv.status === 'agendada' && iv.scheduled_at < agoraIso).length,
  };
}

// ── "Precisa de você" (RF-08) ───────────────────────────────────────────────
// Tipos estruturais próprios (não importados de page.tsx/AgendamentosPainel.tsx/LinksWhatsApp.tsx —
// evita ciclo e evita este módulo depender do shell). Colunas confirmadas em
// supabase/migrations/20260914210000_hiring_agendamento_assistente.sql:30-46 (hiring_scheduling_sessions)
// e em LinksWhatsApp.tsx:27-41 (Conversation, bot_conversations) — nenhuma tabela nova (Constraint 8).
export interface SessaoAgendamento {
  id: string;
  candidate_id: string;
  job_id: string;
  status: string;
  error: string | null;
  pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
  updated_at: string;
}
export interface ConversaNeedsHuman {
  id: string;
  contact_name: string | null;
  contact_phone: string | null;
  candidate_ids: string[];
  last_message_at: string;
}

export type TipoPrecisaDeVoce = 'aguardando_gestor' | 'needs_human' | 'erro';
export interface ItemAguardandoGestor {
  tipo: 'aguardando_gestor';
  sessionId: string;
  candidateId: string;
  candidateName: string;
  jobTitle: string | null;
  /** Mutuamente exclusivos: o candidato disse data/hora exata, ou só um texto livre. Formatar para
   * exibição é decisão de quem renderiza (AreaHoje.tsx), não desta função. */
  pedidoDataHora: string | null;
  pedidoTextoLivre: string | null;
}
export interface ItemNeedsHuman {
  tipo: 'needs_human';
  conversationId: string;
  nome: string;
  /** 1º candidato vinculado à conversa, para abrir a ficha; null = conversa sem candidato ainda. */
  candidateId: string | null;
  atualizadoEm: string;
}
export interface ItemErro {
  tipo: 'erro';
  sessionId: string;
  candidateId: string;
  candidateName: string;
  jobTitle: string | null;
  mensagem: string;
}
export type ItemPrecisaDeVoce = ItemAguardandoGestor | ItemNeedsHuman | ItemErro;

const CANDIDATO_REMOVIDO = 'Candidato removido'; // mesmo texto de AgendamentosPainel.tsx

/**
 * Monta "Precisa de você" (RF-08) a partir dos dados já carregados — nenhuma query aqui. Ordem:
 * pedidos de horário (aguardando_gestor) → conversas que a IA não segue sozinha (needs_human) →
 * convites/agendamentos com erro; dentro de cada grupo, mais recente primeiro. O aviso de
 * notificações (BotaoAvisos) NÃO entra aqui — é componente à parte que já esconde a si mesmo
 * quando não há nada a fazer; quem chama (AreaHoje.tsx) o renderiza ao lado desta lista.
 */
export function montarPrecisaDeVoce(input: {
  sessoes: SessaoAgendamento[];
  candidates: Candidate[];
  jobs: Job[];
  conversas: ConversaNeedsHuman[];
}): ItemPrecisaDeVoce[] {
  const { sessoes, candidates, jobs, conversas } = input;
  const candNome = new Map(candidates.map((c) => [c.id, c.full_name]));
  const jobTitulo = new Map(jobs.map((j) => [j.id, j.title]));

  const aguardando: ItemAguardandoGestor[] = sessoes
    .filter((s) => s.status === 'aguardando_gestor')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((s) => ({
      tipo: 'aguardando_gestor' as const,
      sessionId: s.id,
      candidateId: s.candidate_id,
      candidateName: candNome.get(s.candidate_id) ?? CANDIDATO_REMOVIDO,
      jobTitle: jobTitulo.get(s.job_id) ?? null,
      pedidoDataHora: s.pending_request?.starts_at ?? null,
      pedidoTextoLivre: s.pending_request?.starts_at ? null : (s.pending_request?.texto ?? ''),
    }));

  const precisamDeHumano: ItemNeedsHuman[] = conversas
    .slice()
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
    .map((c) => ({
      tipo: 'needs_human' as const,
      conversationId: c.id,
      nome: c.contact_name || c.contact_phone || 'Sem nome',
      candidateId: c.candidate_ids[0] ?? null,
      atualizadoEm: c.last_message_at,
    }));

  const comErro: ItemErro[] = sessoes
    .filter((s) => s.status === 'erro')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((s) => ({
      tipo: 'erro' as const,
      sessionId: s.id,
      candidateId: s.candidate_id,
      candidateName: candNome.get(s.candidate_id) ?? CANDIDATO_REMOVIDO,
      jobTitle: jobTitulo.get(s.job_id) ?? null,
      mensagem: s.error ?? 'Falhou ao enviar.',
    }));

  return [...aguardando, ...precisamDeHumano, ...comErro];
}
