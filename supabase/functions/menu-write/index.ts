import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { reaplicarFicha, OPCOES_PADRAO, type OpcoesFicha } from '../_shared/ficha-retroativa.ts';

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

// Grava a lista de insumos de uma opção (substitui a anterior). Linha sem insumo válido ou sem quantidade > 0 é
// ignorada; insumo de outra loja também. A unidade vazia vira a do insumo.
async function salvarInsumosOpcao(
  // deno-lint-ignore no-explicit-any
  admin: any, tenantId: string, optionId: string,
  lista: Array<{ ingredient_id?: string | null; production_recipe_id?: string | null; quantity?: number | null; unit?: string | null }>,
) {
  const validas = (lista ?? []).filter((x) => isValidUuid(x?.ingredient_id) && Number(x?.quantity) > 0);
  const ids = [...new Set(validas.map((x) => String(x.ingredient_id)))];
  const unidades = new Map<string, string>();
  if (ids.length) {
    const { data } = await admin.from('ingredients').select('id, unit').in('id', ids).eq('tenant_id', tenantId);
    for (const g of (data ?? []) as Array<{ id: string; unit: string }>) unidades.set(g.id, g.unit);
  }
  const vistos = new Set<string>();
  const linhas = validas.filter((x) => unidades.has(String(x.ingredient_id)) && !vistos.has(String(x.ingredient_id)) && vistos.add(String(x.ingredient_id)))
    .map((x, i) => ({
      tenant_id: tenantId, option_id: optionId, ingredient_id: x.ingredient_id, production_recipe_id: isValidUuid(x.production_recipe_id) ? x.production_recipe_id : null,
      quantity: Number(x.quantity), unit: (x.unit && String(x.unit).trim()) || unidades.get(String(x.ingredient_id)), sort_order: i,
    }));
  const { error: delErr } = await admin.from('option_ingredients').delete().eq('option_id', optionId).eq('tenant_id', tenantId);
  if (delErr) throw new Error(`insumos da opção: ${delErr.message}`);
  if (linhas.length) {
    const { error } = await admin.from('option_ingredients').insert(linhas);
    if (error) throw new Error(`insumos da opção: ${error.message}`);
  }
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
          // Cache longo: o nome do arquivo já tem Date.now() (cada upload = URL nova),
          // então o navegador/CDN pode guardar a foto "para sempre" sem rebaixar a cada
          // hora. Corta drasticamente o egress de visitas repetidas ao cardápio público.
          cacheControl: '31536000',
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
      const { id, name, station_id, sort_order, is_active, fiscal } = payload as { id?: string; name: string; station_id?: string | null; sort_order?: number; is_active?: boolean; fiscal?: Record<string, unknown> };
      // Campos fiscais da categoria (NCM/CEST/CFOP/CSOSN/grupo tributário) — só quando enviados.
      const fiscalCat: Record<string, unknown> = {};
      if (fiscal && typeof fiscal === 'object') {
        for (const k of ['ncm', 'cest', 'cfop', 'csosn', 'cod_tributacao']) {
          if (fiscal[k] !== undefined) fiscalCat[k] = fiscal[k] === '' || fiscal[k] === null ? null : (k === 'cfop' ? Number(fiscal[k]) : String(fiscal[k]).trim());
        }
      }
      if (id) {
        const { data, error } = await admin.from('menu_categories').update({ name, station_id: station_id ?? null, sort_order, is_active, ...fiscalCat }).eq('id', id).eq('tenant_id', tenantId).is('deleted_at', null).select().maybeSingle();
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'category') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_category update: ${error.message}`);
        }
        result = data;
      } else {
        const { data, error } = await admin.from('menu_categories').insert({ tenant_id: tenantId, name, station_id: station_id ?? null, sort_order: sort_order ?? 0, is_active: is_active ?? true, ...fiscalCat }).select().maybeSingle();
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

      // Campos fiscais do item (NCM/CEST/CFOP/CSOSN/origem/grupo tributário/GTIN) — só quando enviados.
      const fiscalItem: Record<string, unknown> = {};
      if (p.fiscal && typeof p.fiscal === 'object') {
        for (const k of ['ncm', 'cest', 'cfop', 'csosn', 'origem', 'cod_tributacao', 'gtin']) {
          const v = p.fiscal[k];
          if (v === undefined) continue;
          if (v === '' || v === null) fiscalItem[k] = null;
          else if (k === 'cfop' || k === 'origem') fiscalItem[k] = Number(v);
          else fiscalItem[k] = String(v).trim();
        }
      }

      let itemId = id;
      if (itemId) {
        const { error } = await admin.from('menu_items').update({ category_id, name, description, price, photo_url, sla_minutes, is_active, skip_kds, sort_order, channels, delivery_config: delivery_config ?? null, ...fiscalItem, updated_at: now }).eq('id', itemId).eq('tenant_id', tenantId).is('deleted_at', null);
        if (error) {
          if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: friendlyUniqueError(error, 'item') }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          throw new Error(`upsert_item update: ${error.message}`);
        }
      } else {
        const { data: newItem, error } = await admin.from('menu_items').insert({ tenant_id: tenantId, category_id, name, description, price, photo_url, sla_minutes: sla_minutes ?? 10, is_active: is_active ?? true, skip_kds: skip_kds ?? false, sort_order: sort_order ?? 0, channels: channels ?? { cashier: true, waiter: true, delivery: true, table_qr: true, self_service: true }, delivery_config: delivery_config ?? null, ...fiscalItem }).select().maybeSingle();
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
            let savedOptId: string | null = opt.id ?? null;
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
              savedOptId = insertedOpt?.id ?? null;
            }
            // Insumos da opção (vários, 2026-09-26). Tela nova manda 'ingredientes'; tela antiga (cache) manda só
            // o vínculo único — aí vale ele. As colunas antigas da opção são mantidas pelo gatilho do banco.
            if (savedOptId) {
              const lista = Array.isArray(opt.ingredientes)
                ? opt.ingredientes
                : (opt.ingredient_id ? [{ ingredient_id: opt.ingredient_id, production_recipe_id: opt.production_recipe_id ?? null, quantity: opt.consumption_quantity, unit: opt.consumption_unit }] : []);
              await salvarInsumosOpcao(admin, tenantId, savedOptId, lista);
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
    else if (action === 'reaplicar_ficha') {
      // Ficha mudada → refaz a baixa das vendas desde a data escolhida (_shared/ficha-retroativa.ts).
      // aplicar=false só calcula o efeito (prévia na tela).
      const { item_id, desde, aplicar, opcoes } = payload as { item_id: string; desde: string; aplicar?: boolean; opcoes?: Partial<OpcoesFicha> };
      if (!isValidUuid(item_id)) return errResp('item_id inválido', 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desde ?? ''))) return errResp('Informe a data (AAAA-MM-DD)', 400);
      const { data: papel } = await admin.from('user_tenants').select('role').eq('user_id', user.id).eq('tenant_id', tenantId).maybeSingle();
      if (!['admin', 'manager'].includes(String(papel?.role ?? ''))) return errResp('Só administrador ou gerente pode refazer a baixa das vendas', 403);
      const { data: item } = await admin.from('menu_items').select('id').eq('id', item_id).eq('tenant_id', tenantId).maybeSingle();
      if (!item) return errResp('Item não encontrado nesta loja', 404);
      const op: OpcoesFicha = { ...OPCOES_PADRAO, ...(opcoes ?? {}) };
      if (op.estoque && !op.consumo) return errResp('Estoque só junto com o consumo', 400);
      result = await reaplicarFicha(admin, tenantId, item_id, `${desde}T00:00:00-03:00`, user.id, !!aplicar, op);
    }
    else if (action === 'fichas_vendidas') {
      // Botão "Aplicar fichas nas vendas passadas" (2026-09-26): produtos vendidos desde a data, com ou sem ficha.
      // Combo vendido entra pelos itens dele (a baixa do combo vem das fichas dos itens).
      const { desde } = payload as { desde: string };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desde ?? ''))) return errResp('Informe a data (AAAA-MM-DD)', 400);
      const { data: papel } = await admin.from('user_tenants').select('role').eq('user_id', user.id).eq('tenant_id', tenantId).maybeSingle();
      if (!['admin', 'manager'].includes(String(papel?.role ?? ''))) return errResp('Só administrador ou gerente', 403);
      const vendas = new Map<string, number>();
      const combosVendidos = new Map<string, number>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from('order_items').select('item_id, combo_id, quantity, status')
          .eq('tenant_id', tenantId).gte('created_at', `${desde}T00:00:00-03:00`).neq('status', 'cancelled').range(from, from + 999);
        if (error) throw new Error(`order_items: ${error.message}`);
        for (const r of (data ?? []) as Array<{ item_id: string | null; combo_id: string | null; quantity: number | null }>) {
          const q = Number(r.quantity ?? 1) || 1;
          if (r.item_id) vendas.set(r.item_id, (vendas.get(r.item_id) ?? 0) + q);
          else if (r.combo_id) combosVendidos.set(r.combo_id, (combosVendidos.get(r.combo_id) ?? 0) + q);
        }
        if (!data || data.length < 1000) break;
      }
      if (combosVendidos.size) {
        const { data: ci } = await admin.from('combo_items').select('combo_id, item_id').eq('tenant_id', tenantId).in('combo_id', [...combosVendidos.keys()]).is('deleted_at', null);
        for (const c of (ci ?? []) as Array<{ combo_id: string; item_id: string }>) vendas.set(c.item_id, (vendas.get(c.item_id) ?? 0) + (combosVendidos.get(c.combo_id) ?? 0));
      }
      const ids = [...vendas.keys()];
      const nomes = new Map<string, string>();
      const comFicha = new Set<string>();
      for (let i = 0; i < ids.length; i += 300) {
        const part = ids.slice(i, i + 300);
        const [{ data: mi }, { data: ii }] = await Promise.all([
          admin.from('menu_items').select('id, name').eq('tenant_id', tenantId).in('id', part),
          admin.from('item_ingredients').select('item_id').eq('tenant_id', tenantId).in('item_id', part),
        ]);
        for (const m of (mi ?? []) as Array<{ id: string; name: string }>) nomes.set(m.id, m.name);
        for (const f of (ii ?? []) as Array<{ item_id: string }>) comFicha.add(f.item_id);
      }
      result = ids.filter((id) => nomes.has(id))
        .map((id) => ({ item_id: id, nome: nomes.get(id)!, vendas: vendas.get(id) ?? 0, tem_ficha: comFicha.has(id) }))
        .sort((a, b) => Number(b.tem_ficha) - Number(a.tem_ficha) || b.vendas - a.vendas);
    }
    else if (action === 'ligar_opcoes_estoque') {
      // Aba Opções × Estoque (2026-09-25/26): acrescenta um insumo a várias opções de uma vez (o mesmo complemento
      // em vários itens), com a quantidade de CADA opção — pode variar de item para item. Não apaga os outros
      // insumos da opção; se a opção já tem esse insumo, troca a quantidade. Nunca liga sozinho: sempre uma pessoa.
      const { vinculos, option_ids, ingredient_id, production_recipe_id, consumption_quantity, consumption_unit } = payload as {
        vinculos?: Array<{ option_id: string; quantity: number }>; option_ids?: string[];
        ingredient_id?: string | null; production_recipe_id?: string | null; consumption_quantity?: number; consumption_unit: string;
      };
      const lista = (Array.isArray(vinculos) ? vinculos : (option_ids ?? []).map((id) => ({ option_id: id, quantity: Number(consumption_quantity) })))
        .filter((v) => isValidUuid(v?.option_id));
      if (!lista.length) return errResp('Nenhuma opção informada', 400);
      if (lista.some((v) => !(Number(v.quantity) > 0))) return errResp('Informe quanto sai do estoque em cada item marcado', 400);
      if (!isValidUuid(ingredient_id)) return errResp('Escolha o insumo', 400);
      if (!['g', 'kg', 'ml', 'l', 'un'].includes(String(consumption_unit ?? ''))) return errResp('Unidade inválida', 400);
      const { data: papel } = await admin.from('user_tenants').select('role').eq('user_id', user.id).eq('tenant_id', tenantId).maybeSingle();
      if (!['admin', 'manager'].includes(String(papel?.role ?? ''))) return errResp('Só administrador ou gerente pode ligar opções ao estoque', 403);
      const { data: ing } = await admin.from('ingredients').select('id').eq('id', ingredient_id).eq('tenant_id', tenantId).is('deleted_at', null).maybeSingle();
      if (!ing) return errResp('Insumo não encontrado nesta loja', 404);
      if (production_recipe_id) {
        const { data: rec } = await admin.from('production_recipes').select('id').eq('id', production_recipe_id).eq('tenant_id', tenantId).maybeSingle();
        if (!rec) return errResp('Produção não encontrada nesta loja', 404);
      }
      const { data: opts } = await admin.from('options').select('id').in('id', lista.map((v) => v.option_id)).eq('tenant_id', tenantId).is('deleted_at', null);
      const validas = new Set(((opts ?? []) as Array<{ id: string }>).map((o) => o.id));
      const { data: ordens } = validas.size
        ? await admin.from('option_ingredients').select('option_id, sort_order').in('option_id', [...validas]).eq('tenant_id', tenantId)
        : { data: [] };
      const proxima = new Map<string, number>();
      for (const r of (ordens ?? []) as Array<{ option_id: string; sort_order: number }>) proxima.set(r.option_id, Math.max(proxima.get(r.option_id) ?? 0, r.sort_order + 1));
      const linhas = lista.filter((v) => validas.has(v.option_id)).map((v) => ({
        tenant_id: tenantId, option_id: v.option_id, ingredient_id, production_recipe_id: production_recipe_id ?? null,
        quantity: Number(v.quantity), unit: consumption_unit, sort_order: proxima.get(v.option_id) ?? 0,
      }));
      if (!linhas.length) return errResp('Opções não encontradas nesta loja', 404);
      const { error } = await admin.from('option_ingredients').upsert(linhas, { onConflict: 'option_id,ingredient_id' });
      if (error) throw new Error(`ligar_opcoes_estoque: ${error.message}`);
      result = { ligadas: linhas.length };
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
      const { id, item_id, custom_price, custom_description, sort_order, is_active, channel } = payload as {
        id?: string; item_id: string; custom_price?: number | null;
        custom_description?: string | null; sort_order?: number; is_active?: boolean;
        channel?: 'casa' | 'ambos' | 'delivery';
      };
      const safeChannel = (channel === 'casa' || channel === 'delivery') ? channel : 'ambos';
      const { data, error } = await admin.rpc('fn_upsert_menu_highlight', {
        p_tenant_id: tenantId,
        p_id: id ?? null,
        p_item_id: item_id,
        p_custom_price: custom_price ?? null,
        p_custom_description: custom_description ?? null,
        p_sort_order: sort_order ?? 0,
        p_is_active: is_active ?? true,
        p_channel: safeChannel,
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