import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ============================================
// ESC/POS Constants
// ============================================

const ESC = "\x1B";
const GS = "\x1D";
const INIT = ESC + "@";
const BOLD_ON = ESC + "E\x01";
const BOLD_OFF = ESC + "E\x00";
const ALIGN_CENTER = ESC + "a\x01";
const ALIGN_LEFT = ESC + "a\x00";
const ALIGN_RIGHT = ESC + "a\x02";
const CUT = GS + "V\x01";
const LINE_FEED = "\x0A";
const DOUBLE_HEIGHT = ESC + "!\x10";
const DOUBLE_WIDTH_HEIGHT = ESC + "!\x30";
const NORMAL = ESC + "!\x00";
const UNDERLINE_ON = ESC + "-\x01";
const UNDERLINE_OFF = ESC + "-\x00";
const CP860 = ESC + "\x74\x03";

// ============================================
// Helpers
// ============================================

function latin1ToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xFF;
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, bytes.length);
    chunks.push(String.fromCharCode(...Array.from(bytes.subarray(i, end))));
  }
  return btoa(chunks.join(""));
}

function utf8ToCp860Bytes(str: string): Uint8Array {
  const map: Record<string, number> = {
    "\u00E1": 0xA0, "\u00C1": 0x86, "\u00E0": 0x85, "\u00C0": 0x91,
    "\u00E2": 0x83, "\u00C2": 0x8F, "\u00E3": 0x84, "\u00C3": 0x8E,
    "\u00E7": 0x87, "\u00C7": 0x80,
    "\u00E9": 0x82, "\u00C9": 0x90, "\u00E8": 0x8A, "\u00C8": 0x92,
    "\u00EA": 0x88, "\u00CA": 0x89,
    "\u00ED": 0xA1, "\u00CD": 0x8B, "\u00EC": 0x8D, "\u00CC": 0x98,
    "\u00F3": 0xA2, "\u00D3": 0x9F, "\u00F2": 0x95, "\u00D2": 0xA9,
    "\u00F4": 0x93, "\u00D4": 0x8C, "\u00F5": 0x94, "\u00D5": 0x99,
    "\u00FA": 0xA3, "\u00DA": 0x96, "\u00F9": 0x97, "\u00D9": 0x9D,
    "\u00FC": 0x81, "\u00DC": 0x9A,
    "\u00F1": 0xA4, "\u00D1": 0xA5,
    "\u00AA": 0xA6, "\u00BA": 0xA7,
    "\u00BF": 0xA8, "\u00A1": 0xAD,
    "\u00B0": 0xF8,
  };
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = map[ch];
    out[i] = code !== undefined ? code : (ch.charCodeAt(0) & 0xFF);
  }
  return out;
}

function toCp860(str: string): string {
  const bytes = utf8ToCp860Bytes(str);
  return String.fromCharCode(...Array.from(bytes));
}

const ORIGEM_PT: Record<string, string> = {
  "cashier": "Caixa",
  "waiter": "Garcom",
  "self_service": "Autoatendimento",
  "delivery": "Delivery",
  "table": "Mesa",
  "mesa": "Mesa",
};

// ============================================
// formatTicket — gera ESC/POS completo
// ============================================

