-- Go-live Paranaguá (2026-09-17) — checagem de membro da loja em RPCs SECURITY DEFINER executáveis
-- por authenticated que escrevem (ou leem custo) por p_tenant_id / id de registro sem conferir quem chama.
-- Depois da 20260917160000 (anon revogado) qualquer usuário LOGADO de qualquer loja ainda podia chamar
-- /rest/v1/rpc/<fn> com o tenant/id de outra loja (abrir/fechar caixa, cancelar pedido, criar token de kiosk...).
-- Corpos copiados de pg_get_functiondef (produção, 2026-09-17); só o bloco de autorização é novo.
-- CREATE OR REPLACE preserva owner e GRANTs. Mesmo critério da 20260917170000:
-- confiável = service_role OU session_user postgres/supabase_admin (cron/CLI); senão auth_is_member_of(loja)
-- (dono tem user_tenants em toda loja; usuário tablet do totem ganha user_tenants no kiosk-auth).
-- Função que recebe só um id: loja derivada do registro (id inexistente → NULL → recusa).
--
-- NÃO tocadas (e por quê):
--   fn_upsert_item_ingredients  — já confere user_tenants por auth.uid(); uid NULL só com service_role (anon revogado na 160000)
--   fn_cortesia_marcar_pedido   — já confere user_tenants por auth.uid() antes de escrever
--   fn_freelancer_salvar / _registrar_pagamento / _informar_dias — já conferem _fn_freelancer_pode (auth.uid() null ou membro)
--   fn_admin_clear_orders/_clear_stock/_reset_tenant/_delete_tenant — já exigem e-mail do dono ou admin da loja
--   fn_admin_get_tenants/_list_users*/_set_user_tenant/_remove_user_tenant/_set_module_access — já fn_assert_platform_admin()
--   fn_kiosk_heartbeat / fn_kiosk_set_offline — não recebem loja (p_user_id → users.kiosk_online); ver relatório
--   fn_peek_senha — LANGUAGE sql (não convertida); só lê contador de senha
--
-- Autoria por parâmetro (p_user_id/p_opened_by/p_operator_id/p_created_by) continua confiando no cliente — não alterado aqui.

BEGIN;

