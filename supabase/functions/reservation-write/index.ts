import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

    if (!action) return json({ error: 'action is required' }, 400);

    // ── Authenticated client ─────────────────────────────────────────────────
    const db = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userError } = await db.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    // ── Tenant resolution ────────────────────────────────────────────────────
    const requestedTenantId: string | null = body.active_tenant_id ?? body.tenant_id ?? null;
    const { data: tenantRows, error: tenantErr } = await db.rpc('get_tenant_for_user', { p_user_id: user.id });
    if (tenantErr) return json({ error: `Tenant lookup failed: ${tenantErr.message}` }, 500);
    if (!tenantRows || tenantRows.length === 0) return json({ error: 'User does not belong to any tenant' }, 403);

    let tenantId: string;
    if (requestedTenantId) {
      const match = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
      if (!match) return json({ error: 'User does not belong to the requested tenant' }, 403);
      tenantId = match.tenant_id;
    } else if (tenantRows.length === 1) {
      tenantId = tenantRows[0].tenant_id;
    } else {
      return json({ error: 'Multiple tenants found — active_tenant_id required' }, 403);
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: create_reservation
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'create_reservation') {
      const {
        table_id,
        customer_name,
        customer_phone,
        customer_id,
        party_size,
        reservation_date,
        reservation_time,
        duration_minutes,
        notes,
        occasion,
        status: initialStatus,
      } = body;

      if (!customer_name || !customer_phone || !party_size || !reservation_date || !reservation_time) {
        return json({ error: 'customer_name, customer_phone, party_size, reservation_date and reservation_time are required' }, 400);
      }

      // Verificar conflito de mesa (se mesa especificada)
      if (table_id) {
        const { data: conflicts } = await admin
          .from('table_reservations')
          .select('id, reservation_time, duration_minutes')
          .eq('table_id', table_id)
          .eq('reservation_date', reservation_date)
          .in('status', ['pending', 'confirmed']);

        if (conflicts && conflicts.length > 0) {
          const newStart = timeToMinutes(reservation_time);
          const newEnd = newStart + (duration_minutes ?? 90);

          for (const c of conflicts) {
            const cStart = timeToMinutes(c.reservation_time);
            const cEnd = cStart + (c.duration_minutes ?? 90);
            if (newStart < cEnd && newEnd > cStart) {
              return json({ error: 'table_conflict', message: 'Mesa já reservada neste horário' }, 409);
            }
          }
        }
      }

      const { data, error } = await admin
        .from('table_reservations')
        .insert({
          tenant_id: tenantId,
          table_id: table_id ?? null,
          customer_name,
          customer_phone,
          customer_id: customer_id ?? null,
          party_size,
          reservation_date,
          reservation_time,
          duration_minutes: duration_minutes ?? 90,
          status: initialStatus ?? 'confirmed',
          notes: notes ?? null,
          occasion: occasion ?? null,
        })
        .select()
        .maybeSingle();

      if (error) throw error;
      return json({ data });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: confirm_reservation
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'confirm_reservation') {
      const { reservation_id } = body;
      if (!reservation_id) return json({ error: 'reservation_id is required' }, 400);

      const { data: reservation, error: fetchErr } = await admin
        .from('table_reservations')
        .select('id, status, tenant_id')
        .eq('id', reservation_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!reservation) return json({ error: 'Reservation not found' }, 404);
      if (reservation.status !== 'pending') {
        return json({ error: 'Only pending reservations can be confirmed', current_status: reservation.status }, 422);
      }

      const { data, error } = await admin
        .from('table_reservations')
        .update({ status: 'confirmed', confirmed_by: user.id })
        .eq('id', reservation_id)
        .select()
        .maybeSingle();

      if (error) throw error;
      return json({ data });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: seat_reservation
    // Marca como 'seated' e cria/vincula uma table_session
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'seat_reservation') {
      const { reservation_id, table_id: seatTableId, session_id } = body;
      if (!reservation_id) return json({ error: 'reservation_id is required' }, 400);

      const { data: reservation, error: fetchErr } = await admin
        .from('table_reservations')
        .select('id, status, tenant_id, table_id, customer_name, party_size')
        .eq('id', reservation_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!reservation) return json({ error: 'Reservation not found' }, 404);
      if (!['pending', 'confirmed'].includes(reservation.status)) {
        return json({ error: 'Only pending or confirmed reservations can be seated', current_status: reservation.status }, 422);
      }

      const resolvedTableId = seatTableId ?? reservation.table_id ?? null;
      let tableSessionId: string | null = session_id ?? null;

      // Se não foi passada uma session_id existente, cria uma nova table_session
      if (!tableSessionId && resolvedTableId) {
        const { data: sessionData, error: sessionErr } = await admin
          .from('table_sessions')
          .insert({
            tenant_id: tenantId,
            table_id: resolvedTableId,
            customer_name: reservation.customer_name,
            status: 'open',
            opened_at: new Date().toISOString(),
          })
          .select('id')
          .maybeSingle();

        if (sessionErr) throw sessionErr;
        tableSessionId = sessionData?.id ?? null;

        // Atualiza status da mesa para 'occupied'
        if (resolvedTableId) {
          await admin
            .from('tables')
            .update({ status: 'occupied' })
            .eq('id', resolvedTableId);
        }
      }

      const { data, error } = await admin
        .from('table_reservations')
        .update({
          status: 'seated',
          table_id: resolvedTableId,
          table_session_id: tableSessionId,
        })
        .eq('id', reservation_id)
        .select()
        .maybeSingle();

      if (error) throw error;
      return json({ data, table_session_id: tableSessionId });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: cancel_reservation
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'cancel_reservation') {
      const { reservation_id, cancellation_reason } = body;
      if (!reservation_id) return json({ error: 'reservation_id is required' }, 400);

      const { data: reservation, error: fetchErr } = await admin
        .from('table_reservations')
        .select('id, status, tenant_id')
        .eq('id', reservation_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!reservation) return json({ error: 'Reservation not found' }, 404);
      if (['cancelled', 'seated'].includes(reservation.status)) {
        return json({ error: 'Cannot cancel a reservation that is already seated or cancelled', current_status: reservation.status }, 422);
      }

      const { data, error } = await admin
        .from('table_reservations')
        .update({
          status: 'cancelled',
          cancelled_by: user.id,
          cancellation_reason: cancellation_reason ?? null,
        })
        .eq('id', reservation_id)
        .select()
        .maybeSingle();

      if (error) throw error;
      return json({ data });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: list_reservations
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'list_reservations') {
      const { reservation_date, status: filterStatus } = body;

      let query = admin
        .from('table_reservations')
        .select(`
          id,
          tenant_id,
          table_id,
          customer_name,
          customer_phone,
          customer_id,
          party_size,
          reservation_date,
          reservation_time,
          duration_minutes,
          status,
          table_session_id,
          notes,
          occasion,
          confirmed_by,
          cancelled_by,
          cancellation_reason,
          created_at,
          updated_at,
          tables (id, number, area, capacity)
        `)
        .eq('tenant_id', tenantId)
        .order('reservation_date', { ascending: true })
        .order('reservation_time', { ascending: true });

      if (reservation_date) {
        query = query.eq('reservation_date', reservation_date);
      }

      if (filterStatus) {
        if (Array.isArray(filterStatus)) {
          query = query.in('status', filterStatus);
        } else {
          query = query.eq('status', filterStatus);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return json({ data });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: mark_no_show
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'mark_no_show') {
      const { reservation_id } = body;
      if (!reservation_id) return json({ error: 'reservation_id is required' }, 400);

      const { data: reservation, error: fetchErr } = await admin
        .from('table_reservations')
        .select('id, status, tenant_id')
        .eq('id', reservation_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!reservation) return json({ error: 'Reservation not found' }, 404);
      if (!['pending', 'confirmed'].includes(reservation.status)) {
        return json({ error: 'Only pending or confirmed reservations can be marked as no-show', current_status: reservation.status }, 422);
      }

      const { data, error } = await admin
        .from('table_reservations')
        .update({ status: 'no_show' })
        .eq('id', reservation_id)
        .select()
        .maybeSingle();

      if (error) throw error;
      return json({ data });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converte "HH:MM" ou "HH:MM:SS" em minutos desde meia-noite */
function timeToMinutes(time: string): number {
  const parts = time.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}
