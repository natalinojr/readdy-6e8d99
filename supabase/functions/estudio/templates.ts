// Modelos de arte do Estúdio: árvore de elementos (estilo React, sem JSX) que o satori
// transforma em SVG. Regras: todo <div> é display:flex (exigência do satori); só CSS que o
// satori entende (sem shorthand de padding com 3 valores, gradiente vai em backgroundImage).
// Cada modelo recebe o Kit da Marca + o item + textos e devolve a árvore no tamanho do formato.

export type Kit = {
  nome_marca: string | null; cor_primaria: string; cor_secundaria: string; cor_fundo: string; cor_texto: string;
  fonte: string; cta_padrao: string | null; mostrar_preco: boolean;
};
export type Textos = { titulo?: string | null; subtitulo?: string | null; preco?: number | null; cta?: string | null; selo?: string | null };
export type Item = { name: string; price: number; description: string | null };
export type RenderInput = { kit: Kit; item: Item; textos: Textos; fotoDataUri: string; logoDataUri: string | null; fontFamily: string };

export type TemplateDef = { id: string; nome: string; formato: 'feed_1x1' | 'feed_4x5' | 'story_9x16' | 'item_1x1'; largura: number; altura: number; descricao: string };

export const TEMPLATES: TemplateDef[] = [
  { id: 'feed_foto_faixa', nome: 'Feed · foto + faixa da marca', formato: 'feed_1x1', largura: 1080, altura: 1080, descricao: 'Foto do prato em cima, faixa na cor da marca com nome, descrição e botão. Preço em destaque.' },
  { id: 'feed_4x5_foto_faixa', nome: 'Feed vertical · foto + faixa', formato: 'feed_4x5', largura: 1080, altura: 1350, descricao: 'Mesmo modelo em 4:5, que ocupa mais tela no celular.' },
  { id: 'story_foto', nome: 'Story / Reels · foto inteira', formato: 'story_9x16', largura: 1080, altura: 1920, descricao: 'Foto grande com degradê, nome, preço e botão na zona segura (fora do topo e da base).' },
  { id: 'item_moldura', nome: 'Foto de item padronizada', formato: 'item_1x1', largura: 1000, altura: 1000, descricao: 'Foto do prato com moldura e selo da marca, para deixar o cardápio uniforme.' },
];

// deno-lint-ignore no-explicit-any
type El = { type: string; props: Record<string, any> };
// deno-lint-ignore no-explicit-any
const h = (type: string, props: Record<string, any> = {}, ...children: any[]): El => {
  const kids = children.filter((c) => c !== false && c !== null && c !== undefined && c !== '');
  if (type === 'div') props = { ...props, style: { display: 'flex', ...(props.style ?? {}) } };
  return { type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } };
};

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const clip = (s: string | null | undefined, max: number) => (s ? (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s) : '');
// Cor de texto legível sobre a cor de fundo dada (luminância simples).
export function contraste(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const v = parseInt(m[1], 16); const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1a1a1a' : '#ffffff';
}
function lum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return 1;
  const v = parseInt(m[1], 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const razao = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Cor de destaque (texto solto, ex.: preço) sobre `fundo`: secundária, senão primária, senão preto/branco.
export function destaque(kit: Kit, fundo: string): string {
  return [kit.cor_secundaria, kit.cor_primaria].find((c) => razao(c, fundo) >= 3) ?? contraste(fundo);
}
// Tamanho de fonte que cabe: reduz conforme o texto cresce.
const fit = (txt: string, base: number, maxChars: number) => (txt.length <= maxChars ? base : Math.max(Math.round(base * maxChars / txt.length), Math.round(base * 0.55)));

function selo(input: RenderInput, size: number) {
  const { kit, logoDataUri } = input;
  if (logoDataUri) return h('img', { src: logoDataUri, width: size, height: size, style: { borderRadius: size / 2, objectFit: 'cover', border: `${Math.round(size * 0.05)}px solid ${kit.cor_secundaria}` } });
  const iniciais = (kit.nome_marca ?? 'M').split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
  return h('div', { style: { width: size, height: size, borderRadius: size / 2, background: kit.cor_primaria, color: contraste(kit.cor_primaria), alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.36), fontWeight: 700, border: `${Math.round(size * 0.05)}px solid ${kit.cor_secundaria}` } }, iniciais);
}

