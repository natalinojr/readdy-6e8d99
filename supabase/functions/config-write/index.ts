import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, tenant_id, active_tenant_id, ...rest } = body

    const tId = tenant_id || active_tenant_id

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // INGREDIENT CATEGORIES
    // ═══════════════════════════════════════════════════════════════════════════
    if (action === 'list_ingredient_categories') {
      if (!tId) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id é obrigatório' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }
      const { data, error } = await supabaseAdmin
        .from('ingredient_categories')
        .select('id, name')
        .eq('tenant_id', tId)
        .order('name', { ascending: true })

      if (error) {
        console.error('[config-write] list_ingredient_categories error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'create_ingredient_category') {
      const { name } = rest
      if (!tId || !name) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e name são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }
      const { data, error } = await supabaseAdmin
        .from('ingredient_categories')
        .insert({ tenant_id: tId, name: String(name).trim() })
        .select('id, name')
        .single()

      if (error) {
        console.error('[config-write] create_ingredient_category error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'delete_ingredient_category') {
      const { id } = rest
      if (!tId || !id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }
      const { error } = await supabaseAdmin
        .from('ingredient_categories')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tId)

      if (error) {
        console.error('[config-write] delete_ingredient_category error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // KITCHEN STATIONS
    // ═══════════════════════════════════════════════════════════════════════════
    if (action === 'get_kitchen_stations') {
      if (!tId) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id é obrigatório' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }
      const { data, error } = await supabaseAdmin
        .from('kitchen_stations')
        .select('id, name, color, sla_minutes, sort_order, is_active')
        .eq('tenant_id', tId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (error) {
        console.error('[config-write] get_kitchen_stations error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'create_kitchen_station') {
      const { name, color, sla_minutes } = rest
      if (!tId || !name) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e name são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      // Get next sort_order
      const { data: lastStation } = await supabaseAdmin
        .from('kitchen_stations')
        .select('sort_order')
        .eq('tenant_id', tId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()

      const nextSort = (lastStation?.sort_order ?? -1) + 1

      const { data, error } = await supabaseAdmin
        .from('kitchen_stations')
        .insert({
          tenant_id: tId,
          name: String(name).trim(),
          color: String(color ?? '#f59e0b'),
          sla_minutes: typeof sla_minutes === 'number' ? sla_minutes : 15,
          sort_order: nextSort,
          is_active: true,
        })
        .select('id, name, color, sla_minutes, sort_order, is_active')
        .single()

      if (error) {
        console.error('[config-write] create_kitchen_station error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'update_kitchen_station') {
      const { id, ...fields } = rest
      if (!tId || !id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const updateData: Record<string, unknown> = {}
      if (fields.name !== undefined) updateData.name = String(fields.name).trim()
      if (fields.color !== undefined) updateData.color = String(fields.color)
      if (fields.sla_minutes !== undefined) updateData.sla_minutes = Number(fields.sla_minutes)
      if (fields.is_active !== undefined) updateData.is_active = Boolean(fields.is_active)
      if (fields.sort_order !== undefined) updateData.sort_order = Number(fields.sort_order)

      if (Object.keys(updateData).length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'Nenhum campo para atualizar' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const { error } = await supabaseAdmin
        .from('kitchen_stations')
        .update(updateData)
        .eq('id', id)
        .eq('tenant_id', tId)

      if (error) {
        console.error('[config-write] update_kitchen_station error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'delete_kitchen_station') {
      const { id } = rest
      if (!tId || !id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      // Remove operators first
      await supabaseAdmin
        .from('station_operators')
        .delete()
        .eq('station_id', id)
        .eq('tenant_id', tId)

      const { error } = await supabaseAdmin
        .from('kitchen_stations')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tId)

      if (error) {
        console.error('[config-write] delete_kitchen_station error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PAYMENT METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    if (action === 'create_payment_method') {
      const { name, type, fee_percentage, days_to_receive, max_installments, installment_interval_days } = rest
      if (!tId || !name || !type) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id, name e type são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const { data, error } = await supabaseAdmin
        .from('payment_methods')
        .insert({
          tenant_id: tId,
          name: String(name).trim(),
          type: String(type),
          is_active: true,
          fee_percentage: typeof fee_percentage === 'number' ? fee_percentage : 0,
          days_to_receive: typeof days_to_receive === 'number' ? days_to_receive : 0,
          max_installments: typeof max_installments === 'number' ? max_installments : 1,
          installment_interval_days: typeof installment_interval_days === 'number' ? installment_interval_days : 30,
        })
        .select('id, name, type, is_active, fee_percentage, days_to_receive')
        .single()

      if (error) {
        console.error('[config-write] create_payment_method error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'update_payment_method') {
      const { id, ...fields } = rest
      if (!tId || !id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (fields.name !== undefined) updateData.name = String(fields.name).trim()
      if (fields.type !== undefined) updateData.type = String(fields.type)
      if (fields.is_active !== undefined) updateData.is_active = Boolean(fields.is_active)
      if (fields.fee_percentage !== undefined) updateData.fee_percentage = Number(fields.fee_percentage)
      if (fields.days_to_receive !== undefined) updateData.days_to_receive = Number(fields.days_to_receive)
      if (fields.max_installments !== undefined) updateData.max_installments = Number(fields.max_installments)
      if (fields.installment_interval_days !== undefined) updateData.installment_interval_days = Number(fields.installment_interval_days)

      const { error } = await supabaseAdmin
        .from('payment_methods')
        .update(updateData)
        .eq('id', id)
        .eq('tenant_id', tId)

      if (error) {
        console.error('[config-write] update_payment_method error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'delete_payment_method') {
      const { id } = rest
      if (!tId || !id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const { error } = await supabaseAdmin
        .from('payment_methods')
        .update({ is_active: false, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tId)

      if (error) {
        console.error('[config-write] delete_payment_method error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TABLES
    // ═══════════════════════════════════════════════════════════════════════════
    if (action === 'create_table') {
      const { number, capacity, table_type, area, pos_x, pos_y } = rest
      if (!tId || number === undefined) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e number são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const qr_token = crypto.randomUUID().replace(/-/g, '')

      const { data, error } = await supabaseAdmin
        .from('tables')
        .insert({
          tenant_id: tId,
          number: Number(number),
          capacity: typeof capacity === 'number' ? capacity : 4,
          table_type: table_type ? String(table_type) : 'quadrada',
          area: area ? String(area) : 'Salão',
          pos_x: typeof pos_x === 'number' ? pos_x : 0,
          pos_y: typeof pos_y === 'number' ? pos_y : 0,
          status: 'available',
          is_active: true,
          qr_token,
        })
        .select('id, number, capacity, table_type, area, pos_x, pos_y, status, qr_token, is_active, observation')
        .single()

      if (error) {
        console.error('[config-write] create_table error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'update_table') {
      const { id, ...fields } = rest
      if (!tId || !id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const updateData: Record<string, unknown> = {}
      if (fields.number !== undefined) updateData.number = Number(fields.number)
      if (fields.capacity !== undefined) updateData.capacity = Number(fields.capacity)
      if (fields.table_type !== undefined) updateData.table_type = String(fields.table_type)
      if (fields.area !== undefined) updateData.area = String(fields.area)
      if (fields.pos_x !== undefined) updateData.pos_x = Number(fields.pos_x)
      if (fields.pos_y !== undefined) updateData.pos_y = Number(fields.pos_y)
      if (fields.status !== undefined) updateData.status = String(fields.status)
      if (fields.qr_token !== undefined) updateData.qr_token = String(fields.qr_token)
      if (fields.observation !== undefined) updateData.observation = String(fields.observation)

      if (Object.keys(updateData).length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'Nenhum campo para atualizar' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const { error } = await supabaseAdmin
        .from('tables')
        .update(updateData)
        .eq('id', id)
        .eq('tenant_id', tId)

      if (error) {
        console.error('[config-write] update_table error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'delete_table') {
      const { id } = rest
      if (!tId || !id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const { error } = await supabaseAdmin
        .from('tables')
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tId)

      if (error) {
        console.error('[config-write] delete_table error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'regenerate_qr') {
      const { id } = rest
      if (!tId || !id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const newQrToken = crypto.randomUUID().replace(/-/g, '')

      const { data, error } = await supabaseAdmin
        .from('tables')
        .update({ qr_token: newQrToken })
        .eq('id', id)
        .eq('tenant_id', tId)
        .select('id, number, capacity, table_type, area, pos_x, pos_y, status, qr_token, is_active, observation')
        .single()

      if (error) {
        console.error('[config-write] regenerate_qr error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PERMISSIONS
    // ═══════════════════════════════════════════════════════════════════════════
    if (action === 'get_permissions') {
      if (!tId) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id é obrigatório' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const { data, error } = await supabaseAdmin
        .from('permissions')
        .select('role, permission_key, allowed')
        .eq('tenant_id', tId)

      if (error) {
        console.error('[config-write] get_permissions error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'upsert_permissions') {
      const { permissions } = rest
      if (!tId || !Array.isArray(permissions)) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id e permissions[] são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      // Build upsert rows
      const rows = permissions.map((p: { role: string; permission_key: string; allowed: boolean }) => ({
        tenant_id: tId,
        role: p.role,
        permission_key: p.permission_key,
        allowed: p.allowed,
      }))

      const { error } = await supabaseAdmin
        .from('permissions')
        .upsert(rows, { onConflict: 'tenant_id,role,permission_key', ignoreDuplicates: false })

      if (error) {
        console.error('[config-write] upsert_permissions error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TENANTS
    // ═══════════════════════════════════════════════════════════════════════════
    if (action === 'update_tenant') {
      // Validate tenant_id from body (not from auth)
      const tenantIdFromBody = tenant_id || active_tenant_id
      if (!tenantIdFromBody) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id é obrigatório' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const updateData: Record<string, unknown> = {}
      const tenantFields = ['name', 'cnpj', 'address', 'logo_url', 'phone', 'email', 'city', 'state', 'zip_code']
      for (const field of tenantFields) {
        if (rest[field] !== undefined) {
          updateData[field] = rest[field]
        }
      }

      if (Object.keys(updateData).length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'Nenhum campo para atualizar' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const { error } = await supabaseAdmin
        .from('tenants')
        .update(updateData)
        .eq('id', tenantIdFromBody)

      if (error) {
        console.error('[config-write] update_tenant error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATION OPERATORS
    // ═══════════════════════════════════════════════════════════════════════════
    if (action === 'assign_station_operator') {
      const { user_id, station_id } = rest
      if (!tId || !user_id || !station_id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id, user_id e station_id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      // Avoid duplicates
      const { data: existing } = await supabaseAdmin
        .from('station_operators')
        .select('id')
        .eq('tenant_id', tId)
        .eq('user_id', user_id)
        .eq('station_id', station_id)
        .maybeSingle()

      if (existing) {
        // Already assigned
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        })
      }

      const { error } = await supabaseAdmin
        .from('station_operators')
        .insert({
          tenant_id: tId,
          user_id,
          station_id,
        })

      if (error) {
        console.error('[config-write] assign_station_operator error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    if (action === 'remove_station_operator') {
      const { user_id, station_id } = rest
      if (!tId || !user_id || !station_id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id, user_id e station_id são obrigatórios' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const { error } = await supabaseAdmin
        .from('station_operators')
        .delete()
        .eq('tenant_id', tId)
        .eq('user_id', user_id)
        .eq('station_id', station_id)

      if (error) {
        console.error('[config-write] remove_station_operator error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SYSTEM SETTINGS (existing action preserved)
    // ═══════════════════════════════════════════════════════════════════════════
    if (action === 'upsert_system_settings') {
      if (!tenant_id) {
        return new Response(JSON.stringify({ success: false, error: 'tenant_id é obrigatório' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }

      const updateData: Record<string, unknown> = {
        tenant_id,
        updated_at: new Date().toISOString(),
      }

      const fieldMap: Record<string, string> = {
        service_fee_enabled: 'service_fee_enabled',
        service_fee_percentage: 'service_fee_percentage',
        pdv_caixa_show_service_fee: 'pdv_caixa_show_service_fee',
        gorjeta_enabled: 'gorjeta_enabled',
        gorjeta_percentage: 'gorjeta_percentage',
        auto_print_enabled: 'auto_print_enabled',
        kitchen_close_time: 'kitchen_close_time',
        self_service_id_type: 'self_service_id_type',
        self_service_payment_type: 'self_service_payment_type',
        welcome_message_new: 'welcome_message_new',
        welcome_message_returning: 'welcome_message_returning',
        stone_client_id: 'stone_client_id',
        stone_client_secret: 'stone_client_secret',
        timer_verde_max: 'timer_verde_max',
        timer_ambar_max: 'timer_ambar_max',
        kitchen_view: 'kitchen_view',
        cancel_mode: 'cancel_mode',
        discount_profile: 'discount_profile',
        default_prep_time: 'default_prep_time',
        delivery_require_id: 'delivery_require_id',
        delivery_type: 'delivery_type',
        delivery_eta_minutes: 'delivery_eta_minutes',
        sectors_config: 'sectors_config',
        print_kds_enabled: 'print_kds_enabled',
        print_kitchen_copy_enabled: 'print_kitchen_copy_enabled',
        printers_config: 'printers_config',
        pager_count: 'pager_count',
        pdv_config: 'pdv_config',
        delivery_commission_rates: 'delivery_commission_rates',
        delivery_payment_methods: 'delivery_payment_methods',
        delivery_print_enabled: 'delivery_print_enabled',
      }

      for (const [key, dbField] of Object.entries(fieldMap)) {
        if (rest[key] !== undefined) {
          updateData[dbField] = rest[key]
        }
      }

      const validIdTypes = ['nome', 'senha', 'comanda', 'senha_balcao', 'nenhum']
      if (updateData.self_service_id_type !== undefined) {
        const val = String(updateData.self_service_id_type).toLowerCase()
        if (!validIdTypes.includes(val)) {
          console.log(`[config-write] Valor inválido para self_service_id_type: ${val}, mantendo existente`)
          delete updateData.self_service_id_type
        } else {
          updateData.self_service_id_type = val
        }
      }

      const { error } = await supabaseAdmin
        .from('system_settings')
        .upsert(updateData, { onConflict: 'tenant_id' })

      if (error) {
        console.error('[config-write] upsert_system_settings error:', error)
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UNKNOWN ACTION
    // ═══════════════════════════════════════════════════════════════════════════
    return new Response(JSON.stringify({ success: false, error: `Ação inválida: ${action}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })

  } catch (err) {
    console.error('[config-write] Erro:', err)
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