function formatTicket(
  payload: Record<string, unknown>,
  papel: "80mm" | "58mm"
): string {
  const {
    numero,
    destino = "",
    origem = "",
    itens = [] as Array<Record<string, unknown>>,
    data_hora,
    mesa,
    comanda,
    observacao_geral,
    senha,
    participant_name,
    estacao,
    total,
    para_viagem,
  } = payload;

  const origemDisplay = ORIGEM_PT[(origem as string || "").toLowerCase()] || origem || "";

  const width = papel === "58mm" ? 32 : 48;
  const sep = "-".repeat(width);
  const eqSep = "=".repeat(width);

  let out = INIT;
  out += CP860;

  // ========================================================
  // CABEÇALHO — Estação (pequeno, secundário)
  // ========================================================
  if (estacao) {
    out += ALIGN_CENTER;
    out += toCp860(`--- ${(estacao as string).toUpperCase()} ---`) + LINE_FEED;
    out += LINE_FEED;
  }

  // ========================================================
  // ═══ INFORMAÇÕES PRINCIPAIS (EM EVIDÊNCIA) ═══
  // ========================================================

  // ── SENHA ── (DOUBLE WIDTH + HEIGHT + BOLD + UNDERLINE)
  if (senha) {
    out += ALIGN_CENTER;
    out += toCp860(eqSep) + LINE_FEED;
    out += UNDERLINE_ON + BOLD_ON + DOUBLE_WIDTH_HEIGHT + toCp860(`  SENHA: ${senha}  `) + NORMAL + BOLD_OFF + UNDERLINE_OFF + LINE_FEED;
    out += toCp860(eqSep) + LINE_FEED;
    out += LINE_FEED;
    out += ALIGN_LEFT;
  }

  // ── DESTINO ── (double height + bold, centralizado)
  if (destino) {
    out += ALIGN_CENTER;
    out += BOLD_ON + DOUBLE_HEIGHT + toCp860(`>> ${destino.toUpperCase()} <<`) + NORMAL + BOLD_OFF;
    out += LINE_FEED + LINE_FEED;
    out += ALIGN_LEFT;
  }

  // ── NOME DO CLIENTE ── (double height + bold, centralizado)
  if (participant_name) {
    out += ALIGN_CENTER;
    out += BOLD_ON + DOUBLE_HEIGHT + toCp860(`${(participant_name as string).toUpperCase()}`) + NORMAL + BOLD_OFF;
    out += LINE_FEED + LINE_FEED;
    out += ALIGN_LEFT;
  }

  // ── PARA VIAGEM ── (destaque especial se aplicável)
  if (para_viagem) {
    out += ALIGN_CENTER;
    out += BOLD_ON + DOUBLE_HEIGHT + toCp860(">> PARA VIAGEM <<") + BOLD_OFF + NORMAL;
    out += LINE_FEED + LINE_FEED;
    out += ALIGN_LEFT;
  }

  // ── Separador ──
  out += toCp860(eqSep) + LINE_FEED;

  // ========================================================
  // INFORMAÇÕES SECUNDÁRIAS (menor destaque)
  // ========================================================

  // Pedido # (tamanho normal, só bold)
  out += BOLD_ON + toCp860(`Pedido: #${numero || "---"}`) + BOLD_OFF + LINE_FEED;

  const now = data_hora || new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  out += toCp860(now as string) + LINE_FEED;

  if (origem) {
    out += toCp860(`Origem: ${origemDisplay}`) + LINE_FEED;
  }
  if (mesa) {
    out += toCp860(`Mesa: ${mesa}`) + LINE_FEED;
  }
  if (comanda) {
    out += toCp860(`Comanda: ${comanda}`) + LINE_FEED;
  }

  out += toCp860(sep) + LINE_FEED;

  // ========================================================
  // ITENS — NOME EM CAIXA ALTA
  // ========================================================
  (itens as Array<Record<string, unknown>>).forEach((item) => {
    const qtd = (item.quantidade as number) || 1;
    const nome = ((item.nome as string) || "Item").toUpperCase();
    const qtdStr = String(qtd).padStart(2, " ");

    out += ALIGN_LEFT;
    out += BOLD_ON + toCp860(`${qtdStr}x ${nome}`) + BOLD_OFF + LINE_FEED;

    const opcoes = item.opcoes as Array<string | { nome: string; obrigatorio?: boolean }> | undefined;
    if (opcoes && opcoes.length > 0) {
      opcoes.forEach((opt) => {
        const optNome = typeof opt === "string" ? opt : opt.nome;
        const obrigatorio = typeof opt === "object" && opt.obrigatorio;
        out += toCp860(`   ${obrigatorio ? "  " : "+ "}${optNome}`) + LINE_FEED;
      });
    }

    const observacoes = item.observacoes as string[] | undefined;
    if (observacoes && observacoes.length > 0) {
      observacoes.forEach((obs) => {
        out += toCp860(`   * ${obs}`) + LINE_FEED;
      });
    }

    const partesDestaque = item.partes_destaque as string[] | undefined;
    if (partesDestaque && partesDestaque.length > 0) {
      out += toCp860(sep) + LINE_FEED;
      out += BOLD_ON;
      partesDestaque.forEach((parte) => {
        out += DOUBLE_HEIGHT + toCp860(`>> ${parte.toUpperCase()} <<`) + NORMAL + LINE_FEED;
      });
      out += BOLD_OFF;
    }

    out += LINE_FEED;
  });

  // ========================================================
  // TOTAL
  // ========================================================
  if (total !== undefined && total !== null && (total as number) > 0) {
    out += LINE_FEED;
    out += toCp860(sep) + LINE_FEED;
    out += ALIGN_RIGHT;
    out += DOUBLE_HEIGHT + BOLD_ON + toCp860(`TOTAL: R$ ${Number(total).toFixed(2).replace(".", ",")}`) + BOLD_OFF + NORMAL + LINE_FEED;
    out += ALIGN_LEFT;
  }

  out += toCp860(sep) + LINE_FEED;

  // ========================================================
  // OBSERVAÇÃO
  // ========================================================
  if (observacao_geral) {
    const estacaoUpper = (estacao as string || "").toUpperCase();
    if (estacaoUpper.includes("COMPROVANTE") || estacaoUpper.includes("RETIRADA")) {
      out += toCp860(observacao_geral as string) + LINE_FEED;
      out += toCp860(sep) + LINE_FEED;
    } else {
      out += BOLD_ON + toCp860("OBS:") + BOLD_OFF + LINE_FEED;
      out += toCp860(observacao_geral as string) + LINE_FEED;
      out += toCp860(sep) + LINE_FEED;
    }
  }

  // ========================================================
  // RODAPÉ
  // ========================================================
  out += ALIGN_CENTER;
  out += toCp860(eqSep) + LINE_FEED;
  out += BOLD_ON + toCp860("ERPOS - Sistema de Gestao") + BOLD_OFF + LINE_FEED;
  out += toCp860(eqSep) + LINE_FEED;

  out += CUT;

  return out;
}

