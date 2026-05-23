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

function ok(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function errResp(message: string) {
  return new Response(JSON.stringify({ error: message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function adminCreateUser(
  supabaseUrl: string, serviceKey: string, email: string, password: string
): Promise<{ id: string; email: string } | null> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) { const body = await res.text(); throw new Error(`adminCreateUser failed (${res.status}): ${body}`); }
  return res.json();
}

async function adminDeleteUser(supabaseUrl: string, serviceKey: string, userId: string): Promise<void> {
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
  });
}

async function adminUpdateUser(supabaseUrl: string, serviceKey: string, userId: string, updates: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify(updates),
  });
  if (!res.ok) { const body = await res.text(); throw new Error(`adminUpdateUser failed (${res.status}): ${body}`); }
}

async function adminGetUser(
  supabaseUrl: string, serviceKey: string, userId: string
): Promise<{ id: string; email: string; user_metadata?: Record<string, unknown> } | null> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function verifyJWT(req: Request): Promise<boolean> {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return false;
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    });
    return res.ok;
  } catch { return false; }
}

/**
 * Gera a próxima matrícula sequencial no formato 0001, 0002, ...
 * Busca o maior badge_number numérico existente e incrementa.
 */
async function gerarProximaMatricula(db: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await db
    .from('users')
    .select('badge_number')
    .not('badge_number', 'is', null)
    .order('badge_number', { ascending: false });

  let maxNum = 0;
  if (data && data.length > 0) {
    for (const row of data as { badge_number: string }[]) {
      const n = parseInt(row.badge_number ?? '0', 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  }

  const proximo = maxNum + 1;
  return proximo.toString().padStart(4, '0');
}

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const isAuthenticated = await verifyJWT(req);
  if (!isAuthenticated) return errResp('Unauthorized');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const effectiveKey = serviceRoleKey.length >= 40 ? serviceRoleKey : anonKey;
    const db = createClient(supabaseUrl, effectiveKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const body = await req.json();
    const { action } = body;

    // ─── create_user ──────────────────────────────────────────────────────────
    if (action === 'create_user') {
      const { nome, email, senha, perfil, tenant_id, training_mode, matricula, pin } = body;

      const roleMap: Record<string, string> = {
        admin: 'admin', gerente: 'manager', caixa: 'cashier',
        garcom: 'waiter', cozinha: 'kitchen', totem: 'tablet',
      };

      const isTotem = perfil === 'totem';

      // Gera matrícula sequencial se não fornecida
      let badgeNumber: string;
      if (matricula?.trim()) {
        badgeNumber = matricula.trim();
      } else {
        badgeNumber = await gerarProximaMatricula(db);
      }

      // Garante unicidade da matrícula
      const { data: existingBadge } = await db.from('users').select('id').eq('badge_number', badgeNumber).maybeSingle();
      if (existingBadge) {
        // Se colidiu, gera uma nova automaticamente
        badgeNumber = await gerarProximaMatricula(db);
      }

      let userId: string;

      if (isTotem) {
        // Totem: cria usuário com email sintético (matrícula@totem.local), sem precisar de email real
        const syntheticEmail = `totem_${badgeNumber}_${tenant_id?.slice(0, 8) ?? 'local'}@totem.erpos.local`;
        const senhaTotem = senha?.trim() || `totem_${badgeNumber}_${Date.now()}`;

        let authUser: { id: string; email: string };
        try {
          const created = await adminCreateUser(supabaseUrl, serviceRoleKey, syntheticEmail, senhaTotem);
          if (!created) return errResp('Erro ao criar usuário totem');
          authUser = created;
        } catch (e) {
          return errResp(e instanceof Error ? e.message : String(e));
        }

        userId = authUser.id;

        const { error: userError } = await db.from('users').upsert({
          id: userId,
          name: nome,
          email: syntheticEmail,
          is_active: true,
          badge_number: badgeNumber,
        });
        if (userError) {
          await adminDeleteUser(supabaseUrl, serviceRoleKey, userId);
          return errResp(userError.message);
        }

        const { error: tenantError } = await db.from('user_tenants').insert({
          user_id: userId,
          tenant_id,
          role: 'tablet',
          training_mode: training_mode ?? false,
        });
        if (tenantError) {
          await adminDeleteUser(supabaseUrl, serviceRoleKey, userId);
          return errResp(tenantError.message);
        }

        // Define PIN automaticamente se fornecido
        if (pin) {
          const trimmedPin = String(pin).trim();
          if (trimmedPin.length >= 4 && trimmedPin.length <= 8) {
            const pinHash = await sha256(trimmedPin + userId);
            await db.from('users').update({ pin_hash: pinHash }).eq('id', userId);
          }
        }

        return ok({ success: true, user_id: userId, matricula: badgeNumber, email: syntheticEmail });
      }

      // Usuário normal (não totem)
      // Email é opcional — se não fornecido, gera um sintético baseado na matrícula
      const effectiveEmail = email?.trim()
        ? email.trim()
        : `user_${badgeNumber}_${tenant_id?.slice(0, 8) ?? 'local'}@erpos.local`;

      if (!senha?.trim() || senha.trim().length < 6) {
        return errResp('Senha obrigatória (mínimo 6 caracteres)');
      }

      let authUser: { id: string; email: string };
      try {
        const created = await adminCreateUser(supabaseUrl, serviceRoleKey, effectiveEmail, senha.trim());
        if (!created) return errResp('Erro ao criar usuário');
        authUser = created;
      } catch (e) {
        return errResp(e instanceof Error ? e.message : String(e));
      }

      userId = authUser.id;

      const { error: userError } = await db.from('users').upsert({
        id: userId,
        name: nome,
        email: effectiveEmail,
        is_active: true,
        badge_number: badgeNumber,
      });
      if (userError) {
        await adminDeleteUser(supabaseUrl, serviceRoleKey, userId);
        return errResp(userError.message);
      }

      const { error: tenantError } = await db.from('user_tenants').insert({
        user_id: userId,
        tenant_id,
        role: roleMap[perfil] ?? 'waiter',
        training_mode: training_mode ?? false,
      });
      if (tenantError) {
        await adminDeleteUser(supabaseUrl, serviceRoleKey, userId);
        return errResp(tenantError.message);
      }

      // Define PIN se fornecido
      if (pin) {
        const trimmedPin = String(pin).trim();
        if (trimmedPin.length >= 4 && trimmedPin.length <= 8) {
          const pinHash = await sha256(trimmedPin + userId);
          await db.from('users').update({ pin_hash: pinHash }).eq('id', userId);
        }
      }

      return ok({ success: true, user_id: userId, matricula: badgeNumber });
    }

    // ─── delete_user ──────────────────────────────────────────────────────────
    if (action === 'delete_user') {
      const { user_id, tenant_id } = body;
      if (!user_id) return errResp('user_id obrigatório');

      // Remove do tenant primeiro
      if (tenant_id) {
        await db.from('user_tenants').delete().eq('user_id', user_id).eq('tenant_id', tenant_id);
      }

      // Soft delete na tabela users
      await db.from('users').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', user_id);

      // Hard delete no Auth (remove acesso de login)
      try {
        await adminDeleteUser(supabaseUrl, serviceRoleKey, user_id);
      } catch (e) {
        console.warn('[user-write] adminDeleteUser error (non-fatal):', e);
      }

      return ok({ success: true });
    }

    // ─── reset_password ───────────────────────────────────────────────────────
    if (action === 'reset_password') {
      const { user_id, nova_senha } = body;
      try {
        await adminUpdateUser(supabaseUrl, serviceRoleKey, user_id, { password: nova_senha });
      } catch (e) {
        return errResp(e instanceof Error ? e.message : String(e));
      }
      return ok({ success: true });
    }

    // ─── set_pin ──────────────────────────────────────────────────────────────
    if (action === 'set_pin') {
      const { user_id, pin } = body;
      if (!user_id || !pin) return errResp('user_id e pin são obrigatórios');
      const trimmedPin = String(pin).trim();
      if (trimmedPin.length < 4 || trimmedPin.length > 8) return errResp('PIN deve ter entre 4 e 8 dígitos');
      if (user_id === '00000000-0000-0000-0000-000000000000') return errResp('Usuário não encontrado');
      const { data: existingUser } = await db.from('users').select('id').eq('id', user_id).maybeSingle();
      if (!existingUser) return errResp('Usuário não encontrado');
      const pinHash = await sha256(trimmedPin + user_id);
      const { error } = await db.from('users').update({ pin_hash: pinHash }).eq('id', user_id);
      if (error) return errResp(error.message);
      return ok({ success: true });
    }

    // ─── clear_pin ────────────────────────────────────────────────────────────
    if (action === 'clear_pin') {
      const { user_id } = body;
      if (!user_id) return errResp('user_id obrigatório');
      const { error } = await db.from('users').update({ pin_hash: null }).eq('id', user_id);
      if (error) return errResp(error.message);
      return ok({ success: true });
    }

    // ─── ensure_user_exists ───────────────────────────────────────────────────
    if (action === 'ensure_user_exists') {
      const { user_id } = body;
      if (!user_id) return errResp('user_id obrigatório');
      const { data: existingUser } = await db.from('users').select('id').eq('id', user_id).maybeSingle();
      if (!existingUser) {
        try {
          const authUser = await adminGetUser(supabaseUrl, serviceRoleKey, user_id);
          if (authUser) {
            const name = (authUser.user_metadata?.name as string) || authUser.email?.split('@')[0] || 'Operador';
            const email = authUser.email || `user_${user_id}@erpos.local`;
            await db.from('users').upsert(
              { id: user_id, name, email, is_active: true },
              { onConflict: 'id', ignoreDuplicates: true }
            );
          }
        } catch { /* non-fatal */ }
      }
      return ok({ success: true });
    }

    return errResp('Ação desconhecida');
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
