import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cria client com o JWT do usuário
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    // Cria client com service_role para bypassar RLS nas payments
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json();
    const { session_id, tenant_id } = body;

    if (!session_id || !tenant_id) {
      return new Response(JSON.stringify({ error: 'session_id e tenant_id são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verifica que o usuário está autenticado e tem acesso ao tenant
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Usuário não autenticado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;

    // Verifica acesso ao tenant — busca todos os registros do usuário e verifica se algum bate
    const { data: userTenants, error: tenantErr } = await supabaseAdmin
      .from('user_tenants')
      .select('tenant_id')
      .eq('user_id', userId);

    if (tenantErr) {
      console.error('[session-payments] erro ao verificar tenant:', tenantErr);
      // Se não conseguiu verificar, continua com cautela (pode ser admin-master sem user_tenants)
    }

    const tenantIds = (userTenants ?? []).map((ut: { tenant_id: string }) => ut.tenant_id);
    
    // Verifica acesso — se temos registros e o tenant não está incluído, nega
    if (tenantIds.length > 0 && !tenantIds.includes(tenant_id)) {
      return new Response(JSON.stringify({ error: 'Acesso negado ao tenant' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verifica também se a sessão pertence ao tenant
    const { data: sessaoCheck, error: sessaoErr } = await supabaseAdmin
      .from('sessions')
      .select('id, tenant_id')
      .eq('id', session_id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    if (sessaoErr) {
      console.error('[session-payments] erro ao verificar sessão:', sessaoErr);
    }

    if (!sessaoCheck) {
      return new Response(JSON.stringify({ error: 'Sessão não encontrada para este tenant' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Busca pedidos da sessão (não cancelados, não treino)
    const { data: orders, error: ordersErr } = await supabaseAdmin
      .from('orders')
      .select('id, total_amount')
      .eq('tenant_id', tenant_id)
      .eq('session_id', session_id)
      .not('status', 'in', '(cancelled,draft)')
      .eq('is_training', false)
      .eq('is_draft', false);

    if (ordersErr) throw ordersErr;

    const orderIds = (orders ?? []).map((o: { id: string }) => o.id);

    if (orderIds.length === 0) {
      return new Response(
        JSON.stringify({ payments: [], payment_methods: [], order_totals: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Busca pagamentos e métodos de pagamento em paralelo com service_role
    const [paymentsRes, pmRes] = await Promise.all([
      supabaseAdmin
        .from('payments')
        .select('id, amount, payment_method_id, order_id, is_refunded')
        .eq('tenant_id', tenant_id)
        .in('order_id', orderIds)
        .eq('is_refunded', false),
      supabaseAdmin
        .from('payment_methods')
        .select('id, name, type')
        .eq('tenant_id', tenant_id),
    ]);

    if (paymentsRes.error) throw paymentsRes.error;
    if (pmRes.error) throw pmRes.error;

    console.log('[session-payments] orders:', orderIds.length, 'payments:', paymentsRes.data?.length ?? 0);

    return new Response(
      JSON.stringify({
        payments: paymentsRes.data ?? [],
        payment_methods: pmRes.data ?? [],
        order_totals: (orders ?? []).map((o: { id: string; total_amount: number }) => ({
          order_id: o.id,
          total_amount: o.total_amount,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[session-payments] erro interno:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