-- 1) fn_register_production_and_stock_v2 — chamadores: Edge production-write (JWT do usuário; a Edge já confere user_tenants)
CREATE OR REPLACE FUNCTION public.fn_register_production_and_stock_v2(p_tenant_id uuid, p_user_id uuid, p_recipe_id uuid, p_recipe_name text, p_produced_quantity numeric, p_unit text, p_yield_percent_actual numeric DEFAULT NULL::numeric, p_yield_percent_expected numeric DEFAULT NULL::numeric, p_loss_quantity_kg numeric DEFAULT NULL::numeric, p_loss_value numeric DEFAULT NULL::numeric, p_total_cost numeric DEFAULT 0, p_unit_cost numeric DEFAULT 0, p_produced_by text DEFAULT ''::text, p_notes text DEFAULT ''::text, p_steps_completed text[] DEFAULT NULL::text[], p_items jsonb DEFAULT '[]'::jsonb, p_output_ingredient_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch_id uuid;
  v_item jsonb;
  v_ingredient_id uuid;
  v_ingredient_name text;
  v_qty_used numeric;
  v_unit text;
  v_stock_unit text;
  v_qty_in_stock_unit numeric;
  v_unit_cost_item numeric;
  v_total_cost_item numeric;
  v_old_stock numeric;
  v_new_stock numeric;
  v_movement_count int := 0;
  v_items_count int := 0;
  v_debug_log jsonb := '[]'::jsonb;
  v_debug_entry jsonb;
  v_timestamp timestamptz := now();
  v_converted numeric;
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  -- 1. Criar o production_batch
  INSERT INTO production_batches (
    tenant_id, recipe_id, recipe_name, produced_quantity, unit,
    yield_percent_actual, yield_percent_expected, loss_quantity_kg, loss_value,
    total_cost, unit_cost, produced_by, produced_at, notes, steps_completed,
    created_at
  ) VALUES (
    p_tenant_id, p_recipe_id, p_recipe_name, p_produced_quantity, p_unit,
    p_yield_percent_actual, p_yield_percent_expected, p_loss_quantity_kg, p_loss_value,
    p_total_cost, p_unit_cost, p_produced_by, v_timestamp, p_notes, p_steps_completed,
    v_timestamp
  ) RETURNING id INTO v_batch_id;

  -- 2. Processar cada item (baixa no estoque + batch_item + movimentacao saida)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_ingredient_id := (v_item->>'ingredient_id')::uuid;
    v_ingredient_name := v_item->>'ingredient_name';
    v_qty_used := COALESCE((v_item->>'quantity_used')::numeric, 0);
    v_unit := COALESCE(v_item->>'unit', 'unit');
    v_unit_cost_item := COALESCE((v_item->>'unit_cost')::numeric, 0);
    v_total_cost_item := COALESCE((v_item->>'total_cost')::numeric, 0);

    v_items_count := v_items_count + 1;

    SELECT unit INTO v_stock_unit FROM ingredients
    WHERE id = v_ingredient_id AND tenant_id = p_tenant_id;

    v_converted := convert_unit(v_qty_used, v_unit, COALESCE(v_stock_unit, v_unit));
    v_qty_in_stock_unit := COALESCE(v_converted, v_qty_used);

    SELECT current_stock INTO v_old_stock FROM ingredients
    WHERE id = v_ingredient_id AND tenant_id = p_tenant_id;

    v_new_stock := COALESCE(v_old_stock, 0) - v_qty_in_stock_unit;

    UPDATE ingredients
    SET current_stock = GREATEST(v_new_stock, 0),
        is_depleted = CASE WHEN GREATEST(v_new_stock, 0) <= 0 THEN true ELSE false END,
        updated_at = v_timestamp
    WHERE id = v_ingredient_id AND tenant_id = p_tenant_id;

    INSERT INTO production_batch_items (
      batch_id, ingredient_id, ingredient_name, quantity_used, unit, unit_cost, total_cost
    ) VALUES (
      v_batch_id, v_ingredient_id, v_ingredient_name, v_qty_used, v_unit, v_unit_cost_item, v_total_cost_item
    );

    INSERT INTO stock_movements (
      tenant_id, ingredient_id, type, quantity, signed_quantity, reason, operator_id, unit, production_batch_id, created_at
    ) VALUES (
      p_tenant_id, v_ingredient_id, 'manual_out', v_qty_in_stock_unit, -v_qty_in_stock_unit,
      'Saida (producao): ' || p_recipe_name, p_user_id, COALESCE(v_stock_unit, v_unit), v_batch_id, v_timestamp
    );

    v_movement_count := v_movement_count + 1;

    v_debug_entry := jsonb_build_object(
      'step', 'baixa_ingrediente',
      'ingredient_id', v_ingredient_id,
      'ingredient_name', v_ingredient_name,
      'qty_used_raw', v_qty_used,
      'unit_used', v_unit,
      'stock_unit', v_stock_unit,
      'qty_in_stock_unit', v_qty_in_stock_unit,
      'old_stock', v_old_stock,
      'new_stock', GREATEST(v_new_stock, 0),
      'was_converted', (v_converted IS NOT NULL AND v_unit <> COALESCE(v_stock_unit, v_unit))
    );
    v_debug_log := v_debug_log || v_debug_entry;
  END LOOP;

  IF p_output_ingredient_id IS NOT NULL THEN
    DECLARE
      v_out_stock_unit text;
      v_produced_in_stock_unit numeric;
      v_conversion_factor numeric;
      v_unit_cost_in_stock_unit numeric;
      v_old_price numeric;
      v_weighted_avg_price numeric;
      v_loss_qty_display numeric;
      v_loss_unit_display text;
      v_loss_converted numeric;
    BEGIN
      SELECT unit INTO v_out_stock_unit FROM ingredients
      WHERE id = p_output_ingredient_id AND tenant_id = p_tenant_id;

      v_converted := convert_unit(p_produced_quantity, p_unit, COALESCE(v_out_stock_unit, p_unit));
      v_produced_in_stock_unit := COALESCE(v_converted, p_produced_quantity);

      SELECT current_stock INTO v_old_stock FROM ingredients
      WHERE id = p_output_ingredient_id AND tenant_id = p_tenant_id;

      v_new_stock := COALESCE(v_old_stock, 0) + v_produced_in_stock_unit;

      UPDATE ingredients
      SET current_stock = v_new_stock,
          is_depleted = CASE WHEN v_new_stock <= 0 THEN true ELSE false END,
          updated_at = v_timestamp
      WHERE id = p_output_ingredient_id AND tenant_id = p_tenant_id;

      v_conversion_factor := convert_unit(1, p_unit, COALESCE(v_out_stock_unit, p_unit));
      IF v_conversion_factor IS NOT NULL AND v_conversion_factor != 0 THEN
        v_unit_cost_in_stock_unit := p_unit_cost / v_conversion_factor;
      ELSE
        v_unit_cost_in_stock_unit := p_unit_cost;
      END IF;

      SELECT COALESCE(unit_price, 0) INTO v_old_price FROM ingredients
      WHERE id = p_output_ingredient_id AND tenant_id = p_tenant_id;

      IF COALESCE(v_old_stock, 0) <= 0 THEN
        v_weighted_avg_price := v_unit_cost_in_stock_unit;
      ELSE
        v_weighted_avg_price := ROUND(
          (v_old_stock * v_old_price + v_produced_in_stock_unit * v_unit_cost_in_stock_unit)
          / (v_old_stock + v_produced_in_stock_unit), 6
        );
      END IF;

      UPDATE ingredients
      SET unit_price = v_weighted_avg_price
      WHERE id = p_output_ingredient_id AND tenant_id = p_tenant_id;

      v_debug_entry := jsonb_build_object(
        'step', 'atualizacao_unit_price',
        'output_ingredient_id', p_output_ingredient_id,
        'old_price', v_old_price,
        'unit_cost_raw', p_unit_cost,
        'prod_unit', p_unit,
        'stock_unit', v_out_stock_unit,
        'conversion_factor', v_conversion_factor,
        'unit_cost_in_stock_unit', v_unit_cost_in_stock_unit,
        'old_stock', v_old_stock,
        'produced_in_stock_unit', v_produced_in_stock_unit,
        'new_weighted_avg_price', v_weighted_avg_price
      );
      v_debug_log := v_debug_log || v_debug_entry;

      INSERT INTO stock_movements (
        tenant_id, ingredient_id, type, quantity, signed_quantity, reason, operator_id, unit, production_batch_id, created_at
      ) VALUES (
        p_tenant_id, p_output_ingredient_id, 'in', v_produced_in_stock_unit, v_produced_in_stock_unit,
        'Entrada (producao): ' || p_recipe_name, p_user_id, COALESCE(v_out_stock_unit, p_unit), v_batch_id, v_timestamp
      );

      v_movement_count := v_movement_count + 1;

      v_debug_entry := jsonb_build_object(
        'step', 'entrada_produto_acabado',
        'output_ingredient_id', p_output_ingredient_id,
        'old_stock', v_old_stock,
        'produced_quantity_raw', p_produced_quantity,
        'unit_raw', p_unit,
        'out_stock_unit', v_out_stock_unit,
        'produced_in_stock_unit', v_produced_in_stock_unit,
        'new_stock', v_new_stock
      );
      v_debug_log := v_debug_log || v_debug_entry;

      IF p_loss_quantity_kg IS NOT NULL AND p_loss_quantity_kg > 0 THEN
        v_loss_converted := convert_unit(p_loss_quantity_kg, 'kg', COALESCE(v_out_stock_unit, 'kg'));
        IF v_loss_converted IS NOT NULL THEN
          v_loss_qty_display := v_loss_converted;
          v_loss_unit_display := v_out_stock_unit;
        ELSE
          v_loss_qty_display := p_loss_quantity_kg;
          v_loss_unit_display := 'kg';
        END IF;

        INSERT INTO stock_movements (
          tenant_id, ingredient_id, type, quantity, signed_quantity, reason, operator_id, unit, production_batch_id, created_at
        ) VALUES (
          p_tenant_id, p_output_ingredient_id, 'loss', v_loss_qty_display, 0,
          'Perda em produção: ' || p_recipe_name, p_user_id, v_loss_unit_display, v_batch_id, v_timestamp
        );

        v_movement_count := v_movement_count + 1;

        v_debug_entry := jsonb_build_object(
          'step', 'registro_perda',
          'loss_quantity_kg_raw', p_loss_quantity_kg,
          'loss_qty_display', v_loss_qty_display,
          'loss_unit_display', v_loss_unit_display
        );
        v_debug_log := v_debug_log || v_debug_entry;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'movements_count', v_movement_count,
    'items_count', v_items_count,
    'debug_log', v_debug_log
  );
