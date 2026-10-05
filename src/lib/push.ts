import { invokeWithAuth, supabase } from '@/lib/supabase';
import { isIOS, isStandalone } from '@/lib/pwa';
import { loginCompartilhado } from '@/pages/hoje/rotina/loginCompartilhado';

/**
 * Notificações push (Web Push). O envio fica na Edge Function `send-push`;
 * aqui só cuidamos da inscrição deste aparelho.
 */

export type EstadoPush =
  | 'nao-suportado'   // navegador sem Push API
  | 'precisa-instalar' // iOS: só funciona com o app na tela de início
  | 'negado'          // usuário bloqueou as notificações
  | 'inativo'
  | 'ativo';

export function pushSuportado(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

export async function estadoPush(): Promise<EstadoPush> {
  if (!pushSuportado()) {
    // No iPhone a API só existe depois de instalar — vale orientar em vez de dizer "sem suporte".
    return isIOS() && !isStandalone() ? 'precisa-instalar' : 'nao-suportado';
  }
  if (Notification.permission === 'denied') return 'negado';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'ativo' : 'inativo';
}

function base64UrlParaBytes(base64Url: string): Uint8Array {
  const base64 = (base64Url + '==='.slice((base64Url.length + 3) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// tenantId nulo: usuário sem loja (só módulo liberado, ex.: Contratação) — o send-push aceita.
export async function ativarPush(tenantId: string | null | undefined, uid?: string | null): Promise<{ ok: boolean; erro?: string }> {
  if (!pushSuportado()) {
    return {
      ok: false,
      erro: isIOS() && !isStandalone()
        ? 'No iPhone, instale o app na tela de início primeiro.'
        : 'Este navegador não suporta notificações.',
    };
  }

  const permissao = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permissao !== 'granted') {
    return { ok: false, erro: 'Permissão de notificação negada.' };
  }

  const { data: chave } = await invokeWithAuth<{ public_key?: string }>('send-push', {
    body: { action: 'public_key' },
  });
  if (!chave?.public_key) return { ok: false, erro: 'Servidor sem chave de push configurada.' };

  const reg = await navigator.serviceWorker.ready;
  // Reaproveita a inscrição existente; se não houver, cria uma nova.
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlParaBytes(chave.public_key),
  }));

  const { data, error } = await invokeWithAuth<{ success?: boolean; error?: string }>('send-push', {
    body: { action: 'subscribe', active_tenant_id: tenantId ?? undefined, subscription: sub.toJSON() },
  });
  if (error || !data?.success) {
    return { ok: false, erro: data?.error ?? error?.message ?? 'Falha ao registrar o aparelho.' };
  }
  // Guarda de quem é a inscrição deste aparelho (ver sincronizarPushAoEntrar).
  const dono = uid ?? (await supabase.auth.getSession().catch(() => null))?.data.session?.user?.id ?? null;
  if (dono) guardarDonoPush(dono);
  return { ok: true };
}

/* ── Aparelho compartilhado (2026-10-05) ─────────────────────────────────────
   A inscrição do navegador é do APARELHO; no servidor ela fica no nome de quem ativou
   (push_subscriptions.user_id). Num tablet da loja, o supervisor ativa os avisos e sai —
   sem limpeza, o aviso de aprovação dele (com botões Aprovar/Recusar) continuaria chegando
   para o caixa que entrou depois. Defesas: (1) sair apaga a inscrição (servidor + navegador);
   (2) entrar reatribui a inscrição que sobrou a quem entrou (ou derruba, se for login da loja);
   (3) o service worker sabe quem está logado e só mostra botões para o destinatário (`para`). */

const CHAVE_DONO = 'erpos-push-dono';

function guardarDonoPush(uid: string | null): void {
  try {
    if (uid) localStorage.setItem(CHAVE_DONO, uid);
    else localStorage.removeItem(CHAVE_DONO);
  } catch { /* sem storage */ }
}
function donoPush(): string | null {
  try { return localStorage.getItem(CHAVE_DONO); } catch { return null; }
}

/** Promessa com prazo: em dev não há service worker e o servidor pode estar lento — sair nunca trava. */
function comPrazo<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((ok) => setTimeout(() => ok(null), ms))]);
}

async function registroAtual(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try { return (await comPrazo(navigator.serviceWorker.getRegistration(), 2000)) ?? null; } catch { return null; }
}

/**
 * Diz ao service worker quem está logado (null = ninguém). O SW guarda no Cache Storage (ele reinicia
 * sozinho) e só mostra os botões Aprovar/Recusar de um aviso se `para` for essa pessoa.
 */
export async function informarUsuarioAoServiceWorker(uid: string | null): Promise<void> {
  const reg = await registroAtual();
  const sw = reg?.active ?? (typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null);
  try { sw?.postMessage({ tipo: 'ERPOS_USUARIO', uid }); } catch { /* sem SW */ }
}

/**
 * Sair: apaga a inscrição deste aparelho no servidor (ainda com o token de quem sai) e no navegador.
 * Chamar ANTES do signOut. Nunca lança; demora no máximo uns poucos segundos.
 */
export async function liberarAparelhoAoSair(): Promise<void> {
  await informarUsuarioAoServiceWorker(null);
  guardarDonoPush(null);
  if (!pushSuportado()) return;
  const reg = await registroAtual();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (!sub) return;
  await comPrazo(
    invokeWithAuth('send-push', { body: { action: 'unsubscribe', endpoint: sub.endpoint } }).catch(() => null),
    4000,
  );
  try { await sub.unsubscribe(); } catch { /* já cancelada */ }
}

/**
 * Entrar: se o aparelho já tem inscrição (permissão concedida) e ela não é de quem entrou, reatribui
 * (o subscribe faz upsert pelo endpoint, sem pedir permissão de novo). Login da loja (Caixa, Cozinha…
 * @erpos.local) não herda a inscrição de ninguém: ela é cancelada e quem quiser ativa de novo.
 */
export async function sincronizarPushAoEntrar(p: { uid: string; email: string | null | undefined; tenantId: string | null | undefined }): Promise<void> {
  await informarUsuarioAoServiceWorker(p.uid);
  if (!pushSuportado() || Notification.permission !== 'granted') return;
  if (donoPush() === p.uid) return; // já é dele
  const reg = await registroAtual();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (!sub) return;
  if (loginCompartilhado(p.email)) {
    try { await sub.unsubscribe(); } catch { /* já cancelada */ }
    guardarDonoPush(null);
    return;
  }
  await ativarPush(p.tenantId, p.uid).catch(() => null);
}

export async function desativarPush(tenantId: string | null): Promise<{ ok: boolean; erro?: string }> {
  if (!pushSuportado()) return { ok: true };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true };

  // Avisa o servidor antes de cancelar: depois do unsubscribe o endpoint some.
  await invokeWithAuth('send-push', {
    body: { action: 'unsubscribe', active_tenant_id: tenantId, endpoint: sub.endpoint },
  });
  await sub.unsubscribe();
  guardarDonoPush(null);
  return { ok: true };
}

export async function enviarPushTeste(tenantId: string | null): Promise<{ ok: boolean; erro?: string }> {
  const { data, error } = await invokeWithAuth<{ success?: boolean; enviados?: number; error?: string }>('send-push', {
    body: { action: 'test', active_tenant_id: tenantId },
  });
  if (error || !data?.success) return { ok: false, erro: data?.error ?? error?.message };
  if (!data.enviados) return { ok: false, erro: 'Nenhum aparelho registrado recebeu o teste.' };
  return { ok: true };
}
