import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function corsResponse(body: unknown, status: number): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// UUID nulo padrao pra quando o entity_id nao eh um UUID valido
// (coluna audit_log.entity_id eh NOT NULL, nao pode receber null)
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

async function mainHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { action } = body;
  if (!action) {
    return corsResponse({ error: 'action is required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';

  if (!serviceRoleKey || serviceRoleKey.length < 40) {
    return corsResponse({ error: 'Server misconfiguration (service key)' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId: string;
  try {
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData?.user) {
      return corsResponse({ error: 'Unauthorized' }, 401);
    }
    userId = authData.user.id;
  } catch (authErr) {
    console.error('[audit-write] getUser exception:', String(authErr));
    return corsResponse({ error: 'Authentication failed' }, 401);
  }

  const requestedTenantId: string | null = (body.active_tenant_id ?? body.tenant_id ?? null) as string | null;
  let tenantId: string | null = null;

  try {
    const { data: tenantRow, error: tenantErr } = await db.rpc('get_tenant_for_user', {
      p_user_id: userId,
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
    }

    if (!tenantId) {
      const { data: tenantsArr, error: tenantsErr } = await db.rpc('get_user_tenants', {
        p_user_id: userId,
      });
      if (!tenantsErr && Array.isArray(tenantsArr) && tenantsArr.length > 0) {
        if (requestedTenantId) {
          const match = tenantsArr.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
          tenantId = match?.tenant_id ?? null;
        } else {
          tenantId = tenantsArr[0]?.tenant_id;
        }
      }
    }
  } catch (tenantErr) {
    console.error('[audit-write] tenant resolution exception:', String(tenantErr));
    tenantId = requestedTenantId;
  }

  if (!tenantId) {
    return corsResponse({ error: 'User does not belong to the requested tenant' }, 403);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[audit-write] action=${action} tenant=${tenantId} setup=${elapsed}ms`);

  return handleAction(action, body, tenantId, userId, admin);
}

Deno.serve({ verify_jwt: false }, async (req: Request): Promise<Response> => {
  try {
    return await mainHandler(req);
  } catch (err) {
    console.error('[audit-write] FATAL unhandled error:', String(err));
    return corsResponse({ error: 'Internal server error' }, 500);
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SEVERITIES = ['info', 'aviso', 'critico'];

async function handleAction(
  action: string,
  body: Record<string, unknown>,
  tenantId: string,
  userId: string,
  admin: ReturnType<typeof createClient>,
): Promise<Response> {

  try {
    if (action === 'log_event') {
      return await handleLogEvent(body, tenantId, userId, admin);
    }

    if (action === 'log_batch') {
      return await handleLogBatch(body, tenantId, userId, admin);
    }

    return corsResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[audit-write] action=${action} exception:`, msg);
    return corsResponse({ error: msg }, 500);
  }
}

async function handleLogEvent(
  body: Record<string, unknown>,
  tenantId: string,
  userId: string,
  admin: ReturnType<typeof createClient>,
): Promise<Response> {
  const {
    action_type, entity_type, entity_id, severity, user_name, user_role,
    description, entity_label, entity_label_type, before, after, notes,
  } = body as Record<string, unknown>;

  if (!action_type || !entity_type) {
    return corsResponse({ error: 'action_type and entity_type are required' }, 400);
  }

  const safeSeverity = VALID_SEVERITIES.includes(severity as string) ? severity : 'info';
  // entity_id na tabela eh NOT NULL — usa nil UUID quando nao for um UUID valido
  const entityUUID = entity_id && UUID_RE.test(entity_id as string) ? entity_id : NIL_UUID;

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

  let rpcOk = false;
  try {
    const { error: rpcError } = await admin.rpc('log_audit', {
      p_tenant_id: tenantId,
      p_user_id: userId,
      p_action_type: action_type,
      p_entity_type: entity_type,
      p_entity_id: entityUUID,
      p_details: details,
    });
    rpcOk = !rpcError;
    if (rpcError) {
      console.warn('[audit-write] log_audit RPC failed:', rpcError.message);
    }
  } catch (rpcErr) {
    console.warn('[audit-write] log_audit RPC exception:', String(rpcErr));
  }

  if (!rpcOk) {
    const { error: insertError } = await admin.from('audit_log').insert({
      tenant_id: tenantId,
      user_id: userId,
      action_type,
      entity_type,
      entity_id: entityUUID,
      ip_address: null,
      details,
    });
    if (insertError) {
      console.error('[audit-write] direct insert also failed:', insertError.message);
      throw new Error(insertError.message);
    }
  }

  return corsResponse({ success: true }, 200);
}

async function handleLogBatch(
  body: Record<string, unknown>,
  tenantId: string,
  userId: string,
  admin: ReturnType<typeof createClient>,
): Promise<Response> {
  const { events } = body as { events?: unknown[] };
  if (!Array.isArray(events) || events.length === 0) {
    return corsResponse({ error: 'events must be a non-empty array' }, 400);
  }
  if (events.length > 100) {
    return corsResponse({ error: 'Batch size exceeds maximum of 100 events' }, 400);
  }

  const rows = (events as Record<string, unknown>[]).map((event) => ({
    tenant_id: tenantId,
    user_id: userId,
    action_type: event.action_type,
    entity_type: event.entity_type,
    entity_id: event.entity_id && UUID_RE.test(event.entity_id as string) ? event.entity_id : NIL_UUID,
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

  try {
    const { data, error } = await admin.from('audit_log').insert(rows).select('id');
    if (!error) {
      return corsResponse({ success: true, count: data?.length ?? 0 }, 200);
    }
    console.warn('[audit-write] batch insert failed:', error.message);
  } catch (batchErr) {
    console.warn('[audit-write] batch insert exception:', String(batchErr));
  }

  let count = 0;
  for (const row of rows) {
    try {
      const { error: rpcErr } = await admin.rpc('log_audit', {
        p_tenant_id: row.tenant_id,
        p_user_id: userId,
        p_action_type: row.action_type,
        p_entity_type: row.entity_type,
        p_entity_id: row.entity_id,
        p_details: row.details,
      });
      if (!rpcErr) count++;
    } catch {
      // Skip failed rows
    }
  }

  return corsResponse({ success: true, count }, 200);
}