END;
$function$;

-- 2) fn_production_crud — chamadores: Edge production-write (JWT do usuário). A checagem interna usa p_user_id (forjável via /rpc); esta usa auth.uid()
CREATE OR REPLACE FUNCTION public.fn_production_crud(p_action text, p_user_id uuid, p_tenant_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recipe_id UUID;
  v_batch_id UUID;
  v_item JSONB;
  v_items JSONB;
  v_steps JSONB;
  v_result JSONB;
  v_step_idx INT;
  v_item_idx INT;
  v_output_qty NUMERIC;
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_tenants WHERE user_id = p_user_id AND tenant_id = p_tenant_id
  ) THEN
    RETURN jsonb_build_object('error', 'User does not belong to this tenant');
  END IF;

  IF p_action = 'list_recipes' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'tenant_id', r.tenant_id,
        'name', r.name,
        'unit', r.unit,
        'output_quantity', r.output_quantity,
        'category', r.category,
        'min_stock', r.min_stock,
        'output_ingredient_id', r.output_ingredient_id,
        'instructions', r.instructions,
        'is_active', r.is_active,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', ri.id,
            'recipe_id', ri.recipe_id,
            'ingredient_id', ri.ingredient_id,
            'ingredient_name', COALESCE(i.name, ri.ingredient_name),
            'quantity', ri.quantity,
            'unit', ri.unit,
            'unit_cost', ri.unit_cost,
            'notes', ri.notes,
            'created_at', ri.created_at
          ) ORDER BY ri.item_order)
          FROM production_recipe_items ri
          LEFT JOIN ingredients i ON i.id = ri.ingredient_id
          WHERE ri.recipe_id = r.id
        ), '[]'::jsonb),
        'steps', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', rs.id,
            'recipe_id', rs.recipe_id,
            'step_order', rs.step_order,
            'text', rs.text,
            'created_at', rs.created_at
          ) ORDER BY rs.step_order)
          FROM production_recipe_steps rs
          WHERE rs.recipe_id = r.id
        ), '[]'::jsonb)
      ) ORDER BY r.created_at DESC
    )
    INTO v_result
    FROM production_recipes r
    WHERE r.tenant_id = p_tenant_id AND r.is_active = true;

    RETURN jsonb_build_object('success', true, 'data', COALESCE(v_result, '[]'::jsonb));

  ELSIF p_action = 'get_recipe' THEN
    v_recipe_id := (NULLIF(p_payload->>'recipe_id', ''))::UUID;

    SELECT jsonb_build_object(
      'id', r.id,
      'tenant_id', r.tenant_id,
      'name', r.name,
      'unit', r.unit,
      'output_quantity', r.output_quantity,
      'category', r.category,
      'min_stock', r.min_stock,
      'output_ingredient_id', r.output_ingredient_id,
      'instructions', r.instructions,
      'is_active', r.is_active,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ri.id,
          'recipe_id', ri.recipe_id,
          'ingredient_id', ri.ingredient_id,
          'ingredient_name', COALESCE(i.name, ri.ingredient_name),
          'quantity', ri.quantity,
          'unit', ri.unit,
          'unit_cost', ri.unit_cost,
          'notes', ri.notes,
          'created_at', ri.created_at
        ) ORDER BY ri.item_order)
        FROM production_recipe_items ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = r.id
      ), '[]'::jsonb),
      'steps', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', rs.id,
          'recipe_id', rs.recipe_id,
          'step_order', rs.step_order,
          'text', rs.text,
          'created_at', rs.created_at
        ) ORDER BY rs.step_order)
        FROM production_recipe_steps rs
        WHERE rs.recipe_id = r.id
      ), '[]'::jsonb)
    )
    INTO v_result
    FROM production_recipes r
    WHERE r.id = v_recipe_id AND r.tenant_id = p_tenant_id;

    RETURN jsonb_build_object('success', true, 'data', v_result);

  ELSIF p_action = 'create_recipe' THEN
    v_output_qty := COALESCE((NULLIF(p_payload->>'output_quantity', ''))::numeric, 1);
    IF v_output_qty <= 0 THEN
      RETURN jsonb_build_object('error', 'output_quantity deve ser maior que zero');
    END IF;

    INSERT INTO production_recipes (
      tenant_id, name, unit, output_quantity, category, min_stock, instructions, is_active
    )
    VALUES (
      p_tenant_id,
      p_payload->>'name',
      p_payload->>'unit',
      v_output_qty,
      NULLIF(p_payload->>'category', ''),
      COALESCE((NULLIF(p_payload->>'min_stock', ''))::numeric, 0),
      COALESCE(p_payload->>'instructions', ''),
      true
    )
    RETURNING id INTO v_recipe_id;

    v_item_idx := 0;
    v_items := COALESCE(p_payload->'items', '[]'::jsonb);
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      INSERT INTO production_recipe_items (recipe_id, ingredient_id, ingredient_name, quantity, unit, unit_cost, notes, item_order)
      VALUES (
        v_recipe_id,
        (NULLIF(v_item->>'ingredient_id', ''))::UUID,
        v_item->>'ingredient_name',
        COALESCE((v_item->>'quantity')::numeric, 0),
        v_item->>'unit',
        COALESCE((v_item->>'unit_cost')::numeric, 0),
        NULLIF(v_item->>'notes', ''),
        v_item_idx
      );
      v_item_idx := v_item_idx + 1;
    END LOOP;

    v_step_idx := 0;
    v_steps := COALESCE(p_payload->'steps', '[]'::jsonb);
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_steps)
    LOOP
      INSERT INTO production_recipe_steps (recipe_id, step_order, text)
      VALUES (v_recipe_id, v_step_idx, v_item->>'text');
      v_step_idx := v_step_idx + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_recipe_id));

  ELSIF p_action = 'update_recipe' THEN
    v_recipe_id := (NULLIF(p_payload->>'recipe_id', ''))::UUID;

    IF NOT EXISTS (
      SELECT 1 FROM production_recipes WHERE id = v_recipe_id AND tenant_id = p_tenant_id
    ) THEN
      RETURN jsonb_build_object('error', 'Recipe not found for this tenant');
    END IF;

    v_output_qty := (NULLIF(p_payload->>'output_quantity', ''))::numeric;
    IF v_output_qty IS NOT NULL AND v_output_qty <= 0 THEN
      RETURN jsonb_build_object('error', 'output_quantity deve ser maior que zero');
    END IF;

    UPDATE production_recipes
    SET
      name = COALESCE(p_payload->>'name', name),
      unit = COALESCE(p_payload->>'unit', unit),
      output_quantity = COALESCE(v_output_qty, output_quantity),
      category = CASE WHEN p_payload ? 'category'
                      THEN NULLIF(p_payload->>'category', '')
                      ELSE category END,
      min_stock = COALESCE((NULLIF(p_payload->>'min_stock', ''))::numeric, min_stock),
      output_ingredient_id = COALESCE(
        (NULLIF(p_payload->>'output_ingredient_id', ''))::UUID, output_ingredient_id
      ),
      instructions = COALESCE(p_payload->>'instructions', instructions),
      is_active = COALESCE((p_payload->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = v_recipe_id AND tenant_id = p_tenant_id;

    IF p_payload ? 'items' THEN
      DELETE FROM production_recipe_items WHERE recipe_id = v_recipe_id;
      v_item_idx := 0;
      v_items := COALESCE(p_payload->'items', '[]'::jsonb);
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
      LOOP
        INSERT INTO production_recipe_items (recipe_id, ingredient_id, ingredient_name, quantity, unit, unit_cost, notes, item_order)
        VALUES (
          v_recipe_id,
          (NULLIF(v_item->>'ingredient_id', ''))::UUID,
          v_item->>'ingredient_name',
          COALESCE((v_item->>'quantity')::numeric, 0),
          v_item->>'unit',
          COALESCE((v_item->>'unit_cost')::numeric, 0),
          NULLIF(v_item->>'notes', ''),
          v_item_idx
        );
        v_item_idx := v_item_idx + 1;
      END LOOP;
    END IF;

    IF p_payload ? 'steps' THEN
      DELETE FROM production_recipe_steps WHERE recipe_id = v_recipe_id;
      v_step_idx := 0;
      v_steps := COALESCE(p_payload->'steps', '[]'::jsonb);
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_steps)
      LOOP
        INSERT INTO production_recipe_steps (recipe_id, step_order, text)
        VALUES (v_recipe_id, v_step_idx, v_item->>'text');
        v_step_idx := v_step_idx + 1;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true);

  ELSIF p_action = 'delete_recipe' THEN
    v_recipe_id := (NULLIF(p_payload->>'recipe_id', ''))::UUID;

    IF NOT EXISTS (
      SELECT 1 FROM production_recipes WHERE id = v_recipe_id AND tenant_id = p_tenant_id
    ) THEN
      RETURN jsonb_build_object('error', 'Recipe not found for this tenant');
    END IF;

    DELETE FROM production_batch_items
    WHERE batch_id IN (
      SELECT id FROM production_batches WHERE recipe_id = v_recipe_id AND tenant_id = p_tenant_id
    );

    DELETE FROM production_batches WHERE recipe_id = v_recipe_id AND tenant_id = p_tenant_id;
    DELETE FROM production_recipe_items WHERE recipe_id = v_recipe_id;
    DELETE FROM production_recipe_steps WHERE recipe_id = v_recipe_id;
    DELETE FROM production_recipes WHERE id = v_recipe_id AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object('success', true);

  ELSIF p_action = 'list_batches' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'tenant_id', b.tenant_id,
        'recipe_id', b.recipe_id,
        'recipe_name', b.recipe_name,
        'produced_quantity', b.produced_quantity,
        'unit', b.unit,
        'yield_percent_actual', b.yield_percent_actual,
        'yield_percent_expected', b.yield_percent_expected,
        'loss_quantity_kg', b.loss_quantity_kg,
        'loss_value', b.loss_value,
        'total_cost', b.total_cost,
        'unit_cost', b.unit_cost,
        'produced_by', b.produced_by,
        'produced_at', b.produced_at,
        'notes', b.notes,
        'steps_completed', b.steps_completed,
        'created_at', b.created_at,
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', bi.id,
            'batch_id', bi.batch_id,
            'ingredient_id', bi.ingredient_id,
            'ingredient_name', bi.ingredient_name,
            'quantity_used', bi.quantity_used,
            'unit', bi.unit,
            'unit_cost', bi.unit_cost,
            'total_cost', bi.total_cost,
            'created_at', bi.created_at
          ))
          FROM production_batch_items bi
          WHERE bi.batch_id = b.id
        ), '[]'::jsonb)
      ) ORDER BY b.produced_at DESC
    )
    INTO v_result
    FROM production_batches b
    WHERE b.tenant_id = p_tenant_id;

    RETURN jsonb_build_object('success', true, 'data', COALESCE(v_result, '[]'::jsonb));

  ELSIF p_action = 'create_batch' THEN
    INSERT INTO production_batches (
      tenant_id, recipe_id, recipe_name, produced_quantity, unit,
      yield_percent_actual, yield_percent_expected, loss_quantity_kg, loss_value,
      total_cost, unit_cost, produced_by, notes, steps_completed
    )
    VALUES (
      p_tenant_id,
      (NULLIF(p_payload->>'recipe_id', ''))::UUID,
      p_payload->>'recipe_name',
      COALESCE((p_payload->>'produced_quantity')::numeric, 0),
      p_payload->>'unit',
      (NULLIF(p_payload->>'yield_percent_actual', ''))::numeric,
      (NULLIF(p_payload->>'yield_percent_expected', ''))::numeric,
      (NULLIF(p_payload->>'loss_quantity_kg', ''))::numeric,
      (NULLIF(p_payload->>'loss_value', ''))::numeric,
      COALESCE((p_payload->>'total_cost')::numeric, 0),
      COALESCE((p_payload->>'unit_cost')::numeric, 0),
      p_payload->>'produced_by',
      COALESCE(p_payload->>'notes', ''),
      ARRAY(SELECT jsonb_array_elements_text(p_payload->'steps_completed'))
    )
    RETURNING id INTO v_batch_id;

    v_items := COALESCE(p_payload->'items', '[]'::jsonb);
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      INSERT INTO production_batch_items (batch_id, ingredient_id, ingredient_name, quantity_used, unit, unit_cost, total_cost)
      VALUES (
        v_batch_id,
        (NULLIF(v_item->>'ingredient_id', ''))::UUID,
        v_item->>'ingredient_name',
        COALESCE((v_item->>'quantity_used')::numeric, 0),
        v_item->>'unit',
        COALESCE((v_item->>'unit_cost')::numeric, 0),
        COALESCE((v_item->>'total_cost')::numeric, 0)
      );
    END LOOP;

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_batch_id));

  ELSIF p_action = 'delete_batch' THEN
    v_batch_id := (NULLIF(p_payload->>'batch_id', ''))::UUID;

    IF NOT EXISTS (
      SELECT 1 FROM production_batches WHERE id = v_batch_id AND tenant_id = p_tenant_id
    ) THEN
      RETURN jsonb_build_object('error', 'Batch not found for this tenant');
    END IF;

    DELETE FROM production_batch_items WHERE batch_id = v_batch_id;
    DELETE FROM production_batches WHERE id = v_batch_id AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object('success', true);

  ELSE
    RETURN jsonb_build_object('error', 'Unknown action: ' || p_action);
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$function$;

