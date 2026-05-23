import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UNIT_MAP: Record<string, string> = { kg: 'kg', g: 'g', ml: 'ml', l: 'L', L: 'L', un: 'unit', unit: 'unit' };
const MOVEMENT_TYPE_MAP: Record<string, string> = {
  entrada: 'in', saida_venda: 'theoretical_out', saida_manual: 'manual_out',
  perda: 'manual_out', inventory_adjustment: 'inventory_adjustment',
  ajuste_inventario: 'inventory_adjustment', transfer_in: 'transfer_in',
  transfer_out: 'transfer_out', in: 'in', theoretical_out: 'theoretical_out',
  manual_out: 'manual_out',
};

function isUniqueViolation(err: unknown): boolean {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : extractErrorMessage(err);
  return msg.includes('unique constraint') || msg.includes('duplicate key') || msg.includes('already exists');
}

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

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';

  const hasServiceRole = serviceRoleKey.length > 100;

  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const admin = createClient(supabaseUrl, hasServiceRole ? serviceRoleKey : anonKey, {
    global: { headers: hasServiceRole
      ? { Authorization: `Bearer ${serviceRoleKey}` }
      : { Authorization: authHeader }
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) {
    console.error('[stock-write] Auth failed:', extractErrorMessage(userError));
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { action } = body;
    console.log('[stock-write] Action:', action, 'User:', user.id);

    if (!action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const requestedTenantId: string | null = body.active_tenant_id ?? body.tenant_id ?? null;

    const { data: tenantRows, error: tenantErr } = await admin
      .from('user_tenants')
      .select('tenant_id, role')
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

    let tenantId: string;
    if (requestedTenantId) {
      const match = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
      if (!match) {
        tenantId = tenantRows[0].tenant_id;
      } else {
        tenantId = match.tenant_id;
      }
    } else if (tenantRows.length === 1) {
      tenantId = tenantRows[0].tenant_id;
    } else {
      tenantId = tenantRows[0].tenant_id;
    }

    console.log('[stock-write] Resolved tenant:', tenantId, 'Requested:', requestedTenantId);

    if (action === 'delete_ingredient') {
      const { ingredient_id } = body;
      console.log('[stock-write] delete_ingredient — id:', ingredient_id, 'tenant:', tenantId);
      if (!ingredient_id) {
        return new Response(JSON.stringify({ error: 'ingredient_id is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: rpcData, error: rpcErr } = await admin.rpc('fn_soft_delete_ingredient', {
        p_ingredient_id: ingredient_id,
        p_tenant_id: tenantId,
      });
      console.log('[stock-write] fn_soft_delete_ingredient result:', JSON.stringify(rpcData), 'error:', extractErrorMessage(rpcErr));
      if (rpcErr) {
        return new Response(JSON.stringify({ error: extractErrorMessage(rpcErr) }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const result = rpcData as Record<string, unknown> | null;
      if (!result || result.success !== true) {
        return new Response(JSON.stringify({
          error: (result?.error as string) ?? 'Insumo nao encontrado ou sem permissao para deletar'
        }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, deleted: result.deleted ?? 1 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'add_stock_movement') {
      const { ingredient_id, type, quantity, unit, reason, notes, order_id, operator_id, batch_id } = body;
      const dbType = MOVEMENT_TYPE_MAP[type] ?? 'manual_out';
      const isSub = ['manual_out', 'theoretical_out', 'transfer_out'].includes(dbType);
      const delta = isSub ? -Math.abs(quantity) : Math.abs(quantity);

      const { data: rpcData, error: rpcErr } = await admin.rpc('fn_add_stock_movement', {
        p_tenant_id: tenantId,
        p_ingredient_id: ingredient_id,
        p_type: dbType,
        p_quantity: Math.abs(quantity),
        p_unit: UNIT_MAP[unit] ?? null,
        p_reason: reason ?? null,
        p_notes: notes ?? null,
        p_order_id: order_id ?? null,
        p_operator_id: operator_id ?? user.id,
        p_batch_id: batch_id ?? null,
      });

      if (rpcErr) {
        const msg = extractErrorMessage(rpcErr);
        console.error('[stock-write] add_stock_movement fn_add_stock_movement error:', msg);
        throw new Error(msg);
      }

      const result = rpcData as Record<string, unknown> | null;
      const movementId = result?.movement_id as string | undefined;

      return new Response(JSON.stringify({ data: { id: movementId, delta } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create_batch') {
      const { ingredient_id, batch_code, supplier_id, quantity_received, unit, unit_cost, received_date, expiry_date, notes } = body;
      if (!ingredient_id || !quantity_received || !unit || !unit_cost) {
        return new Response(JSON.stringify({ error: 'ingredient_id, quantity_received, unit e unit_cost sao obrigatorios' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: batch, error: batchErr } = await admin
        .from('ingredient_batches')
        .insert({
          tenant_id: tenantId, ingredient_id, batch_code: batch_code ?? null,
          supplier_id: supplier_id ?? null, quantity_received: Number(quantity_received),
          quantity_remaining: Number(quantity_received), unit, unit_cost: Number(unit_cost),
          received_date: received_date ?? new Date().toISOString().split('T')[0],
          expiry_date: expiry_date ?? null, notes: notes ?? null, created_by: user.id, status: 'active',
        })
        .select('*')
        .single();
      if (batchErr) {
        throw new Error(extractErrorMessage(batchErr));
      }
      const { data: rpcData, error: rpcErr } = await admin.rpc('fn_add_stock_movement', {
        p_tenant_id: tenantId,
        p_ingredient_id: ingredient_id,
        p_type: 'in',
        p_quantity: Number(quantity_received),
        p_unit: unit,
        p_reason: `Entrada de lote${batch_code ? ` ${batch_code}` : ''}`,
        p_notes: null,
        p_order_id: null,
        p_operator_id: user.id,
        p_batch_id: batch.id,
      });
      if (rpcErr) console.error('[stock-write] create_batch fn_add_stock_movement error:', extractErrorMessage(rpcErr));
      return new Response(JSON.stringify({ data: batch }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'update_batch_status') {
      const { batch_id, status } = body;
      const validStatuses = ['active', 'depleted', 'expired', 'recalled'];
      if (!validStatuses.includes(status)) {
        return new Response(JSON.stringify({ error: `Status invalido: ${status}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error } = await admin.from('ingredient_batches').update({ status, updated_at: new Date().toISOString() }).eq('id', batch_id).eq('tenant_id', tenantId);
      if (error) throw new Error(extractErrorMessage(error));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'upsert_ingredient') {
      const { id, name, unit, unit_price, min_stock, current_stock, category, supplier, supplier_id, purchase_unit, purchase_factor, dre_category_id, usage_type } = body;
      const { data: rpcData, error: rpcErr } = await admin.rpc('fn_upsert_ingredient', {
        p_tenant_id: tenantId,
        p_id: id ?? null,
        p_name: name,
        p_unit: UNIT_MAP[unit] ?? 'unit',
        p_unit_price: unit_price ?? 0,
        p_min_stock: min_stock ?? 0,
        p_current_stock: current_stock ?? 0,
        p_category: category ?? '',
        p_supplier: supplier ?? '',
        p_usage_type: usage_type ?? 'final',
        p_purchase_unit: purchase_unit ?? null,
        p_purchase_factor: purchase_factor != null ? Number(purchase_factor) : 1,
        p_supplier_id: supplier_id ?? null,
        p_dre_category_id: dre_category_id ?? null,
      });
      if (rpcErr) {
        if (isUniqueViolation(rpcErr)) {
          return new Response(JSON.stringify({ error: 'Ja existe um insumo com este nome. Escolha outro nome.' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        throw new Error(extractErrorMessage(rpcErr));
      }
      return new Response(JSON.stringify({ data: rpcData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'mark_depleted') {
      const { ingredient_id, depleted } = body;
      const { error } = await admin.rpc('fn_mark_ingredient_depleted', {
        p_ingredient_id: ingredient_id, p_tenant_id: tenantId, p_depleted: depleted ?? true,
      });
      if (error) throw new Error(extractErrorMessage(error));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'confirm_inventory') {
      const { items, operator_id } = body;
      if (!Array.isArray(items)) throw new Error('items must be array');

      for (const item of items) {
        if (item.diferenca === 0) continue;
        const dbType = 'inventory_adjustment';
        const { data: rpcData, error: rpcErr } = await admin.rpc('fn_add_stock_movement', {
          p_tenant_id: tenantId,
          p_ingredient_id: item.ingredient_id,
          p_type: dbType,
          p_quantity: Math.abs(item.diferenca),
          p_unit: null,
          p_reason: item.reason ?? 'Ajuste de Inventario',
          p_notes: null,
          p_order_id: null,
          p_operator_id: operator_id ?? user.id,
          p_batch_id: null,
        });
        if (rpcErr) console.error('[stock-write] confirm_inventory fn_add_stock_movement error:', extractErrorMessage(rpcErr));
      }

      for (const item of items) {
        const { error: updErr } = await admin.from('ingredients').update({ current_stock: item.qtd_contada, updated_at: new Date().toISOString() }).eq('id', item.ingredient_id).eq('tenant_id', tenantId);
        if (updErr) console.error('[stock-write] confirm_inventory update error:', extractErrorMessage(updErr));
      }
      return new Response(JSON.stringify({ ok: true, adjusted: items.filter((i: {diferenca: number}) => i.diferenca !== 0).length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'deduct_sale') {
      const { deductions, order_id } = body;
      if (!Array.isArray(deductions)) throw new Error('deductions must be array');

      if (order_id) {
        const { data: existing, error: existingErr } = await admin
          .from('stock_movements')
          .select('id')
          .eq('order_id', order_id)
          .eq('type', 'theoretical_out')
          .limit(1);
        if (existingErr) {
          console.error('[stock-write] deduct_sale dedup check error:', extractErrorMessage(existingErr));
        } else if (existing && existing.length > 0) {
          console.log('[stock-write] deduct_sale dedup: baixa já existe para order_id', order_id, '— pulando');
          return new Response(JSON.stringify({ ok: true, deduplicated: true, reason: 'stock_movement already exists for this order' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      for (const d of deductions) {
        const { data: rpcData, error: rpcErr } = await admin.rpc('fn_add_stock_movement', {
          p_tenant_id: tenantId,
          p_ingredient_id: d.ingredient_id,
          p_type: 'theoretical_out',
          p_quantity: Math.abs(d.quantity),
          p_unit: UNIT_MAP[d.unit] ?? null,
          p_reason: d.reason ?? 'Baixa automatica por venda',
          p_notes: null,
          p_order_id: order_id ?? null,
          p_operator_id: user.id,
          p_batch_id: d.batch_id ?? null,
        });
        if (rpcErr) {
          console.error('[stock-write] deduct_sale fn_add_stock_movement error:', extractErrorMessage(rpcErr));
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = extractErrorMessage(err);
    console.error('[stock-write] Uncaught error:', msg, 'raw:', JSON.stringify(err));
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
