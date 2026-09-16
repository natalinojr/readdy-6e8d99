// Notificação nativa do app Android (Capacitor) pelo Firebase Cloud Messaging — API HTTP v1.
// O aparelho se inscreve pelo mesmo `subscribe` do Web Push, com endpoint "fcm:<token>".
// Secret: FIREBASE_SERVICE_ACCOUNT = JSON da conta de serviço do projeto Firebase
// (Configurações do projeto › Contas de serviço › Gerar nova chave privada).

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cache: { token: string; exp: number } | null = null;

export function fcmConfig(): ServiceAccount | null {
  try {
    const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT') ?? '';
    if (!raw) return null;
    const sa = JSON.parse(raw);
    return sa?.project_id && sa?.client_email && sa?.private_key ? sa : null;
  } catch { return null; }
}

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Token OAuth2 da conta de serviço (JWT RS256 assinado aqui, sem biblioteca); dura 1 h.
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cache && cache.exp > Date.now() + 60_000) return cache.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.access_token) throw new Error(`Google OAuth ${r.status}: ${JSON.stringify(out).slice(0, 200)}`);
  cache = { token: out.access_token, exp: Date.now() + Number(out.expires_in ?? 3600) * 1000 };
  return cache.token;
}

/** Envia para um token do FCM. `expirada` = token não existe mais (app desinstalado). */
export async function enviarFcm(
  token: string, payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; erro?: string; expirada?: boolean }> {
  const sa = fcmConfig();
  if (!sa) return { ok: false, status: 0, erro: 'FIREBASE_SERVICE_ACCOUNT não configurado' };
  try {
    const at = await accessToken(sa);
    const titulo = String(payload.titulo ?? 'ERPOS');
    const corpo = String(payload.corpo ?? '');
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: titulo, body: corpo },
          // `url` vai nos dados: o app abre essa tela ao tocar na notificação.
          data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? '')])),
          android: { priority: 'high', notification: { tag: String(payload.tag ?? 'erpos'), channel_id: 'erpos' } },
        },
      }),
    });
    if (r.ok) return { ok: true, status: r.status };
    const txt = await r.text();
    return { ok: false, status: r.status, erro: txt.slice(0, 300), expirada: r.status === 404 || /UNREGISTERED|NOT_FOUND/.test(txt) };
  } catch (e) {
    return { ok: false, status: 0, erro: e instanceof Error ? e.message : String(e) };
  }
}
