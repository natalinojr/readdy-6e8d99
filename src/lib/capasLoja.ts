// Fotos de capa do cardápio online (delivery e QR). Configurações › Loja grava até 10
// em tenants.cover_images; lojas antigas só têm cover_url/cover_position.

export interface CapaLoja {
  url: string;
  /** "X% Y%" (object-position); vazio = centro */
  posicao: string;
}

export const MAX_CAPAS = 10;

/** Colunas de tenants que as telas do cliente leem para montar o topo da loja. */
export const COLUNAS_MARCA_LOJA = 'logo_url, cover_url, brand_color, cover_position, cover_images';

export function lerCapasLoja(row: {
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