// ============================================
// Main Handler
// ============================================

interface PollPayload {
  action: "poll";
  tenant_id: string;
  limit?: number;
}

interface ConfirmPayload {
  action: "confirm";
  queue_id: string;
  status: "printed" | "failed";
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as PollPayload | ConfirmPayload;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Configuracao do servidor incompleta" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
    });

    // -- POLL --
    if (body.action === "poll") {
      const { tenant_id, limit = 10 } = body as PollPayload;

      if (!tenant_id) {
        return new Response(
          JSON.stringify({ success: false, error: "tenant_id obrigatorio" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.log(`[print-queue-agent] POLL tenant=${tenant_id.slice(0, 8)}... limit=${limit}`);

      const { data, error } = await supabaseAdmin
        .from("print_queue")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("status", "pending")
        .lt("retry_count", 5)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        console.error("[print-queue-agent] poll error:", error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.log(`[print-queue-agent] POLL encontrou ${data?.length ?? 0} ticket(s)`);

      // Marca como printing
      if (data && data.length > 0) {
        const ids = data.map((d: { id: string }) => d.id);
        const { error: updateError } = await supabaseAdmin
          .from("print_queue")
          .update({ status: "printing", updated_at: new Date().toISOString() })
          .in("id", ids);

        if (updateError) {
          console.error("[print-queue-agent] erro ao marcar printing:", updateError);
        }
      }

      // ── Resolve impressora_id -> IP/porta/papel via printers_config (fonte unica: o app) ──
      // O agente passa a imprimir no IP que vem RESOLVIDO no ticket, sem depender do
      // config.json local de cada PC. Trocar/criar impressora no app reflete em todos
      // os PCs automaticamente.
      const { data: settingsRow } = await supabaseAdmin
        .from("system_settings")
        .select("printers_config")
        .eq("tenant_id", tenant_id)
        .maybeSingle();

      const printersConfig = (settingsRow?.printers_config as Record<string, unknown> | null) ?? {};
      const printersList = (printersConfig.impressoras ?? []) as Array<Record<string, unknown>>;
      const mapaEstacoes = (printersConfig.mapaEstacoes ?? {}) as Record<string, string>;
      const printerById: Record<string, { ip?: string; porta: number; papel: string; nome?: string }> = {};
      for (const p of printersList) {
        const pid = p.id as string | undefined;
        if (!pid) continue;
        printerById[pid] = {
          ip: (p.ip as string) || undefined,
          porta: (p.porta as number) || (p.port as number) || 9100,
          papel: ((p.paperStyle as string) || (p.papel as string) || "80mm") === "58mm" ? "58mm" : "80mm",
          nome: (p.nome as string) || (p.descricao as string) || undefined,
        };
      }
      // Se houver exatamente UMA impressora, ela vira o destino padrao quando a
      // estacao do ticket nao estiver mapeada (lojas com 1 impressora "so funcionam").
      const defaultPrinterId = printersList.length === 1 ? (printersList[0].id as string) : "";

      // ── GERA ESC/POS PRÉ-FORMATADO ──
      const tickets = (data ?? []).map((ticket: Record<string, unknown>) => {
        // Resolve estacao -> impressora (id) -> ip/porta/papel.
        // PDV ja grava impressora_id = id da impressora; canais do cliente gravam o
        // station_key (precisa passar pelo mapaEstacoes). Cobrimos os dois casos aqui.
        const directId = (ticket.impressora_id as string) ||
          ((ticket.payload as Record<string, unknown> | undefined)?.impressora_id as string) || "";
        const stationKey = (ticket.station_key as string) || "";
        let printerId = "";
        if (directId && printerById[directId]) {
          printerId = directId; // ja e um id de impressora valido
        } else {
          printerId = mapaEstacoes[stationKey] || mapaEstacoes[directId] || defaultPrinterId;
        }
        const resolved = printerById[printerId] || ({} as { ip?: string; porta?: number; papel?: string; nome?: string });
        const papelTicket: "80mm" | "58mm" = resolved.papel === "58mm" ? "58mm" : "80mm";
        const printerFields = {
          impressora_ip: resolved.ip ?? (ticket.impressora_ip as string | null) ?? null,
          impressora_port: resolved.porta ?? (ticket.impressora_port as number | null) ?? 9100,
          impressora_nome: resolved.nome ?? (ticket.impressora_nome as string | null) ?? null,
          paper_style: papelTicket,
        };

        const payload = ticket.payload as Record<string, unknown> | undefined;
        if (!payload || !payload.itens) {
          return { ...ticket, ...printerFields, escpos_80mm_base64: null, escpos_58mm_base64: null };
        }

        // (1) Data/hora SEMPRE derivada do created_at (timestamptz autoritativo) no
        // fuso America/Sao_Paulo — a edge roda em UTC, entao alguns canais saíam +3h.
        // (2) Nome do cliente SEM o endereço: delivery-write grava destino como
        // "Nome - Endereço" (ou "Nome - Retirada/Entrega"); para delivery/retirada
        // mostramos só o nome (parte antes do primeiro " - ").
        const createdAtIso = ticket.created_at as string | undefined;
        const origemTicket = String(payload.origem || "").toLowerCase();
        const destinoRaw = payload.destino;
        const destinoLimpo = (origemTicket === "delivery" || origemTicket === "retirada") && typeof destinoRaw === "string"
          ? (destinoRaw.split(/\s+[-–—]\s+/)[0].trim() || destinoRaw)
          : destinoRaw;
        const payloadTicket: Record<string, unknown> = { ...payload, destino: destinoLimpo };
        if (createdAtIso) {
          payloadTicket.data_hora = new Date(createdAtIso).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
          });
        }

        try {
          const escpos80 = formatTicket(payloadTicket, "80mm");
          const escpos58 = formatTicket(payloadTicket, "58mm");

          const bytes80 = latin1ToBytes(escpos80);
          const bytes58 = latin1ToBytes(escpos58);

          return {
            ...ticket,
            ...printerFields,
            escpos_80mm_base64: bytesToBase64(bytes80),
            escpos_58mm_base64: bytesToBase64(bytes58),
            escpos_80mm_size: bytes80.length,
            escpos_58mm_size: bytes58.length,
          };
        } catch (fmtErr) {
          console.error(`[print-queue-agent] erro formatando ticket ${ticket.id}:`, fmtErr);
          return { ...ticket, ...printerFields, escpos_80mm_base64: null, escpos_58mm_base64: null, format_error: (fmtErr as Error).message };
        }
      });

      return new Response(
        JSON.stringify({ success: true, tickets }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // -- CONFIRM --
    if (body.action === "confirm") {
      const { queue_id, status, error: errMsg } = body as ConfirmPayload;

      if (!queue_id || !status) {
        return new Response(
          JSON.stringify({ success: false, error: "queue_id e status obrigatorios" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.log(`[print-queue-agent] CONFIRM queue_id=${queue_id.slice(0, 8)}... status=${status}`);

      const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };

      if (status === "printed") {
        updates.printed_at = new Date().toISOString();
      }

      if (status === "failed") {
        const { data: current } = await supabaseAdmin
          .from("print_queue")
          .select("retry_count")
          .eq("id", queue_id)
          .single();

        const nextRetry = (current?.retry_count ?? 0) + 1;
        updates.retry_count = nextRetry;
        if (errMsg) updates.last_error = errMsg;
        updates.status = nextRetry >= 5 ? "failed" : "pending";
      }

      const { error: confirmErr } = await supabaseAdmin
        .from("print_queue")
        .update(updates)
        .eq("id", queue_id);

      if (confirmErr) {
        console.error("[print-queue-agent] confirm error:", confirmErr);
        return new Response(
          JSON.stringify({ success: false, error: confirmErr.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Acao invalida. Use 'poll' ou 'confirm'." }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[print-queue-agent] exception:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});