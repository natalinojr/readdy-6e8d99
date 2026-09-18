import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_BADGE = 5;
const MAX_FAILS_PER_IP = 100; // loja inteira sai pelo mesmo IP (NAT): limite alto, o bloqueio fino é por matrícula
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MSG_BLOQUEIO = 'Muitas tentativas. Aguarde 15 minutos.';

// deno-lint-ignore no-explicit-any
type Db = any;

function getClientIp(req: Request): string | null {
  // cf-connecting-ip é definido pela borda (não vem do cliente); x-forwarded-for como reserva.
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf.slice(0, 64);
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return xff ? xff.slice(0, 64) : null;
}

async function checkRateLimit(db: Db, badge: string, ip: string | null): Promise<string | null> {
  try {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const byBadge = db.from('login_pin_attempts').select('id', { count: 'exact', head: true })
      .eq('badge_number', badge).eq('success', false).gte('created_at', since);
    const byIp = ip
      ? db.from('login_pin_attempts').select('id', { count: 'exact', head: true })
        .eq('ip', ip).eq('success', false).gte('created_at', since)
      : Promise.resolve({ count: 0, error: null });
    const [b, i] = await Promise.all([byBadge, byIp]);
    if (b.error || i.error) {
      console.error('[login-pin] rate limit count error (fail-open):', b.error ?? i.error);
      return null;
    }
    if ((b.count ?? 0) >= MAX_FAILS_PER_BADGE) return MSG_BLOQUEIO;
    if ((i.count ?? 0) >= MAX_FAILS_PER_IP) return MSG_BLOQUEIO;
    return null;
  } catch (e) {
    console.error('[login-pin] rate limit exception (fail-open):', e);
    return null;
  }
}

async function recordAttempt(db: Db, badge: string, ip: string | null, tenantId: string | null, success: boolean): Promise<void> {
  try {
    const { error } = await db.from('login_pin_attempts').insert({ badge_number: badge, ip, tenant_id: tenantId, success });
    if (error) console.error('[login-pin] record attempt error (fail-open):', error);
    // Limpeza oportunista (~2% das chamadas), sem cron.
    if (Math.random() < 0.02) {
      const { error: delError } = await db.from('login_pin_attempts').delete().lt('created_at', new Date(Date.now() - RETENTION_MS).toISOString());
      if (delError) console.error('[login-pin] cleanup error:', delError);
    }
  } catch (e) {
    console.error('[login-pin] record attempt exception (fail-open):', e);
  }
}

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let body: { badge_number?: string; pin?: string; verify_only?: boolean; tenant_id?: string | null; require_manager?: boolean };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

  const { badge_number, pin, verify_only, require_manager } = body;
  const requestedTenantId = typeof body.tenant_id === 'string' && body.tenant_id.trim() ? body.tenant_id.trim() : null;
  if (!badge_number || !pin) return new Response(JSON.stringify({ error: 'badge_number and pin are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const effectiveKey = serviceRoleKey.length >= 40 ? serviceRoleKey : anonKey;
  const db = createClient(supabaseUrl, effectiveKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const badge = String(badge_number).trim().slice(0, 64);
  const clientIp = getClientIp(req);
  const tenantForLog = requestedTenantId && UUID_RE.test(requestedTenantId) ? requestedTenantId : null;

  // Limite de tentativas no servidor (a tela também limita, mas a edge é pública).
  // Fail-open: se a tabela não existir/der erro, registra no log e segue — não pode
  // derrubar o login de todas as lojas.
  const bloqueio = await checkRateLimit(db, badge, clientIp);
  if (bloqueio) return new Response(JSON.stringify({ error: bloqueio }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const { data: userRow, error: userError } = await db.from('users').select('id, name, email, pin_hash, is_active').eq('badge_number', badge).maybeSingle();
  if (userError) console.error('[login-pin] users lookup error:', userError);

  // Mensagem única para matrícula inexistente, sem PIN configurado ou PIN errado (não enumera matrícula).
  const pinOk = !!userRow?.pin_hash && (await sha256(String(pin).trim() + userRow.id)) === userRow.pin_hash;
  if (!userRow) await sha256(String(pin).trim() + badge); // tempo parecido com o caminho da matrícula existente
  if (!userError) await recordAttempt(db, badge, clientIp, tenantForLog, pinOk);
  if (!pinOk) return new Response(JSON.stringify({ error: 'Matrícula ou PIN incorretos' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // Daqui em diante o PIN foi validado: as mensagens específicas não vazam nada a quem não o conhece.
  const userRowOk = userRow!;
  if (!userRowOk.is_active) return new Response(JSON.stringify({ error: 'Usuário inativo' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // Busca o role e tenant_id do usuário via user_tenants
  const { data: tenantRows, error: tenantError } = await db.from('user_tenants').select('tenant_id, role').eq('user_id', userRowOk.id);
  let tenantInfo: { tenant_id: string; role: string } | null;
  if (requestedTenantId) {
    // Loja informada (ex.: totem): exige vínculo NAQUELA loja e devolve essa loja — admin
    // de várias lojas não pode cair no "primeiro vínculo" de outra.
    if (tenantError) return new Response(JSON.stringify({ error: 'Falha ao verificar vínculo com a loja' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    tenantInfo = (tenantRows ?? []).find((t: { tenant_id: string }) => t.tenant_id === requestedTenantId) ?? null;
    if (!tenantInfo) return new Response(JSON.stringify({ error: 'Usuário sem acesso a esta loja' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (require_manager && tenantInfo.role !== 'admin' && tenantInfo.role !== 'manager') {
      return new Response(JSON.stringify({ error: 'Apenas gerente ou administrador' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } else {
    // Sem loja: comportamento antigo — primeiro tenant com role admin/manager, ou o primeiro no geral
    tenantInfo = (tenantRows ?? []).find((t: { role: string }) => t.role === 'admin' || t.role === 'manager') ?? (tenantRows ?? [])[0] ?? null;
  }

  // Se for apenas verificação, não gera token de sessão
  if (verify_only) {
    await db.from('users').update({ last_access_at: new Date().toISOString() }).eq('id', userRowOk.id);
    return new Response(JSON.stringify({
      name: userRowOk.name,
      role: tenantInfo?.role ?? null,
      tenant_id: tenantInfo?.tenant_id ?? null,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Usa o SDK do Supabase para gerar o link mágico (modo login completo)
  let hashedToken: string | null = null;
  try {
    const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: userRowOk.email,
      options: { shouldCreateUser: false },
    });
    if (linkError || !linkData) {
      console.error('[login-pin] generateLink error:', linkError);
      return new Response(JSON.stringify({ error: `Falha ao gerar token de sessão: ${linkError?.message ?? 'generateLink retornou vazio'}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    hashedToken = (linkData.properties as Record<string, unknown>)?.hashed_token as string ?? linkData.hashed_token ?? null;
  } catch (e) {
    console.error('[login-pin] generateLink exception:', e);
    return new Response(JSON.stringify({ error: `Falha ao gerar token de sessão: ${e instanceof Error ? e.message : String(e)}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  if (!hashedToken) return new Response(JSON.stringify({ error: 'Falha ao gerar token de sessão: hashed_token não encontrado na resposta' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  await db.from('users').update({ last_access_at: new Date().toISOString() }).eq('id', userRowOk.id);
  return new Response(JSON.stringify({
    hashed_token: hashedToken,
    name: userRowOk.name,
    role: tenantInfo?.role ?? null,
    tenant_id: tenantInfo?.tenant_id ?? null,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
