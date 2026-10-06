// Fotos e vídeos de capa do cardápio online (delivery e QR) e da tela de espera do totem.
// Configurações › Loja grava até 10 fotos em tenants.cover_images e vídeos (até 50 MB
// somados) em tenants.cover_videos; lojas antigas só têm cover_url/cover_position.

export interface CapaLoja {
  /** Imagem do slide. No vídeo é o quadro de capa (poster) — pode vir vazio. */
  url: string;
  /** "X% Y%" (object-position); vazio = centro */
  posicao: string;
  /** Presente quando o slide é um vídeo */
  video?: string;
}

export const MAX_CAPAS = 10;
/** Vídeos: quantos quiser, até 50 MB somados (o config-write confere; o bucket recusa arquivo acima disso). Duração livre. */
export const VIDEOS_MAX_BYTES_TOTAL = 50 * 1024 * 1024;

/** Colunas de tenants que as telas do cliente leem para montar o topo da loja. */
export const COLUNAS_MARCA_LOJA = 'logo_url, cover_url, brand_color, cover_position, cover_images, cover_videos';

export interface VideoLoja {
  url: string;
  poster: string;
  /** Tamanho do arquivo (o config-write grava o real); vídeos antigos podem não ter */
  bytes?: number;
}

export function lerVideosLoja(row: { cover_videos?: unknown } | null | undefined): VideoLoja[] {
  const lista = row && Array.isArray(row.cover_videos) ? row.cover_videos : [];
  const videos: VideoLoja[] = [];
  for (const item of lista) {
    const url = item && typeof item === 'object' ? String((item as Record<string, unknown>).url ?? '') : '';
    if (!url) continue;
    const bytes = Number((item as Record<string, unknown>).bytes);
    videos.push({ url, poster: String((item as Record<string, unknown>).poster ?? ''), ...(bytes > 0 ? { bytes } : {}) });
  }
  return videos;
}

/** Só as fotos (sem vídeos) — é o que Configurações edita na lista de fotos. */
export function lerFotosLoja(row: {
  cover_images?: unknown;
  cover_url?: string | null;
  cover_position?: string | null;
} | null | undefined): CapaLoja[] {
  if (!row) return [];
  const lista = Array.isArray(row.cover_images) ? row.cover_images : [];
  const capas: CapaLoja[] = [];
  for (const item of lista) {
    const url = item && typeof item === 'object' ? String((item as Record<string, unknown>).url ?? '') : '';
    if (!url) continue;
    capas.push({ url, posicao: String((item as Record<string, unknown>).position ?? '') });
    if (capas.length >= MAX_CAPAS) break;
  }
  if (capas.length === 0 && row.cover_url) {
    capas.push({ url: row.cover_url, posicao: row.cover_position || '' });
  }
  return capas;
}

/** Slides do topo da loja: vídeos primeiro (é o que a loja quer mostrar), depois as fotos. */
export function lerCapasLoja(row: {
  cover_images?: unknown;
  cover_videos?: unknown;
  cover_url?: string | null;
  cover_position?: string | null;
} | null | undefined): CapaLoja[] {
  const videos = lerVideosLoja(row).map(function (v): CapaLoja { return { url: v.poster, posicao: '', video: v.url }; });
  return videos.concat(lerFotosLoja(row));
}
