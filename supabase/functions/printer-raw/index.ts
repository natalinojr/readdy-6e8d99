/**
 * printer-raw — Edge Function que envia dados raw (ESC/POS ou HTML) diretamente
 * para uma impressora térmica via TCP na porta 9100.
 *
 * Funciona para impressoras de rede (Ethernet) com IP acessível.
 * Para impressoras USB, use o printService do frontend.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface PrinterRawPayload {
  ip: string;
  port?: number;
  content_type: "escpos" | "html" | "text";
  data: string; // base64 ou texto
  data_encoding?: "base64" | "utf8";
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// ── CP860 conversion for Portuguese accents ──────────────────────────────────

const ESC = "\x1B";
const INIT = ESC + "@";
const CP860 = ESC + "\x74\x03";

function utf8ToCp860(str: string): string {
  const map: Record<string, string> = {
    "á": "\xA0", "Á": "\x86", "à": "\x85", "À": "\x91",
    "â": "\x83", "Â": "\x8F", "ã": "\x84", "Ã": "\x8E",
    "ç": "\x87", "Ç": "\x80",
    "é": "\x82", "É": "\x90", "è": "\x8A", "È": "\x92",
    "ê": "\x88", "Ê": "\x89",
    "í": "\xA1", "Í": "\x8B", "ì": "\x8D", "Ì": "\x98",
    "ó": "\xA2", "Ó": "\x9F", "ò": "\x95", "Ò": "\xA9",
    "ô": "\x93", "Ô": "\x8C", "õ": "\x94", "Õ": "\x99",
    "ú": "\xA3", "Ú": "\x96", "ù": "\x97", "Ù": "\x9D",
    "ü": "\x81", "Ü": "\x9A",
    "ñ": "\xA4", "Ñ": "\xA5",
    "ª": "\xA6", "º": "\xA7",
    "¿": "\xA8", "¡": "\xAD",
    "°": "\xF8",
  };
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    out += map[ch] !== undefined ? map[ch] : ch;
  }
  return out;
}

function isEscPos(data: string): boolean {
  return data.indexOf("\x1B") !== -1;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const body = (await req.json()) as PrinterRawPayload;
    const { ip, port = 9100, content_type, data, data_encoding = "utf8" } = body;

    if (!ip || !data) {
      return new Response(
        JSON.stringify({ success: false, error: "IP e data sao obrigatorios" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    // Validacao basica do IP
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
      return new Response(
        JSON.stringify({ success: false, error: "IP invalido" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    let buffer: Uint8Array;

    if (content_type === "escpos" && data_encoding === "base64") {
      // ESC/POS binario em base64
      const binary = atob(data);
      buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
      }
    } else {
      // HTML ou texto — converte para bytes CP860 para acentuacao correta
      if (isEscPos(data)) {
        // Ja contem comandos ESC/POS — envia como latin1
        const converted = utf8ToCp860(data);
        buffer = new Uint8Array(converted.length);
        for (let i = 0; i < converted.length; i++) {
          buffer[i] = converted.charCodeAt(i) & 0xFF;
        }
      } else {
        // Texto/UTF-8 — converte para CP860 e adiciona comando de code page
        const finalData = INIT + CP860 + utf8ToCp860(data);
        buffer = new Uint8Array(finalData.length);
        for (let i = 0; i < finalData.length; i++) {
          buffer[i] = finalData.charCodeAt(i) & 0xFF;
        }
      }
    }

    // Conexao TCP com timeout
    const conn = await Deno.connect({ hostname: ip, port });
    const writePromise = conn.write(buffer);

    // Timeout de 5 segundos
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout na conexao com a impressora")), 5000);
    });

    await Promise.race([writePromise, timeout]);
    conn.close();

    return new Response(
      JSON.stringify({ success: true, bytes_sent: buffer.length }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
  }
});
