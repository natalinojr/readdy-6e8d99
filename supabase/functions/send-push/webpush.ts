/**
 * Web Push (RFC 8291 — criptografia aes128gcm; RFC 8292 — VAPID) sobre Web Crypto.
 *
 * Escrito à mão de propósito: as libs de push do npm dependem de módulos Node
 * (https, crypto) cuja compatibilidade no Deno das Edge Functions é instável.
 * Aqui só se usa Web Crypto, que é nativo.
 */

const enc = new TextEncoder();

export interface Subscription {
  endpoint: string;
  p256dh: string; // chave pública do navegador (P-256 sem compressão, base64url)
  auth: string;   // segredo de autenticação (16 bytes, base64url)
}

// ── base64url ────────────────────────────────────────────────────────────
export function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64u(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ── HKDF (SHA-256) ───────────────────────────────────────────────────────
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** Extract + Expand. `length` sempre <= 32 aqui, então basta 1 bloco. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

// ── Criptografia do payload (RFC 8291) ───────────────────────────────────
async function encryptPayload(sub: Subscription, payload: string): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(sub.p256dh);
  const authSecret = b64uToBytes(sub.auth);

  // Par efêmero do servidor de aplicação
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, par.privateKey, 256),
  );

  // IKM combina o segredo ECDH com o auth_secret e as duas chaves públicas
  const keyInfo = concat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  // 0x02 = delimitador de "último registro" (RFC 8188)
  const plaintext = concat(enc.encode(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext),
  );

  // Cabeçalho: salt | tamanho do registro | tamanho da chave | chave pública
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// ── VAPID (RFC 8292) ─────────────────────────────────────────────────────
async function vapidHeader(endpoint: string, publicKey: string, privateKey: string, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const assinar = `${header}.${claims}`;

  // Monta o JWK a partir do par de chaves guardado nos secrets
  const pubBytes = b64uToBytes(publicKey);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKey,
    x: bytesToB64u(pubBytes.slice(1, 33)),
    y: bytesToB64u(pubBytes.slice(33, 65)),
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // ECDSA no Web Crypto já devolve r||s cru, que é o formato do JWS
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(assinar)),
  );

  return `vapid t=${assinar}.${bytesToB64u(sig)}, k=${publicKey}`;
}

export interface ResultadoEnvio {
  ok: boolean;
  status: number;
  /** true quando a assinatura morreu (404/410) e deve ser apagada. */
  expirada: boolean;
  erro?: string;
}

export async function enviarPush(
  sub: Subscription,
  payload: string,
  vapid: { publicKey: string; privateKey: string; subject: string },
  ttl = 86400,
): Promise<ResultadoEnvio> {
  try {
    const corpo = await encryptPayload(sub, payload);
    const auth = await vapidHeader(sub.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject);

    const resp = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
      },
      body: corpo,
    });

    if (resp.ok) return { ok: true, status: resp.status, expirada: false };
    const texto = await resp.text().catch(() => '');
    return {
      ok: false,
      status: resp.status,
      expirada: resp.status === 404 || resp.status === 410,
      erro: texto.slice(0, 200),
    };
  } catch (e) {
    return { ok: false, status: 0, expirada: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

