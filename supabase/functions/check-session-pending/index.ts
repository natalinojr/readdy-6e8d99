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
    const { session_id, tenant_id } = await req.json();
    if (!session_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'session_id e tenant_id são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Busca pedidos da sessão (bypass RLS)
    const { data: pedidos, error: errPedidos } = await supabase
      .from('orders')
      .select('id, session_id, is_paid, status, number, tenant_id')
      .eq('session_id', session_id)
      .eq('tenant_id', tenant_id)
      .neq('status', 'cancelled');

    if (errPedidos) {
      return new Response(
        JSON.stringify({ error: errPedidos.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const listaPedidos = pedidos ?? [];
    const orderIds = listaPedidos.map((p) => p.id);
    const orderIdsComItensNaoEntregues: string[] = [];

    // 2. Busca itens não entregues
    if (orderIds.length > 0) {
      const { data: itens, error: errItens } = await supabase
        .from('order_items')
        .select('order_id')
        .in('order_id', orderIds)
        .eq('tenant_id', tenant_id)
        .neq('status', 'delivered')
        .neq('status', 'cancelled')
        .eq('skip_kds', false);

      if (!errItens && itens) {
        for (const item of itens) {
          if (!orderIdsComItensNaoEntregues.includes(item.order_id)) {
            orderIdsComItensNaoEntregues.push(item.order_id);
          }
        }
      }
    }

    // 3. Monta pendentes
    const pendentes: { id: string; numero: string; motivo: string }[] = [];
    for (const pedido of listaPedidos) {
      const temItens = orderIdsComItensNaoEntregues.includes(pedido.id);
      const naoPago = !pedido.is_paid;
      if (temItens) {
        pendentes.push({ id: pedido.id, numero: pedido.number ?? pedido.id.slice(0, 8), motivo: 'nao_entregue' });
      } else if (naoPago) {
        pendentes.push({ id: pedido.id, numero: pedido.number ?? pedido.id.slice(0, 8), motivo: 'nao_pago' });
      }
    }

    // 4. Mesas abertas — busca com detalhes para debug
    const { data: sessoesAbertas, error: errMesas } = await supabase
      .from('table_sessions')
      .select('id, opened_at, customer_name, table_id')
      .eq('session_id', session_id)
      .eq('tenant_id', tenant_id)
      .eq('status', 'open');

    const mesasAbertas = sessoesAbertas?.length ?? 0;

    // 5. Auto-correção: fechar sessões zumbi (abertas há mais de 4 horas sem pedidos vinculados)
    // Uma sessão zumbi é aquela que não tem pedidos vinculados a ela diretamente (table_session_id)
    // mas ficou com status open indevidamente
    const sessoesZumbi: string[] = [];
    if (sessoesAbertas && sessoesAbertas.length > 0) {
      for (const sess of sessoesAbertas) {
        // Verifica se há pedidos vinculados diretamente a esta table_session
        const { count: pedidosNaSessao } = await supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('table_session_id', sess.id)
          .eq('tenant_id', tenant_id)
          .neq('status', 'cancelled');

        // Verifica se foi aberta há mais de 4 horas
        const abertoHa = Date.now() - new Date(sess.opened_at).getTime();
        const horasAberta = abertoHa / (1000 * 60 * 60);

        // É zumbi se: (sem pedidos vinculados) OU (aberta há mais de 6 horas)
        if ((pedidosNaSessao ?? 0) === 0 || horasAberta > 6) {
          sessoesZumbi.push(sess.id);
        }
      }

      // Fecha as sessões zumbi automaticamente
      if (sessoesZumbi.length > 0) {
        await supabase
          .from('table_sessions')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .in('id', sessoesZumbi)
          .eq('tenant_id', tenant_id);
      }
    }

    // Recalcula depois da limpeza
    const mesasAbertasReal = mesasAbertas - sessoesZumbi.length;

    return new Response(
      JSON.stringify({
        pedidosPendentes: pendentes,
        mesasAbertas: Math.max(0, mesasAbertasReal),
        totalPedidos: listaPedidos.length,
        sessoesZumbiCorrigidas: sessoesZumbi.length,
        debug: {
          orderIds,
          orderIdsComItensNaoEntregues,
          sessoesAbertas: sessoesAbertas?.map(s => ({ id: s.id, abertoEm: s.opened_at, cliente: s.customer_name })) ?? [],
          sessoesZumbi,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message ?? 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
