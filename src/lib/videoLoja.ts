// Envio de vídeo da loja (Configurações › Loja → delivery, QR e tela de espera do totem).
// Confere o arquivo no navegador, tira um quadro de capa (poster) e manda o vídeo direto
// ao Storage por URL assinada que o config-write cria (só admin/gerente da loja).
import { invokeWithAuth, uploadMenuImage, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { VIDEO_MAX_BYTES, VIDEO_MAX_SEGUNDOS, type VideoLoja } from '@/lib/capasLoja';

const EXT_POR_TIPO: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const TIPO_POR_EXT: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

/**
 * HEVC (H.265) é o padrão da câmera do iPhone: toca no iPhone de quem enviou, mas fica
 * preto em boa parte dos Android e no Chrome do computador. As caixas 'hvc1'/'hev1' do
 * MP4/MOV denunciam o codec.
 */
export function videoEhHevc(bytes: Uint8Array): boolean {
  for (let i = 4; i + 3 < bytes.length; i++) {
    if (bytes[i] !== 0x68) continue; // 'h'
    const b1 = bytes[i + 1], b2 = bytes[i + 2], b3 = bytes[i + 3];
    if (!((b1 === 0x76 && b2 === 0x63 && b3 === 0x31) || (b1 === 0x65 && b2 === 0x76 && b3 === 0x31))) continue;
    // Caixa de verdade: os 4 bytes antes são o tamanho dela (pequeno). Sem isso, a
    // sequência apareceria por acaso no meio dos dados comprimidos.
    const tam = ((bytes[i - 4] << 24) >>> 0) + (bytes[i - 3] << 16) + (bytes[i - 2] << 8) + bytes[i - 1];
    if (tam >= 16 && tam <= 4096) return true;
  }
  return false;
}

function abrirVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise(function (resolve, reject) {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const t = setTimeout(function () { reject(new Error('Não deu para abrir o vídeo neste navegador.')); }, 15000);
    // loadedmetadata (não loadeddata): o Safari em pouca energia não baixa quadros sem toque
    v.onloadedmetadata = function () { clearTimeout(t); resolve(v); };
    v.onerror = function () { clearTimeout(t); reject(new Error('Formato de vídeo não suportado. Envie em MP4.')); };
    v.src = url;
  });
}

/** Quadro do vídeo em JPEG (largura até 1280). null se o navegador não deixar desenhar. */
async function tirarQuadro(v: HTMLVideoElement): Promise<Blob | null> {
  try {
    const alvo = Math.min(0.5, (v.duration || 1) / 2);
    await new Promise<void>(function (resolve) {
      const t = setTimeout(resolve, 3000);
      v.onseeked = function () { clearTimeout(t); resolve(); };
      v.currentTime = alvo;
    });
    const escala = Math.min(1, 1280 / (v.videoWidth || 1280));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((v.videoWidth || 1280) * escala);
    canvas.height = Math.round((v.videoHeight || 720) * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.8); });
  } catch {
    return null;
  }
}

export async function enviarVideoLoja(file: File, tenantId: string): Promise<{ video: VideoLoja | null; erro: string | null }> {
  const ext = EXT_POR_TIPO[file.type] || (/\.(mp4|webm|mov)$/i.exec(file.name)?.[1] || '').toLowerCase();
  if (!ext) return { video: null, erro: 'Envie o vídeo em MP4 (ou WebM/MOV).' };
  if (file.size > VIDEO_MAX_BYTES) {
    return { video: null, erro: 'Vídeo com ' + (file.size / 1024 / 1024).toFixed(1) + ' MB. O máximo é ' + (VIDEO_MAX_BYTES / 1024 / 1024) + ' MB — encurte ou exporte em 720p.' };
  }
  if (ext !== 'webm' && videoEhHevc(new Uint8Array(await file.arrayBuffer()))) {
    return { video: null, erro: 'Este vídeo está em HEVC (padrão do iPhone) e não abre em muitos celulares Android. No iPhone: Ajustes › Câmera › Formatos › "Mais compatível" e grave de novo, ou exporte em MP4 (H.264).' };
  }

  const local = URL.createObjectURL(file);
  let poster = '';
  let v: HTMLVideoElement | null = null;
  try {
    v = await abrirVideo(local);
    if (v.duration && v.duration > VIDEO_MAX_SEGUNDOS + 0.5) {
      return { video: null, erro: 'Vídeo com ' + Math.round(v.duration) + ' s. O máximo é ' + VIDEO_MAX_SEGUNDOS + ' s.' };
    }
    const quadro = await tirarQuadro(v);
    if (quadro) {
      const { url } = await uploadMenuImage(new File([quadro], 'capa-video.jpg', { type: 'image/jpeg' }), tenantId, 'capa-video');
      poster = url || '';
    }
  } catch (e) {
    return { video: null, erro: e instanceof Error ? e.message : 'Não deu para abrir o vídeo.' };
  } finally {
    if (v) { v.removeAttribute('src'); v.load(); }
    URL.revokeObjectURL(local);
  }

  const { data, error } = await invokeWithAuth<{ success: boolean; signed_url?: string; public_url?: string; error?: string }>('config-write', {
    body: { action: 'cover_video_upload_url', tenant_id: tenantId, ext },
  });
  if (error || !data?.success || !data.signed_url || !data.public_url) {
    return { video: null, erro: error?.message || data?.error || 'Não deu para preparar o envio.' };
  }
  // URL assinada: o token vai na própria URL, sem login (o client não renova o JWT sozinho)
  const res = await fetch(data.signed_url, {
    method: 'PUT',
    // Tipo pela extensão: celular às vezes manda video/x-m4v ou vazio, e o bucket só aceita estes 3
    // Cache de 1 ano: o nome do arquivo é único (cada envio = URL nova), então o celular e o
    // totem guardam o vídeo e não baixam de novo a cada visita (igual às fotos do cardápio).
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': TIPO_POR_EXT[ext], 'x-upsert': 'false', 'cache-control': 'max-age=31536000' },
    body: file,
  });
  if (!res.ok) {
    const corpo = await res.json().catch(function () { return {} as Record<string, unknown>; });
    return { video: null, erro: String((corpo as Record<string, unknown>).message || (corpo as Record<string, unknown>).error || 'Falha no envio (HTTP ' + res.status + ')') };
  }
  return { video: { url: data.public_url, poster }, erro: null };
}
