import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let body: { email?: string; password?: string; tenant_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

  const { email, password, tenant_id } = body;
  if (!email || !password) return new Response(JSON.stringify({ error: 'email and password are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const effectiveKey = serviceRoleKey.length >= 40 ? serviceRoleKey : anonKey;
  const db = createClient(supabaseUrl, effectiveKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Busca o usuário no auth.users pelo email (usando admin API)
  const normalizedEmail = email.trim().toLowerCase();

  // Verifica credenciais via signInWithPassword (server-side, não afeta sessão do browser)
  const { data: authData, error: authError } = await db.auth.signInWithPassword({
    email: normalizedEmail,
    password: password.trim(),
  });

  if (authError || !authData.user) {
    console.error('[verify-manager-credentials] auth error:', authError?.message);
    return new Response(JSON.stringify({ error: 'Credenciais inválidas' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const userId = authData.user.id;

  // Busca o nome na tabela users
  const { data: userRow } = await db.from('users').select('name, is_active').eq('id', userId).maybeSingle();
  if (!userRow?.is_active) {
    return new Response(JSON.stringify({ error: 'Usuário inativo' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Se tenant_id foi informado, verifica membership e role
  let role: string | null = null;
  if (tenant_id) {
    const { data: tenantRow } = await db.from('user_tenants').select('role').eq('user_id', userId).eq('tenant_id', tenant_id).maybeSingle();
    if (!tenantRow) {
      return new Response(JSON.stringify({ error: 'Usuário não pertence a este estabelecimento' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    role = tenantRow.role;
  } else {
    // Sem tenant_id, pega o primeiro role admin/manager
    const { data: tenantRows } = await db.from('user_tenants').select('role').eq('user_id', userId);
    const best = (tenantRows ?? []).find((t: { role: string }) => t.role === 'admin' || t.role === 'manager');
    role = best?.role ?? (tenantRows ?? [])[0]?.role ?? null;
  }

  return new Response(JSON.stringify({
    name: userRow.name ?? normalizedEmail,
    role: role,
    user_id: userId,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
