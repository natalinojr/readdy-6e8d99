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

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let body: { badge_number?: string; pin?: string; verify_only?: boolean };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

  const { badge_number, pin, verify_only } = body;
  if (!badge_number || !pin) return new Response(JSON.stringify({ error: 'badge_number and pin are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const effectiveKey = serviceRoleKey.length >= 40 ? serviceRoleKey : anonKey;
  const db = createClient(supabaseUrl, effectiveKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: userRow, error: userError } = await db.from('users').select('id, name, email, pin_hash, is_active').eq('badge_number', badge_number.trim()).maybeSingle();
  if (userError || !userRow) return new Response(JSON.stringify({ error: 'Matrícula não encontrada' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (!userRow.is_active) return new Response(JSON.stringify({ error: 'Usuário inativo' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (!userRow.pin_hash) return new Response(JSON.stringify({ error: 'PIN não configurado para este usuário' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const expectedHash = await sha256(pin.trim() + userRow.id);
  if (expectedHash !== userRow.pin_hash) return new Response(JSON.stringify({ error: 'PIN incorreto' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // Busca o role e tenant_id do usuário via user_tenants
  const { data: tenantRows, error: tenantError } = await db.from('user_tenants').select('tenant_id, role').eq('user_id', userRow.id);
  // Pega o primeiro tenant com role de admin/manager, ou o primeiro no geral
  const tenantInfo = (tenantRows ?? []).find((t: { role: string }) => t.role === 'admin' || t.role === 'manager') ?? (tenantRows ?? [])[0] ?? null;

  // Se for apenas verificação, não gera token de sessão
  if (verify_only) {
    await db.from('users').update({ last_access_at: new Date().toISOString() }).eq('id', userRow.id);
    return new Response(JSON.stringify({
      name: userRow.name,
      role: tenantInfo?.role ?? null,
      tenant_id: tenantInfo?.tenant_id ?? null,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Usa o SDK do Supabase para gerar o link mágico (modo login completo)
  let hashedToken: string | null = null;
  try {
    const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: userRow.email,
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

  await db.from('users').update({ last_access_at: new Date().toISOString() }).eq('id', userRow.id);
  return new Response(JSON.stringify({
    hashed_token: hashedToken,
    name: userRow.name,
    role: tenantInfo?.role ?? null,
    tenant_id: tenantInfo?.tenant_id ?? null,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
