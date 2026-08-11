-- stock_movements.signed_quantity — 2026-08-11
--
-- Prepara terreno pra feature de "estoque teorico numa data qualquer" (aba
-- nova em Estoque). Reconstruir estoque histórico = current_stock menos a
-- soma das movimentações depois daquela data, andando pra trás. Isso exige
-- saber o SINAL de cada movimentação — hoje `quantity` é sempre gravado em
-- valor absoluto, e o sinal:
--   - é DEDUTÍVEL do `type` pra a maioria (in/transfer_in somam,
--     manual_out/theoretical_out/transfer_out/loss subtraem);
--   - fica escondido como TEXTO dentro de `notes` ('delta=-2.4') só pra
--     `inventory_adjustment` (ajuste pode ser positivo OU negativo);
--   - é literalmente IRRECUPERÁVEL em pelo menos 1 caminho de inserção
--     (`fn_add_stock_movement` com type=inventory_adjustment não grava
--     delta em lugar nenhum da linha).
--
-- Levantamento feito em produção antes de escrever esta migração (não em
-- memória): 576 movimentações no total, 3 são inventory_adjustment. 2 têm
-- 'delta=' recuperável em notes. A 1 restante (id 27ab3833..., Chilli com
-- Carne, tenant EP PAR MALL, 2026-06-04) tem notes NULL — mas a sessão de
-- inventário correspondente (inventory_sessions #1, mesmo tenant, 8min
-- antes) tem o item com `diferenca: -2.4` — bate exatamente com o valor
-- absoluto gravado (quantity=2.4). Recuperado por cruzamento, não chute.
--
-- ACHADO À PARTE, importante pro cálculo de estoque teórico: a movimentação
-- de "perda de produção" (type=loss, production_batch_id preenchido — ver
-- migração de 2026-08-11 mais cedo hoje) é INFORMATIVA — não mexe em
-- current_stock (já está refletida na diferença entre insumo bruto que saiu
-- e produto pronto que entrou). Se ela entrar na reconstrução como -quantity
-- igual a uma perda manual, o estoque teórico subtrai a perda 2x. Por isso
-- o CASE abaixo trata esse tipo especificamente como signed_quantity = 0.
-- Hoje (11/08) há ZERO linhas desse tipo em produção — regra escrita pra
-- não quebrar quando a primeira aparecer.
--
-- Terceiro achado: `order-write/index.ts` (deductStockForOrderItem e
-- restockForOrderItem) insere em stock_movements DIRETO, sem passar por
-- nenhuma RPC — é o maior volume do sistema (toda venda). Editado junto
-- nesta mudança (fora desta migração SQL, é TypeScript).
--
-- NULL em signed_quantity = "sinal historicamente desconhecido". A RPC de
-- estoque teórico que vai consumir esta coluna deve marcar como não-confiável
-- qualquer data cuja reconstrução dependa de uma linha com signed_quantity
-- NULL, em vez de chutar o sinal.

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS signed_quantity numeric;

COMMENT ON COLUMN stock_movements.signed_quantity IS
  'Efeito REAL assinado no current_stock no momento em que a movimentacao foi aplicada (positivo = somou, negativo = subtraiu, 0 = informativa/nao mexeu em estoque — ex: perda de producao, ja refletida na diferenca entre insumo bruto que saiu e produto pronto que entrou). NULL = sinal historico desconhecido — nao confiar em reconstrucoes de estoque teorico que dependam deste registro. Populado no INSERT por fn_add_stock_movement, fn_confirm_inventory, fn_register_production_and_stock_v2 e pelos inserts diretos em order-write/index.ts (deductStockForOrderItem/restockForOrderItem).';

-- 1) Tipos com sinal 100% dedutivel do `type` — inclui o caso especial de
--    perda de producao (informativa, signed_quantity = 0).
UPDATE stock_movements
SET signed_quantity = CASE
  WHEN type = 'loss' AND production_batch_id IS NOT NULL THEN 0
  WHEN type IN ('manual_out', 'theoretical_out', 'transfer_out', 'loss') THEN -quantity
  WHEN type IN ('in', 'transfer_in') THEN quantity
  ELSE NULL
END
WHERE type <> 'inventory_adjustment' AND signed_quantity IS NULL;

