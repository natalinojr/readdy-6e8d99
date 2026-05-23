import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function resp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function isAdminOrManager(role: string | null): boolean {
  if (!role) return false;
  const n = role.toLowerCase().trim();
  return n === 'admin' || n === 'manager' || n === 'gerente';
}

const TIPO_TO_DB: Record<string, string> = {
  dinheiro: 'cash', credito: 'credit_card', debito: 'debit_card', pix: 'pix',
  vale: 'meal_voucher', cash: 'cash', credit_card: 'credit_card',
  debit_card: 'debit_card', meal_voucher: 'meal_voucher', other: 'other',
};
const DB_TO_TIPO: Record<string, string> = {
  cash: 'dinheiro', credit_card: 'credito', debit_card: 'debito',
  pix: 'pix', meal_voucher: 'vale', other: 'vale',
};

const ROLE_PT_TO_DB: Record<string, string> = {
  admin: 'admin', gerente: 'manager', manager: 'manager',
  caixa: 'cashier', cashier: 'cashier', garcom: 'waiter', waiter: 'waiter',
  cozinha: 'kitchen', kitchen: 'kitchen',
};
const ROLE_DB_TO_PT: Record<string, string> = {
  admin: 'admin', manager: 'gerente', cashier: 'caixa', waiter: 'garcom', kitchen: 'cozinha',
};

function mapPaymentMethodRow(row: Record<string, unknown>) {
  if (!row) return row;
  return { ...row, type: DB_TO_TIPO[row.type as string] ?? row.type };
}
function serializeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}
function normalizeIdType(v: string | null | undefined): string {
  if (!v) return 'nome';
  const map: Record<string, string> = {
    nome: 'nome', name: 'nome', senha: 'senha', password: 'senha',
    pin: 'senha', comanda: 'comanda', ticket: 'comanda', nenhum: 'nenhum', none: 'nenhum',
  };
  return map[v.toLowerCase()] ?? v;
}
function normalizePaymentType(v: string | null | undefined): string {
  if (!v) return 'hora';
  const map: Record<string, string> = {
    hora: 'hora', upfront: 'hora', now: 'hora',
    entrega: 'entrega', delivery: 'entrega', later: 'entrega',
    ambos: 'ambos', both: 'ambos',
  };
  return map[v.toLowerCase()] ?? v;
}

