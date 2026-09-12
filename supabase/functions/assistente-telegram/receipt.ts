// Comprovante de pagamento em IMAGEM (PNG), montado com os dados que a API do Inter devolve
// (fin_inter_payments.response). A API não entrega o comprovante oficial do banco, por isso o
// rodapé diz que foi gerado pelo ERPOS. SVG → PNG com resvg (wasm) e a fonte Inter (TTF estático),
// baixados do jsDelivr uma vez por instância. Layout aprovado pelo dono em 2026-09-12.
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
const FONT_URL = (w: number) => `https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-${w}-normal.ttf`;
const TZ = 'America/Sao_Paulo';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtDoc = (d: unknown) => {
  const x = String(d ?? '').replace(/\D/g, '');
  if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (x.length === 11) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return String(d ?? '');
};
const dt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Quebra texto longo em linhas (aprox. pela largura média da Inter).
function wrap(text: unknown, maxChars: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of String(text ?? '').split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

// deno-lint-ignore no-explicit-any
export function receiptSvg(p: any, payer: { name?: string | null; cnpj?: string | null }): string {
  const tp = p.response?.transacaoPix ?? {};
  const isPix = p.kind === 'pix';
  const W = 720, PAD = 48;
  // deno-lint-ignore no-explicit-any
  const hist: any[] = Array.isArray(p.response?.historico) ? p.response.historico : [];
  const evt = (s: string) => hist.find((h) => h.status === s)?.dataHoraEvento as string | undefined;
  const pagoEm = tp.dataHoraMovimento ?? evt('PIX_PAGO') ?? p.paid_at;
  const recebedor = tp.recebedor?.nome ?? p.beneficiary_name;
  const recDoc = tp.recebedor?.cpfCnpj ?? p.beneficiary_doc;
  const conta = tp.contaCorrente ? `•••• ${String(tp.contaCorrente).slice(-4)}` : null;

  const parts: string[] = [];
  let y = 0;
  const text = (x: number, yy: number, s: unknown, o: { size?: number; w?: number; c?: string; anchor?: string; ls?: number } = {}) =>
    parts.push(`<text x="${x}" y="${yy}" font-size="${o.size ?? 20}" font-weight="${o.w ?? 400}" fill="${o.c ?? '#1B1F24'}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`);

  // Cabeçalho
  parts.push(`<rect x="0" y="0" width="${W}" height="300" fill="#0F5132"/>`);
  parts.push(`<circle cx="${W / 2}" cy="78" r="34" fill="#FFFFFF"/>`);
  parts.push(`<path d="M${W / 2 - 15} 79 l10 10 l20 -21" stroke="#0F5132" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  text(W / 2, 148, isPix ? 'Pix realizado' : 'Pagamento realizado', { size: 24, w: 700, c: '#D1F2E0', anchor: 'middle' });
  text(W / 2, 214, brl(p.amount), { size: 56, w: 700, c: '#FFFFFF', anchor: 'middle' });
  text(W / 2, 262, pagoEm ? dt(pagoEm) : '', { size: 20, c: '#D1F2E0', anchor: 'middle' });
  y = 300;

  const section = (titulo: string, linhas: Array<[string, unknown, boolean?]>) => {
    y += 44;
    text(PAD, y, titulo.toUpperCase(), { size: 15, w: 700, c: '#6B7280', ls: 1.5 });
    y += 10;
    for (const [rot, val, big] of linhas) {
      if (val == null || val === '') continue;
      y += 34;
      text(PAD, y, rot, { size: 17, c: '#6B7280' });
      const vl = wrap(val, big ? 32 : 44);
      vl.forEach((l, i) => text(W - PAD, y + i * 28, l, { size: big ? 21 : 19, w: big ? 700 : 600, anchor: 'end' }));
      y += (vl.length - 1) * 28;
    }
    y += 22;
    parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#E5E7EB" stroke-width="2"/>`);
  };

  const chave = tp.chave ?? p.pix_key;
  section('Quem recebeu', [
    ['Nome', recebedor, true],
    [String(recDoc ?? '').replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ', recDoc ? fmtDoc(recDoc) : null],
    isPix ? ['Chave Pix', chave ? (['cnpj', 'cpf'].includes(p.pix_key_kind) ? fmtDoc(chave) : chave) : null] : ['Linha digitável', p.digitavel],
  ]);
  section('Quem pagou', [
    ['Nome', payer?.name, true],
    ['CNPJ', payer?.cnpj ? fmtDoc(payer.cnpj) : null],
    ['Instituição', 'Banco Inter S.A.'],
    ['Conta', conta],
  ]);
  const aprovado = evt('TRANSACAO_APROVADA_PELO_USUARIO');
  section('Detalhes', [
    ['Descrição', p.description],
    ['Aprovado no app', aprovado ? hm(aprovado) : null],
    ['Situação', isPix ? (tp.status === 'PAGO' ? 'Pix pago' : (tp.status ?? 'Pago')) : 'Pago'],
  ]);

  y += 44;
  text(PAD, y, 'IDENTIFICAÇÃO', { size: 15, w: 700, c: '#6B7280', ls: 1.5 });
  const ids: Array<[string, unknown]> = [[isPix ? 'ID da transação (E2E)' : 'Autenticação', tp.endToEnd ?? p.inter_code], ['Código no Inter', tp.codigoSolicitacao ?? p.inter_code]];
  for (const [rot, val] of ids) {
    if (!val) continue;
    y += 36; text(PAD, y, rot, { size: 17, c: '#6B7280' });
    y += 30; text(PAD, y, val, { size: 19, w: 600 });
  }
  y += 36;

  const foot = ['Comprovante gerado pelo ERPOS com os dados devolvidos pela API do Banco Inter.', 'Confira pelo ID E2E no banco de quem recebeu.'];
  parts.push(`<rect x="0" y="${y}" width="${W}" height="${36 + foot.length * 26}" fill="#F3F4F6"/>`);
  foot.forEach((l, i) => text(W / 2, y + 34 + i * 26, l, { size: 15, c: '#6B7280', anchor: 'middle' }));
  y += 36 + foot.length * 26;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" font-family="Inter"><rect width="${W}" height="${y}" fill="#FFFFFF"/>${parts.join('')}</svg>`;
}

let assets: Promise<Uint8Array[]> | null = null;
function loadAssets(): Promise<Uint8Array[]> {
  if (!assets) {
    assets = (async () => {
      const get = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} → ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
      await initWasm(await get(WASM_URL));
      return await Promise.all([400, 600, 700].map((w) => get(FONT_URL(w))));
    })().catch((e) => { assets = null; throw e; });
  }
  return assets;
}

// deno-lint-ignore no-explicit-any
export async function receiptPng(p: any, payer: { name?: string | null; cnpj?: string | null }): Promise<Uint8Array> {
  const fontBuffers = await loadAssets();
  const r = new Resvg(receiptSvg(p, payer), { fitTo: { mode: 'width', value: 1080 }, font: { fontBuffers, defaultFontFamily: 'Inter', loadSystemFonts: false } });
  return r.render().asPng();
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
