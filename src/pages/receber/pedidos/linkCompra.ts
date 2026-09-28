// Cópia de lerLinkCompra (supabase/functions/_shared/pedidos-pagamento.ts) só para a prévia na tela.
// Quem vale é a Edge (que também abre o link curto do app do ML). Mudou lá, muda aqui.
// ── Compra online: o link colado (2026-09-28) ──
// O app do Mercado Livre compartilha "Olha o que encontrei… <título> https://…" — vale o 1º link do texto.
// A API do ML não lê anúncio com o token da loja (403), então nome e nº saem do próprio endereço.
const SITES: [RegExp, string][] = [
  [/(^|\.)mercadoli(vre|bre)\.com(\.br)?$/, 'Mercado Livre'], [/(^|\.)mercadopago\.com(\.br)?$/, 'Mercado Pago'],
  [/(^|\.)shopee\.com\.br$/, 'Shopee'], [/(^|\.)amazon\.com(\.br)?$/, 'Amazon'], [/(^|\.)amzn\.to$/, 'Amazon'],
  [/(^|\.)(magazineluiza|magalu)\.com(\.br)?$/, 'Magalu'], [/(^|\.)aliexpress\.com$/, 'AliExpress'],
];
export function lerLinkCompra(texto: string): { url: string; site: string; anuncio_id: string | null; titulo: string | null } | null {
  const m = String(texto ?? '').match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  let u: URL;
  try { u = new URL(m[0].replace(/[).,;!?]+$/, '')); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const site = SITES.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, '');
  const id = u.pathname.match(/MLB-?(\d{6,})/i);
  const anuncio_id = id ? `MLB${id[1]}` : null;
  // Título: texto antes do link (compartilhar do app) ou o "slug" do endereço
  const antes = String(texto).slice(0, m.index).replace(/^.*?(encontrei|achei)[^!:\n]*[!:]?\s*/i, '').replace(/[\s:–—-]+$/, '').trim();
  const partes = u.pathname.split('/').filter(Boolean);
  const depoisDoId = id ? u.pathname.split(/MLB-?\d{6,}-?/i)[1]?.split('/')[0] ?? '' : '';
  const slug = depoisDoId || partes.find((p) => /[a-z]-[a-z]/i.test(p)) || '';
  let doSlug = '';
  try { doSlug = decodeURIComponent(slug); } catch { doSlug = slug; }
  doSlug = doSlug.replace(/[-_]+JM$/i, '').replace(/-i\.\d+\.\d+$/, '').replace(/[-_]+/g, ' ').trim();
  const titulo = (antes.length >= 4 ? antes : doSlug).slice(0, 200) || null;
  return { url: u.toString(), site, anuncio_id, titulo: titulo ? titulo.charAt(0).toUpperCase() + titulo.slice(1) : null };
}
