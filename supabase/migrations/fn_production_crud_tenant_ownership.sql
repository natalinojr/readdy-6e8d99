-- =============================================================================
-- MIGRATION: fn_production_crud — checagem de posse (tenant) antes dos DELETEs
-- Data: 2026-07-11
-- Problema: em update_recipe/delete_recipe/delete_batch, os DELETEs internos
--   (production_recipe_items, production_recipe_steps, production_batch_items,
--   production_batches) filtravam apenas por recipe_id/batch_id, sem tenant.
--   Como a funcao e SECURITY DEFINER e o edge production-write valida apenas a
--   membership no tenant INFORMADO, um usuario autenticado de qualquer tenant
--   podia apagar/alterar fichas e batches de OUTRO tenant passando o UUID.
-- Fix: cada acao mutavel primeiro verifica que a recipe/batch pertence ao
--   p_tenant_id e retorna erro caso contrario. Sem mudanca de comportamento
--   para chamadas legitimas.
-- =============================================================================

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
BEGIN
  -- Validate user belongs to tenant
  IF NOT EXISTS (
    SELECT 1 FROM user_tenants WHERE user_id = p_user_id AND tenant_id = p_tenant_id
  ) THEN
    RETURN jsonb_build_object('error', 'User does not belong to this tenant');
  END IF;

  -- LIST RECIPES
  IF p_action = 'list_recipes' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'tenant_id', r.tenant_id,
        'name', r.name,
        'unit', r.unit,
        'instructions', r.instructions,
        'is_active', r.is_active,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', ri.id,
            'recipe_id', ri.recipe_id,
            'ingredient_id', ri.ingredient_id,
            'ingredient_name', ri.ingredient_name,
            'quantity', ri.quantity,
            'unit', ri.unit,
            'unit_cost', ri.unit_cost,
            'created_at', ri.created_at
          ))
          FROM production_recipe_items ri
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

  -- GET RECIPE
  ELSIF p_action = 'get_recipe' THEN
    v_recipe_id := (NULLIF(p_payload->>'recipe_id', ''))::UUID;

    SELECT jsonb_build_object(
      'id', r.id,
      'tenant_id', r.tenant_id,
      'name', r.name,
      'unit', r.unit,
      'instructions', r.instructions,
      'is_active', r.is_active,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ri.id,
          'recipe_id', ri.recipe_id,
          'ingredient_id', ri.ingredient_id,
          'ingredient_name', ri.ingredient_name,
          'quantity', ri.quantity,
          'unit', ri.unit,
          'unit_cost', ri.unit_cost,
          'created_at', ri.created_at
        ))
        FROM production_recipe_items ri
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

  -- CREATE RECIPE
  ELSIF p_action = 'create_recipe' THEN
    INSERT INTO production_recipes (tenant_id, name, unit, instructions, is_active)
    VALUES (
      p_tenant_id,
      p_payload->>'name',
      p_payload->>'unit',
      COALESCE(p_payload->>'instructions', ''),
      true
    )
    RETURNING id INTO v_recipe_id;

    v_items := COALESCE(p_payload->'items', '[]'::jsonb);
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      INSERT INTO production_recipe_items (recipe_id, ingredient_id, ingredient_name, quantity, unit, unit_cost)
      VALUES (
        v_recipe_id,
        (NULLIF(v_item->>'ingredient_id', ''))::UUID,
        v_item->>'ingredient_name',
        COALESCE((v_item->>'quantity')::numeric, 0),
        v_item->>'unit',
        COALESCE((v_item->>'unit_cost')::numeric, 0)
      );
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

  -- UPDATE RECIPE
  ELSIF p_action = 'update_recipe' THEN
    v_recipe_id := (NULLIF(p_payload->>'recipe_id', ''))::UUID;

    -- Posse: a ficha precisa pertencer ao tenant antes de qualquer escrita
    IF NOT EXISTS (
      SELECT 1 FROM production_recipes WHERE id = v_recipe_id AND tenant_id = p_tenant_id
    ) THEN
      RETURN jsonb_build_object('error', 'Recipe not found for this tenant');
    END IF;

    UPDATE production_recipes
    SET
      name = COALESCE(p_payload->>'name', name),
      unit = COALESCE(p_payload->>'unit', unit),
      instructions = COALESCE(p_payload->>'instructions', instructions),
      is_active = COALESCE((p_payload->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = v_recipe_id AND tenant_id = p_tenant_id;

    IF p_payload ? 'items' THEN
      DELETE FROM production_recipe_items WHERE recipe_id = v_recipe_id;
      v_items := COALESCE(p_payload->'items', '[]'::jsonb);
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
      LOOP
        INSERT INTO production_recipe_items (recipe_id, ingredient_id, ingredient_name, quantity, unit, unit_cost)
        VALUES (
          v_recipe_id,
          (NULLIF(v_item->>'ingredient_id', ''))::UUID,
          v_item->>'ingredient_name',
          COALESCE((v_item->>'quantity')::numeric, 0),
          v_item->>'unit',
          COALESCE((v_item->>'unit_cost')::numeric, 0)
        );
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

  -- DELETE RECIPE
  ELSIF p_action = 'delete_recipe' THEN
    v_recipe_id := (NULLIF(p_payload->>'recipe_id', ''))::UUID;

    -- Posse: a ficha precisa pertencer ao tenant antes de qualquer DELETE
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

  -- LIST BATCHES
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

  -- CREATE BATCH
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

  -- DELETE BATCH
  ELSIF p_action = 'delete_batch' THEN
    v_batch_id := (NULLIF(p_payload->>'batch_id', ''))::UUID;

    -- Posse: o batch precisa pertencer ao tenant antes de qualquer DELETE
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
