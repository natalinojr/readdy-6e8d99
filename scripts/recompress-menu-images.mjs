/**
 * recompress-menu-images.mjs — roda UMA vez para recomprimir as fotos JÁ existentes
 * no bucket `menu-images` (reduz o egress sem mexer no cardápio: mantém as mesmas URLs).
 *
 * O que faz por arquivo:
 *   - baixa
 *   - redimensiona (lado maior <= 1000px) + JPEG qualidade 70
 *   - re-sobe no MESMO caminho (upsert) com Cache-Control de 1 ano
 *   - só substitui se a versão comprimida ficou MENOR
 *
 * Como rodar (PowerShell, na pasta scripts/):
 *   npm init -y
 *   npm install @supabase/supabase-js sharp
 *   $env:SUPABASE_URL = "https://mdghhjemzdmeuqpzuyzx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<sua service_role key do painel Supabase>"
 *   node recompress-menu-images.mjs
 *
 * A service_role key fica só no ambiente (não é gravada em arquivo). Pegue em:
 *   Supabase > Project Settings > API > service_role (secret).
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'menu-images';
const MAX_SIZE = 1000;
const QUALITY = 70;
const CACHE = '31536000'; // 1 ano

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Lista todos os arquivos do bucket recursivamente (estrutura: tenant/item/arquivo).
async function listAll(prefix = '') {
  const out = [];
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) { console.error('Erro listando', prefix, error.message); return out; }
  for (const entry of data || []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null && (!entry.metadata || entry.metadata.size === undefined)) {
      // É uma "pasta" — desce nela.
      out.push(...(await listAll(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function run() {
  console.log('Listando arquivos...');
  const paths = await listAll('');
  console.log(`${paths.length} arquivo(s) encontrados.`);

  let recomprimidos = 0, pulados = 0, falhas = 0, ganhoBytes = 0;

  for (const path of paths) {
    try {
      const { data: blob, error: dErr } = await supabase.storage.from(BUCKET).download(path);
      if (dErr || !blob) { console.log('skip (download)', path); falhas++; continue; }
      const input = Buffer.from(await blob.arrayBuffer());

      const meta = await sharp(input).metadata();
      if (!meta.width || ['gif', 'svg'].includes(meta.format)) { pulados++; continue; }

      const output = await sharp(input)
        .rotate() // respeita orientação EXIF
        .resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer();

      if (output.length >= input.length) { pulados++; continue; }

      const { error: uErr } = await supabase.storage.from(BUCKET).upload(path, output, {
        upsert: true, contentType: 'image/jpeg', cacheControl: CACHE,
      });
      if (uErr) { console.log('falha upload', path, uErr.message); falhas++; continue; }

      ganhoBytes += input.length - output.length;
      recomprimidos++;
      console.log(`ok ${path}: ${(input.length / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.log('erro', path, e.message);
      falhas++;
    }
  }

  console.log('\n=== RESUMO ===');
  console.log('Recomprimidos:', recomprimidos, '| Pulados:', pulados, '| Falhas:', falhas);
  console.log('Economia:', (ganhoBytes / 1024 / 1024).toFixed(1), 'MB por download completo do cardápio.');
}

run().then(() => process.exit(0));
