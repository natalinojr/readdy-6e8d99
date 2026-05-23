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
      // HTML ou texto — converte para bytes UTF-8
      const encoder = new TextEncoder();
      buffer = encoder.encode(data);
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
