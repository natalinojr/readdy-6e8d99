// Aparelho compartilhado (2026-10-05): sair apaga a inscrição de push; entrar reatribui a quem entrou, e o
// login da loja (Caixa @erpos.local) não herda a inscrição de ninguém.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ invoke: vi.fn(), uid: 'supervisor' as string | null }));
vi.mock('@/lib/supabase', () => ({
  invokeWithAuth: h.invoke,
  supabase: { auth: { getSession: async () => ({ data: { session: h.uid ? { user: { id: h.uid } } : null } }) } },
}));
vi.mock('@/lib/pwa', () => ({ isIOS: () => false, isStandalone: () => false }));

import { liberarAparelhoAoSair, sincronizarPushAoEntrar } from '@/lib/push';

let sub: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn>; toJSON: () => unknown } | null;
const postMessage = vi.fn();

beforeEach(() => {
  localStorage.clear();
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (_fn: string, o: { body: { action: string } }) =>
    ({ data: o.body.action === 'public_key' ? { public_key: 'AAAA' } : { success: true }, error: null }));
  postMessage.mockReset();
  sub = { endpoint: 'https://push.example/abc', unsubscribe: vi.fn(async () => { sub = null; return true; }), toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }) };
  const reg = { active: { postMessage }, pushManager: { getSubscription: async () => sub, subscribe: vi.fn() } };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => reg, ready: Promise.resolve(reg), controller: null } });
  (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  (globalThis as unknown as { Notification: unknown }).Notification = { permission: 'granted', requestPermission: vi.fn() };
});
afterEach(() => {
  delete (window as unknown as { PushManager?: unknown }).PushManager;
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
});

const acoes = () => h.invoke.mock.calls.map((c) => (c[1] as { body: { action: string } }).body.action);

describe('push num aparelho compartilhado', () => {
  it('sair apaga a inscrição no servidor (com o token de quem sai) e no navegador, e avisa o service worker', async () => {
    const s = sub!;
    await liberarAparelhoAoSair();
    expect(acoes()).toEqual(['unsubscribe']);
    expect(h.invoke.mock.calls[0][1]).toMatchObject({ body: { action: 'unsubscribe', endpoint: 'https://push.example/abc' } });
    expect(s.unsubscribe).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ tipo: 'ERPOS_USUARIO', uid: null });
  });

  it('entrar com inscrição que sobrou de outra pessoa: reatribui a quem entrou (upsert pelo endpoint)', async () => {
    localStorage.setItem('erpos-push-dono', 'supervisor');
    await sincronizarPushAoEntrar({ uid: 'gerente', email: 'gerente@loja.com', tenantId: 't1' });
    expect(acoes()).toEqual(['public_key', 'subscribe']);
    expect(postMessage).toHaveBeenCalledWith({ tipo: 'ERPOS_USUARIO', uid: 'gerente' });
    expect(localStorage.getItem('erpos-push-dono')).toBe('gerente');
  });

  it('login da loja (Caixa) não herda a inscrição: ela é cancelada, sem registrar no nome do caixa', async () => {
    localStorage.setItem('erpos-push-dono', 'supervisor');
    const s = sub!;
    await sincronizarPushAoEntrar({ uid: 'caixa', email: 'caixa.paranagua@erpos.local', tenantId: 't1' });
    expect(acoes()).toEqual([]);
    expect(s.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem('erpos-push-dono')).toBeNull();
  });

  it('a inscrição já é de quem entrou: não faz nada além de avisar o service worker', async () => {
    localStorage.setItem('erpos-push-dono', 'caixa');
    const s = sub!;
    await sincronizarPushAoEntrar({ uid: 'caixa', email: 'caixa.paranagua@erpos.local', tenantId: 't1' });
    expect(acoes()).toEqual([]);
    expect(s.unsubscribe).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ tipo: 'ERPOS_USUARIO', uid: 'caixa' });
  });

  it('sem permissão concedida não reinscreve nem pede permissão', async () => {
    (globalThis as unknown as { Notification: { permission: string } }).Notification.permission = 'default';
    await sincronizarPushAoEntrar({ uid: 'gerente', email: 'g@loja.com', tenantId: 't1' });
    expect(acoes()).toEqual([]);
  });
});
