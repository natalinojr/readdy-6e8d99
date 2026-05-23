import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';

  // Client with user's JWT for auth verification
  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Admin client — prefers service role key, falls back to anon
  const effectiveKey = serviceRoleKey.length > 100 ? serviceRoleKey : anonKey;
  const admin = createClient(supabaseUrl, effectiveKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { action } = body;
    if (!action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const requestedTenantId: string | null = body.active_tenant_id ?? body.tenant_id ?? null;

    // Resolve tenant — try get_tenant_for_user first, fallback to get_user_tenants
    let tenantId: string | null = null;

    const { data: tenantRow, error: tenantErr } = await db.rpc('get_tenant_for_user', {
      p_user_id: user.id,
    });

    if (!tenantErr && tenantRow) {
      if (Array.isArray(tenantRow)) {
        if (requestedTenantId) {
          const match = tenantRow.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
          tenantId = match?.tenant_id ?? null;
        } else {
          tenantId = tenantRow[0]?.tenant_id ?? null;
        }
      } else if (typeof tenantRow === 'object') {
        const row = tenantRow as { tenant_id?: string };
        tenantId = row.tenant_id ?? null;
        if (requestedTenantId && tenantId !== requestedTenantId) tenantId = null;
      }
    } else {
      // Fallback
      const { data: tenantsArr, error: tenantsErr } = await db.rpc('get_user_tenants', {
        p_user_id: user.id,
      });
      if (!tenantsErr && tenantsArr && tenantsArr.length > 0) {
        if (requestedTenantId) {
          const match = tenantsArr.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
          tenantId = match?.tenant_id ?? null;
        } else {
          tenantId = tenantsArr[0].tenant_id;
        }
      }
    }

    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'User does not belong to the requested tenant' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return handleAction(action, body, tenantId, user.id, admin, corsHeaders);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SEVERITIES = ['info', 'aviso', 'critico'];

async function handleAction(
  action: string,
  body: Record<string, unknown>,
  tenantId: string,
  userId: string,
  // deno-lint-ignore no-explicit-any
  admin: any,
  corsHeaders: Record<string, string>,
): Promise<Response> {

  if (action === 'log_event') {
    const {
      action_type, entity_type, entity_id, severity, user_name, user_role,
      description, entity_label, entity_label_type, before, after, notes,
    } = body as Record<string, unknown>;

    if (!action_type || !entity_type) {
      return new Response(JSON.stringify({ error: 'action_type and entity_type are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const safeSeverity = VALID_SEVERITIES.includes(severity as string) ? severity : 'info';
    const entityUUID = entity_id && UUID_RE.test(entity_id as string) ? entity_id : null;

    const details = {
      severity: safeSeverity,
      user_name: user_name ?? null,
      user_role: user_role ?? null,
      description: description ?? null,
      entity_label: entity_label ?? null,
      entity_label_type: entity_label_type ?? null,
      before: before ?? null,
      after: after ?? null,
      notes: notes ?? null,
    };

    // Use SECURITY DEFINER RPC to bypass RLS — this is the reliable path
    const { error: rpcError } = await admin.rpc('log_audit', {
      p_tenant_id: tenantId,
      p_user_id: userId,
      p_action_type: action_type,
      p_entity_type: entity_type,
      p_entity_id: entityUUID,
      p_details: details,
    });

    if (rpcError) {
      // Fallback: try direct insert with service role
      const { error: insertError } = await admin.from('audit_log').insert({
        tenant_id: tenantId,
        user_id: userId,
        action_type,
        entity_type,
        entity_id: entityUUID,
        ip_address: null,
        details,
      });
      if (insertError) throw new Error(insertError.message);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'log_batch') {
    const { events } = body as { events?: unknown[] };
    if (!Array.isArray(events) || events.length === 0) {
      return new Response(JSON.stringify({ error: 'events must be a non-empty array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (events.length > 100) {
      return new Response(JSON.stringify({ error: 'Batch size exceeds maximum of 100 events' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = (events as Record<string, unknown>[]).map((event) => ({
      tenant_id: tenantId,
      user_id: userId,
      action_type: event.action_type,
      entity_type: event.entity_type,
      entity_id: event.entity_id && UUID_RE.test(event.entity_id as string) ? event.entity_id : null,
      ip_address: null,
      details: {
        severity: VALID_SEVERITIES.includes(event.severity as string) ? event.severity : 'info',
        user_name: event.user_name ?? null,
        user_role: event.user_role ?? null,
        description: event.description ?? null,
        entity_label: event.entity_label ?? null,
        entity_label_type: event.entity_label_type ?? null,
        before: event.before ?? null,
        after: event.after ?? null,
        notes: event.notes ?? null,
      },
    }));

    // Try batch insert via service role
    const { data, error } = await admin.from('audit_log').insert(rows).select('id');
    if (error) {
      // Fallback: insert one by one via log_audit RPC
      let count = 0;
      for (const row of rows) {
        const { error: rpcErr } = await admin.rpc('log_audit', {
          p_tenant_id: row.tenant_id,
          p_user_id: userId,
          p_action_type: row.action_type,
          p_entity_type: row.entity_type,
          p_entity_id: row.entity_id,
          p_details: row.details,
        });
        if (!rpcErr) count++;
      }
      return new Response(JSON.stringify({ success: true, count }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, count: data?.length ?? 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
