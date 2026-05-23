/**
 * bootstrap-admin — cria o usuário admin master e o tenant demo
 *
 * IMPORTANTE: NÃO usa createClient com service role key porque o novo formato
 * sb_secret_... não é reconhecido pelo Supabase JS client como service role.
 * Todas as operações privilegiadas usam a REST API diretamente via fetch.
 */

const TENANT_ID = 'a1b2c3d4-0000-0000-0000-000000000001';
const BOOTSTRAP_SECRET = 'erpos-bootstrap-2025';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bootstrap-secret',
};

// ─── Auth Admin REST helpers ──────────────────────────────────────────────────

async function authAdminListUsers(
  supabaseUrl: string,
  serviceKey: string,
): Promise<Array<{ id: string; email?: string }>> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1000`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
  });
  if (!res.ok) throw new Error(`listUsers failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data?.users ?? [];
}

async function authAdminCreateUser(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
  password: string,
  name: string,
): Promise<{ id: string }> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
  });
  if (!res.ok) throw new Error(`createUser failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function authAdminUpdateUser(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`updateUser failed (${res.status}): ${await res.text()}`);
}

// ─── PostgREST RPC helper ─────────────────────────────────────────────────────

async function restRpc(
  supabaseUrl: string,
  serviceKey: string,
  fn: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; data: unknown; text: string; status: number }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, data, text, status: res.status };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const secret = req.headers.get('x-bootstrap-secret');
  if (secret !== BOOTSTRAP_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  console.log('[bootstrap-admin] ENV check:', {
    hasUrl: !!supabaseUrl,
    hasServiceKey: !!serviceRoleKey,
    serviceKeyLen: serviceRoleKey.length,
    serviceKeyPrefix: serviceRoleKey.substring(0, 12),
  });

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Missing env vars: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const ADMIN_EMAIL = 'admin@erpos.com';
  const ADMIN_PASSWORD = '123456';
  const ADMIN_NAME = 'Admin Master';

  try {
    // ── 1. Verificar/criar usuário auth via REST ────────────────────────────────
    console.log('[bootstrap-admin] Listing users...');
    const users = await authAdminListUsers(supabaseUrl, serviceRoleKey);
    const existing = users.find((u) => u.email === ADMIN_EMAIL);
    let authUserId: string;

    if (existing) {
      authUserId = existing.id;
      console.log('[bootstrap-admin] User exists, updating password...');
      await authAdminUpdateUser(supabaseUrl, serviceRoleKey, authUserId, {
        password: ADMIN_PASSWORD,
        email_confirm: true,
      });
    } else {
      console.log('[bootstrap-admin] Creating new admin user...');
      const newUser = await authAdminCreateUser(
        supabaseUrl, serviceRoleKey, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME,
      );
      authUserId = newUser.id;
    }

    console.log('[bootstrap-admin] Auth user id:', authUserId);

    // ── 2. Chamar RPC bootstrap_tenant via REST ────────────────────────────────
    console.log('[bootstrap-admin] Calling bootstrap_tenant RPC...');
    const rpcResult = await restRpc(supabaseUrl, serviceRoleKey, 'bootstrap_tenant', {
      p_tenant_id: TENANT_ID,
      p_tenant_name: 'Restaurante Demo',
      p_tenant_slug: 'demo',
      p_user_id: authUserId,
      p_user_name: ADMIN_NAME,
      p_user_email: ADMIN_EMAIL,
      p_user_badge: '0001',
      p_role: 'admin',
    });

    if (!rpcResult.ok) {
      console.error('[bootstrap-admin] bootstrap_tenant RPC failed:', rpcResult.status, rpcResult.text);
      return new Response(
        JSON.stringify({ error: `bootstrap_tenant RPC failed (${rpcResult.status}): ${rpcResult.text}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcData = rpcResult.data as any;
    if (rpcData && rpcData.success === false) {
      return new Response(
        JSON.stringify({ error: `bootstrap_tenant error: ${rpcData.error}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('[bootstrap-admin] ✅ Bootstrap complete! user_id:', authUserId);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Admin criado com sucesso!',
        credentials: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        user_id: authUserId,
        tenant_id: TENANT_ID,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[bootstrap-admin] ❌ Unexpected error:', String(err));
    return new Response(
      JSON.stringify({ error: `Unexpected error: ${String(err)}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