-- 3) fn_get_ingredients — chamadores: EstoqueContext, NovaCompraModal, RegistroProducaoModal, useConsumoIngredientes, assistente (leitura de custos)
CREATE OR REPLACE FUNCTION public.fn_get_ingredients(p_tenant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT id, name, unit::text, unit_price, min_stock, current_stock, is_depleted,
             category, supplier, supplier_id, created_at, updated_at,
             price_source, last_purchase_price, last_purchase_date,
             purchase_unit, COALESCE(purchase_factor, 1) AS purchase_factor,
             deleted_at, dre_category_id, usage_type
      FROM ingredients
      WHERE tenant_id = p_tenant_id
        AND deleted_at IS NULL
      ORDER BY name
    ) t
  );
END;
$function$;

-- 4) fn_cancel_order_bypass — chamadores: CancelamentoModal
CREATE OR REPLACE FUNCTION public.fn_cancel_order_bypass(p_order_id uuid, p_user_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of((SELECT o.tenant_id FROM public.orders o WHERE o.id = p_order_id))) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  UPDATE orders
  SET status = 'cancelled', cancel_reason = p_reason, cancelled_by = p_user_id, cancelled_at = now(), updated_at = now()
  WHERE id = p_order_id;

  UPDATE order_items
  SET status = 'cancelled'
  WHERE order_id = p_order_id AND status IN ('new', 'preparing', 'ready');
