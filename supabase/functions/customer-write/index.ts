import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';

  // >= 40: as chaves novas do Supabase (sb_secret_…) são curtas (~50 chars).
  // Mesmo critério do voucher-write/delivery-write (que funcionam).
  const effectiveServiceKey = serviceRoleKey.length >= 40 ? serviceRoleKey : anonKey;
  const admin = createClient(supabaseUrl, effectiveServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const { action } = body;
    if (!action) return json({ error: 'action is required' }, 400);

    // ── Cliente autenticado (resolve o usuário do JWT) ───────────────────────
    const db = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await db.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    // ── Resolução de tenant (respeita multi-loja) ────────────────────────────
    const requestedTenantId: string | null = body.active_tenant_id ?? body.tenant_id ?? null;
    const { data: tenantRows, error: tenantErr } = await db.rpc('get_tenant_for_user', { p_user_id: user.id });
    if (tenantErr) return json({ error: `Tenant lookup failed: ${tenantErr.message}` }, 500);
    if (!tenantRows || tenantRows.length === 0) return json({ error: 'User does not belong to any tenant' }, 403);

    let tenantId: string;
    if (requestedTenantId) {
      const match = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
      if (!match) return json({ error: 'User does not belong to the requested tenant' }, 403);
      tenantId = match.tenant_id;
    } else if (tenantRows.length === 1) {
      tenantId = tenantRows[0].tenant_id;
    } else {
      return json({ error: 'Multiple tenants found — active_tenant_id required' }, 403);
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: update_customer
    // Edita cadastro + campos de CRM. Só atualiza os campos enviados.
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'update_customer') {
      const { customer_id } = body;
      if (!customer_id) return json({ error: 'customer_id is required' }, 400);

      // Garante que o cliente pertence ao tenant do usuário
      const { data: existing, error: existErr } = await admin
        .from('customers')
        .select('id, accepts_marketing, gdpr_consent_at')
        .eq('id', customer_id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .maybeSingle();
      if (existErr) throw existErr;
      if (!existing) return json({ error: 'Customer not found' }, 404);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

      // Campos de perfil — só entram se vierem no body (undefined = não mexe)
      if (body.name !== undefined) {
        const nome = String(body.name).trim();
        if (!nome) return json({ error: 'name cannot be empty' }, 400);
        patch.name = nome;
      }
      if (body.phone !== undefined) {
        const fone = String(body.phone).replace(/\D/g, '');
        if (fone.length < 10) return json({ error: 'phone must have at least 10 digits' }, 400);
        patch.phone = fone;
      }
      if (body.birth_date !== undefined) patch.birth_date = body.birth_date || null;
      if (body.gender !== undefined) patch.gender = body.gender || null;
      if (body.email !== undefined) patch.email = body.email || null;
      if (body.cpf !== undefined) patch.cpf = body.cpf ? String(body.cpf).replace(/\D/g, '') : null;

      // Campos de CRM
      if (body.notes !== undefined) patch.notes = body.notes || null;
      if (body.manual_tags !== undefined) {
        const tags = Array.isArray(body.manual_tags)
          ? body.manual_tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 20)
          : [];
        patch.manual_tags = tags;
      }
      if (body.accepts_marketing !== undefined) {
        const aceita = !!body.accepts_marketing;
        patch.accepts_marketing = aceita;
        // Registra o consentimento (LGPD) na primeira vez que aceita
        if (aceita && !existing.gdpr_consent_at) patch.gdpr_consent_at = new Date().toISOString();
      }

      const { data: updated, error: updErr } = await admin
        .from('customers')
        .update(patch)
        .eq('id', customer_id)
        .eq('tenant_id', tenantId)
        .select()
        .maybeSingle();
      if (updErr) throw updErr;

      return json({ data: updated });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: touch_contact
    // Marca que o cliente foi contatado agora (anti-spam de campanhas).
    // Aceita um único customer_id ou uma lista customer_ids.
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'touch_contact') {
      const ids: string[] = Array.isArray(body.customer_ids)
        ? body.customer_ids
        : (body.customer_id ? [body.customer_id] : []);
      if (ids.length === 0) return json({ error: 'customer_id or customer_ids is required' }, 400);

      const { error: updErr } = await admin
        .from('customers')
        .update({ last_contacted_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .in('id', ids);
      if (updErr) throw updErr;

      return json({ ok: true, updated: ids.length });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    const msg = e?.message
      ? `${e.message}${e.code ? ` (${e.code})` : ''}${e.details ? ` — ${e.details}` : ''}`
      : (err instanceof Error ? err.message : JSON.stringify(err));
    return json({ error: msg }, 500);
  }
});
