import { invokeWithAuth } from '@/lib/supabase';
import { isIOS, isStandalone } from '@/lib/pwa';

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

export async function ativarPush(tenantId: string): Promise<{ ok: boolean; erro?: string }> {
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
    body: { action: 'subscribe', active_tenant_id: tenantId, subscription: sub.toJSON() },
  });
  if (error || !data?.success) {
    return { ok: false, erro: data?.error ?? error?.message ?? 'Falha ao registrar o aparelho.' };
  }
  return { ok: true };
}

export async function desativarPush(tenantId: string): Promise<{ ok: boolean; erro?: string }> {
  if (!pushSuportado()) return { ok: true };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true };

  // Avisa o servidor antes de cancelar: depois do unsubscribe o endpoint some.
  await invokeWithAuth('send-push', {
    body: { action: 'unsubscribe', active_tenant_id: tenantId, endpoint: sub.endpoint },
  });
  await sub.unsubscribe();
  return { ok: true };
}

export async function enviarPushTeste(tenantId: string): Promise<{ ok: boolean; erro?: string }> {
  const { data, error } = await invokeWithAuth<{ success?: boolean; enviados?: number; error?: string }>('send-push', {
    body: { action: 'test', active_tenant_id: tenantId },
  });
  if (error || !data?.success) return { ok: false, erro: data?.error ?? error?.message };
  if (!data.enviados) return { ok: false, erro: 'Nenhum aparelho registrado recebeu o teste.' };
  return { ok: true };
}
