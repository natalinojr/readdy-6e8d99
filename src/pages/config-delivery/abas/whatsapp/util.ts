import { todayBrasilia, dateKeyBrasilia } from '@/lib/dateUtils';
import type { Bot, Conversa } from './tipos';

// Regras puras do grupo WhatsApp (testadas em src/test/lib/deliveryWhatsapp.test.ts).

const FUSO = 'America/Sao_Paulo';
export const PAUSA_EQUIPE_MS = 2 * 3_600_000;

/** Código curto que liga a conversa à loja (vai no texto pronto do link): PD-XXXX. */
export function novoCodigo(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return 'PD-' + s;
}

/** O assistente está pausado (equipe atendendo)? */
export function pausado(c: Pick<Conversa, 'bot_paused_until'>, agora = Date.now()): boolean {
  return !!c.bot_paused_until && new Date(c.bot_paused_until).getTime() > agora;
}

export interface ConversasAgrupadas {
  /** Abertas que pediram a equipe. */
  pedemVoce: Conversa[];
  /** Abertas que o assistente está atendendo. */
  cuidando: Conversa[];
  encerradas: Conversa[];
}

/** Separa a lista (já ordenada pela mais recente) nos três blocos da aba Conversas. */
export function agruparConversas(lista: Conversa[]): ConversasAgrupadas {
  const out: ConversasAgrupadas = { pedemVoce: [], cuidando: [], encerradas: [] };
  for (const c of lista) {
    if (c.status !== 'aberta') out.encerradas.push(c);
    else if (c.needs_human) out.pedemVoce.push(c);
    else out.cuidando.push(c);
  }
  return out;
}

/** "20:12" se for de hoje (Brasília), senão "04/10 20:12". */
export function quandoConversa(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  if (dateKeyBrasilia(d) === todayBrasilia()) return hora;
  const dia = d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
  return `${dia} ${hora}`;
}

// ── Assistente (wa_loja_bots) ──

const limpo = (s: string | null | undefined) => (s ?? '').trim() || null;

/** Texto que já vem digitado no WhatsApp. O código tem de estar nele: é ele que liga a conversa à loja. */
export function textoInicialFinal(b: Pick<Bot, 'start_text' | 'code'>): string {
  const t = limpo(b.start_text) ?? `Oi! Quero ver o cardápio (${b.code})`;
  return t.includes(b.code) ? t : `${t} (${b.code})`;
}

export type CamposAssistente = Pick<Bot, 'is_active' | 'start_text' | 'welcome' | 'extra_info' | 'forbidden' | 'voucher_code' | 'upsell' | 'notify_owner'>;

/** Os campos editáveis do assistente como vão para o banco (texto limpo, código no texto pronto, cupom em maiúsculas). */
export function camposAssistente(b: Bot): CamposAssistente {
  return {
    is_active: !!b.is_active,
    start_text: textoInicialFinal(b),
    welcome: limpo(b.welcome),
    extra_info: limpo(b.extra_info),
    forbidden: limpo(b.forbidden),
    voucher_code: limpo(b.voucher_code)?.toUpperCase() ?? null,
    upsell: !!b.upsell,
    notify_owner: !!b.notify_owner,
  };
}

/** Mudou alguma coisa em relação ao que está gravado? (compara já normalizado: espaço sobrando não conta) */
export function assistenteMudou(rascunho: Bot | null, salvo: Bot | null): boolean {
  if (!rascunho || !salvo) return false;
  return JSON.stringify(camposAssistente(rascunho)) !== JSON.stringify(camposAssistente(salvo));
}

/** Pela API da Meta a mensagem fora da janela de 24 h volta com o erro 131047. */
export function erroDe24h(texto: string): boolean {
  return /131047|24\s*(h\b|hora|hour)/i.test(texto);
}