function pill(txt: string, bg: string, fg: string, fontSize: number, radius = 999) {
  return h('div', { style: { background: bg, color: fg, paddingLeft: Math.round(fontSize * 0.7), paddingRight: Math.round(fontSize * 0.7), paddingTop: Math.round(fontSize * 0.3), paddingBottom: Math.round(fontSize * 0.3), borderRadius: radius, fontSize, fontWeight: 700, alignItems: 'center', justifyContent: 'center' } }, txt);
}

function fotoFaixa(input: RenderInput, W: number, H: number): El {
  const { kit, item, textos, fotoDataUri, fontFamily } = input;
  const fotoH = Math.round(H * 0.7);
  const titulo = clip(textos.titulo || item.name, 40);
  const sub = clip(textos.subtitulo ?? item.description, 70);
  const preco = textos.preco ?? item.price;
  const cta = textos.cta || kit.cta_padrao || 'Peça agora';
  const fgFaixa = contraste(kit.cor_primaria); const fgSec = contraste(kit.cor_secundaria);
  const p = Math.round(W * 0.044);
  return h('div', { style: { width: W, height: H, flexDirection: 'column', background: kit.cor_fundo, fontFamily } },
    h('div', { style: { width: W, height: fotoH, position: 'relative' } },
      h('img', { src: fotoDataUri, width: W, height: fotoH, style: { objectFit: 'cover' } }),
      h('div', { style: { position: 'absolute', top: p, left: p } }, selo(input, Math.round(W * 0.11))),
      textos.selo && h('div', { style: { position: 'absolute', top: p, right: p } }, pill(clip(textos.selo, 18).toUpperCase(), kit.cor_secundaria, fgSec, Math.round(W * 0.03))),
      kit.mostrar_preco && preco != null && preco > 0 && h('div', { style: { position: 'absolute', right: p, bottom: p } }, pill(brl(preco), kit.cor_secundaria, fgSec, Math.round(W * 0.052))),
    ),
    h('div', { style: { flexDirection: 'column', flex: 1, background: kit.cor_primaria, paddingTop: Math.round(p * 0.8), paddingBottom: Math.round(p * 0.8), paddingLeft: p, paddingRight: p, color: fgFaixa } },
      h('div', { style: { fontSize: fit(titulo, Math.round(W * 0.067), 18), fontWeight: 700, lineHeight: 1.05 } }, titulo),
      sub && h('div', { style: { fontSize: Math.round(W * 0.03), opacity: 0.9, marginTop: Math.round(p * 0.25) } }, sub),
      h('div', { style: { marginTop: 'auto', alignItems: 'center', justifyContent: 'space-between' } },
        h('div', { style: { fontSize: Math.round(W * 0.028), opacity: 0.85 } }, kit.nome_marca ?? ''),
        pill(clip(cta, 24), kit.cor_secundaria, fgSec, Math.round(W * 0.031), 16),
      ),
    ),
  );
}