-- 2) inventory_adjustment com 'delta=' recuperavel em notes
UPDATE stock_movements
SET signed_quantity = (regexp_match(notes, '^delta=(-?[0-9]+(\.[0-9]+)?)$'))[1]::numeric
WHERE type = 'inventory_adjustment'
  AND signed_quantity IS NULL
  AND notes ~ '^delta=-?[0-9]+(\.[0-9]+)?$';

-- 3) inventory_adjustment restante: cruza com inventory_sessions.items pelo
--    tenant + janela de tempo (+-2h) + ingredient_id + magnitude batendo
--    (sanity check contra falso-positivo). So marca signed_quantity quando
--    a diferenca da sessao bate EXATAMENTE com o quantity absoluto gravado.
UPDATE stock_movements sm
SET signed_quantity = sub.diferenca
FROM (
  SELECT sm2.id AS movement_id, (item->>'diferenca')::numeric AS diferenca
  FROM stock_movements sm2
  JOIN inventory_sessions s
    ON s.tenant_id = sm2.tenant_id
   AND s.created_at BETWEEN sm2.created_at - interval '2 hours' AND sm2.created_at + interval '2 hours'
  CROSS JOIN LATERAL jsonb_array_elements(s.items) AS item
  WHERE sm2.type = 'inventory_adjustment'
    AND sm2.signed_quantity IS NULL
    AND COALESCE(item->>'insumoId', item->>'ingredient_id') = sm2.ingredient_id::text
    AND abs((item->>'diferenca')::numeric) = sm2.quantity
) sub
WHERE sm.id = sub.movement_id;

-- Linhas de inventory_adjustment que ainda assim ficarem com signed_quantity
-- NULL (nenhuma delas hoje, 11/08) permanecem NULL de proposito — sinal
-- genuinamente perdido, marcado como tal em vez de adivinhado.

