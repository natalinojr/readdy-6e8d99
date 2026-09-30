// Guia em PDF só-imagem → texto, no navegador e de graça (sem IA): desenha a 1ª página, lê o QR do
// Pix (jsQR) e faz OCR em português (tesseract.js, baixa o modelo "por" do CDN na 1ª vez e o
// navegador guarda). A conferência (DVs, CRC, valor do código de barras) fica em guiaOcr.ts.
import { textoGuiaOcr, type ResumoGuiaOcr } from './guiaOcr';

const TEXTO_MINIMO = 80; // abaixo disso o PDF é imagem (o "Imprimir como PDF" do Windows não tem texto)

/** null = o PDF já tem texto (o servidor lê direto). */
export async function lerGuiaImagem(file: File, aviso?: (etapa: string) => void): Promise<{ texto: string; resumo: ResumoGuiaOcr } | null> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await pdf.getPage(1);
  const conteudo = await page.getTextContent();
  const jaTemTexto = conteudo.items.map((i) => ('str' in i ? i.str : '')).join('').replace(/\s/g, '').length;
  if (jaTemTexto >= TEXTO_MINIMO) return null;

  aviso?.('A guia é uma imagem: lendo o texto (pode levar alguns segundos)…');
  const vp = page.getViewport({ scale: 300 / 72 }); // 300 dpi: o OCR acerta mais os dígitos
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Não consegui desenhar a guia');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas } as Parameters<typeof page.render>[0]).promise;

  // QR do Pix (FGTS Digital; DAS/DARF também trazem, mas lá vale a linha digitável)
  let qr: string | null = null;
  try {
    const { default: jsQR } = await import('jsqr');
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    qr = jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  } catch { qr = null; }

  const { createWorker } = await import('tesseract.js');
  const w = await createWorker('por');
  try {
    const { data } = await w.recognize(canvas);
    return textoGuiaOcr(data.text ?? '', qr);
  } finally {
    await w.terminate();
  }
}
