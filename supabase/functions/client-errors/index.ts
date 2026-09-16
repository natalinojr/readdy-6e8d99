// client-errors — Edge Function PÚBLICA (verify_jwt: false): recebe erros do front
// (window.onerror, unhandledrejection, ErrorBoundary, invokeWithAuth com 4xx/5xx) e grava
// em dev_error_events via fn_dev_error_report (dedup por fingerprint).
// Pública porque o erro pode acontecer antes do login. Defesas: só POST, lote ≤ 20,
// campos truncados, rate limit por IP em memória (por instância) e user_id só quando
// o JWT do Authorization for válido — nunca confia no user_id mandado pelo cliente.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SOURCES = new Set(['front', 'edge', 'sw', 'other']);
const MAX_BATCH = 20;
const RATE_PER_MIN = 60;
const rate = new Map<string, { n: number; t: number }>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const r = rate.get(ip);
  if (!r || now - r.t > 60_000) { rate.set(ip, { n: 1, t: now }); return true; }
  r.n++;
  return r.n <= RATE_PER_MIN;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!allowed(ip)) return json({ error: 'rate_limited' }, 429);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // user_id só de JWT válido
  let userId: string | null = null;
  const auth = req.headers.get('Authorization') ?? '';
  if (auth.startsWith('Bearer ') && auth.length > 40 && auth.slice(7) !== anonKey) {
    try {
      const { data } = await createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } }).auth.getUser();
      userId = data?.user?.id ?? null;
    } catch { /* anônimo */ }
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const events: any[] = Array.isArray(body?.events) ? body.events.slice(0, MAX_BATCH) : body ? [body] : [];
  if (events.length === 0) return json({ ok: true, saved: 0 });

  const ua = req.headers.get('user-agent')?.slice(0, 400) ?? null;
  let saved = 0;
  const errors: string[] = [];
  for (const ev of events) {
    const message = str(ev?.message, 2000);
    if (!message) continue;
    const source = SOURCES.has(ev?.source) ? ev.source : 'front';
    const payload = {
      source,
      severity: ev?.severity === 'warning' ? 'warning' : 'error',
      message,
      stack: str(ev?.stack, 8000),
      route: str(ev?.route, 300),
      fn: str(ev?.fn, 200),
      tenant_id: typeof ev?.tenant_id === 'string' && /^[0-9a-f-]{36}$/i.test(ev.tenant_id) ? ev.tenant_id : null,
      user_id: userId,
      app_build: str(ev?.app_build, 80),
      user_agent: ua,
      context: ev?.context && typeof ev.context === 'object' ? JSON.parse(JSON.stringify(ev.context).slice(0, 4000)) : {},
    };
    const { error } = await admin.rpc('fn_dev_error_report', { p: payload });
    if (error) errors.push(error.message);
    else saved++;
  }
  if (errors.length) console.error('[client-errors] rpc falhou:', errors.slice(0, 3));
  return json({ ok: true, saved, failed: errors.length });
});
