// Conversa entre pessoas da mesma loja (2026-09-23). Tudo que grava passa pela Edge chat-equipe;
// as mensagens novas chegam pelo Realtime (chat_messages, RLS por participante).
import { invokeWithAuth } from '@/lib/supabase';

export interface PessoaEquipe { id: string; nome: string; foto: string | null; papel?: string }
export interface ConversaResumo {
  thread_id: string;
  loja: string;
  pessoa: PessoaEquipe | null;
  lido_pelo_outro: number;
  nao_lidas: number;
  ultima: { id: number; minha: boolean; texto: string; created_at: string } | null;
  quando: string;
}
export interface MensagemEquipe { id: number; sender_id: string; body: string; created_at: string; temp?: boolean; falhou?: boolean }

export async function chatEquipe<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await invokeWithAuth<{ success?: boolean; data?: T; error?: string }>('chat-equipe', { body: { action, ...extra } });
  if (data?.success) return data.data as T;
  throw new Error(data?.error ?? error?.message ?? 'Não foi possível falar com o servidor.');
}

/** Evento de janela: mensagem nova chegou pelo Realtime (a conversa aberta escuta). */
export const EVENTO_MSG_EQUIPE = 'erpos:chat-equipe-msg';
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
