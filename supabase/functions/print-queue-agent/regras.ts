// Regras puras da print-queue-agent (sem Deno/rede) — testadas em src/test/edge/printQueueRegras.test.ts.

// Tabela CP860 (Portugues) dos caracteres acentuados/simbolos que a impressora tem.
export const CP860_MAP: Record<string, number> = {
  "á": 0xA0, "Á": 0x86, "à": 0x85, "À": 0x91,
  "â": 0x83, "Â": 0x8F, "ã": 0x84, "Ã": 0x8E,
  "ç": 0x87, "Ç": 0x80,
  "é": 0x82, "É": 0x90, "è": 0x8A, "È": 0x92,
  "ê": 0x88, "Ê": 0x89,
  "í": 0xA1, "Í": 0x8B, "ì": 0x8D, "Ì": 0x98,
  "ó": 0xA2, "Ó": 0x9F, "ò": 0x95, "Ò": 0xA9,
  "ô": 0x93, "Ô": 0x8C, "õ": 0x94, "Õ": 0x99,
  "ú": 0xA3, "Ú": 0x96, "ù": 0x97, "Ù": 0x9D,
  "ü": 0x81, "Ü": 0x9A,
  "ñ": 0xA4, "Ñ": 0xA5,
  "ª": 0xA6, "º": 0xA7,
  "¿": 0xA8, "¡": 0xAD,
  "°": 0xF8,
  "¢": 0x9B, "£": 0x9C, "½": 0xAB, "¼": 0xAC,
  "«": 0xAE, "»": 0xAF, "ß": 0xE1, "µ": 0xE6,
  "±": 0xF1, "÷": 0xF6, "·": 0xFA, "²": 0xFD,
};

// Caracteres comuns em nomes de produto/observacao (vindos de celular, Word, IA)
// que NAO existem na CP860. Antes caiam em `charCode & 0xFF` e viravam bytes de
// controle ESC/POS (ex.: travessao U+2014 -> 0x14), baguncando o ticket.
export const CHAR_SUBST: Record<string, string> = {
  "—": "-", "–": "-", "‒": "-", "‐": "-", "‑": "-", "−": "-", "⁃": "-",
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "´": "'",
  "“": '"', "”": '"', "„": '"', "″": '"',
  "…": "...",
  "•": "*", "●": "*", "‣": "*", "▪": "*",
  " ": " ", " ": " ", " ": " ", " ": " ", "\t": " ",
  "​": "", "‌": "", "‍": "", "﻿": "", "️": "", "\r": "",
  "×": "x", "€": "EUR", "™": "TM", "©": "(c)", "®": "(r)",
};

// Converte texto para bytes CP860. Garantia: nunca emite byte < 0x20 (exceto LF)
// nem 0x7F: texto de usuario nao pode virar comando ESC/POS.
// Ordem: ASCII imprimivel -> tabela CP860 -> substituicao -> letra sem acento -> "?".
export function utf8ToCp860Bytes(str: string): Uint8Array {
  const out: number[] = [];
  for (const ch of String(str ?? "").normalize("NFC")) {
    const code = ch.codePointAt(0) ?? 0x3F;
    if (code === 0x0A || (code >= 0x20 && code <= 0x7E)) { out.push(code); continue; }
    const mapped = CP860_MAP[ch];
    if (mapped !== undefined) { out.push(mapped); continue; }
    const sub = CHAR_SUBST[ch];
    if (sub !== undefined) { for (let i = 0; i < sub.length; i++) out.push(sub.charCodeAt(i)); continue; }
    if (code >= 0x0300 && code <= 0x036F) continue; // acento solto (sem letra pre-composta): descarta
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (base.length === 1) {
      const b = base.charCodeAt(0);
      if (b >= 0x20 && b <= 0x7E) { out.push(b); continue; }
      const bm = CP860_MAP[base];
      if (bm !== undefined) { out.push(bm); continue; }
    }
    out.push(0x3F); // "?"
  }
  return Uint8Array.from(out);
}

// ── Retentativa com backoff por tempo ──
// Antes: 5 falhas seguidas (uma por poll, ~15s) => 'failed' para sempre; trocar
// bobina ou abrir a tampa por 1-5 min perdia o ticket. Agora, apos cada falha o
// ticket volta a 'pending' e so e devolvido no poll depois de um atraso crescente
// (contado de updated_at, gravado no confirm). Vira 'failed' so quando ja tentou
// RETRY_MIN_ATTEMPTS vezes E passaram RETRY_WINDOW_MS desde created_at.
// (O minimo de tentativas protege ticket que ficou parado com o agente desligado.)
// Como o filtro esta no poll, o poll disparado pelo Realtime (job novo) tambem
// respeita o atraso: a impressora quebrada nao e martelada a cada pedido novo.
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000]; // 1a, 2a, 3a, 4a+ falha
export const RETRY_WINDOW_MS = 15 * 60 * 1000;
export const RETRY_MIN_ATTEMPTS = 5;

export function retryEligibleFilter(nowMs: number): string {
  const at = (ms: number) => `"${new Date(nowMs - ms).toISOString()}"`;
  const [d1, d2, d3, d4] = RETRY_DELAYS_MS;
  return [
    "retry_count.is.null",
    "retry_count.eq.0",
    `and(retry_count.eq.1,updated_at.lte.${at(d1)})`,
    `and(retry_count.eq.2,updated_at.lte.${at(d2)})`,
    `and(retry_count.eq.3,updated_at.lte.${at(d3)})`,
    `and(retry_count.gte.4,updated_at.lte.${at(d4)})`,
  ].join(",");
}

export function retryGiveUp(nextRetry: number, createdAt: string | null | undefined, nowMs: number): boolean {
  const created = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(created)) return nextRetry >= RETRY_MIN_ATTEMPTS * 4; // sem data: teto por contagem
  return nextRetry >= RETRY_MIN_ATTEMPTS && nowMs - created >= RETRY_WINDOW_MS;
}

// ── Fallback de impressora quando a estacao nao esta mapeada ──
// Regra (loja com 1 impressora: sempre ela):
//  - estacao de cozinha (station_key = UUID de estacao, ou contem "cozinha"):
//    a primeira impressora (ordem do cadastro) que atende alguma estacao mapeada;
//  - demais (delivery-receipt, danfe, comprovantes...): impressora de
//    'caixa-pdv', senao 'pedidos', senao 'gestor-pedidos';
//  - por fim, a primeira impressora cadastrada (preferindo a que tem IP).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fallbackPrinterId(
  stationKey: string,
  mapaEstacoes: Record<string, string>,
  printersList: Array<Record<string, unknown>>,
  printerById: Record<string, { ip?: string }>,
): string {
  const ids = printersList.map((p) => p.id as string | undefined).filter((id): id is string => !!id && !!printerById[id]);
  if (ids.length === 0) return "";
  if (ids.length === 1) return ids[0];
  const isCozinha = UUID_RE.test(stationKey) || /cozinha/i.test(stationKey);
  if (isCozinha) {
    const alvosEstacao = new Set(
      Object.entries(mapaEstacoes).filter(([k]) => UUID_RE.test(k)).map(([, v]) => v),
    );
    const primeira = ids.find((id) => alvosEstacao.has(id));
    if (primeira) return primeira;
  } else {
    for (const k of ["caixa-pdv", "pedidos", "gestor-pedidos"]) {
      const id = mapaEstacoes[k];
      if (id && printerById[id]) return id;
    }
  }
  return ids.find((id) => !!printerById[id].ip) ?? ids[0];
}