END;
$function$;

-- 5) fn_update_paid_by_pdv — chamadores: PDVContext, PagamentoModal, PDV delivery/garçom, autoatendimento (usuário tablet tem user_tenants)
CREATE OR REPLACE FUNCTION public.fn_update_paid_by_pdv(p_order_id uuid, p_paid_by_pdv text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of((SELECT o.tenant_id FROM public.orders o WHERE o.id = p_order_id))) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  UPDATE orders
  SET paid_by_pdv = p_paid_by_pdv
  WHERE id = p_order_id
    AND paid_by_pdv IS NULL;
END;
$function$;

-- 6) fn_open_cash_register — chamadores: SessaoContext (abrir caixa); assistente com JWT do dono
CREATE OR REPLACE FUNCTION public.fn_open_cash_register(p_session_id uuid, p_tenant_id uuid, p_operator_id uuid, p_opening_value numeric DEFAULT 0, p_opening_method text DEFAULT 'total'::text)
 RETURNS TABLE(id uuid, opening_value numeric, opened_at timestamp with time zone, operator_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reg_id uuid;
  v_opening_value numeric;
  v_opened_at timestamp with time zone;
  v_operator_id uuid;
  v_user_exists boolean;
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  -- Check if user exists
  SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id = p_operator_id) INTO v_user_exists;

  -- Ensure user exists in public.users
  IF NOT v_user_exists THEN
    INSERT INTO public.users (id, name, email, is_active)
    VALUES (
      p_operator_id,
      'Operador',
      p_operator_id::text || '@erpos.local',
      true
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  INSERT INTO public.cash_registers (
    session_id,
    tenant_id,
    operator_id,
    opening_value,
    opening_method,
    status
  ) VALUES (
    p_session_id,
    p_tenant_id,
    p_operator_id,
    p_opening_value,
    p_opening_method::cash_opening_method,
    'open'
  )
  RETURNING
    cash_registers.id,
    cash_registers.opening_value,
    cash_registers.opened_at,
    cash_registers.operator_id
  INTO v_reg_id, v_opening_value, v_opened_at, v_operator_id;

  RETURN QUERY SELECT v_reg_id, v_opening_value, v_opened_at, v_operator_id;
END;
$function$;

-- 7) fn_open_session — chamadores: SessaoContext (abrir sessão); assistente com JWT do dono
CREATE OR REPLACE FUNCTION public.fn_open_session(p_tenant_id uuid, p_opened_by uuid, p_opening_amount numeric DEFAULT 0, p_is_training boolean DEFAULT false)
 RETURNS TABLE(id uuid, number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_number text;
  v_dd text;
  v_mm text;
  v_yy text;
  v_seq int;
  v_now timestamptz;
  v_today date;
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  -- Usa timezone de Brasília para evitar virada de dia errada
  v_now   := NOW() AT TIME ZONE 'America/Sao_Paulo';
  v_today := (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;

  v_dd := LPAD(EXTRACT(DAY   FROM v_now)::text, 2, '0');
  v_mm := LPAD(EXTRACT(MONTH FROM v_now)::text, 2, '0');
  v_yy := RIGHT(EXTRACT(YEAR FROM v_now)::text, 2);

  SELECT COUNT(*) + 1
    INTO v_seq
    FROM sessions
   WHERE tenant_id = p_tenant_id
     AND (opened_at AT TIME ZONE 'America/Sao_Paulo')::date = v_today;

  v_number := 'S' || v_dd || v_mm || v_yy || LPAD(v_seq::text, 3, '0');

  INSERT INTO sessions (tenant_id, number, opened_by, opening_amount, is_training, status)
  VALUES (p_tenant_id, v_number, p_opened_by, p_opening_amount, p_is_training, 'open')
  RETURNING sessions.id INTO v_id;

  RETURN QUERY SELECT v_id, v_number;
END;
$function$;

-- 8) fn_close_cash_register_v2 — chamadores: SessaoContext (fechar caixa); assistente
CREATE OR REPLACE FUNCTION public.fn_close_cash_register_v2(p_cash_register_id uuid, p_closing_value numeric, p_closing_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_opening_value numeric;
  v_total_cash_payments numeric;
  v_total_deposits numeric;
  v_total_withdrawals numeric;
  v_expected numeric;
  v_difference numeric;
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of((SELECT cr.tenant_id FROM public.cash_registers cr WHERE cr.id = p_cash_register_id))) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  -- Busca dados do caixa
  SELECT opening_value
  INTO v_opening_value
  FROM cash_registers
  WHERE id = p_cash_register_id;

  -- Total recebido em dinheiro (cash) NESTE CAIXA específico
  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_total_cash_payments
  FROM payments p
  JOIN payment_methods pm ON pm.id = p.payment_method_id
  WHERE p.cash_register_id = p_cash_register_id
    AND pm.type = 'cash'
    AND NOT p.is_refunded;

  -- Total de suprimentos (depósitos) no caixa
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_deposits
  FROM cash_movements
  WHERE cash_register_id = p_cash_register_id AND type = 'in';

  -- Total de sangrias (retiradas) do caixa
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_withdrawals
  FROM cash_movements
  WHERE cash_register_id = p_cash_register_id AND type = 'out';

  -- Valor esperado = fundo inicial + recebimentos em dinheiro + suprimentos - sangrias
  v_expected := COALESCE(v_opening_value, 0) + v_total_cash_payments + v_total_deposits - v_total_withdrawals;

  -- Diferença = contado - esperado (positivo = sobra, negativo = falta)
  v_difference := p_closing_value - v_expected;

  UPDATE cash_registers
  SET
    closing_value_actual   = p_closing_value,
    closing_value_expected = v_expected,
    closing_difference     = v_difference,
    closing_notes          = p_closing_notes,
    closed_at              = now(),
    status                 = 'closed'
  WHERE id = p_cash_register_id;
END;
$function$;

-- 9) fn_update_cash_register_notes — chamadores: FechamentoCaixaModal; assistente
CREATE OR REPLACE FUNCTION public.fn_update_cash_register_notes(p_id uuid, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of((SELECT cr.tenant_id FROM public.cash_registers cr WHERE cr.id = p_id))) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  UPDATE cash_registers SET closing_notes = p_notes WHERE id = p_id;
END;
$function$;

