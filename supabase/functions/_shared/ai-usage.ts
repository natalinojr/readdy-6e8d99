// Custo da IA num lugar só (dono, 2026-09-28): toda Edge Function que chama a API da Anthropic
// registra cada resposta em public.ai_usage_events. A tela Assistente › Custos da IA soma por loja,
// por pessoa e por uso (feature).
//
// Uso: depois de cada client.messages.create(...)
//   registrarUsoIa(admin, { feature: 'leitura-notinha', model: res.model, usage: res.usage, tenantId, userId });
// Nunca lança erro nem atrasa a resposta de propósito: falha de registro só vai para o console.
// Preço de lista (US$ por milhão de tokens). Cache: leitura 0,1×, escrita 5 min 1,25×, 1 h 2×.
// Web search: US$ 10 por 1.000 buscas.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const PRECOS: Array<{ prefixo: string; entrada: number; saida: number }> = [
  { prefixo: 'claude-opus-5-5', entrada: 4, saida: 20 },
  { prefixo: 'claude-opus', entrada: 5, saida: 25 },
  { prefixo: 'claude-sonnet', entrada: 2, saida: 10 },
  { prefixo: 'claude-haiku', entrada: 1, saida: 5 },
  { prefixo: 'claude-fable', entrada: 10, saida: 50 },
];

// deno-lint-ignore no-explicit-any
type Usage = any;

export type UsoIa = {
  feature: string;
  model: string;
  usage: Usage;
  tenantId?: string | null;
  userId?: string | null;
  ref?: string | null;
  /** Detalhe do uso para abrir na tela (ex.: assistente → 'canal|assunto'). */
  detalhe?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNull = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

export function custoIaUsd(model: string, usage: Usage): number {
  const p = PRECOS.find((x) => String(model ?? '').startsWith(x.prefixo)) ?? PRECOS[2];
  const u = usage ?? {};
  const w1h = Number(u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const wTotal = Number(u.cache_creation_input_tokens ?? 0);
  const tokens = Number(u.input_tokens ?? 0) * p.entrada
    + Number(u.output_tokens ?? 0) * p.saida
    + Number(u.cache_read_input_tokens ?? 0) * p.entrada * 0.1
    + Math.max(wTotal - w1h, 0) * p.entrada * 1.25
    + w1h * p.entrada * 2;
  return tokens / 1e6 + Number(u.server_tool_use?.web_search_requests ?? 0) * 0.01;
}

export async function registrarUsoIa(admin: SupabaseClient, uso: UsoIa): Promise<void> {
  try {
    const u = uso.usage ?? {};
    const { error } = await admin.from('ai_usage_events').insert({
      tenant_id: uuidOuNull(uso.tenantId),
      user_id: uuidOuNull(uso.userId),
      feature: uso.feature,
      model: String(uso.model ?? ''),
      input_tokens: Number(u.input_tokens ?? 0),
      output_tokens: Number(u.output_tokens ?? 0),
      cache_read_tokens: Number(u.cache_read_input_tokens ?? 0),
      cache_write_tokens: Number(u.cache_creation_input_tokens ?? 0),
      web_searches: Number(u.server_tool_use?.web_search_requests ?? 0),
      cost_usd: Number(custoIaUsd(uso.model, u).toFixed(6)),
      ref: uso.ref ? String(uso.ref).slice(0, 200) : null,
      detalhe: uso.detalhe ? String(uso.detalhe).slice(0, 120) : null,
    });
    if (error) console.error(JSON.stringify({ level: 'WARN', msg: 'ai_usage_events', error: error.message }));
  } catch (e) {
    console.error(JSON.stringify({ level: 'WARN', msg: 'ai_usage_events', error: e instanceof Error ? e.message : String(e) }));
  }
}
