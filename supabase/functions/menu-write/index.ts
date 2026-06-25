import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function errResp(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function isUniqueViolation(err: unknown): boolean {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : (err as Record<string, unknown>)?.message as string ?? '';
  return msg.includes('unique constraint') || msg.includes('duplicate key') || msg.includes('already exists');
}

function friendlyUniqueError(err: unknown, context: string): string {
  const msg = typeof err === 'string' ? err : (err as Record<string, unknown>)?.message as string ?? '';
  if (msg.includes('menu_categories') || context === 'category') return 'Já existe uma categoria com este nome. Escolha outro nome.';
  if (msg.includes('menu_items') || context === 'item') return 'Já existe um item com este nome nesta categoria. Escolha outro nome.';
  if (msg.includes('combos') || context === 'combo') return 'Já existe um combo com este nome. Escolha outro nome.';
  if (msg.includes('global_observations') || context === 'obs') return 'Esta observação já existe. Escolha outro texto.';
  return 'Já existe um registro com este nome. Escolha outro nome.';
}

function isValidUuid(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';

    if (!supabaseUrl) return errResp('Server misconfiguration', 500);
    if (!serviceRoleKey || serviceRoleKey.length < 40) return errResp('Server misconfiguration (service key)', 500);
    if (!authHeader || authHeader === 'Bearer ') return errResp('Unauthorized', 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return errResp('Unauthorized', 401);

    let user: { id: string } | null = null;
    let userError: { message: string } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (!userErr && userData?.user) {
        user = userData.user;
        userError = null;
        break;
      }
      userError = userErr;
      if (attempt === 0 && userErr) {
        console.warn('[menu-write] getUser attempt 1 failed:', userErr.message, '— retrying in 300ms...');
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (userError || !user) {
      console.error('[menu-write] getUser failed after retry:', userError?.message ?? 'no user');
      return errResp('Unauthorized', 401);
    }

    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const tenantIdForm = formData.get('tenant_id') as string | null;
      const itemId = formData.get('item_id') as string | null;

      if (!file) return errResp('No file provided', 400);
      if (!tenantIdForm) return errResp('tenant_id required', 400);

      const { data: tenantRows } = await admin
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantIdForm);
      if (!tenantRows || tenantRows.length === 0) return errResp('User does not belong to the requested tenant', 403);

      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const fileName = `${tenantIdForm}/${itemId ?? 'new'}-${Date.now()}.${ext}`;
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      const { data: uploadData, error: uploadError } = await admin.storage
        .from('menu-images')
        .upload(fileName, uint8, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) {
        console.error('[menu-write] Storage upload error:', uploadError.message);
        return errResp(`Upload failed: ${uploadError.message}`, 500);
      }

      const { data: { publicUrl } } = admin.storage
        .from('menu-images')
        .getPublicUrl(uploadData.path);

      return new Response(JSON.stringify({ success: true, url: publicUrl }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } });

    let body: { action: string; payload: Record<string, unknown>; active_tenant_id?: string };
    try { body = await req.json(); } catch { return errResp('Invalid JSON body', 400); }
    const { action, payload } = body;

    console.log('[menu-write] action:', action, 'payload keys:', Object.keys(payload));

    const { data: tenantRows, error: tenantErr } = await admin
      .from('user_tenants')
      .select('tenant_id')
      .eq('user_id', user.id);

    if (tenantErr) return errResp(`Tenant lookup failed: ${tenantErr.message}`, 500);
    if (!tenantRows || tenantRows.length === 0) return errResp('User does not belong to any tenant', 403);

    let tenantId: string;
    const requestedTenantId = body.active_tenant_id ?? null;
    if (requestedTenantId) {
      const match = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
      if (!match) return errResp('User does not belong to the requested tenant', 403);
      tenantId = match.tenant_id;
    } else if (tenantRows.length === 1) {
      tenantId = tenantRows[0].tenant_id;
    } else {
      return errResp('Multiple tenants found — active_tenant_id required', 403);
    }

    const now = new Date().toISOString();
    let result: unknown = null;

    if (action === 'upsert_category') {
      const { id, name, station_id, sort_order, is_active } = payload as { id?: string; name: string; station_id?: string | null; sort_order?: number; is_active?: boolean };
      if (id) {
        const { data, error } = await admin.from('menu_categories').update({ name, station_id: station_id ?? null, sort_order, is_active }).eq('id', id).eq('tenant_id', tenantId).is('deleted_at', null).select().maybeSingle();
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'category') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_category update: ${error.message}`);
        }
        result = data;
      } else {
        const { data, error } = await admin.from('menu_categories').insert({ tenant_id: tenantId, name, station_id: station_id ?? null, sort_order: sort_order ?? 0, is_active: is_active ?? true }).select().maybeSingle();
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'category') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_category insert: ${error.message}`);
        }
        result = data;
      }
    }
    else if (action === 'delete_category') {
      const { id } = payload as { id: string };
      const { error } = await admin.from('menu_categories').update({ deleted_at: now }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw new Error(`delete_category: ${error.message}`);
      result = { deleted: true };
    }
    else if (action === 'reorder_categories') {
      const { items } = payload as { items: Array<{ id: string; sort_order: number }> };
      for (const item of items) {
        await admin.from('menu_categories').update({ sort_order: item.sort_order }).eq('id', item.id).eq('tenant_id', tenantId);
      }
      result = { reordered: true };
    }
    else if (action === 'reorder_items') {
      const { items } = payload as { items: Array<{ id: string; sort_order: number }> };
      for (const item of items) {
        await admin.from('menu_items').update({ sort_order: item.sort_order }).eq('id', item.id).eq('tenant_id', tenantId);
      }
      result = { reordered: true };
    }
    else if (action === 'set_category_channel') {
      // Aplica o canal (casa / ambos / delivery) a TODOS os itens de uma categoria
      // de uma vez. Mexe somente em channels + delivery_config.ativo — não toca em
      // grupos de opções, promoções nem ficha. Espelha a lógica de salvarItem/
      // disponibilidadeDe no front (CardapioContext).
      const { category_id, disponibilidade } = payload as { category_id: string; disponibilidade: 'ambos' | 'casa' | 'delivery' };
      if (!category_id) return errResp('category_id required', 400);
      if (!['ambos', 'casa', 'delivery'].includes(disponibilidade)) return errResp('invalid disponibilidade', 400);

      const channels = disponibilidade === 'delivery'
        ? { cashier: false, waiter: false, delivery: true, table_qr: false, self_service: false }
        : { cashier: true, waiter: true, delivery: true, table_qr: true, self_service: true };
      const deliveryAtivo = disponibilidade !== 'casa'; // delivery e ambos = true; casa = false

      const { data: items, error: selErr } = await admin
        .from('menu_items')
        .select('id, delivery_config')
        .eq('category_id', category_id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null);
      if (selErr) throw new Error(`set_category_channel select: ${selErr.message}`);

      let updated = 0;
      for (const it of (items ?? [])) {
        const dc = (it.delivery_config && typeof it.delivery_config === 'object') ? it.delivery_config as Record<string, unknown> : {};
        const newDc = { ...dc, ativo: deliveryAtivo };
        const { error: updErr } = await admin.from('menu_items')
          .update({ channels, delivery_config: newDc, updated_at: now })
          .eq('id', it.id).eq('tenant_id', tenantId);
        if (updErr) throw new Error(`set_category_channel update ${it.id}: ${updErr.message}`);
        updated++;
      }
      result = { updated };
    }
    else if (action === 'upsert_item') {
      const p = payload as any;
      const { id, category_id, name, description, price, sla_minutes, is_active, skip_kds, sort_order, channels, option_groups, promotions, preset_observations, delivery_config, production_parts } = p;

      let photo_url: string | null = p.photo_url ?? null;
      if (photo_url && photo_url.startsWith('data:')) {
        photo_url = null;
      }

      let itemId = id;
      if (itemId) {
        const { error } = await admin.from('menu_items').update({ category_id, name, description, price, photo_url, sla_minutes, is_active, skip_kds, sort_order, channels, delivery_config: delivery_config ?? null, updated_at: now }).eq('id', itemId).eq('tenant_id', tenantId).is('deleted_at', null);
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'item') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_item update: ${error.message}`);
        }
      } else {
        const { data: newItem, error } = await admin.from('menu_items').insert({ tenant_id: tenantId, category_id, name, description, price, photo_url, sla_minutes: sla_minutes ?? 10, is_active: is_active ?? true, skip_kds: skip_kds ?? false, sort_order: sort_order ?? 0, channels: channels ?? { cashier: true, waiter: true, delivery: true, table_qr: true, self_service: true }, delivery_config: delivery_config ?? null }).select().maybeSingle();
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'item') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_item insert: ${error.message}`);
        }
        itemId = newItem?.id;
      }
      if (!itemId) throw new Error('Failed to upsert item — no id returned');

      if (option_groups !== undefined) {
        console.log('[menu-write] Processing option_groups, count:', (option_groups as unknown[])?.length ?? 0);
        console.log('[menu-write] Raw option_groups:', JSON.stringify(option_groups));
        
        const ingredientIdsToFetch: string[] = [];
        for (let gi = 0; gi < option_groups.length; gi++) {
          const grp = option_groups[gi];
          for (let oi = 0; oi < (grp.options ?? []).length; oi++) {
            const opt = grp.options[oi];
            if (opt.ingredient_id && (!opt.name || String(opt.name).trim() === '')) {
              ingredientIdsToFetch.push(opt.ingredient_id);
            }
          }
        }
        const ingredientNameMap = new Map<string, string>();
        if (ingredientIdsToFetch.length > 0) {
          const uniqueIds = [...new Set(ingredientIdsToFetch)];
          const { data: ingRows } = await admin
            .from('ingredients')
            .select('id, name')
            .in('id', uniqueIds)
            .eq('tenant_id', tenantId);
          if (ingRows) {
            for (const row of ingRows) {
              if (row.id && row.name) ingredientNameMap.set(row.id, row.name);
            }
          }
        }

        // Soft-delete groups that are no longer in the list
        const keepGroupIds = option_groups.filter((g: { id?: string }) => g.id).map((g: { id: string }) => g.id);
        console.log('[menu-write] keepGroupIds:', JSON.stringify(keepGroupIds));
        if (keepGroupIds.length > 0) {
          const { error: delErr } = await admin.from('option_groups').update({ deleted_at: now }).eq('item_id', itemId).eq('tenant_id', tenantId).not('id', 'in', `(${keepGroupIds.map((i: string) => `'${i}'`).join(',')})`).is('deleted_at', null);
          if (delErr) console.error('[menu-write] Soft-delete old groups error:', delErr.message);
        } else {
          const { error: delErr } = await admin.from('option_groups').update({ deleted_at: now }).eq('item_id', itemId).eq('tenant_id', tenantId).is('deleted_at', null);
          if (delErr) console.error('[menu-write] Soft-delete all groups error:', delErr.message);
        }

        for (let gi = 0; gi < option_groups.length; gi++) {
          const grp = option_groups[gi];
          console.log(`[menu-write] Group ${gi}: id="${grp.id}", name="${grp.name}", options=${(grp.options ?? []).length}`);
          
          let groupId = grp.id;
          if (groupId) {
            console.log(`[menu-write] Updating existing group ${groupId}`);
            const { error: updErr } = await admin.from('option_groups').update({ name: grp.name, is_required: grp.is_required, min_selections: grp.min_selections, max_selections: grp.max_selections, sort_order: gi }).eq('id', groupId).eq('tenant_id', tenantId);
            if (updErr) {
              console.error(`[menu-write] Failed to update group ${groupId}:`, updErr.message);
              throw new Error(`Failed to update option group: ${updErr.message}`);
            }
          } else {
            console.log(`[menu-write] Inserting NEW group: name="${grp.name}", item_id="${itemId}", tenant_id="${tenantId}"`);
            const { data: newGrp, error: insErr } = await admin.from('option_groups').insert({ tenant_id: tenantId, item_id: itemId, name: grp.name, is_required: grp.is_required ?? false, min_selections: grp.min_selections ?? 0, max_selections: grp.max_selections ?? 1, sort_order: gi }).select().maybeSingle();
            if (insErr) {
              console.error(`[menu-write] FAILED to insert group:`, insErr.message, 'code:', insErr.code, 'details:', insErr.details);
              throw new Error(`Failed to insert option group: ${insErr.message}`);
            }
            console.log(`[menu-write] Group inserted, got data:`, JSON.stringify(newGrp));
            groupId = newGrp?.id;
          }
          if (!groupId) {
            console.warn(`[menu-write] SKIPPING group ${gi} — no groupId (insert returned null?)`);
            continue;
          }
          console.log(`[menu-write] Group resolved id: ${groupId}, processing ${(grp.options ?? []).length} options`);

          // Soft-delete options no longer in this group
          const keepOptIds = (grp.options ?? []).filter((o: { id?: string }) => o.id).map((o: { id: string }) => o.id);
          if (keepOptIds.length > 0) {
            await admin.from('options').update({ deleted_at: now }).eq('group_id', groupId).eq('tenant_id', tenantId).not('id', 'in', `(${keepOptIds.map((i: string) => `'${i}'`).join(',')})`).is('deleted_at', null);
          } else {
            await admin.from('options').update({ deleted_at: now }).eq('group_id', groupId).eq('tenant_id', tenantId).is('deleted_at', null);
          }

          for (let oi = 0; oi < (grp.options ?? []).length; oi++) {
            const opt = grp.options[oi];
            console.log(`[menu-write] Option ${oi}: id="${opt.id}", name="${opt.name}", price=${opt.additional_price}`);
            
            const resolvedName = (opt.name && String(opt.name).trim() !== '')
              ? opt.name
              : (opt.ingredient_id && ingredientNameMap.get(opt.ingredient_id)) || opt.name || '';
            const optDescription = typeof opt.description === 'string' ? opt.description : null;
            const optPayload: Record<string, unknown> = {
              name: resolvedName,
              description: optDescription,
              additional_price: opt.additional_price ?? 0,
              is_active: opt.is_active ?? true,
              sort_order: oi,
              ingredient_id: opt.ingredient_id ?? null,
              production_recipe_id: opt.production_recipe_id ?? null,
              consumption_quantity: opt.consumption_quantity ?? null,
              consumption_unit: opt.consumption_unit ?? null,
            };
            if (opt.id) {
              console.log(`[menu-write] Updating option ${opt.id}`);
              const { data: updatedOpt, error: updErr } = await admin.from('options').update(optPayload).eq('id', opt.id).eq('tenant_id', tenantId).select('id, name, description').maybeSingle();
              if (updErr) {
                console.error('[menu-write] Failed to update option', opt.id, ':', updErr.message);
                throw new Error(`Failed to update option: ${updErr.message}`);
              }
            } else {
              console.log(`[menu-write] Inserting NEW option for group ${groupId}`);
              const { data: insertedOpt, error: insErr } = await admin.from('options').insert({ tenant_id: tenantId, group_id: groupId, ...optPayload }).select('id, name, description').maybeSingle();
              if (insErr) {
                console.error('[menu-write] Failed to insert option:', insErr.message, 'code:', insErr.code);
                throw new Error(`Failed to insert option: ${insErr.message}`);
              }
              console.log('[menu-write] Option inserted:', JSON.stringify(insertedOpt));
            }
          }
        }
        console.log('[menu-write] option_groups processing COMPLETE');
      }

      if (promotions !== undefined) {
        await admin.from('item_promotions').delete().eq('item_id', itemId).eq('tenant_id', tenantId);
        for (const promo of promotions) {
          await admin.from('item_promotions').insert({ tenant_id: tenantId, item_id: itemId, promotional_price: promo.promotional_price, days_of_week: promo.days_of_week ?? [], is_recurring: promo.is_recurring ?? true, specific_date: promo.specific_date ?? null, is_active: promo.is_active ?? true });
        }
      }

      if (preset_observations !== undefined) {
        await admin.from('item_preset_observations').delete().eq('item_id', itemId).eq('tenant_id', tenantId);
        for (const obs of preset_observations) {
          await admin.from('item_preset_observations').insert({ tenant_id: tenantId, item_id: itemId, text: obs.text });
        }
      }

      if (production_parts !== undefined) {
        console.log('[menu-write] production_parts for item:', itemId, 'count:', (production_parts as unknown[])?.length ?? 0);
        console.log('[menu-write] production_parts payload:', JSON.stringify(production_parts));
        const { error: rpcError } = await admin.rpc('fn_upsert_item_production_parts', {
          p_tenant_id: tenantId,
          p_item_id: itemId,
          p_parts: production_parts ?? [],
        });
        if (rpcError) {
          console.error('[menu-write] production_parts RPC error:', rpcError.message, 'code:', rpcError.code);
          throw new Error(`production_parts upsert: ${rpcError.message}`);
        }
        console.log('[menu-write] production_parts RPC ok for item:', itemId);
      }

      result = { id: itemId };
    }
    else if (action === 'delete_item') {
      const { id } = payload as { id: string };
      await admin.from('item_preset_observations').delete().eq('item_id', id).eq('tenant_id', tenantId);
      await admin.from('item_promotions').delete().eq('item_id', id).eq('tenant_id', tenantId);
      await admin.from('option_groups').update({ deleted_at: now }).eq('item_id', id).eq('tenant_id', tenantId).is('deleted_at', null);
      const { data: groups } = await admin.from('option_groups').select('id').eq('item_id', id).eq('tenant_id', tenantId);
      if (groups && groups.length > 0) {
        for (const g of groups) {
          await admin.from('options').update({ deleted_at: now }).eq('group_id', g.id).eq('tenant_id', tenantId).is('deleted_at', null);
        }
      }
      const { error: rpcError } = await admin.rpc('fn_upsert_item_production_parts', {
        p_tenant_id: tenantId,
        p_item_id: id,
        p_parts: [],
      });
      if (rpcError) {
        console.error('[menu-write] delete_item production_parts RPC error:', rpcError.message);
        throw new Error(`delete_item production_parts: ${rpcError.message}`);
      }
      await admin.rpc('fn_upsert_item_ingredients', { p_tenant_id: tenantId, p_item_id: id, p_ingredients: [] });
      const { error } = await admin.from('menu_items').update({ deleted_at: now }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw new Error(`delete_item: ${error.message}`);
      result = { deleted: true };
    }
    else if (action === 'upsert_item_ingredients') {
      const { item_id, ingredients } = payload as { item_id: string; ingredients: Array<{ ingredient_id: string; quantity: number; unit: string }> };
      const { data, error } = await db.rpc('fn_upsert_item_ingredients', {
        p_tenant_id: tenantId,
        p_item_id: item_id,
        p_ingredients: ingredients ?? [],
      });
      if (error) throw new Error(`upsert_item_ingredients: ${error.message}`);
      result = data;
    }
    else if (action === 'upsert_global_obs') {
      const { id, text, is_active, excluded_item_ids, excluded_category_ids } = payload as {
        id?: string; text: string; is_active?: boolean;
        excluded_item_ids?: string[]; excluded_category_ids?: string[];
      };
      const updateData = {
        text,
        is_active,
        excluded_item_ids: excluded_item_ids ?? [],
        excluded_category_ids: excluded_category_ids ?? [],
      };
      if (id) {
        const { data, error } = await admin.from('global_observations').update(updateData).eq('id', id).eq('tenant_id', tenantId).select().maybeSingle();
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'obs') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_global_obs update: ${error.message}`);
        }
        result = data;
      } else {
        const { data, error } = await admin.from('global_observations').insert({ tenant_id: tenantId, ...updateData, is_active: is_active ?? true }).select().maybeSingle();
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'obs') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_global_obs insert: ${error.message}`);
        }
        result = data;
      }
    }
    else if (action === 'delete_global_obs') {
      const { id } = payload as { id: string };
      const { error } = await admin.from('global_observations').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw new Error(`delete_global_obs: ${error.message}`);
      result = { deleted: true };
    }
    else if (action === 'upsert_combo') {
      const { id, name, description, photo_url, price, is_active, items } = payload as any;
      let comboId = id;
      if (comboId) {
        const { error } = await admin.from('combos').update({ name, description, photo_url, price, is_active, updated_at: now }).eq('id', comboId).eq('tenant_id', tenantId).is('deleted_at', null);
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'combo') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_combo update: ${error.message}`);
        }
      } else {
        const { data: newCombo, error } = await admin.from('combos').insert({ tenant_id: tenantId, name, description, photo_url, price, is_active: is_active ?? true }).select().maybeSingle();
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'combo') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_combo insert: ${error.message}`);
        }
        comboId = newCombo?.id;
      }
      if (!comboId) throw new Error('Failed to upsert combo — no id returned');
      if (items !== undefined) {
        await admin.from('combo_items').update({ deleted_at: now }).eq('combo_id', comboId).eq('tenant_id', tenantId).is('deleted_at', null);
        for (const ci of items) {
          await admin.from('combo_items').insert({ tenant_id: tenantId, combo_id: comboId, item_id: ci.item_id ?? null, name: ci.name, quantity: ci.quantity ?? 1 });
        }
      }
      result = { id: comboId };
    }
    else if (action === 'delete_combo') {
      const { id } = payload as { id: string };
      await admin.from('combo_items').update({ deleted_at: now }).eq('combo_id', id).eq('tenant_id', tenantId).is('deleted_at', null);
      const { error } = await admin.from('combos').update({ deleted_at: now }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw new Error(`delete_combo: ${error.message}`);
      result = { deleted: true };
    }
    else if (action === 'fetch_templates') {
      const { data, error } = await admin
        .rpc('fn_fetch_option_group_templates', { p_tenant_id: tenantId });
      if (error) throw new Error(`fetch_templates: ${error.message}`);
      result = data ?? [];
    }
    else if (action === 'save_template') {
      const { name, is_required, min_selections, max_selections, template_data } = payload as {
        name: string;
        is_required: boolean;
        min_selections: number;
        max_selections: number;
        template_data: Array<{
          nome: string;
          precoAdicional: number;
          descricao?: string;
          ingredientId?: string | null;
          productionRecipeId?: string | null;
          consumptionQuantity?: number;
          consumptionUnit?: string;
          source?: string;
        }>;
      };
      const { data, error } = await admin
        .rpc('fn_save_option_group_template', {
          p_tenant_id: tenantId,
          p_name: name.trim(),
          p_is_required: is_required ?? false,
          p_min_selections: min_selections ?? 0,
          p_max_selections: max_selections ?? 1,
          p_template_data: template_data ?? [],
        });
      if (error) {
        if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: 'Já existe um template com este nome.' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        throw new Error(`save_template: ${error.message}`);
      }
      result = data;
    }
    else if (action === 'update_template') {
      const { id, name, is_required, min_selections, max_selections, template_data } = payload as {
        id: string;
        name: string;
        is_required: boolean;
        min_selections: number;
        max_selections: number;
        template_data: Array<{
          nome: string;
          precoAdicional: number;
          descricao?: string;
          ingredientId?: string | null;
          productionRecipeId?: string | null;
          consumptionQuantity?: number;
          consumptionUnit?: string;
          source?: string;
        }>;
      };
      const { data, error } = await admin
        .rpc('fn_update_option_group_template', {
          p_tenant_id: tenantId,
          p_id: id,
          p_name: name.trim(),
          p_is_required: is_required ?? false,
          p_min_selections: min_selections ?? 0,
          p_max_selections: max_selections ?? 1,
          p_template_data: template_data ?? [],
        });
      if (error) {
        if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: 'Já existe um template com este nome.' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        throw new Error(`update_template: ${error.message}`);
      }
      result = data;
    }
    else if (action === 'delete_template') {
      const { id } = payload as { id: string };
      const { data, error } = await admin
        .rpc('fn_delete_option_group_template', {
          p_tenant_id: tenantId,
          p_id: id,
        });
      if (error) throw new Error(`delete_template: ${error.message}`);
      result = { deleted: true };
    }
    else if (action === 'upsert_highlight') {
      const { id, item_id, custom_price, custom_description, sort_order, is_active } = payload as {
        id?: string; item_id: string; custom_price?: number | null;
        custom_description?: string | null; sort_order?: number; is_active?: boolean;
      };
      const { data, error } = await admin.rpc('fn_upsert_menu_highlight', {
        p_tenant_id: tenantId,
        p_id: id ?? null,
        p_item_id: item_id,
        p_custom_price: custom_price ?? null,
        p_custom_description: custom_description ?? null,
        p_sort_order: sort_order ?? 0,
        p_is_active: is_active ?? true,
      });
      if (error) throw new Error(`upsert_highlight: ${error.message}`);
      result = data;
    }
    else if (action === 'delete_highlight') {
      const { id } = payload as { id: string };
      const { data, error } = await admin.rpc('fn_delete_menu_highlight', {
        p_tenant_id: tenantId,
        p_id: id,
      });
      if (error) throw new Error(`delete_highlight: ${error.message}`);
      result = { deleted: data };
    }
    else if (action === 'reorder_highlights') {
      const { items } = payload as { items: Array<{ id: string; sort_order: number }> };
      const { data, error } = await admin.rpc('fn_reorder_menu_highlights', {
        p_tenant_id: tenantId,
        p_items: items,
      });
      if (error) throw new Error(`reorder_highlights: ${error.message}`);
      result = { reordered: data };
    }
    else {
      return errResp(`Unknown action: ${action}`, 400);
    }

    return new Response(JSON.stringify({ success: true, data: result }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[menu-write] Unhandled error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});