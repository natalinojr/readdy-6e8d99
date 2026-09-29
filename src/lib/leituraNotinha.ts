// Leitura de notinha/nota de compra (tirado da Nova Compra em 2026-09-29 para ser usado também no
// "Lançar a partir deste pagamento" da Conciliação e no "Detalhar itens" de uma compra existente).
// Ordem: QR Code da NFC-e na foto (grátis, dados oficiais da SEFAZ-PR) → leitura da imagem por IA
// (Edge purchase-receipt-scan, ação scan). A Edge devolve cada linha com o vínculo memorizado.
import { supabase } from '@/lib/supabase';

export interface ScanItem {
  raw_description: string; quantity: number; unit_label: string; unit_price: number;
  line_total: number; line_discount: number;
  catalog_id: string | null; ingredient_id: string | null;
  merchandise_category_id: string | null; dre_category_id: string | null;
  pack_count: number | null; pack_size: number | null;
  confidence: string; match_source: 'memoria' | 'ia' | null;
}
export interface ScanResult {
  source?: 'qrcode';                 // presente quando veio da SEFAZ pelo QR Code
  access_key?: string;               // chave de acesso da NFC-e (44 dígitos)
  duplicate?: { id: string; purchase_date: string } | null;
  readable: boolean; supplier_name: string | null; supplier_key: string;
  invoice_number: string | null; purchase_date: string | null; payment_method: string | null;
  document_total: number | null; discount_total: number | null; items_sum: number;
  items: ScanItem[]; warnings: string[];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Não foi possível abrir a imagem'));
    i.src = url;
  });
}

// Procura o QR Code da NFC-e na foto (no navegador, sem custo). Tenta alguns
// tamanhos: QR pequeno numa foto grande precisa de resolução; foto tremida lê
// melhor reduzida. jsQR é carregado só quando usado.
export async function decodeQrFromFile(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  const { default: jsQR } = await import('jsqr');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    for (const max of [1600, 2400, 1000]) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) return code.data;
      if (scale === 1) break; // imagem já menor que os próximos tamanhos
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// QR de NFC-e do Paraná (única SEFAZ suportada pela Edge por enquanto).
export const isNfcePrQr = (s: string) => /^https?:\/\/(www\.)?fazenda\.pr\.gov\.br\/nfce\/qrcode\/?\?p=\d{44}/i.test(s.trim());

// Foto do celular chega com 4–12 MB: reduz para ~2000px em JPEG antes de enviar
// (lê igual e sobe em segundos no 4G). PDF vai como está.
export async function fileToPayload(file: File): Promise<{ base64: string; mediaType: string }> {
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
    const MAX = 2000;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
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

/** Chama a Edge purchase-receipt-scan — ou lança erro com a mensagem do servidor. */
export async function callScan(tenantId: string | undefined, body: Record<string, unknown>): Promise<ScanResult> {
  const { data, error } = await supabase.functions.invoke('purchase-receipt-scan', {
    body: { ...body, tenant_id: tenantId },
  });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string; data?: ScanResult } | null;
  if (!resp?.success || !resp.data) throw new Error(resp?.error || 'Falha ao ler a nota');
  return resp.data;
}

/** Foto ou PDF: primeiro o QR Code da NFC-e; sem QR (ou SEFAZ fora), leitura por IA. */
export async function lerNotinhaArquivo(tenantId: string | undefined, file: File, etapa: (s: string) => void): Promise<ScanResult> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Arquivo grande demais (máx. 25 MB).');
  let qrErr: string | null = null;
  etapa('Procurando o QR Code da nota…');
  const qr = await decodeQrFromFile(file).catch(() => null);
  if (qr && isNfcePrQr(qr)) {
    etapa('Consultando a nota na SEFAZ…');
    try {
      return await callScan(tenantId, { action: 'qrcode', url: qr });
    } catch (err) {
      // SEFAZ fora do ar ou nota ainda não disponível: segue pela leitura da imagem.
      qrErr = err instanceof Error ? err.message : 'Falha na consulta à SEFAZ';
    }
  }
  etapa('Lendo a nota com IA… (leva alguns segundos)');
  try {
    const { base64, mediaType } = await fileToPayload(file);
    return await callScan(tenantId, { action: 'scan', file_base64: base64, media_type: mediaType });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha ao ler a nota. Tente de novo.';
    throw new Error(qrErr ? `QR Code: ${qrErr} — leitura da foto: ${msg}` : msg);
  }
}

/** Link do QR Code (lido pela câmera ou colado). */
export const lerNotinhaLink = (tenantId: string | undefined, url: string) => callScan(tenantId, { action: 'qrcode', url: url.trim() });

/** Memoriza os vínculos que a pessoa confirmou (sem await: é conveniência). */
export function aprenderVinculos(tenantId: string | undefined, supplierKey: string, items: Array<{
  raw_description: string; ingredient_id?: string | null; catalog_id?: string | null;
  merchandise_category_id?: string | null; dre_category_id?: string | null;
  unit_label?: string | null; pack_count?: number | null; pack_size?: number | null;
}>) {
  const toLearn = items.filter((it) => it.raw_description).map((it) => ({
    raw_description: it.raw_description, ingredient_id: it.ingredient_id ?? null, catalog_id: it.catalog_id ?? null,
    merchandise_category_id: it.merchandise_category_id ?? null, dre_category_id: it.dre_category_id ?? null,
    unit_label: it.unit_label ?? null, pack_count: it.pack_count ?? null, pack_size: it.pack_size ?? null,
  }));
  if (!toLearn.length) return;
  supabase.functions.invoke('purchase-receipt-scan', {
    body: { action: 'learn', tenant_id: tenantId, supplier_key: supplierKey, items: toLearn },
  }).catch(() => { /* memória é conveniência */ });
}

export interface LinhaLida { descricao: string; raw: string; qtd: number; unidade: string; total: number; insumoId: string | null }

/**
 * Linhas da nota para um lançamento que precisa fechar com um valor pago.
 * - Insumo só vem quando o vínculo foi confirmado antes (memória), nunca da sugestão da IA
 *   (regra do dono 2026-09-24: o sistema não sugere insumo).
 * - Se o total da nota bate com o pago e as linhas não (desconto no total), o desconto é
 *   rateado entre as linhas pelo valor, e a última absorve o centavo.
 */
export function linhasParaValor(r: ScanResult, valorPago: number): LinhaLida[] {
  const linhas: LinhaLida[] = r.items.map((si) => {
    const qtd = si.quantity > 0 ? si.quantity : 1;
    const bruto = si.unit_price > 0 ? si.unit_price * qtd : si.line_total + si.line_discount;
    const total = Math.round((bruto - (si.line_discount || 0)) * 100) / 100;
    return {
      descricao: si.raw_description, raw: si.raw_description, qtd, unidade: si.unit_label || 'un',
      total: total > 0 ? total : Math.round(si.line_total * 100) / 100,
      insumoId: si.match_source === 'memoria' ? si.ingredient_id : null,
    };
  });
  const soma = Math.round(linhas.reduce((s, l) => s + l.total, 0) * 100) / 100;
  const doc = r.document_total;
  if (linhas.length && soma > 0 && doc != null && Math.abs(doc - valorPago) < 0.01 && Math.abs(soma - valorPago) >= 0.01) {
    const fator = valorPago / soma;
    let acc = 0;
    linhas.forEach((l, i) => {
      if (i < linhas.length - 1) { l.total = Math.round(l.total * fator * 100) / 100; acc += l.total; }
      else l.total = Math.round((valorPago - acc) * 100) / 100;
    });
  }
  return linhas;
}
