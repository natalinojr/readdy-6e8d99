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

    // 1. Busca pedidos da sessão (não cancelados)
    const { data: pedidos, error: errPedidos } = await supabase
      .from('orders')
      .select('id, session_id, is_paid, status, number, tenant_id, is_draft')
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

    if (orderIds.length > 0) {
      // 2. Busca order_items da sessão (não cancelados, não skip_kds)
      // Precisamos dos IDs dos order_items para depois consultar order_item_units corretamente
      const { data: orderItemsRows, error: errOrderItems } = await supabase
        .from('order_items')
        .select('id, order_id, status, skip_kds')
        .in('order_id', orderIds)
        .eq('tenant_id', tenant_id)
        .neq('status', 'cancelled')
        .eq('skip_kds', false);

      const allOrderItems = orderItemsRows ?? [];
      const orderItemIds = allOrderItems.map((oi) => oi.id);

      // 3. Busca UNIDADES não entregues em order_item_units
      // CORRIGIDO: filtra por order_item_id (IDs de order_items), não por orderIds (IDs de orders)
      if (!errOrderItems && orderItemIds.length > 0) {
        const { data: unidades, error: errUnidades } = await supabase
          .from('order_item_units')
          .select('order_item_id')
          .in('order_item_id', orderItemIds)
          .in('status', ['new', 'preparing', 'ready']);

        if (!errUnidades && unidades && unidades.length > 0) {
          // Mapeia order_item_id → order_id
          const itemToOrder = new Map<string, string>();
          for (const oi of allOrderItems) {
            itemToOrder.set(oi.id, oi.order_id);
          }

          for (const u of unidades) {
            const orderId = itemToOrder.get(u.order_item_id as string);
            if (orderId && !orderIdsComItensNaoEntregues.includes(orderId)) {
              orderIdsComItensNaoEntregues.push(orderId);
            }
          }
        }
      }

      // 4. Fallback: order_items cujo status agregado não é 'delivered'
      // (para itens que não têm units no order_item_units — ex: itens mais antigos)
      if (!errOrderItems) {
        for (const oi of allOrderItems) {
          if (oi.status !== 'delivered' && oi.status !== 'cancelled') {
            if (!orderIdsComItensNaoEntregues.includes(oi.order_id)) {
              orderIdsComItensNaoEntregues.push(oi.order_id);
            }
          }
        }
      }
    }

    // 5. Monta pendentes
    const pendentes: { id: string; numero: string; motivo: string }[] = [];
    for (const pedido of listaPedidos) {
      const temItensNaoEntregues = orderIdsComItensNaoEntregues.includes(pedido.id);
      // Um pedido é entregue se: status = 'delivered' OU não tem itens não entregues
      const pedidoNaoEntregue = pedido.status !== 'delivered' && temItensNaoEntregues;
      const naoPago = !pedido.is_paid;

      if (pedidoNaoEntregue) {
        pendentes.push({ id: pedido.id, numero: pedido.number ?? pedido.id.slice(0, 8), motivo: 'nao_entregue' });
      } else if (naoPago) {
        pendentes.push({ id: pedido.id, numero: pedido.number ?? pedido.id.slice(0, 8), motivo: 'nao_pago' });
      }
    }

    // 6. Mesas abertas
    const { data: sessoesAbertas, error: errMesas } = await supabase
      .from('table_sessions')
      .select('id, opened_at, customer_name, table_id')
      .eq('session_id', session_id)
      .eq('tenant_id', tenant_id)
      .eq('status', 'open');

    const mesasAbertas = sessoesAbertas?.length ?? 0;

    // 7. Auto-correção: sessões zumbi (mesas abertas sem pedidos ou abertas há mais de 6h)
    const sessoesZumbi: string[] = [];
    if (sessoesAbertas && sessoesAbertas.length > 0) {
      for (const sess of sessoesAbertas) {
        const { count: pedidosNaSessao } = await supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('table_session_id', sess.id)
          .eq('tenant_id', tenant_id)
          .neq('status', 'cancelled');

        const abertoHa = Date.now() - new Date(sess.opened_at).getTime();
        const horasAberta = abertoHa / (1000 * 60 * 60);

        if ((pedidosNaSessao ?? 0) === 0 || horasAberta > 6) {
          sessoesZumbi.push(sess.id);
        }
      }

      if (sessoesZumbi.length > 0) {
        await supabase
          .from('table_sessions')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .in('id', sessoesZumbi)
          .eq('tenant_id', tenant_id);
      }
    }

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
