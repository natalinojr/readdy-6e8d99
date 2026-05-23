/**
 * printUtils.ts — Utilitários de impressão
 *
 * Duas formas de imprimir:
 * 1. Impressora de REDE (IP configurado): envia via Edge Function printer-raw (TCP 9100) — SILENCIOSA
 * 2. Impressora USB/Windows (sem IP): abre a janela de impressão do navegador via iframe
 *
 * A função sendToPrinter() escolhe automaticamente a estratégia com base na impressora.
 */

import type { Impressora } from '@/contexts/ImpressorasContext';

export interface PrintOptions {
  paperWidthPx?: number;
}

/**
 * Imprime um ticket de cozinha.
 * - Se a impressora tiver IP: envia silenciosamente via Edge Function printer-raw (sem abrir janela)
 * - Se a impressora for USB/Windows: abre a janela de impressão do navegador
 */
export async function sendToPrinter(
  html: string,
  impressora?: Impressora,
): Promise<{ success: boolean; error?: string }> {
  // Sem impressora configurada — fallback: imprime via navegador (janela aparece)
  if (!impressora) {
    printHTML(html);
    return { success: true };
  }

  // Sem IP = impressora USB/Windows local — abre janela de impressão do navegador
  if (!impressora.ip) {
    printHTML(html);
    return { success: true };
  }

  // Com IP = impressora de rede — envia via Edge Function (SILENCIOSO!)
  try {
    const url = `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/printer-raw`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip: impressora.ip,
        port: 9100,
        content_type: 'html',
        data: html,
        data_encoding: 'utf8',
      }),
    });
    const result = await res.json().catch(() => null);
    if (result?.success) {
      return { success: true };
    }
    return { success: false, error: result?.error || `Erro ${res.status}` };
  } catch (e) {
    const err = e instanceof Error ? e.message : 'Erro desconhecido';
    return { success: false, error: err };
  }
}

/**
 * Impressão via navegador (iframe oculta + window.print).
 * SEMPRE abre a janela de impressão do navegador.
 * Use apenas para impressoras USB/Windows ou quando não há impressora de rede configurada.
 */
export function printHTML(html: string, options?: PrintOptions): void {
  const paperWidth = options?.paperWidthPx ?? 320;

  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:none;visibility:hidden;z-index:-1;';
  document.body.appendChild(iframe);

  const iframeDoc =
    iframe.contentDocument ?? iframe.contentWindow?.document ?? null;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    return;
  }

  iframeDoc.open();
  iframeDoc.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>Print</title>
  <style>
    @page { size: ${paperWidth}px auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; width: ${paperWidth}px; padding: 8px; }
    @media print {
      body { padding: 4px; width: 100%; }
    }
  </style>
</head>
<body>${html}</body>
</html>`);
  iframeDoc.close();

  const doPrint = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) return;
      win.focus();
      win.print();
    } catch (_) {
      /* ignore */
    }
  };

  const cleanup = () => {
    setTimeout(() => {
      try {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      } catch (_) {
        /* already removed */
      }
    }, 3000);
  };

  if (iframeDoc.readyState === 'complete') {
    doPrint();
    cleanup();
  } else {
    iframe.onload = () => {
      doPrint();
      cleanup();
    };
    setTimeout(() => {
      doPrint();
      cleanup();
    }, 400);
  }
}