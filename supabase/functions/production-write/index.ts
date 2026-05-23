import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractErrorMessage(err: unknown): string {
  if (err == null) return 'Erro desconhecido';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const obj = err as Record<string, unknown>;
  if (obj.message) return String(obj.message);
  if (obj.error) {
    const inner = obj.error;
    if (typeof inner === 'string') return inner;
    if (inner && typeof inner === 'object') {
      if ('message' in inner) return String((inner as Record<string, unknown>).message ?? inner);
      return JSON.stringify(inner);
    }
  }
  if (obj.details) return String(obj.details);
  return JSON.stringify(err);
}

/**
 * Tenta obter o usuario autenticado com retry.
 * O Supabase Auth API pode falhar transientemente; retry ajuda a evitar
 * falsos 401 quando o token e valido mas a API de auth teve instabilidade.
 */
async function getUserWithRetry(
  db: ReturnType<typeof createClient>,
  maxRetries = 2,
): Promise<{ user: { id: string } | null; error: Error | null }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await db.auth.getUser();
    if (!error && data?.user) {
      return { user: data.user, error: null };
    }
    if (attempt < maxRetries) {
      const delay = 150 * (attempt + 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  const { data, error } = await db.auth.getUser();
  return { user: data?.user ?? null, error: error ?? new Error('Auth session missing!') };
}

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';

  if (!authHeader || authHeader.trim() === '' || authHeader === 'Bearer ') {
    return new Response(JSON.stringify({ error: 'Authorization header missing or empty' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { user, error: userError } = await getUserWithRetry(db);
  if (!user) {
    const msg = userError ? extractErrorMessage(userError) : 'Unauthorized';
    console.error('[production-write] getUser failed after retries:', msg, '| header prefix:', authHeader.slice(0, 20));
    return new Response(JSON.stringify({ error: msg }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { action, tenant_id } = body;
    if (!action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: 'tenant_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: tenantRows, error: tenantErr } = await db
      .from('user_tenants')
      .select('tenant_id')
      .eq('user_id', user.id);

    if (tenantErr) {
      return new Response(JSON.stringify({ error: `Tenant lookup failed: ${extractErrorMessage(tenantErr)}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!tenantRows || tenantRows.length === 0) {
      return new Response(JSON.stringify({ error: 'User does not belong to any tenant' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const match = tenantRows.find((r) => r.tenant_id === tenant_id);
    if (!match) {
      return new Response(JSON.stringify({ error: 'User does not belong to the requested tenant' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create_batch_with_stock') {
      const {
        recipe_id, recipe_name, produced_quantity, unit,
        yield_percent_actual, yield_percent_expected,
        loss_quantity_kg, loss_value, total_cost, unit_cost,
        produced_by, notes, steps_completed, items, output_ingredient_id,
      } = body;

      if (!recipe_id) {
        return new Response(JSON.stringify({ error: 'recipe_id is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('[production-write] create_batch_with_stock input:', {
        tenant_id, recipe_id, recipe_name, produced_quantity, unit,
        output_ingredient_id: output_ingredient_id ?? null,
        items_count: items?.length ?? 0,
      });

      const { data: rpcData, error: rpcErr } = await db.rpc('fn_register_production_and_stock_v2', {
        p_tenant_id: tenant_id,
        p_user_id: user.id,
        p_recipe_id: recipe_id,
        p_recipe_name: recipe_name ?? '\u2014',
        p_produced_quantity: produced_quantity ?? 0,
        p_unit: unit ?? 'kg',
        p_yield_percent_actual: yield_percent_actual ?? null,
        p_yield_percent_expected: yield_percent_expected ?? null,
        p_loss_quantity_kg: loss_quantity_kg ?? null,
        p_loss_value: loss_value ?? null,
        p_total_cost: total_cost ?? 0,
        p_unit_cost: unit_cost ?? 0,
        p_produced_by: produced_by ?? '',
        p_notes: notes ?? '',
        p_steps_completed: steps_completed ?? null,
        p_items: items ?? '[]',
        p_output_ingredient_id: output_ingredient_id ?? null,
      });

      if (rpcErr) {
        console.error('[production-write] fn_register_production_and_stock_v2 error:', extractErrorMessage(rpcErr));
        return new Response(JSON.stringify({ error: extractErrorMessage(rpcErr) }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = typeof rpcData === 'string' ? JSON.parse(rpcData) : (rpcData as Record<string, unknown>);
      } catch {
        parsed = { data: rpcData };
      }

      console.log('[production-write] RPC result:', JSON.stringify(parsed));

      if (parsed.error) {
        return new Response(JSON.stringify({ error: parsed.error }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        data: { id: parsed.batch_id },
        movements_count: parsed.movements_count,
        items_count: parsed.items_count,
        debug_log: parsed.debug_log,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key !== 'action' && key !== 'tenant_id') {
        payload[key] = value;
      }
    }

    const { data: rpcData, error: rpcErr } = await db.rpc('fn_production_crud', {
      p_action: action,
      p_user_id: user.id,
      p_tenant_id: tenant_id,
      p_payload: payload,
    });

    if (rpcErr) {
      console.error('[production-write] RPC error:', extractErrorMessage(rpcErr));
      return new Response(JSON.stringify({ error: extractErrorMessage(rpcErr) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = typeof rpcData === 'string' ? JSON.parse(rpcData) : (rpcData as Record<string, unknown>);
    } catch {
      parsed = { data: rpcData };
    }

    if (parsed.error) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = extractErrorMessage(err);
    console.error('[production-write] error:', msg, 'raw:', JSON.stringify(err));
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});