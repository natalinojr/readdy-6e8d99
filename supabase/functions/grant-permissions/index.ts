import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const tables = [
    'sessions', 'item_ingredients', 'tenants', 'user_tenants', 'permissions',
    'system_settings', 'payment_methods', 'station_operators', 'ingredients',
    'menu_categories', 'menu_items', 'item_promotions', 'option_groups', 'options',
    'item_preset_observations', 'global_observations', 'recipes', 'combo_items',
    'customers', 'cash_registers', 'cash_movements', 'station_sessions',
    'table_sessions', 'table_session_customers', 'orders', 'order_item_options',
    'order_item_observations', 'order_item_units', 'payments', 'waiter_calls',
    'stock_movements', 'audit_log', 'tables', 'order_items', 'ingredient_categories',
    'combos', 'order_item_parts', 'users', 'kitchen_stations', 'kiosk_tokens',
    'fin_cash_flow', 'fin_accounts_payable', 'fin_purchases', 'fin_purchase_items',
    'fin_cost_centers', 'fin_suppliers', 'fin_budgets', 'fin_budget_items',
    'fin_bank_statements', 'fin_dre_categories', 'fin_receivable_installments',
    'fin_anticipations', 'fin_implementation_costs', 'fin_implementation_columns',
    'fin_investment_settings', 'fin_bank_accounts', 'fin_bank_transactions',
    'fin_income_routing', 'hr_employees', 'hr_payroll', 'refunds', 'order_discounts',
    'promotion_rules', 'vouchers', 'voucher_transactions', 'loyalty_transactions',
    'combo_ingredients', 'ingredient_batches', 'print_queue',
  ];

  const results: Record<string, string> = {};

  for (const table of tables) {
    try {
      const { error: e1 } = await supabaseAdmin.rpc('exec_sql', {
        sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO authenticated;`
      });
      const { error: e2 } = await supabaseAdmin.rpc('exec_sql', {
        sql: `GRANT SELECT ON public.${table} TO anon;`
      });
      const { error: e3 } = await supabaseAdmin.rpc('exec_sql', {
        sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO service_role;`
      });

      if (e1 || e2 || e3) {
        results[table] = `ERROR: auth=${e1?.message ?? 'ok'} | anon=${e2?.message ?? 'ok'} | svc=${e3?.message ?? 'ok'}`;
      } else {
        results[table] = 'OK';
      }
    } catch (err) {
      results[table] = `EXCEPTION: ${err}`;
    }
  }

  let seqResult = 'OK';
  try {
    await supabaseAdmin.rpc('exec_sql', {
      sql: `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`
    });
    await supabaseAdmin.rpc('exec_sql', {
      sql: `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;`
    });
    await supabaseAdmin.rpc('exec_sql', {
      sql: `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;`
    });
  } catch (err) {
    seqResult = `ERROR: ${err}`;
  }

  return new Response(
    JSON.stringify({ tables: results, sequences: seqResult }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