function story(input: RenderInput, W: number, H: number): El {
  const { kit, item, textos, fotoDataUri, fontFamily } = input;
  const fotoH = Math.round(H * 0.69);
  const titulo = clip(textos.titulo || item.name, 36);
  const sub = clip(textos.subtitulo ?? item.description, 60);
  const preco = textos.preco ?? item.price;
  const cta = textos.cta || kit.cta_padrao || 'Peça agora';
  const fgFundo = contraste(kit.cor_fundo);
  const p = Math.round(W * 0.06);
  const zonaSegura = Math.round(H * 0.13); // topo e base ficam livres para a interface do Instagram
  return h('div', { style: { width: W, height: H, flexDirection: 'column', background: kit.cor_fundo, fontFamily } },
    h('div', { style: { width: W, height: fotoH, position: 'relative' } },
      h('img', { src: fotoDataUri, width: W, height: fotoH, style: { objectFit: 'cover' } }),
      h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.round(fotoH * 0.28), backgroundImage: `linear-gradient(to bottom, ${kit.cor_fundo}00, ${kit.cor_fundo})` } }),
      h('div', { style: { position: 'absolute', top: zonaSegura, left: p } }, selo(input, Math.round(W * 0.13))),
      textos.selo && h('div', { style: { position: 'absolute', top: zonaSegura + Math.round(W * 0.02), right: p } }, pill(clip(textos.selo, 18).toUpperCase(), kit.cor_secundaria, contraste(kit.cor_secundaria), Math.round(W * 0.034))),
    ),
    h('div', { style: { flexDirection: 'column', flex: 1, paddingLeft: p, paddingRight: p, paddingBottom: zonaSegura, color: fgFundo } },
      h('div', { style: { fontSize: fit(titulo, Math.round(W * 0.088), 16), fontWeight: 700, lineHeight: 1.02 } }, titulo),
      sub && h('div', { style: { fontSize: Math.round(W * 0.034), opacity: 0.85, marginTop: Math.round(p * 0.2) } }, sub),
      kit.mostrar_preco && preco != null && preco > 0 && h('div', { style: { fontSize: Math.round(W * 0.066), color: destaque(kit, kit.cor_fundo), fontWeight: 700, marginTop: Math.round(p * 0.2) } }, brl(preco)),
      h('div', { style: { marginTop: Math.round(p * 0.6), alignSelf: 'flex-start', background: kit.cor_primaria, color: contraste(kit.cor_primaria), border: `4px solid ${kit.cor_secundaria}`, paddingLeft: p * 0.7, paddingRight: p * 0.7, paddingTop: p * 0.32, paddingBottom: p * 0.32, borderRadius: 999, fontSize: Math.round(W * 0.037), fontWeight: 700 } }, clip(cta, 24)),
    ),
  );
}

function itemMoldura(input: RenderInput, W: number, H: number): El {
  const { kit, item, textos, fotoDataUri, fontFamily } = input;
  const borda = Math.round(W * 0.035);
  const preco = textos.preco ?? item.price;
  const nome = clip(textos.titulo || item.name, 34);
  return h('div', { style: { width: W, height: H, background: kit.cor_primaria, padding: borda, fontFamily } },
    h('div', { style: { flex: 1, position: 'relative', borderRadius: Math.round(W * 0.03), overflow: 'hidden', background: kit.cor_fundo } },
      h('img', { src: fotoDataUri, width: W - 2 * borda, height: H - 2 * borda, style: { objectFit: 'cover' } }),
      h('div', { style: { position: 'absolute', top: borda, left: borda } }, selo(input, Math.round(W * 0.12))),
      h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.round(H * 0.22), backgroundImage: `linear-gradient(to bottom, ${kit.cor_fundo}00, ${kit.cor_fundo}dd)` } }),
      h('div', { style: { position: 'absolute', left: borda, right: borda, bottom: borda, alignItems: 'flex-end', justifyContent: 'space-between', color: contraste(kit.cor_fundo) } },
        h('div', { style: { fontSize: fit(nome, Math.round(W * 0.05), 22), fontWeight: 700, maxWidth: Math.round(W * 0.6) } }, nome),
        kit.mostrar_preco && preco != null && preco > 0 && pill(brl(preco), kit.cor_secundaria, contraste(kit.cor_secundaria), Math.round(W * 0.04)),
      ),
    ),
  );
}

export function buildTree(templateId: string, input: RenderInput): { tree: El; def: TemplateDef } {
  const def = TEMPLATES.find((t) => t.id === templateId);
  if (!def) throw new Error(`Modelo desconhecido: ${templateId}`);
  const { largura: W, altura: H } = def;
  const tree = def.id === 'story_foto' ? story(input, W, H) : def.id === 'item_moldura' ? itemMoldura(input, W, H) : fotoFaixa(input, W, H);
  return { tree, def };
}
