// Regras puras do agente de impressão remoto (RF-01/02/06/07/08).
// Só Web APIs (crypto.getRandomValues, crypto.subtle, Headers) — precisa rodar
// tanto em Deno (Edge Functions) quanto em Node 20 (vitest). NÃO importar
// Deno.* nem supabase-js aqui. Testado em src/test/edge/printAgents.test.ts.

export const AGENT_TOKEN_PREFIX = "epa_";
export const HEARTBEAT_MIN_INTERVAL_MS = 30_000;

export const AGENT_CONFIG_DEFAULTS = {
  print_queue_enabled: true,
  polling_enabled: true,
  poll_interval_ms: 3000,
  realtime_enabled: true,
  realtime_debounce_ms: 250,
  safety_poll_interval_ms: 60000,
  realtime_watchdog_ms: 60000,
  config_refresh_ms: 60000,
} as const;

export type AgentAuth =
  | { mode: "anon" }
  | { mode: "token"; token: string }
  | { mode: "token-invalid" };

export type AgentRemoteConfig = typeof AGENT_CONFIG_DEFAULTS & {
  agent_id: string;
  apelido: string;
  tenant_ids: string[];
  supabase_anon_key: string;
};

// token bem formado: prefixo epa_ + 43 chars base64url (32 bytes aleatórios) = 47 chars totais.
const TOKEN_RE = /^epa_[A-Za-z0-9_-]{43}$/;

function base64UrlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateAgentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return AGENT_TOKEN_PREFIX + base64UrlFromBytes(bytes);
}

export function isWellFormedAgentToken(t: unknown): t is string {
  return typeof t === "string" && TOKEN_RE.test(t);
}

export async function hashAgentToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export function readAgentAuth(headers: Headers): AgentAuth {
  const raw = headers.get("x-agent-token");
  if (!raw) return { mode: "anon" };
  if (!isWellFormedAgentToken(raw)) return { mode: "token-invalid" };
  return { mode: "token", token: raw };
}

export function decidePoll(i: {
  mode: "anon" | "token";
  callerAgentId: string | null;
  assignedAgentId: string | null;
  requireToken: boolean;
}): "serve" | "empty_assigned" | "empty_require_token" | "forbidden" {
  if (i.mode === "token") {
    return i.assignedAgentId !== null && i.assignedAgentId === i.callerAgentId ? "serve" : "forbidden";
  }
  // anon
  if (i.assignedAgentId !== null) return "empty_assigned";
  if (i.requireToken) return "empty_require_token";
  return "serve";
}

export function decideConfirm(i: {
  mode: "anon" | "token";
  callerAgentId: string | null;
  assignedAgentId: string | null;
}): "ok" | "forbidden" {
  if (i.mode === "anon") return "ok";
  return i.assignedAgentId !== null && i.assignedAgentId === i.callerAgentId ? "ok" : "forbidden";
}

export function buildAgentConfig(i: {
  agentId: string;
  apelido: string;
  tenantIds: string[];
  anonKey: string;
}): AgentRemoteConfig {
  const tenant_ids = Array.from(new Set(i.tenantIds)).sort();
  return {
    ...AGENT_CONFIG_DEFAULTS,
    agent_id: i.agentId,
    apelido: i.apelido,
    tenant_ids,
    supabase_anon_key: i.anonKey,
  };
}

export function shouldHeartbeat(lastSeenIso: string | null, nowMs: number): boolean {
  if (!lastSeenIso) return true;
  const last = Date.parse(lastSeenIso);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= HEARTBEAT_MIN_INTERVAL_MS;
}

const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;

export function sanitizeVersion(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return VERSION_RE.test(v) ? v : null;
}

export function truncateError(s: unknown, max = 500): string | null {
  if (s === undefined || s === null || s === "") return null;
  const str = String(s);
  return str.length > max ? str.slice(0, max) : str;
}
