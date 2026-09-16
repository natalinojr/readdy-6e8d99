// @vitest-environment node
// send-push/fcm.ts (notificação nativa do app Android pelo Firebase) rodando no Node com um
// `Deno` falso: assina o JWT da conta de serviço, troca por token OAuth e manda a mensagem v1.
// Tudo com fetch simulado e uma chave RSA gerada na hora — nada sai para o Google.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import por caminho montado em tempo de execução: o tsc do app não passa a checar código Deno.
const FCM_PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/send-push/fcm.ts')).href;
type FcmModule = {
  fcmConfig: () => unknown;
  enviarFcm: (token: string, payload: Record<string, unknown>) => Promise<{ ok: boolean; status: number; erro?: string; expirada?: boolean }>;
};
const env: Record<string, string> = {};
const load = async (): Promise<FcmModule> => { vi.resetModules(); return (await import(/* @vite-ignore */ FCM_PATH)) as FcmModule; };

const b64 = (buf: ArrayBuffer) => Buffer.from(buf).toString('base64');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
let publicKey: CryptoKey;

beforeEach(async () => {
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  );
  publicKey = pair.publicKey;
  const pkcs8 = b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`;
  env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'erpos-teste', client_email: 'push@erpos-teste.iam.gserviceaccount.com', private_key: pem });
});
afterEach(() => { vi.unstubAllGlobals(); delete env.FIREBASE_SERVICE_ACCOUNT; });

function mockGoogle(fcmStatus = 200, fcmBody = '{"name":"projects/erpos-teste/messages/1"}') {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'ya29.teste', expires_in: 3600 }), { status: 200 });
    }
    if (url.startsWith('https://fcm.googleapis.com/')) return new Response(fcmBody, { status: fcmStatus });
    throw new Error(`fetch inesperado: ${url} ${String(init?.method)}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('send-push/fcm.ts', () => {
  it('sem FIREBASE_SERVICE_ACCOUNT: não configurado e não chama ninguém', async () => {
    delete env.FIREBASE_SERVICE_ACCOUNT;
    const fetchMock = mockGoogle();
    const m = await load();
    expect(m.fcmConfig()).toBeNull();
    expect(await m.enviarFcm('tok', { titulo: 'x' })).toMatchObject({ ok: false, status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('JSON inválido no secret conta como não configurado', async () => {
    env.FIREBASE_SERVICE_ACCOUNT = '{quebrado';
    expect((await load()).fcmConfig()).toBeNull();
  });

  it('assina o JWT da conta de serviço (RS256 válido) e manda a mensagem v1 certa', async () => {
    const fetchMock = mockGoogle();
    const m = await load();
    const r = await m.enviarFcm('TOKEN-DO-CELULAR', { titulo: 'Assistente', corpo: '💸 Pagamento para aprovar', url: '/assistente', tag: 'assistente-pagamento' });
    expect(r).toEqual({ ok: true, status: 200 });

    // 1) Troca do JWT por token OAuth — assinatura confere com a chave pública
    const [oauthUrl, oauthInit] = fetchMock.mock.calls[0];
    expect(oauthUrl).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(oauthInit.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h64, c64, s64] = String(form.get('assertion')).split('.');
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromB64url(s64), new TextEncoder().encode(`${h64}.${c64}`));
    expect(valid).toBe(true);
    const claims = JSON.parse(fromB64url(c64).toString());
    expect(claims).toMatchObject({ iss: 'push@erpos-teste.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token' });
    expect(claims.exp - claims.iat).toBe(3600);

    // 2) Mensagem para o FCM
    const [fcmUrl, fcmInit] = fetchMock.mock.calls[1];
    expect(fcmUrl).toBe('https://fcm.googleapis.com/v1/projects/erpos-teste/messages:send');
    expect((fcmInit.headers as Record<string, string>).Authorization).toBe('Bearer ya29.teste');
    const msg = JSON.parse(String(fcmInit.body)).message;
    expect(msg.token).toBe('TOKEN-DO-CELULAR');
    expect(msg.notification).toEqual({ title: 'Assistente', body: '💸 Pagamento para aprovar' });
    expect(msg.data.url).toBe('/assistente'); // o app abre essa tela no toque
    expect(Object.values(msg.data).every((v) => typeof v === 'string')).toBe(true); // FCM só aceita string em data
    expect(msg.android).toMatchObject({ priority: 'high', notification: { tag: 'assistente-pagamento', channel_id: 'erpos' } });
  });

  it('reaproveita o token OAuth entre envios (1 troca para 2 mensagens)', async () => {
    const fetchMock = mockGoogle();
    const m = await load();
    await m.enviarFcm('a', { titulo: '1' });
    await m.enviarFcm('b', { titulo: '2' });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('oauth2')).length).toBe(1);
  });

  it('token de aparelho que não existe mais volta como expirada (send-push apaga a inscrição)', async () => {
    mockGoogle(404, '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}');
    const r = await (await load()).enviarFcm('velho', { titulo: 'x' });
    expect(r).toMatchObject({ ok: false, status: 404, expirada: true });
  });

  it('erro temporário do FCM não marca como expirada', async () => {
    mockGoogle(503, 'unavailable');
    const r = await (await load()).enviarFcm('tok', { titulo: 'x' });
    expect(r).toMatchObject({ ok: false, status: 503, expirada: false });
  });
});
