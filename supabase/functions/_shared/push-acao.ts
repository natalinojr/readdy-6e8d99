// Token de ação do aviso no celular (2026-10-05): "Aprovar" / "Recusar" direto na notificação Web Push.
// O token vai CIFRADO no payload do push (só o aparelho da pessoa decifra) e prova, para a Edge `acao-push`,
// três coisas: quem é a pessoa (u), qual pedido (id) e qual decisão (a) — assinado com HMAC-SHA256, vale
// 15 min. Uso único na prática: o pedido deixa de estar "pendente" na primeira decisão e a Edge só decide
// pedido pendente. Sem import (Web Crypto), roda no Deno e no vitest.
//
// A chave vem de PUSH_ACAO_SECRET (se existir) ou é derivada da service role — as duas Edges (send-push que
// assina, acao-push que confere) a têm, e a service role nunca sai do servidor.

export type AcaoPush = 'aprovar' | 'recusar';
export interface CargaAcao {
  /** tipo do pedido: 'pdv' = pdv_approval_requests */
  k: 'pdv';
  /** id do pedido */
  id: string;
  /** user_id de quem recebeu o aviso (e só ele pode usar) */
  u: string;
  a: AcaoPush;
  /** expira em (segundos desde 1970) */
  exp: number;
}

export const VALIDADE_ACAO_SEG = 15 * 60;
const enc = new TextEncoder();

function b64u(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function deB64u(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Chave HMAC (separada por finalidade: a service role crua nunca assina nada). */
export async function chaveDaAcao(segredo: string): Promise<CryptoKey> {
  if (!segredo || segredo.length < 16) throw new Error('segredo da ação do push não configurado');
  const base = await crypto.subtle.digest('SHA-256', enc.encode(`erpos:push-acao:v1:${segredo}`));
  return crypto.subtle.importKey('raw', base, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function assinarAcao(carga: Omit<CargaAcao, 'exp'>, chave: CryptoKey, agoraMs = Date.now()): Promise<string> {
  const completa: CargaAcao = { ...carga, exp: Math.floor(agoraMs / 1000) + VALIDADE_ACAO_SEG };
  const corpo = b64u(enc.encode(JSON.stringify(completa)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', chave, enc.encode(`v1.${corpo}`)));
  return `v1.${corpo}.${b64u(sig)}`;
}

export type ResultadoToken = { ok: true; carga: CargaAcao } | { ok: false; motivo: 'invalido' | 'expirado' };

export async function verificarAcao(token: unknown, chave: CryptoKey, agoraMs = Date.now()): Promise<ResultadoToken> {
  const partes = typeof token === 'string' && token.length <= 1000 ? token.split('.') : [];
  if (partes.length !== 3 || partes[0] !== 'v1') return { ok: false, motivo: 'invalido' };
  try {
    // verify do Web Crypto compara em tempo constante
    const valido = await crypto.subtle.verify('HMAC', chave, deB64u(partes[2]), enc.encode(`v1.${partes[1]}`));
    if (!valido) return { ok: false, motivo: 'invalido' };
    const c = JSON.parse(new TextDecoder().decode(deB64u(partes[1]))) as Partial<CargaAcao>;
    if (c.k !== 'pdv' || typeof c.id !== 'string' || typeof c.u !== 'string' || (c.a !== 'aprovar' && c.a !== 'recusar') || typeof c.exp !== 'number') {
      return { ok: false, motivo: 'invalido' };
    }
    if (c.exp * 1000 < agoraMs) return { ok: false, motivo: 'expirado' };
    return { ok: true, carga: c as CargaAcao };
  } catch {
    return { ok: false, motivo: 'invalido' };
  }
}

// ── Regras da decisão do PDV pelo aviso ─────────────────────────────────────
/** Quem decide no PDV (as mesmas da fn_pdv_approval_decide). */
export const PAPEIS_QUE_DECIDEM_PDV = ['admin', 'manager', 'supervisor'];
/** Só desconto e cancelamento saem pelo aviso; "problema no item" pede olhar a tela. */
export const TIPOS_PDV_PELO_AVISO = ['cancelamento', 'desconto'];

export type AvaliacaoPdv = { ok: true } | { ok: false; codigo: 'sem_acesso' | 'ja_decidido' | 'so_no_app'; mensagem: string };

export function avaliarDecisaoPdv(p: {
  pedido: { status: string; tipo: string; requested_by: string | null; resolved_by_name?: string | null };
  userId: string;
  papel: string | null;
}): AvaliacaoPdv {
  if (!p.papel || !PAPEIS_QUE_DECIDEM_PDV.includes(p.papel)) return { ok: false, codigo: 'sem_acesso', mensagem: 'Você não decide pedidos desta loja.' };
  // Ninguém decide o que pediu (o aviso nem é enviado a quem pediu, mas o token não é a única barreira).
  if (p.pedido.requested_by && p.pedido.requested_by === p.userId) return { ok: false, codigo: 'sem_acesso', mensagem: 'Quem pediu não pode decidir o próprio pedido.' };
  if (p.pedido.status !== 'pendente') {
    const quem = p.pedido.resolved_by_name ? ` por ${p.pedido.resolved_by_name}` : '';
    return { ok: false, codigo: 'ja_decidido', mensagem: p.pedido.status === 'cancelado' ? 'Quem pediu desistiu do pedido.' : `Já foi ${p.pedido.status === 'aprovado' ? 'aprovado' : 'recusado'}${quem}.` };
  }
  if (!TIPOS_PDV_PELO_AVISO.includes(p.pedido.tipo)) return { ok: false, codigo: 'so_no_app', mensagem: 'Esse pedido precisa ser visto no app.' };
  return { ok: true };
}
