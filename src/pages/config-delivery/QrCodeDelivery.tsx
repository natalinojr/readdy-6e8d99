import { useRef } from 'react';
import QRCodeImport from 'react-qr-code';

// react-qr-code exporta como default em alguns bundles e como named em outros.
const QRCode = ((QRCodeImport as unknown as { default: typeof QRCodeImport }).default || QRCodeImport) as typeof QRCodeImport;

interface Props {
  url: string;
  /** Nome base do arquivo baixado (sem extensão). */
  nomeArquivo?: string;
}

/**
 * QR Code do link de delivery da loja, com botões para baixar em PNG (alta
 * resolução, p/ imprimir/postar) e SVG (vetorial). Usa `react-qr-code` (SVG no DOM)
 * e serializa esse SVG na hora do download — sem dependência nova.
 */
export default function QrCodeDelivery({ url, nomeArquivo = 'qrcode-delivery' }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  const getSvg = (): SVGSVGElement | null => wrapRef.current?.querySelector('svg') ?? null;

  const baixar = (href: string, ext: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = `${nomeArquivo}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const baixarSVG = () => {
    const svg = getSvg();
    if (!svg) return;
    const data = new XMLSerializer().serializeToString(svg);
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + data], { type: 'image/svg+xml;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    baixar(href, 'svg');
    URL.revokeObjectURL(href);
  };

  const baixarPNG = () => {
    const svgEl = getSvg();
    if (!svgEl) return;
    const size = 1024;   // resolução do QR
    const margin = 96;   // borda branca (quiet zone) — ajuda leitura/impressão
    // Clona e fixa dimensões grandes p/ o browser rasterizar em alta resolução.
    const svg = svgEl.cloneNode(true) as SVGSVGElement;
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    const data = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    const urlObj = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size + margin * 2;
      canvas.height = size + margin * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(urlObj); return; }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, margin, margin, size, size);
      URL.revokeObjectURL(urlObj);
      baixar(canvas.toDataURL('image/png'), 'png');
    };
    img.src = urlObj;
  };

  return (
    <div className="flex items-center gap-4 mt-3 bg-white rounded-xl border border-amber-200 p-4">
      <div ref={wrapRef} className="bg-white p-2 rounded-lg border border-zinc-100 flex-shrink-0">
        <QRCode value={url} size={120} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-zinc-800">QR Code do delivery</p>
        <p className="text-xs text-zinc-500 mt-0.5 mb-2.5">
          Baixe e use onde quiser — vitrine, embalagem, panfleto, Instagram. Aponta para o link da loja.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={baixarPNG}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1 transition-colors">
            <i className="ri-download-2-line" /> Baixar PNG
          </button>
          <button type="button" onClick={baixarSVG}
            className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1 transition-colors">
            <i className="ri-download-2-line" /> Baixar SVG
          </button>
        </div>
      </div>
    </div>
  );
}