-- 10) fn_restock_order — chamadores: CancelamentoModal; assistente
CREATE OR REPLACE FUNCTION public.fn_restock_order(p_order_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_out RECORD;
  v_already_restocked boolean;
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of((SELECT o.tenant_id FROM public.orders o WHERE o.id = p_order_id))) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM orders WHERE id = p_order_id;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  -- BUG-18 FIX: Only restock what was ACTUALLY deducted (based on theoretical_out stock_movements),
  -- not what the recipe/technical sheet says should have been deducted.
  -- Canceling a 'new' order that never reached ready/delivered will NOT inflate inventory.
  FOR v_out IN
    SELECT ingredient_id, quantity, unit
    FROM stock_movements
    WHERE order_id = p_order_id
      AND type = 'theoretical_out'
  LOOP
    -- Dedup: check if this ingredient was already restocked for this order
    SELECT EXISTS(
      SELECT 1 FROM stock_movements
      WHERE order_id = p_order_id
        AND ingredient_id = v_out.ingredient_id
        AND type = 'in'
        AND reason ILIKE 'Estorno%'
    ) INTO v_already_restocked;

    IF v_already_restocked THEN
      CONTINUE;
    END IF;

    INSERT INTO stock_movements (tenant_id, ingredient_id, type, quantity, unit, reason, order_id, operator_id)
    VALUES (v_tenant_id, v_out.ingredient_id, 'in', v_out.quantity, v_out.unit, 'Estorno pedido #' || substring(p_order_id::text, 1, 8), p_order_id, p_user_id);

    PERFORM fn_update_ingredient_stock(v_out.ingredient_id, v_tenant_id, v_out.quantity);
  END LOOP;
