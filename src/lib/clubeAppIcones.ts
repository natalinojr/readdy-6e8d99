// "Cara do app" do clube: cor e ícones gerados no navegador da loja (canvas) a partir
// da logo cadastrada. Regra da cor, para qualquer loja:
//   1. a cor da loja (Configurações › Loja — a mesma do delivery);
//   2. sem cor: a cor principal da logo, escurecida se o texto branco não ficar legível;
//   3. sem logo e sem cor: a cor padrão do sistema, e o ícone vira as iniciais da loja.
import { COR_LOJA_PADRAO } from './corLoja';

export function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => falha(new Error('Não consegui abrir a logo.'));
    img.src = src;
  });
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

function luminancia(h: string): number {
  const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Contraste do texto branco sobre a cor (WCAG). */
export const contrasteComBranco = (h: string) => 1.05 / (luminancia(h) + 0.05);

/** Escurece até o texto branco ficar legível (contraste ≥ 4,5). */
export function corLegivel(h: string): string {
  let [r, g, b] = rgb(h);
  for (let i = 0; i < 20 && contrasteComBranco(hex(r, g, b)) < 4.5; i++) { r *= 0.92; g *= 0.92; b *= 0.92; }
  return hex(r, g, b);
}

function matiz(r: number, g: number, b: number): { h: number; s: number } {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return { h: 0, s: 0 };
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx === 0 ? 0 : d / mx };
}

/** Cor principal e cor de destaque da logo (null quando a logo é só preto/branco/cinza). */
export function coresDaLogo(img: HTMLImageElement): { principal: string | null; destaque: string | null } {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, 64, 64);
  const px = ctx.getImageData(0, 0, 64, 64).data;
  const baldes = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const { s } = matiz(r, g, b);
    const mx = Math.max(r, g, b);
    if (s < 0.28 || mx < 40) continue; // cinza, preto e branco não viram cor da marca
    const k = `${r >> 4},${g >> 4},${b >> 4}`;
    const v = baldes.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    v.n++; v.r += r; v.g += g; v.b += b;
    baldes.set(k, v);
  }
  const lista = [...baldes.values()].sort((a, b) => b.n - a.n).map((v) => ({ n: v.n, r: v.r / v.n, g: v.g / v.n, b: v.b / v.n }));
  if (!lista.length || lista[0].n < 20) return { principal: null, destaque: null };
  const p = lista[0];
  const hp = matiz(p.r, p.g, p.b).h;
  const d = lista.find((v) => {
    const dh = Math.abs(matiz(v.r, v.g, v.b).h - hp);
    return v.n >= 15 && Math.min(dh, 360 - dh) >= 40;
  });
  return { principal: hex(p.r, p.g, p.b), destaque: d ? hex(d.r, d.g, d.b) : null };
}

export function iniciais(nome: string): string {
  const palavras = nome.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((p) => p && !/^(de|da|do|das|dos|e|the)$/i.test(p));
  return (palavras.slice(0, 2).map((p) => p[0]).join('') || nome.slice(0, 2)).toUpperCase();
}

/** Nome curto para embaixo do ícone (o celular corta nomes longos). */
export function nomeCurto(nome: string): string {
  const limpo = nome.trim().replace(/\s+/g, ' ');
  if (limpo.length <= 12) return limpo;
  let out = '';
  for (const p of limpo.split(' ')) { if ((out ? `${out} ${p}` : p).length > 12) break; out = out ? `${out} ${p}` : p; }
  return out || limpo.slice(0, 12);
}

/** Logo "cheia" (fundo próprio, sem transparência nos cantos)? Devolve a cor do fundo. */
function fundoDaLogo(img: HTMLImageElement): string | null {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, 32, 32);
  const cantos = [[1, 1], [30, 1], [1, 30], [30, 30]].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data);
  if (cantos.some((p) => p[3] < 220)) return null;
  const media = [0, 1, 2].map((i) => cantos.reduce((s, p) => s + p[i], 0) / 4);
  return hex(media[0], media[1], media[2]);
}

function desenhar(tam: number, cor: string, img: HTMLImageElement | null, nome: string, mascaravel: boolean): string {
  const c = document.createElement('canvas');
  c.width = tam; c.height = tam;
  const ctx = c.getContext('2d')!;
  if (!img) {
    ctx.fillStyle = cor; ctx.fillRect(0, 0, tam, tam);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 ${Math.round(tam * (mascaravel ? 0.32 : 0.4))}px "Plus Jakarta Sans", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(iniciais(nome), tam / 2, tam / 2 + tam * 0.02);
    return c.toDataURL('image/png');
  }
  const fundo = fundoDaLogo(img);
  const quadrada = Math.abs(img.naturalWidth / img.naturalHeight - 1) < 0.12;
  ctx.fillStyle = fundo ?? cor; ctx.fillRect(0, 0, tam, tam);
  // Logo cheia e quadrada ocupa o ícone todo; senão vai inteira no meio (com folga).
  // No ícone "mascarável" o Android recorta em círculo/gota: fica dentro dos 70% do meio.
  const area = mascaravel ? 0.7 : fundo && quadrada ? 1 : 0.78;
  const esc = Math.min((tam * area) / img.naturalWidth, (tam * area) / img.naturalHeight);
  const w = img.naturalWidth * esc, h = img.naturalHeight * esc;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (tam - w) / 2, (tam - h) / 2, w, h);
  return c.toDataURL('image/png');
}

export interface CaraDoApp { cor: string; corDestaque: string | null; origemCor: 'loja' | 'logo' | 'padrao' }

/** Cor do app pela regra (loja → logo → padrão). */
export async function corAutomatica(corLoja: string | null, logo: string | null): Promise<CaraDoApp> {
  let destaque: string | null = null;
  let daLogo: string | null = null;
  if (logo) {
    try { const c = coresDaLogo(await carregarImagem(logo)); daLogo = c.principal; destaque = c.destaque; } catch { /* logo ilegível: segue */ }
  }
  if (corLoja && /^#[0-9a-f]{6}$/i.test(corLoja)) return { cor: corLoja.toUpperCase(), corDestaque: destaque, origemCor: 'loja' };
  if (daLogo) return { cor: corLegivel(daLogo), corDestaque: destaque, origemCor: 'logo' };
  return { cor: COR_LOJA_PADRAO, corDestaque: null, origemCor: 'padrao' };
}

/** Os 4 PNGs do app (192, 512, 512 mascarável e 180 do iPhone), em data URL. */
export async function gerarIcones(logo: string | null, cor: string, nome: string): Promise<Record<'192' | '512' | 'mask512' | 'apple180', string>> {
  let img: HTMLImageElement | null = null;
  if (logo) { try { img = await carregarImagem(logo); } catch { img = null; } }
  try { await document.fonts?.load?.('800 40px "Plus Jakarta Sans"'); } catch { /* sem a fonte: usa a do sistema */ }
  return {
    192: desenhar(192, cor, img, nome, false),
    512: desenhar(512, cor, img, nome, false),
    mask512: desenhar(512, cor, img, nome, true),
    apple180: desenhar(180, cor, img, nome, false),
  };
}
