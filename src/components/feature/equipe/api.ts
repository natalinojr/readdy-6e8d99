// Conversa entre pessoas da mesma loja (2026-09-23). Tudo que grava passa pela Edge chat-equipe;
// as mensagens novas chegam pelo Realtime (chat_messages, RLS por participante).
import { invokeWithAuth } from '@/lib/supabase';

export interface PessoaEquipe { id: string; nome: string; foto: string | null; papel?: string }
export interface ConversaResumo {
  thread_id: string;
  /** Loja da conversa: o mesmo par de pessoas tem uma conversa em cada loja (2026-09-24). */
  tenant_id?: string;
  loja: string;
  pessoa: PessoaEquipe | null;
  lido_pelo_outro: number;
  /** Até onde chegou no aparelho da outra pessoa (✓✓ cinza). */
  entregue_ao_outro?: number;
  nao_lidas: number;
  ultima: { id: number; minha: boolean; texto: string; created_at: string } | null;
  quando: string;
}
export interface CitacaoEquipe { id: number; sender_id: string; body: string }
export interface MensagemEquipe {
  id: number; sender_id: string; body: string; created_at: string;
  /** Resposta a uma mensagem (como no WhatsApp): o id e a citação. */
  reply_to_id?: number | null; resposta?: CitacaoEquipe | null;
  temp?: boolean; falhou?: boolean;
}

export async function chatEquipe<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await invokeWithAuth<{ success?: boolean; data?: T; error?: string }>('chat-equipe', { body: { action, ...extra } });
  if (data?.success) return data.data as T;
  throw new Error(data?.error ?? error?.message ?? 'Não foi possível falar com o servidor.');
}

/** Conversas de Tarefas (2026-09-24): sem loja — com quem divide pasta ou tarefa comigo. A Edge usa
 * este valor no lugar do tenant_id (a conversa fica com tenant_id nulo no banco). */
export const ESCOPO_TAREFAS = 'tarefas';

/** Evento de janela: mensagem nova chegou pelo Realtime (a conversa aberta escuta). */
export const EVENTO_MSG_EQUIPE = 'erpos:chat-equipe-msg';
/** Evento de janela: a outra pessoa recebeu/leu (linha de chat_participants pelo Realtime). */
export const EVENTO_VISTO_EQUIPE = 'erpos:chat-equipe-visto';
/** Evento de janela: abrir uma conversa (vem do link do aviso no celular). */
export const EVENTO_ABRIR_EQUIPE = 'erpos:chat-equipe-abrir';

export const iniciais = (nome: string) =>
  nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

export function horaCurta(iso: string): string {
  const d = new Date(iso);
  const tz = 'America/Sao_Paulo';
  const dia = (x: Date) => x.toLocaleDateString('pt-BR', { timeZone: tz });
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  if (dia(d) === dia(hoje)) return d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  if (dia(d) === dia(ontem)) return 'ontem';
  return d.toLocaleDateString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' });
}
