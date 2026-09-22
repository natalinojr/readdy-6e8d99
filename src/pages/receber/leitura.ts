// Leitura pela câmera do celular, no navegador (sem custo):
// - DANFE (NF-e): código de barras CODE-128 com a chave de 44 dígitos → BarcodeDetector (Chrome/Android)
// - Cupom (NFC-e): QR Code com o link da SEFAZ → BarcodeDetector ou jsQR (iPhone não tem BarcodeDetector)
// Mesma técnica do decodeQrFromFile da Nova Compra: tenta alguns tamanhos da foto.

export type Lido = { tipo: 'chave'; chave: string } | { tipo: 'qr'; url: string } | { tipo: 'nada' };

// QR de NFC-e do Paraná (única SEFAZ que a Edge purchase-receipt-scan consulta por enquanto)
export const isNfcePrQr = (s: string) => /^https?:\/\/(www\.)?fazenda\.pr\.gov\.br\/nfce\/qrcode\?p=\d{44}/i.test(s.trim());

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Não foi possível abrir a imagem'));
    i.src = url;
  });
}

function interpretar(valor: string): Lido | null {
  const v = valor.trim();
  if (/^https?:\/\//i.test(v)) return { tipo: 'qr', url: v };
  const d = v.replace(/\D/g, '');
  if (d.length === 44) return { tipo: 'chave', chave: d };
  return null;
}

type Detector = { detect: (src: HTMLCanvasElement) => Promise<{ rawValue: string }[]> };

async function detectorNativo(): Promise<Detector | null> {
  const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const suportados = (await BD.getSupportedFormats?.()) ?? [];
    const formats = ['code_128', 'qr_code', 'itf', 'code_39'].filter((f) => !suportados.length || suportados.includes(f));
    return new BD({ formats });
  } catch {
    return null;
  }
}

/** Lê chave de NF-e (código de barras) ou link de NFC-e (QR) numa foto. */
export async function lerCodigoDaFoto(file: File): Promise<Lido> {
  if (!file.type.startsWith('image/')) return { tipo: 'nada' };
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const nativo = await detectorNativo();
    let jsQR: typeof import('jsqr').default | null = null;
    for (const max of [1600, 2400, 1000]) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (nativo) {
        try {
          const achados = await nativo.detect(canvas);
          for (const a of achados) {
            const r = interpretar(a.rawValue);
            if (r) return r;
          }
        } catch { /* cai no jsQR */ }
      }
      if (!jsQR) jsQR = (await import('jsqr')).default;
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) {
        const r = interpretar(code.data);
        if (r) return r;
      }
      if (scale === 1) break;
    }
    return { tipo: 'nada' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Foto de 4–12 MB → JPEG de ~2000px para a leitura por IA (sobe rápido no 4G). */
export async function fotoParaEnvio(file: File): Promise<{ base64: string; mediaType: string }> {
  const readB64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  if (file.type === 'application/pdf') return { base64: await readB64(file), mediaType: 'application/pdf' };
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))), 'image/jpeg', 0.85));
    return { base64: await readB64(blob), mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}
