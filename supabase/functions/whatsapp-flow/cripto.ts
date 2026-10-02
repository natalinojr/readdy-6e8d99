// Criptografia do endpoint do WhatsApp Flows (mesma conta do exemplo oficial da Meta,
// github.com/WhatsApp/WhatsApp-Flows-Tools › examples/endpoint/nodejs/basic/src/encryption.js),
// feita com WebCrypto para rodar igual no Deno (Edge Function) e no Node (testes do vitest):
//   • a Meta sorteia uma chave AES-128 e a manda cifrada com a NOSSA chave pública (RSA-OAEP, SHA-256);
//   • o corpo vem em AES-128-GCM (os 16 bytes finais são a tag), com o initial_vector de 16 bytes;
//   • a resposta vai com a MESMA chave AES e o vetor invertido bit a bit (~byte), em base64 puro.
// A chave privada fica no segredo WHATSAPP_FLOW_PRIVATE_KEY (PEM PKCS#8 sem senha;
// scripts/whatsapp-flow/gerar-chaves.mjs). A pública é derivada dela e enviada à Meta pela ação admin.

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const pemBody = (pem: string) => pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

/** Erro com o status HTTP que a Meta entende (421 = chave errada; ela busca a pública de novo). */
export class FlowHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface FlowRequest { encrypted_flow_data: string; encrypted_aes_key: string; initial_vector: string }
export interface Decifrado { body: Record<string, unknown>; aes: Uint8Array; iv: Uint8Array }

export function importarPrivada(pem: string): Promise<CryptoKey> {
  // Segredo colado com "\n" literais (CLI do Supabase) também vale.
  const der = b64ToBytes(pemBody(pem.replace(/\\n/g, '\n')));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']);
}

export async function decifrar(req: FlowRequest, privada: CryptoKey): Promise<Decifrado> {
  let aes: Uint8Array;
  try {
    aes = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privada, b64ToBytes(req.encrypted_aes_key)));
  } catch {
    throw new FlowHttpError(421, 'não deu para abrir a chave AES (chave pública da Meta diferente da nossa?)');
  }
  const iv = b64ToBytes(req.initial_vector);
  const chave = await crypto.subtle.importKey('raw', aes, { name: 'AES-GCM' }, false, ['decrypt']);
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, chave, b64ToBytes(req.encrypted_flow_data));
  return { body: JSON.parse(new TextDecoder().decode(claro)), aes, iv };
}

export async function cifrarResposta(resposta: unknown, aes: Uint8Array, iv: Uint8Array): Promise<string> {
  const invertido = iv.map((b) => ~b & 0xff);
  const chave = await crypto.subtle.importKey('raw', aes, { name: 'AES-GCM' }, false, ['encrypt']);
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: invertido, tagLength: 128 }, chave, new TextEncoder().encode(JSON.stringify(resposta)));
  return bytesToB64(new Uint8Array(cifrado));
}

/** Chave pública (PEM SPKI) a partir da privada: é o que vai para a Meta (whatsapp_business_encryption). */
export async function publicaDaPrivada(privada: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', privada);
  const pub = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RSA-OAEP-256', ext: true },
    { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
  const spki = bytesToB64(new Uint8Array(await crypto.subtle.exportKey('spki', pub)));
  return `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;
}

// ── HMAC (assinatura da Meta e token do Flow) ──
async function hmacHex(segredo: string, texto: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** X-Hub-Signature-256 do corpo cru com o App Secret (o mesmo do webhook whatsapp-cloud). */
export async function assinaturaMetaOk(segredo: string, corpoCru: string, header: string | null): Promise<boolean> {
  const sig = String(header ?? '').replace(/^sha256=/, '');
  if (!sig) return false;
  return iguais(await hmacHex(segredo, corpoCru), sig);
}
