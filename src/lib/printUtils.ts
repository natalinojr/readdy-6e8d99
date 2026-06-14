/**
 * printUtils.ts — Utilitários de impressão
 *
 * Três formas de imprimir:
 * 1. Agente local (localhost:9876) — SILENCIOSO, sem janela:
 *    → Sempre tenta primeiro com JSON estruturado (orderData)
 *    → Depois tenta com raw data (ip/port/data)
 * 2. Edge Function printer-raw (TCP 9100 via Supabase) — SILENCIOSO
 *    → Só pra IPs públicos (impressora na nuvem/nuvem privada)
 * 3. Navegador (iframe + window.print) — abre janela:
 *    → Fallback final quando tudo falha
 *
 * A função sendToPrinter() escolhe automaticamente a estratégia.
 */

import type { Impressora } from '@/contexts/ImpressorasContext';

export interface PrintOptions {
  paperWidthPx?: number;
  /** Se true, não abre janela do navegador quando tudo falha. Retorna erro silenciosamente. */
  suppressBrowserFallback?: boolean;
}

export interface PrintResult {
  success: boolean;
  error?: string;
  fallbackToBrowser?: boolean;
  agentUnreachable?: boolean;
}

function isPrivateIP(ip: string): boolean {
  if (!ip || ip.trim() === '') return false;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('127.')) return true;
  return false;
}

function isPageHttps(): boolean {
  try {
    return window.location.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Compatibilidade: AbortSignal.timeout pode não existir em browsers antigos ──
function createTimeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * Testa se o agente local está respondendo.
 */
export async function testAgentConnection(timeoutMs = 2000): Promise<{
  online: boolean;
  url?: string;
  error?: string;
  mixedContent?: boolean;
}> {
  const urls = ['http://127.0.0.1:9876/health', 'http://localhost:9876/health'];
  const mixedContentWarning = isPageHttps();

  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        return { online: true, url };
      }
    } catch (e: unknown) {
      clearTimeout(timeout);
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('Failed to fetch') && mixedContentWarning) {
        return {
          online: false,
          url,
          mixedContent: true,
          error: 'Pagina HTTPS bloqueou conexao HTTP com agente local (mixed content).',
        };
      }
    }
  }

  return {
    online: false,
    error: mixedContentWarning
      ? 'Agente local nao encontrado. Se a pagina esta em HTTPS, o browser pode estar bloqueando a conexao com localhost HTTP.'
      : 'Agente local nao encontrado em localhost:9876. Verifique se o agente esta rodando.',
    mixedContent: mixedContentWarning,
  };
}

async function sendToLocalAgentRaw(
  ip: string,
  port: number,
  data: string,
  impressoraId?: string,
  dataEncoding = 'utf8',
  timeoutMs = 3000,
): Promise<{ success: boolean; bytes_sent?: number; error?: string }> {
  const url = 'http://127.0.0.1:9876/print';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const payload: Record<string, unknown> = { ip, port, data, data_encoding: dataEncoding };
  if (impressoraId) {
    payload.impressora_id = impressoraId;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, error: `Agente local retornou HTTP ${res.status}: ${body}` };
    }

    const result = await res.json().catch(() => null);
    if (result?.success) {
      return { success: true, bytes_sent: result?.bytes_sent };
    }
    return { success: false, error: result?.error || 'Agente local retornou erro desconhecido' };
  } catch (e: unknown) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    if (msg.includes('abort') || msg.includes('AbortError') || msg.includes('Failed to fetch')) {
      return { success: false, error: 'Agente local nao encontrado (localhost:9876)' };
    }
    return { success: false, error: msg };
  }
}

// ── Ticket estruturado (JSON) pro agente local do Claude ───────────────────────

export interface TicketItem {
  quantidade: number;
  nome: string;
  opcoes?: Array<{ nome: string; obrigatorio?: boolean }>;
  observacoes?: string[];
  /** Partes de produção destacadas para esta estação (ex: ['hamburguer']) */
  partes_destaque?: string[];
}

export interface TicketPayload {
  numero: number;
  destino: string;
  origem: string;
  impressora_id: string;
  itens: TicketItem[];
  data_hora?: string;
  mesa?: string;
  comanda?: string;
  observacao_geral?: string;
  senha?: string;
  participant_name?: string;
  /** Nome da estação de produção (ex: 'Hamburguer', 'Fritadeira') para exibir no cabeçalho */
  estacao?: string;
  /** Valor total do pedido */
  total?: number;
  /** Indica que o pedido é para viagem/retirada */
  para_viagem?: boolean;
}

/**
 * Envia ticket estruturado em JSON para o agente local.
 * Tenta 127.0.0.1 (IPv4) e depois localhost.
 */
export async function sendTicketToAgent(
  payload: TicketPayload,
  timeoutMs = 3000,
): Promise<{ success: boolean; bytes_sent?: number; error?: string }> {
  const urls = ['http://127.0.0.1:9876/print', 'http://localhost:9876/print'];
  let lastError = '';

  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        lastError = `Agente local retornou HTTP ${res.status}: ${body}`;
        continue;
      }

      const result = await res.json().catch(() => null);
      if (result?.success) {
        return { success: true, bytes_sent: result?.bytes_sent };
      }
      lastError = result?.error || 'Agente local retornou erro desconhecido';
    } catch (e: unknown) {
      clearTimeout(timeout);
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      if (msg.includes('abort') || msg.includes('AbortError') || msg.includes('Failed to fetch')) {
        lastError = 'Agente local nao encontrado (localhost:9876)';
      } else {
        lastError = msg;
      }
    }
  }

  if (isPageHttps() && lastError.includes('Agente local nao encontrado')) {
    lastError += '. ATENCAO: pagina HTTPS pode bloquear conexao HTTP com localhost. Acesse via HTTP ou instale certificado no agente.';
  }

  return { success: false, error: lastError };
}

