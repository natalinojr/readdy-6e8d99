import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const { action, tenant_id, payload } = body;

    if (!tenant_id) return new Response(JSON.stringify({ error: 'tenant_id required' }), { status: 400, headers: corsHeaders });

    // Verify user belongs to tenant
    const { data: membership } = await supabase
      .from('user_tenants')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    if (!membership) {
      return new Response(JSON.stringify({ error: 'Unauthorized: user does not belong to tenant' }), { status: 403, headers: corsHeaders });
    }

    let result;

    switch (action) {
      case 'upsert_cost': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase.from('fin_implementation_costs')
            .update({ ...data, tenant_id })
            .eq('id', id).eq('tenant_id', tenant_id)
            .select().maybeSingle();
        } else {
          result = await supabase.from('fin_implementation_costs')
            .insert({ ...data, tenant_id })
            .select().maybeSingle();
        }
        break;
      }
      case 'delete_cost': {
        result = await supabase.from('fin_implementation_costs')
          .delete().eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }
      case 'upsert_column': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase.from('fin_implementation_columns')
            .update({ ...data, tenant_id })
            .eq('id', id).eq('tenant_id', tenant_id)
            .select().maybeSingle();
        } else {
          result = await supabase.from('fin_implementation_columns')
            .insert({ ...data, tenant_id })
            .select().maybeSingle();
        }
        break;
      }
      case 'delete_column': {
        result = await supabase.from('fin_implementation_columns')
          .update({ is_active: false })
          .eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }
      case 'upsert_investment_settings': {
        // Sanitizar campos antes de salvar
        const sanitized: Record<string, unknown> = {
          tenant_id,
          updated_at: new Date().toISOString(),
        };

        // inauguration_date: '' ou null → null, senão manter
        if (payload.inauguration_date !== undefined) {
          sanitized.inauguration_date = (payload.inauguration_date === '' || payload.inauguration_date === null)
            ? null
            : payload.inauguration_date;
        }

        // total_investment: garantir que é número
        if (payload.total_investment !== undefined) {
          const parsed = Number(payload.total_investment);
          sanitized.total_investment = isNaN(parsed) ? 0 : parsed;
        }

        // Outros campos do payload
        const skip = new Set(['inauguration_date', 'total_investment', 'tenant_id', 'updated_at']);
        for (const [k, v] of Object.entries(payload)) {
          if (!skip.has(k)) sanitized[k] = v;
        }

        console.log('[implementation-write] upsert_investment_settings payload:', JSON.stringify(sanitized));

        result = await supabase.from('fin_investment_settings')
          .upsert(sanitized, { onConflict: 'tenant_id' })
          .select().maybeSingle();

        if (result?.error) {
          console.error('[implementation-write] upsert error:', result.error);
        } else {
          console.log('[implementation-write] upsert success:', JSON.stringify(result?.data));
        }
        break;
      }
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: corsHeaders });
    }

    if (result?.error) {
      console.error('[implementation-write] result error:', result.error.message);
      return new Response(JSON.stringify({ error: result.error.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(
      JSON.stringify({ data: result?.data ?? null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[implementation-write] unhandled error:', String(err));
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
