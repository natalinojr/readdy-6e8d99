-- Insumo fora da contagem de inventário (dono, 2026-09-22).
--
-- Tem insumo que existe para lançar (compra, entrada, saída, ficha técnica, CMV) mas que ninguém
-- conta na prateleira: guardanapo, gás, produto de limpeza. Ele só atrapalha a contagem.
--
-- ingredients.count_inventory (default true, insumos existentes seguem como estão):
--   true  → aparece na contagem de inventário (tela e assistente), como hoje.
--   false → some da contagem; a confirmação do inventário ignora o insumo mesmo que ele venha
--           na lista (rascunho antigo no navegador). Todo o resto continua igual.
-- Independente de track_stock (avisos/bloqueios).

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS count_inventory boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.fn_get_ingredients(p_tenant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissao para esta loja.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT id, name, unit::text, unit_price, min_stock, current_stock, is_depleted,
             category, supplier, supplier_id, created_at, updated_at,
             price_source, last_purchase_price, last_purchase_date,
             purchase_unit, COALESCE(purchase_factor, 1) AS purchase_factor,
             deleted_at, dre_category_id, usage_type,
             COALESCE(track_stock, true) AS track_stock,
             COALESCE(count_inventory, true) AS count_inventory
      FROM ingredients
      WHERE tenant_id = p_tenant_id
        AND deleted_at IS NULL
      ORDER BY name
    ) t
  );
END;
$function$;

-- Mesma função de antes; só pula o insumo marcado como fora da contagem.
CREATE OR REPLACE FUNCTION public.fn_confirm_inventory(p_tenant_id uuid, p_operator_id uuid, p_operator_name text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_ing_id uuid;
  v_counted numeric;
  v_live numeric;
  v_delta numeric;
  v_unit_price numeric;
  v_unit text;
  v_name text;
  v_conta boolean;
  v_adjusted int := 0;
  v_counted_items int := 0;
  v_valor numeric := 0;
  v_numero int;
  v_session_id uuid;
  v_session_items jsonb := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_items deve ser um array');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('inventory_confirm_' || p_tenant_id::text));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ing_id := COALESCE(v_item->>'ingredient_id', v_item->>'insumoId')::uuid;
    v_counted := COALESCE(v_item->>'qtd_contada', v_item->>'qtdContada')::numeric;
    CONTINUE WHEN v_ing_id IS NULL OR v_counted IS NULL OR v_counted < 0;

    SELECT current_stock, unit_price, unit::text, name, COALESCE(count_inventory, true)
      INTO v_live, v_unit_price, v_unit, v_name, v_conta
      FROM ingredients
      WHERE id = v_ing_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
      FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_conta IS NOT TRUE;

    v_live := COALESCE(v_live, 0);
    v_delta := v_counted - v_live;
    v_counted_items := v_counted_items + 1;

    IF v_delta <> 0 THEN
      INSERT INTO stock_movements (tenant_id, ingredient_id, type, quantity, signed_quantity, unit, reason, notes, operator_id)
      VALUES (p_tenant_id, v_ing_id, 'inventory_adjustment', ABS(v_delta), v_delta, v_unit,
              COALESCE(v_item->>'reason', 'Ajuste de Inventario'),
              'delta=' || v_delta::text, p_operator_id);
      v_adjusted := v_adjusted + 1;
      v_valor := v_valor + v_delta * COALESCE(v_unit_price, 0);
    END IF;

    UPDATE ingredients
    SET current_stock = v_counted,
        is_depleted = (v_counted <= 0),
        updated_at = now()
    WHERE id = v_ing_id AND tenant_id = p_tenant_id;

    v_session_items := v_session_items || jsonb_build_object(
      'ingredient_id', v_ing_id,
      'nome', v_name,
      'unidade', v_unit,
      'qtdTeorica', v_live,
      'qtd_contada', v_counted,
      'diferenca', v_delta,
      'preco_unitario', COALESCE(v_unit_price, 0)
    );
  END LOOP;

  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
  FROM inventory_sessions WHERE tenant_id = p_tenant_id;

  INSERT INTO inventory_sessions (
    tenant_id, numero, operator_name, status,
    itens_contados, itens_com_diferenca, valor_ajuste_liquido, items
  )
  VALUES (
    p_tenant_id, v_numero, COALESCE(p_operator_name, 'Operador'), 'confirmado',
    v_counted_items, v_adjusted, ROUND(v_valor, 2), v_session_items
  )
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'success', true, 'session_id', v_session_id, 'numero', v_numero,
    'adjusted', v_adjusted, 'itens_contados', v_counted_items,
    'valor_ajuste_liquido', ROUND(v_valor, 2)
  );
END;
$function$;