-- ────────────────────────────────────────────────────────────────────────
-- fn_add_stock_movement — passa a gravar signed_quantity = v_delta (ja
-- calculado, so faltava persistir). prosecdef/proconfig identicos ao
-- original (proconfig NULL — sem search_path pinado; nao e escopo desta
-- mudanca mexer nisso).
CREATE OR REPLACE FUNCTION fn_add_stock_movement(
  p_tenant_id uuid,
  p_ingredient_id uuid,
  p_type text,
  p_quantity numeric,
  p_unit text DEFAULT NULL::text,
  p_reason text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_order_id uuid DEFAULT NULL::uuid,
  p_operator_id uuid DEFAULT NULL::uuid,
  p_batch_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_delta NUMERIC;
  v_is_sub BOOLEAN;
  v_movement_id UUID;
  v_result JSONB;
  v_recorded_quantity NUMERIC;
BEGIN
  v_is_sub := p_type IN ('manual_out', 'theoretical_out', 'transfer_out', 'loss');

  -- BUG-31: inventory_adjustment pode ser positivo (ganho) ou negativo (perda).
  IF p_type = 'inventory_adjustment' THEN
    v_delta := p_quantity;
    v_recorded_quantity := ABS(p_quantity);
  ELSE
    v_delta := CASE WHEN v_is_sub THEN -ABS(p_quantity) ELSE ABS(p_quantity) END;
    v_recorded_quantity := ABS(p_quantity);
  END IF;

  INSERT INTO stock_movements (
    tenant_id, ingredient_id, type, quantity, signed_quantity, unit, reason, notes, order_id, operator_id, batch_id
  ) VALUES (
    p_tenant_id, p_ingredient_id, p_type::stock_movement_type, v_recorded_quantity, v_delta, p_unit,
    p_reason, p_notes, p_order_id, p_operator_id, p_batch_id
  )
  RETURNING id INTO v_movement_id;

  UPDATE ingredients
  SET current_stock = COALESCE(current_stock, 0) + v_delta,
      is_depleted = CASE
        WHEN COALESCE(current_stock, 0) + v_delta > 0 THEN false
        ELSE true
      END,
      updated_at = NOW()
  WHERE id = p_ingredient_id AND tenant_id = p_tenant_id;

  IF p_batch_id IS NOT NULL AND v_is_sub THEN
    UPDATE ingredient_batches
    SET quantity_remaining = COALESCE(quantity_remaining, 0) - ABS(p_quantity),
        status = CASE WHEN COALESCE(quantity_remaining, 0) - ABS(p_quantity) <= 0 THEN 'depleted' ELSE status END,
        updated_at = NOW()
    WHERE id = p_batch_id AND tenant_id = p_tenant_id;
  END IF;

  v_result := jsonb_build_object('movement_id', v_movement_id, 'delta', v_delta, 'success', true);
  RETURN v_result;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- fn_confirm_inventory — passa a gravar signed_quantity = v_delta (ja
-- calculado ali mesmo). Assinatura/proconfig identicos ao original.
CREATE OR REPLACE FUNCTION fn_confirm_inventory(
  p_tenant_id uuid,
  p_operator_id uuid,
  p_operator_name text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ────────────────────────────────────────────────────────────────────────
-- fn_register_production_and_stock_v2 — passa a gravar signed_quantity nas
-- 3 movimentacoes que cria: manual_out (-qty, real), in (+qty, real) e
-- loss (0, informativa — NAO e -qty, ver comentario no topo da migracao).
CREATE OR REPLACE FUNCTION fn_register_production_and_stock_v2(
  p_tenant_id uuid,
  p_user_id uuid,
  p_recipe_id uuid,
  p_recipe_name text,
  p_produced_quantity numeric,
  p_unit text,
  p_yield_percent_actual numeric DEFAULT NULL::numeric,
  p_yield_percent_expected numeric DEFAULT NULL::numeric,
  p_loss_quantity_kg numeric DEFAULT NULL::numeric,
  p_loss_value numeric DEFAULT NULL::numeric,
  p_total_cost numeric DEFAULT 0,
  p_unit_cost numeric DEFAULT 0,
  p_produced_by text DEFAULT ''::text,
  p_notes text DEFAULT ''::text,
  p_steps_completed text[] DEFAULT NULL::text[],
  p_items jsonb DEFAULT '[]'::jsonb,
  p_output_ingredient_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- Buscar unidade de estoque do ingrediente
    SELECT unit INTO v_stock_unit FROM ingredients
    WHERE id = v_ingredient_id AND tenant_id = p_tenant_id;

    -- Converter quantidade usada para a unidade do estoque
    v_converted := convert_unit(v_qty_used, v_unit, COALESCE(v_stock_unit, v_unit));
    v_qty_in_stock_unit := COALESCE(v_converted, v_qty_used);

    -- Dar baixa no estoque do ingrediente bruto
    SELECT current_stock INTO v_old_stock FROM ingredients
    WHERE id = v_ingredient_id AND tenant_id = p_tenant_id;

    v_new_stock := COALESCE(v_old_stock, 0) - v_qty_in_stock_unit;

    UPDATE ingredients
    SET current_stock = GREATEST(v_new_stock, 0),
        is_depleted = CASE WHEN GREATEST(v_new_stock, 0) <= 0 THEN true ELSE false END,
        updated_at = v_timestamp
    WHERE id = v_ingredient_id AND tenant_id = p_tenant_id;

    -- Criar production_batch_item
    INSERT INTO production_batch_items (
      batch_id, ingredient_id, ingredient_name, quantity_used, unit, unit_cost, total_cost
    ) VALUES (
      v_batch_id, v_ingredient_id, v_ingredient_name, v_qty_used, v_unit, v_unit_cost_item, v_total_cost_item
    );

    -- Criar stock_movement de SAIDA (producao) na unidade do estoque
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

  -- 3. Dar ENTRADA no estoque do produto acabado (se tiver ID) + registrar perda
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
      -- Busca a unidade do estoque do produto acabado
      SELECT unit INTO v_out_stock_unit FROM ingredients
      WHERE id = p_output_ingredient_id AND tenant_id = p_tenant_id;

      -- Converte a quantidade produzida para a unidade do estoque do produto acabado
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

      -- BUG-30: Propagar custo unitario da producao para ingredients.unit_price (media ponderada)
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

      -- Criar stock_movement de ENTRADA (producao) na unidade do estoque do produto
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

      -- Registrar a PERDA como movimentacao (puramente informativa — NAO mexe
      -- em current_stock de novo, ela ja esta refletida na diferenca entre o
      -- que saiu de insumo bruto e o que entrou de produto pronto acima).
      -- signed_quantity = 0 (NAO -quantidade): o efeito real em current_stock
      -- desta linha e zero, e a reconstrucao de estoque teorico depende disso
      -- pra nao descontar a perda duas vezes.
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

  -- Retornar resultado
  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'movements_count', v_movement_count,
    'items_count', v_items_count,
    'debug_log', v_debug_log
  );
END;
$$;
