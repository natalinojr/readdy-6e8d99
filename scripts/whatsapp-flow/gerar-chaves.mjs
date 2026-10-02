// Gera o par de chaves RSA 2048 do endpoint do WhatsApp Flows (whatsapp-flow).
// A privada vai para o segredo WHATSAPP_FLOW_PRIVATE_KEY (PEM PKCS#8 SEM senha: o WebCrypto do Deno não
// lê PEM com senha). A pública é derivada da privada pela própria Edge Function (ação admin chave_publica),
// então não precisa ser guardada.
//
// Uso (no PC, fora do repo — NUNCA commitar a privada):
//   node scripts/whatsapp-flow/gerar-chaves.mjs <pasta-de-saída>
//   npx supabase secrets set --project-ref mdghhjemzdmeuqpzuyzx WHATSAPP_FLOW_PRIVATE_KEY="$(cat <pasta>/privada.pem)"
//   depois apague a pasta.
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pasta = process.argv[2];
if (!pasta) {
  console.error('Uso: node scripts/whatsapp-flow/gerar-chaves.mjs <pasta-de-saída fora do repo>');
  process.exit(1);
}
const dir = resolve(pasta);
if (dir.startsWith(resolve('.'))) {
  console.error('A pasta de saída tem que ficar FORA do repositório (a chave privada não pode ser commitada).');
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'privada.pem'), privateKey, { mode: 0o600 });
writeFileSync(resolve(dir, 'publica.pem'), publicKey);
console.log(`Chaves em ${dir} (privada.pem e publica.pem).`);