async function callRpc(supabaseUrl: string, serviceRoleKey: string, fnName: string, args: Record<string, unknown>) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`RPC ${fnName} failed [${res.status}]: ${text}`);
  return data;
}

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token || token === 'null' || token === 'undefined' || token === '') {
    return resp({ error: 'Missing Authorization header' }, 401);
  }

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userError } = await userDb.auth.getUser();
  if (userError || !user) return resp({ error: 'Unauthorized' }, 401);

  const adminDb = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const { action } = body;
    if (!action) return resp({ error: 'action is required' }, 400);

    const requestedTenantId: string | null = body.active_tenant_id ?? body.tenant_id ?? null;

    const { data: tenantRowsRaw, error: tenantLookupErr } = await adminDb
      .from('user_tenants')
      .select('tenant_id, role')
      .eq('user_id', user.id);

    if (tenantLookupErr) {
      console.error('[config-write] tenant lookup error:', tenantLookupErr.message);
      return resp({ error: `Tenant lookup failed: ${tenantLookupErr.message}` }, 500);
    }

    const tenantRows = (tenantRowsRaw ?? []) as Array<{ tenant_id: string; role: string }>;
    if (tenantRows.length === 0) return resp({ error: 'User does not belong to any tenant' }, 403);

    let tenantId: string;
    let role: string | null = null;
    if (requestedTenantId) {
      const match = tenantRows.find((r) => r.tenant_id === requestedTenantId);
      if (!match) return resp({ error: 'User does not belong to the requested tenant' }, 403);
      tenantId = match.tenant_id;
      role = match.role;
    } else if (tenantRows.length === 1) {
      tenantId = tenantRows[0].tenant_id;
      role = tenantRows[0].role;
    } else {
      return resp({ error: 'Multiple tenants found — active_tenant_id required' }, 403);
    }

    const adminActions = [
      'create_kitchen_station', 'update_kitchen_station', 'delete_kitchen_station',
      'create_payment_method', 'update_payment_method', 'delete_payment_method',
      'assign_station_operator', 'remove_station_operator',
      'create_ingredient_category', 'delete_ingredient_category',
      'update_tenant', 'upsert_system_settings',
      'create_table', 'update_table', 'delete_table',
      'upsert_permissions',
    ];
    if (adminActions.includes(action) && !isAdminOrManager(role)) {
      return resp({ error: `Insufficient permissions — admin or manager required. Your role: ${role}` }, 403);
    }

    if (action === 'get_station_operators') {
      const { data, error } = await adminDb.from('station_operators')
        .select('user_id, station_id').eq('tenant_id', tenantId);
      if (error) throw error;
      return resp({ success: true, data: data ?? [] });
    }

    if (action === 'get_permissions') {
      const rawData = await callRpc(supabaseUrl, serviceRoleKey, 'fn_permissions_write_bypass', {
        p_tenant_id: tenantId, p_action: 'select', p_permissions: [],
      }) as Array<Record<string, unknown>> | null;
      const data = rawData ?? [];
      const mapped = data.map((row) => ({ ...row, role: ROLE_DB_TO_PT[row.role as string] ?? row.role }));
      return resp({ success: true, data: mapped });
    }

    if (action === 'list_ingredient_categories') {
      const { data, error } = await adminDb
        .from('ingredient_categories')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true });
      if (error) {
        console.error('[config-write] list_ingredient_categories error:', error.message);
        throw error;
      }
      console.log('[config-write] list_ingredient_categories found:', data?.length ?? 0);
      return resp({ success: true, data: data ?? [] });
    }

    if (action === 'create_kitchen_station') {
      const { name, color, sla_minutes } = body;
      if (!name?.trim()) return resp({ error: 'name is required' }, 400);
      const data = await callRpc(supabaseUrl, serviceRoleKey, 'fn_kitchen_station_write_bypass', {
        p_tenant_id: tenantId, p_action: 'create',
        p_payload: { name: name.trim(), color: color ?? '#f59e0b', sla_minutes: sla_minutes ?? 15 },
      });
      return resp({ success: true, data });
    }
    if (action === 'update_kitchen_station') {
      const { id, name, color, sla_minutes, is_active } = body;
      if (!id) return resp({ error: 'id is required' }, 400);
      const payload: Record<string, unknown> = { id };
      if (name !== undefined) payload.name = name.trim();
      if (color !== undefined) payload.color = color;
      if (sla_minutes !== undefined) payload.sla_minutes = sla_minutes;
      if (is_active !== undefined) payload.is_active = is_active;
      const data = await callRpc(supabaseUrl, serviceRoleKey, 'fn_kitchen_station_write_bypass', {
        p_tenant_id: tenantId, p_action: 'update', p_payload: payload,
      });
      return resp({ success: true, data });
    }
    if (action === 'delete_kitchen_station') {
      const { id } = body;
      if (!id) return resp({ error: 'id is required' }, 400);
      const { data: operators } = await adminDb.from('station_operators')
        .select('id').eq('station_id', id).eq('tenant_id', tenantId).limit(1);
      if (operators && operators.length > 0)
        return resp({ error: 'Cannot delete station with assigned operators' }, 400);
      await callRpc(supabaseUrl, serviceRoleKey, 'fn_kitchen_station_write_bypass', {
        p_tenant_id: tenantId, p_action: 'delete', p_payload: { id },
      });
      return resp({ success: true });
    }
    if (action === 'assign_station_operator') {
      const { user_id, station_id } = body;
      if (!user_id || !station_id) return resp({ error: 'user_id and station_id are required' }, 400);
      await callRpc(supabaseUrl, serviceRoleKey, 'fn_kitchen_station_write_bypass', {
        p_tenant_id: tenantId, p_action: 'assign_operator', p_payload: { user_id, station_id },
      });
      return resp({ success: true });
    }
    if (action === 'remove_station_operator') {
      const { user_id, station_id } = body;
      if (!user_id || !station_id) return resp({ error: 'user_id and station_id are required' }, 400);
      await callRpc(supabaseUrl, serviceRoleKey, 'fn_kitchen_station_write_bypass', {
        p_tenant_id: tenantId, p_action: 'remove_operator', p_payload: { user_id, station_id },
      });
      return resp({ success: true });
    }

    if (action === 'create_payment_method') {
      const { name, type, fee_percentage, days_to_receive } = body;
      if (!name?.trim() || !type) return resp({ error: 'name and type are required' }, 400);
      const dbType = TIPO_TO_DB[type];
      if (!dbType) return resp({ error: `Invalid payment type: "${type}"` }, 400);
      const data = await callRpc(supabaseUrl, serviceRoleKey, 'fn_payment_method_write_bypass', {
        p_tenant_id: tenantId, p_action: 'create',
        p_payload: { name: name.trim(), type: dbType, fee_percentage: fee_percentage ?? 0, days_to_receive: days_to_receive ?? 0 },
      });
      return resp({ success: true, data: data ? mapPaymentMethodRow(data as Record<string, unknown>) : null });
    }
    if (action === 'update_payment_method') {
      const { id, name, type, fee_percentage, days_to_receive, is_active } = body;
      if (!id) return resp({ error: 'id is required' }, 400);
      const payload: Record<string, unknown> = { id };
      if (name !== undefined) payload.name = name.trim();
      if (type !== undefined) {
        const dbType = TIPO_TO_DB[type];
        if (!dbType) return resp({ error: `Invalid payment type: "${type}"` }, 400);
        payload.type = dbType;
      }
      if (fee_percentage !== undefined) payload.fee_percentage = fee_percentage;
      if (days_to_receive !== undefined) payload.days_to_receive = days_to_receive;
      if (is_active !== undefined) payload.is_active = is_active;
      const data = await callRpc(supabaseUrl, serviceRoleKey, 'fn_payment_method_write_bypass', {
        p_tenant_id: tenantId, p_action: 'update', p_payload: payload,
      });
      return resp({ success: true, data: data ? mapPaymentMethodRow(data as Record<string, unknown>) : null });
    }
    if (action === 'delete_payment_method') {
      const { id } = body;
      if (!id) return resp({ error: 'id is required' }, 400);
      await callRpc(supabaseUrl, serviceRoleKey, 'fn_payment_method_write_bypass', {
        p_tenant_id: tenantId, p_action: 'delete', p_payload: { id },
      });
      return resp({ success: true });
    }

    if (action === 'create_ingredient_category') {
      const { name } = body;
      if (!name?.trim()) return resp({ error: 'name is required' }, 400);
      const data = await callRpc(supabaseUrl, serviceRoleKey, 'fn_ingredient_category_write_bypass', {
        p_tenant_id: tenantId, p_action: 'create', p_payload: { name: name.trim() },
      });
      return resp({ success: true, data });
    }
    if (action === 'delete_ingredient_category') {
      const { id } = body;
      if (!id) return resp({ error: 'id is required' }, 400);
      await callRpc(supabaseUrl, serviceRoleKey, 'fn_ingredient_category_write_bypass', {
        p_tenant_id: tenantId, p_action: 'delete', p_payload: { id },
      });
      return resp({ success: true });
    }

    if (action === 'create_table') {
      const { number, capacity, table_type, area, pos_x, pos_y } = body;
      if (!number) return resp({ error: 'number is required' }, 400);
      const data = await callRpc(supabaseUrl, serviceRoleKey, 'fn_table_write_bypass', {
        p_tenant_id: tenantId, p_action: 'create',
        p_payload: { number, capacity: capacity ?? 4, table_type: table_type ?? 'quadrada', area: area ?? 'Principal', pos_x: pos_x ?? 10, pos_y: pos_y ?? 10 },
      });
      return resp({ success: true, data });
    }
    if (action === 'update_table') {
      const { id, number, capacity, table_type, area, pos_x, pos_y, status, qr_token, observation } = body;
      if (!id) return resp({ error: 'id is required' }, 400);
      const payload: Record<string, unknown> = { id };
      if (number !== undefined) payload.number = number;
      if (capacity !== undefined) payload.capacity = capacity;
      if (table_type !== undefined) payload.table_type = table_type;
      if (area !== undefined) payload.area = area;
      if (pos_x !== undefined) payload.pos_x = pos_x;
      if (pos_y !== undefined) payload.pos_y = pos_y;
      if (status !== undefined) payload.status = status;
      if (qr_token !== undefined) payload.qr_token = qr_token;
      if (observation !== undefined) payload.observation = observation;
      const data = await callRpc(supabaseUrl, serviceRoleKey, 'fn_table_write_bypass', {
        p_tenant_id: tenantId, p_action: 'update', p_payload: payload,
      });
      if (!data) return resp({ success: false, error: 'No row updated' }, 404);
      return resp({ success: true, data });
    }
    if (action === 'delete_table') {
      const { id } = body;
      if (!id) return resp({ error: 'id is required' }, 400);
      const { data: sessions } = await adminDb.from('table_sessions')
        .select('id').eq('table_id', id).eq('status', 'active').limit(1);
      if (sessions && sessions.length > 0)
        return resp({ error: 'Cannot delete table with active session' }, 400);
      await callRpc(supabaseUrl, serviceRoleKey, 'fn_table_write_bypass', {
        p_tenant_id: tenantId, p_action: 'delete', p_payload: { id },
      });
      return resp({ success: true });
    }

    if (action === 'update_tenant') {
      const { name, cnpj, address, logo_url, phone, email, city, state, zip_code } = body;
      const payload: Record<string, unknown> = {};
      if (name !== undefined) payload.name = name.trim();
      if (cnpj !== undefined) payload.cnpj = cnpj;
      if (address !== undefined) payload.address = address;
      if (logo_url !== undefined) payload.logo_url = logo_url;
      if (phone !== undefined) payload.phone = phone;
      if (email !== undefined) payload.email = email;
      if (city !== undefined) payload.city = city;
      if (state !== undefined) payload.state = state;
      if (zip_code !== undefined) payload.zip_code = zip_code;
      const data = await callRpc(supabaseUrl, serviceRoleKey, 'fn_tenant_write_bypass', {
        p_tenant_id: tenantId, p_payload: payload,
      });
      return resp({ success: true, data });
    }

    if (action === 'upsert_system_settings') {
      const fields = [
        'service_fee_enabled', 'service_fee_percentage',
        'gorjeta_enabled', 'gorjeta_percentage',
        'auto_print_enabled', 'kitchen_close_time',
        'self_service_id_type', 'self_service_payment_type',
        'welcome_message_new', 'welcome_message_returning',
        'stone_client_id', 'stone_client_secret',
        'timer_verde_max', 'timer_ambar_max',
        'kitchen_view', 'cancel_mode', 'discount_profile',
        'default_prep_time', 'delivery_require_id',
        'delivery_type', 'delivery_eta_minutes',
        'sectors_config', 'print_kds_enabled',
        'print_kitchen_copy_enabled', 'printers_config',
        'pdv_config', 'pager_count',
        'delivery_commission_rates', 'delivery_payment_methods',
      ];

      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        if (body[f] !== undefined) {
          if (f === 'self_service_id_type') payload[f] = normalizeIdType(body[f]);
          else if (f === 'self_service_payment_type') payload[f] = normalizePaymentType(body[f]);
          else payload[f] = body[f];
        }
      }

      console.log('[config-write] upsert_system_settings tenantId:', tenantId, 'fields:', Object.keys(payload));

      const data = await callRpc(supabaseUrl, serviceRoleKey, 'fn_system_settings_write_bypass', {
        p_tenant_id: tenantId, p_payload: payload,
      });

      console.log('[config-write] upsert result:', JSON.stringify(data));
      return resp({ success: true, data });
    }

    if (action === 'upsert_permissions') {
      const { permissions } = body;
      if (!Array.isArray(permissions) || permissions.length === 0)
        return resp({ error: 'permissions array is required' }, 400);

      const mappedPermissions = permissions.map((p: { role: string; permission_key: string; allowed: boolean }) => ({
        role: ROLE_PT_TO_DB[p.role] ?? p.role,
        permission_key: p.permission_key,
        allowed: p.allowed,
      }));

      console.log('[config-write] upsert_permissions tenantId:', tenantId, 'count:', mappedPermissions.length);

      const result = await callRpc(supabaseUrl, serviceRoleKey, 'fn_permissions_write_bypass', {
        p_tenant_id: tenantId, p_action: 'insert_batch', p_permissions: mappedPermissions,
      });

      console.log('[config-write] upsert_permissions result:', JSON.stringify(result));
      return resp({ success: true });
    }

    return resp({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error('[config-write] error:', serializeError(e));
    return resp({ error: serializeError(e) }, 500);
  }
});
