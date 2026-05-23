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

  const effectiveServiceKey = serviceRoleKey.length > 100 ? serviceRoleKey : anonKey;
  const admin = createClient(supabaseUrl, effectiveServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const { action } = body;
    if (!action) return new Response(JSON.stringify({ error: 'action is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // ── Public action: get_table_session_status ──────────────────────────────────
    if (action === 'get_table_session_status') {
      const { table_number, tenant_id } = body;
      if (!table_number || !tenant_id) {
        return new Response(JSON.stringify({ error: 'table_number and tenant_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: tableData, error: tableErr } = await admin
        .from('tables')
        .select('id, number, capacity, area, status')
        .eq('tenant_id', tenant_id)
        .eq('number', table_number)
        .maybeSingle();

      if (tableErr) throw tableErr;
      if (!tableData) {
        return new Response(JSON.stringify({ status: 'not_found', session: null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: sessionData, error: sessionErr } = await admin
        .from('table_sessions')
        .select('id, status, customer_name, opened_at')
        .eq('table_id', tableData.id)
        .eq('status', 'open')
        .maybeSingle();

      if (sessionErr) throw sessionErr;

      return new Response(JSON.stringify({
        table: tableData,
        session: sessionData ?? null,
        session_status: sessionData ? 'open' : 'closed',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Public action: save_customer_name ────────────────────────────────────────
    if (action === 'save_customer_name') {
      const { table_session_id, customer_name } = body;
      if (!table_session_id || !customer_name) {
        return new Response(JSON.stringify({ error: 'table_session_id and customer_name required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: sess, error: sessErr } = await admin
        .from('table_sessions')
        .select('id, status')
        .eq('id', table_session_id)
        .eq('status', 'open')
        .maybeSingle();

      if (sessErr) throw sessErr;
      if (!sess) {
        return new Response(JSON.stringify({ error: 'Session not found or already closed' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { error: updateErr } = await admin
        .from('table_sessions')
        .update({ customer_name })
        .eq('id', table_session_id);

      if (updateErr) throw updateErr;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Public action: check_close_conditions ────────────────────────────────────
    // Verifica se as condições para fechar estão satisfeitas SEM fechar
    if (action === 'check_close_conditions') {
      const { table_session_id } = body;
      if (!table_session_id) {
        return new Response(JSON.stringify({ error: 'table_session_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: sess, error: sessErr } = await admin
        .from('table_sessions')
        .select('id, status')
        .eq('id', table_session_id)
        .eq('status', 'open')
        .maybeSingle();

      if (sessErr) throw sessErr;
      if (!sess) {
        return new Response(JSON.stringify({ can_close: false, reason: 'session_closed' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: orders, error: ordersErr } = await admin
        .from('orders')
        .select('id, total_amount')
        .eq('table_session_id', table_session_id);

      if (ordersErr) throw ordersErr;

      const orderIds = (orders ?? []).map((o: { id: string }) => o.id);
      let pendingItemsCount = 0;

      if (orderIds.length > 0) {
        const { data: items, error: itemsErr } = await admin
          .from('order_items')
          .select('id, status')
          .in('order_id', orderIds)
          .neq('status', 'delivered');

        if (itemsErr) throw itemsErr;
        pendingItemsCount = (items ?? []).length;
      }

      const totalConsumo = (orders ?? []).reduce((sum: number, o: { total_amount: number }) => sum + (o.total_amount ?? 0), 0);

      const { data: payments, error: paymentsErr } = await admin
        .from('payments')
        .select('amount')
        .eq('table_session_id', table_session_id);

      if (paymentsErr) throw paymentsErr;
      const totalPago = (payments ?? []).reduce((sum: number, p: { amount: number }) => sum + (p.amount ?? 0), 0);
      const contaZerada = totalConsumo <= 0 || totalPago >= totalConsumo * 0.99;
      const allDelivered = pendingItemsCount === 0;

      return new Response(JSON.stringify({
        can_close: allDelivered && contaZerada,
        all_delivered: allDelivered,
        conta_zerada: contaZerada,
        pending_items: pendingItemsCount,
        total_consumo: totalConsumo,
        total_pago: totalPago,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Public action: close_table_by_customer ───────────────────────────────────
    if (action === 'close_table_by_customer') {
      const { table_session_id } = body;
      if (!table_session_id) {
        return new Response(JSON.stringify({ error: 'table_session_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: sess, error: sessErr } = await admin
        .from('table_sessions')
        .select('id, status, table_id')
        .eq('id', table_session_id)
        .eq('status', 'open')
        .maybeSingle();

      if (sessErr) throw sessErr;
      if (!sess) {
        return new Response(JSON.stringify({ error: 'Session not found or already closed' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: orders, error: ordersErr } = await admin
        .from('orders')
        .select('id, total_amount')
        .eq('table_session_id', table_session_id);

      if (ordersErr) throw ordersErr;

      const orderIds = (orders ?? []).map((o: { id: string }) => o.id);
      let allDelivered = true;
      let pendingItemsCount = 0;

      if (orderIds.length > 0) {
        const { data: items, error: itemsErr } = await admin
          .from('order_items')
          .select('id, status')
          .in('order_id', orderIds)
          .neq('status', 'delivered');

        if (itemsErr) throw itemsErr;
        pendingItemsCount = (items ?? []).length;
        allDelivered = pendingItemsCount === 0;
      }

      const totalConsumo = (orders ?? []).reduce((sum: number, o: { total_amount: number }) => sum + (o.total_amount ?? 0), 0);

      const { data: payments, error: paymentsErr } = await admin
        .from('payments')
        .select('amount')
        .eq('table_session_id', table_session_id);

      if (paymentsErr) throw paymentsErr;
      const totalPago = (payments ?? []).reduce((sum: number, p: { amount: number }) => sum + (p.amount ?? 0), 0);
      const contaZerada = totalConsumo <= 0 || totalPago >= totalConsumo * 0.99;

      if (!allDelivered) {
        return new Response(JSON.stringify({
          error: 'pending_items',
          message: `Ainda há ${pendingItemsCount} item(s) não entregue(s). Aguarde a entrega antes de encerrar.`,
          can_close: false,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (!contaZerada) {
        return new Response(JSON.stringify({
          error: 'unpaid_balance',
          message: 'A conta ainda não foi totalmente paga. Finalize o pagamento antes de encerrar.',
          can_close: false,
          total_consumo: totalConsumo,
          total_pago: totalPago,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { error: closeErr } = await admin
        .from('table_sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', table_session_id);

      if (closeErr) throw closeErr;

      if (sess.table_id) {
        await admin
          .from('tables')
          .update({ status: 'available' })
          .eq('id', sess.table_id);
      }

      return new Response(JSON.stringify({ ok: true, closed: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Authenticated actions below ──────────────────────────────────────────────
    const db = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userError } = await db.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const requestedTenantId: string | null = body.active_tenant_id ?? body.tenant_id ?? null;
    const { data: tenantRows, error: tenantErr } = await db.rpc('get_tenant_for_user', { p_user_id: user.id });
    if (tenantErr) return new Response(JSON.stringify({ error: `Tenant lookup failed: ${tenantErr.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!tenantRows || tenantRows.length === 0) return new Response(JSON.stringify({ error: 'User does not belong to any tenant' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let tenantId: string;
    if (requestedTenantId) {
      const match = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
      if (!match) return new Response(JSON.stringify({ error: 'User does not belong to the requested tenant' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      tenantId = match.tenant_id;
    } else if (tenantRows.length === 1) {
      tenantId = tenantRows[0].tenant_id;
    } else {
      return new Response(JSON.stringify({ error: 'Multiple tenants found — active_tenant_id required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'open_table') {
      const { table_id, session_id, customer_name } = body;
      const { data, error } = await admin.rpc('fn_open_table_session', {
        p_tenant_id: tenantId,
        p_table_id: table_id,
        p_session_id: session_id,
        p_customer_name: customer_name ?? null,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'close_table') {
      const { table_session_id } = body;
      const { error } = await admin.rpc('fn_close_table_session', { p_table_session_id: table_session_id, p_tenant_id: tenantId });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'update_table_status') {
      const { table_id, status } = body;
      const { error } = await admin.from('tables').update({ status }).eq('id', table_id).eq('tenant_id', tenantId);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'seed_tables') {
      const { tables } = body;
      if (!Array.isArray(tables)) throw new Error('tables must be array');
      const rows = tables.map((t: { number: number; capacity: number; area?: string; pos_x?: number; pos_y?: number }) => ({
        tenant_id: tenantId,
        number: t.number,
        capacity: t.capacity,
        area: t.area ?? 'Salão',
        pos_x: t.pos_x ?? 0,
        pos_y: t.pos_y ?? 0,
        is_active: true,
        status: 'available',
        qr_token: crypto.randomUUID(),
      }));
      const { data, error } = await admin.from('tables').upsert(rows, { onConflict: 'tenant_id,number' }).select('id, number');
      if (error) throw error;
      return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
