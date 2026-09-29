// inter-webhook — aviso do Banco Inter quando um pagamento que mandamos muda de status (2026-09-29).
//
// Cadastrado pelo inter-bank › webhook { op: 'put' } para os tipos pix-pagamento e boleto-pagamento,
// com a URL  .../inter-webhook?t=<tenant_id>&k=<INTER_WEBHOOK_KEY>.
//
// Segurança: o Inter chama com certificado de cliente (mTLS), que a Supabase não deixa conferir. Por isso
// o aviso é só um GATILHO: nada do corpo é gravado nem confiado. Pega os códigos (codigoSolicitacao do Pix,
// codigoTransacao do boleto), acha os nossos pagamentos em andamento com esse código na loja e pede ao
// assistente-telegram › pay_watch { ids } que confira AGORA no Inter — o mesmo caminho do acompanhamento
// automático (status, conversa, pendência, comprovante, baixa, push). Aviso falso = uma consulta a mais.
//
// Responde 200 sempre que a chave confere (o Inter reenvia em 20/30/60/120 min se não for 200).
// Publicada com --no-verify-jwt (o Inter não manda JWT).
// Secrets: INTER_WEBHOOK_KEY, ASSISTENTE_INTERNAL_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const webhookKey = Deno.env.get('INTER_WEBHOOK_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';
const EM_ANDAMENTO = ['sent', 'pending_approval', 'approved', 'scheduled'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'inter-webhook', level, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}
function igual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** Códigos do aviso: objeto, lista ou { pix: [...] }; só texto curto sem espaço. */
function codigos(body: unknown): string[] {
  const itens: unknown[] = Array.isArray(body) ? body
    // deno-lint-ignore no-explicit-any
    : Array.isArray((body as any)?.pix) ? (body as any).pix : [body];
  const out = new Set<string>();
  for (const it of itens.slice(0, 50)) {
    // deno-lint-ignore no-explicit-any
    const x = it as any;
    for (const c of [x?.codigoSolicitacao, x?.codigoTransacao]) {
      const s = typeof c === 'string' ? c.trim() : '';
      if (s && s.length <= 80 && /^[\w-]+$/.test(s)) out.add(s);
    }
  }
  return [...out];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('t') ?? '';
  const k = url.searchParams.get('k') ?? '';
  if (webhookKey.length < 24 || !igual(k, webhookKey) || !UUID.test(tenantId)) {
    log('WARN', 'aviso recusado', { tenantId: UUID.test(tenantId) ? tenantId : null });
    return json({ error: 'Unauthorized' }, 401);
  }
  let body: unknown = null;
  try { body = await req.json(); } catch { /* corpo inválido: nada a conferir */ }
  const cods = codigos(body);
  // deno-lint-ignore no-explicit-any
  const status = (body as any)?.status ?? null;
  if (!cods.length) { log('WARN', 'aviso sem código', { tenantId }); return json({ ok: true, conferidos: 0 }); }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: pays, error } = await admin.from('fin_inter_payments').select('id')
    .eq('tenant_id', tenantId).in('inter_code', cods).in('status', EM_ANDAMENTO).limit(20);
  if (error) { log('ERROR', 'buscar pagamento', { tenantId, error: error.message }); return json({ error: 'erro interno' }, 500); }
  const ids = (pays ?? []).map((p) => String(p.id));
  log('INFO', 'aviso recebido', { tenantId, codigos: cods, status_aviso: status, pagamentos: ids });
  if (!ids.length) return json({ ok: true, conferidos: 0 });

  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey, Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ action: 'pay_watch', ids }),
    });
    const out = await r.json().catch(() => ({}));
    log('INFO', 'conferido no Inter', { tenantId, ids, resultado: out });
    // Falha aqui: 500 faz o Inter reenviar mais tarde; o acompanhamento automático (~45 s) segue valendo.
    if (!r.ok) return json({ error: 'conferência falhou' }, 500);
    return json({ ok: true, conferidos: ids.length });
  } catch (e) {
    log('ERROR', 'chamar pay_watch', { tenantId, error: String((e as Error)?.message ?? e) });
    return json({ error: 'conferência falhou' }, 500);
  }
});
