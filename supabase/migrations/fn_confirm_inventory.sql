-- =============================================================================
-- MIGRATION: fn_confirm_inventory — confirmacao de inventario transacional
-- Data: 2026-07-11
-- Problema: o edge stock-write (action confirm_inventory) rodava dois loops sem
--   transacao: (1) movimentos de ajuste com a diferenca calculada no FRONT
--   (snapshot possivelmente velho — rascunho de dias no localStorage) e
--   (2) UPDATE absoluto current_stock=qtd_contada para TODOS os itens, apagando
--   vendas/entradas ocorridas entre o carregamento da contagem e o confirm.
--   Erros no meio eram so console.error com resposta ok:true, e o numero da
--   sessao vinha de count(limit 1000)+1 (corrida + teto).
-- Fix: RPC unica e atomica. O delta e recalculado contra o estoque VIVO (com
--   FOR UPDATE por linha), o movimento guarda o sinal em notes ('delta=x'),
--   a numeracao usa MAX(numero)+1 sob advisory lock por tenant e o valor do
--   ajuste e calculado no servidor com o unit_price atual.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_confirm_inventory(
  p_tenant_id uuid,
  p_operator_id uuid,
  p_operator_name text,
  p_items jsonb
)
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

  -- Serializa confirmacoes concorrentes do mesmo tenant (numeracao + ajustes)
  PERFORM pg_advisory_xact_lock(hashtext('inventory_confirm_' || p_tenant_id::text));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ing_id := COALESCE(v_item->>'ingredient_id', v_item->>'insumoId')::uuid;
    v_counted := COALESCE(v_item->>'qtd_contada', v_item->>'qtdContada')::numeric;
    CONTINUE WHEN v_ing_id IS NULL OR v_counted IS NULL OR v_counted < 0;

    SELECT current_stock, unit_price, unit::text, name
      INTO v_live, v_unit_price, v_unit, v_name
      FROM ingredients
      WHERE id = v_ing_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
      FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    v_live := COALESCE(v_live, 0);
    -- Delta contra o estoque VIVO do momento do confirm, nao o snapshot do front
    v_delta := v_counted - v_live;
    v_counted_items := v_counted_items + 1;

    IF v_delta <> 0 THEN
      INSERT INTO stock_movements (tenant_id, ingredient_id, type, quantity, unit, reason, notes, operator_id)
      VALUES (p_tenant_id, v_ing_id, 'inventory_adjustment', ABS(v_delta), v_unit,
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