END;
$function$;

-- 11) fn_create_kiosk_token — chamadores: useKioskTokens (Configurações); bloqueada no assistente (RPC_BLOCK)
CREATE OR REPLACE FUNCTION public.fn_create_kiosk_token(p_tenant_id uuid, p_label text, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, token text, label text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_token TEXT;
  v_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_id := gen_random_uuid();
  v_created_at := now();
  INSERT INTO kiosk_tokens(id, tenant_id, token, label, is_active, created_at, created_by)
  VALUES (v_id, p_tenant_id, v_token, p_label, true, v_created_at, p_created_by);
  RETURN QUERY SELECT v_id, v_token, p_label, v_created_at;
END;
$function$;

-- 12) fn_revoke_kiosk_token — chamadores: useKioskTokens (Configurações); bloqueada no assistente (RPC_BLOCK)
CREATE OR REPLACE FUNCTION public.fn_revoke_kiosk_token(p_token_id uuid, p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  UPDATE kiosk_tokens
  SET is_active = false
  WHERE id = p_token_id AND tenant_id = p_tenant_id;
  RETURN FOUND;
END;
$function$;

-- 13) fn_next_senha — chamadores: PDVContext (p_tenant_id é text: resolve pela tabela tenants para não estourar cast)
CREATE OR REPLACE FUNCTION public.fn_next_senha(p_tenant_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ DECLARE v_senha INTEGER; BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of((SELECT t.id FROM public.tenants t WHERE t.id::text = p_tenant_id))) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;
 INSERT INTO senha_counter (tenant_id, counter) VALUES (p_tenant_id, 200) ON CONFLICT (tenant_id) DO NOTHING; UPDATE senha_counter SET counter = counter + 1 WHERE tenant_id = p_tenant_id RETURNING counter - 1 INTO v_senha; RETURN v_senha; END; $function$;

COMMIT;