/**
 * Envia ticket para impressora.
 * Fluxo:
 * 1. Se houver orderData (JSON estruturado): tenta agente local SILENCIOSAMENTE primeiro.
 *    → Se o agente confirmar, retorna sucesso SEM abrir janela.
 *    → Se o agente falhar, continua o fluxo normal.
 * 2. Se houver impressora com IP privado: tenta agente local com raw data.
 * 3. Se houver impressora com IP público: envia via Edge Function.
 * 4. Fallback final: abre janela do navegador (iframe + window.print).
 */
export async function sendToPrinter(
  html: string,
  impressora?: Impressora,
  orderData?: TicketPayload,
  options?: PrintOptions,
): Promise<PrintResult> {
  const suppressFallback = options?.suppressBrowserFallback ?? false;

  console.log('[printUtils] sendToPrinter chamado. suppressFallback=', suppressFallback);
  console.log('[printUtils] impressora:', impressora ? `${impressora.nome} (id=${impressora.id}, ip=${impressora.ip || 'n/a'})` : 'NENHUMA');
  console.log('[printUtils] orderData:', orderData ? `PEDIDO #${orderData.numero} para ${orderData.destino}, ${orderData.itens.length} itens, impressora_id=${orderData.impressora_id}` : 'NENHUM');

  // ── PASSO 1: Tentar agente local com JSON estruturado (silencioso, sem janela) ──
  if (orderData) {
    console.log('[printUtils] PASSO 1: Tentando agente local com orderData JSON...');
    try {
      const agentResult = await sendTicketToAgent(orderData, 3000);
      if (agentResult.success) {
        console.log('[printUtils] PASSO 1: Agente local imprimiu com sucesso via orderData! Bytes:', agentResult.bytes_sent);
        return { success: true };
      }
      console.warn('[printUtils] PASSO 1: Agente local retornou erro:', agentResult.error);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      console.warn('[printUtils] PASSO 1: Agente local nao respondeu no orderData:', msg);
    }
  }

  // ── PASSO 2: Sem impressora configurada → fallback navegador (se permitido) ──
  if (!impressora) {
    if (suppressFallback) {
      console.warn('[printUtils] PASSO 2: Sem impressora e suppressFallback=true → retornando erro silencioso');
      return { success: false, error: 'Nenhuma impressora configurada e fallback do navegador suprimido.' };
    }
    console.warn('[printUtils] PASSO 2: Sem impressora → abrindo janela do navegador');
    printHTML(html);
    return { success: true, fallbackToBrowser: true, error: 'Nenhuma impressora configurada. Agente local nao respondeu.' };
  }

  // ── PASSO 3: Sem IP = impressora USB/Windows → fallback navegador (se permitido) ──
  if (!impressora.ip) {
    if (suppressFallback) {
      console.warn('[printUtils] PASSO 3: Impressora sem IP e suppressFallback=true → retornando erro silencioso');
      return { success: false, error: 'Impressora sem IP configurado e fallback do navegador suprimido.' };
    }
    console.warn('[printUtils] PASSO 3: Impressora sem IP (USB/Windows) → abrindo janela');
    printHTML(html);
    return { success: true, fallbackToBrowser: true };
  }

  const ip = impressora.ip.trim();
  const privado = isPrivateIP(ip);

  // ── PASSO 4: IP privado → tenta agente local com raw data ──
  if (privado) {
    console.log(`[printUtils] PASSO 4: IP privado (${ip}) → tentando agente local raw...`);
    const agentResult = await sendToLocalAgentRaw(ip, 9100, html, impressora.id, 'utf8', 3000);
    if (agentResult.success) {
      console.log('[printUtils] PASSO 4: Agente local raw imprimiu! Bytes:', agentResult.bytes_sent);
      return { success: true };
    }
    console.warn('[printUtils] PASSO 4: Agente local raw falhou:', agentResult.error);
    if (suppressFallback) {
      console.warn('[printUtils] PASSO 4: suppressFallback=true → retornando erro silencioso');
      return { success: false, agentUnreachable: true, error: agentResult.error };
    }
    console.warn('[printUtils] PASSO 4: IP privado nao alcancavel. Caindo no fallback navegador...');
    printHTML(html);
    return {
      success: true,
      fallbackToBrowser: true,
      agentUnreachable: true,
      error: agentResult.error,
    };
  }

  // ── PASSO 5: IP público → Edge Function (silencioso) ──
  console.log(`[printUtils] PASSO 5: IP publico (${ip}) → Edge Function printer-raw...`);
  try {
    const url = `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/printer-raw`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip,
        port: 9100,
        content_type: 'html',
        data: html,
        data_encoding: 'utf8',
      }),
    });
    const result = await res.json().catch(() => null);
    if (result?.success) {
      console.log('[printUtils] PASSO 5: Edge Function imprimiu! Bytes:', result?.bytes_sent);
      return { success: true };
    }
    console.error('[printUtils] PASSO 5: Edge Function erro:', result?.error || `HTTP ${res.status}`);
    return { success: false, error: result?.error || `Erro ${res.status}` };
  } catch (e) {
    const err = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[printUtils] PASSO 5: Erro na Edge Function:', err);
    return { success: false, error: err };
  }
}

/**
 * Impressão via navegador (iframe oculta + window.print).
 * SEMPRE abre a janela de impressão do navegador.
 * Use apenas como fallback final.
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
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>Print</title>
  <style>
    @page { size: ${paperWidth}px auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; width: ${paperWidth}px; padding: 8px; }
    @media print {
      body { padding: 4px; width: 100%; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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