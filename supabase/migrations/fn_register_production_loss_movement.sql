-- fn_register_production_and_stock_v2 — 2026-08-11
--
-- Sintoma (usuário, screenshot): aba Movimentações > filtro "Perda" nunca mostra
-- nada de produção, mesmo quando o RegistroProducaoModal calcula e exibe perda
-- (kg + R$) na hora de registrar. A perda fica só em production_batches
-- (loss_quantity_kg/loss_value) — nunca vira uma linha em stock_movements.
--
-- O front JÁ estava pronto pra isso — código morto esperando o dado:
--   EstoqueContext.detectProducaoTipo(): `reason.includes('Perda em produção')` → tipo 'perda'
--   MovimentacoesTab.getMotivoDisplay(): `motivo.startsWith('Perda em produção:')` → label/sub
-- Só faltava a RPC gravar essa linha. Esta migração faz exatamente isso.
--
-- Por que é seguro NÃO subtrair estoque de novo: a perda já está refletida na
-- diferença entre o que SAIU de insumo bruto (manual_out, quantidade usada
-- INTEIRA) e o que ENTROU de produto pronto (in, só o que foi PESADO — já
-- líquido de perda). Subtrair de novo aqui seria contar a perda 2x. O
-- trigger em stock_movements (fn_apply_stock_movement) é NO-OP confirmado —
-- inserir a linha direto, sem UPDATE em ingredients, é o comportamento certo
-- (puramente informativo, pra aparecer no relatório).
--
-- Anexado ao INSUMO DE SAÍDA (produto acabado), não aos insumos brutos: a
-- perda já sai agregada do front (kg-equivalente, soma vários insumos —
-- ver toKgAprox em RegistroProducaoModal), não há como atribuir a um insumo
-- bruto específico sem inventar uma divisão arbitrária. "Perda ao fazer X"
-- fica naturalmente ligada a X.
--
-- Assinatura idêntica à anterior (mesmos defaults) — confirmado via
-- pg_get_function_arguments antes de escrever esta migração.

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
      tenant_id, ingredient_id, type, quantity, reason, operator_id, unit, production_batch_id, created_at
    ) VALUES (
      p_tenant_id, v_ingredient_id, 'manual_out', v_qty_in_stock_unit,
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
      -- O CMV (fn_get_cmv_report) le ingredients.unit_price para calcular o custo dos itens vendidos.
      -- Sem esta atualizacao, insumos produzidos ficam com unit_price 0 ou desatualizado,
      -- resultando em CMV subestimado nos itens que usam esse insumo como ingrediente.
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
        tenant_id, ingredient_id, type, quantity, reason, operator_id, unit, production_batch_id, created_at
      ) VALUES (
        p_tenant_id, p_output_ingredient_id, 'in', v_produced_in_stock_unit,
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
      -- Reason EXATO ("Perda em produção: ") pra bater com o que o front ja
      -- espera: EstoqueContext.detectProducaoTipo() e
      -- MovimentacoesTab.getMotivoDisplay() ja tratam esse texto — so faltava
      -- alguem gravar a linha.
      IF p_loss_quantity_kg IS NOT NULL AND p_loss_quantity_kg > 0 THEN
        v_loss_converted := convert_unit(p_loss_quantity_kg, 'kg', COALESCE(v_out_stock_unit, 'kg'));
        IF v_loss_converted IS NOT NULL THEN
          v_loss_qty_display := v_loss_converted;
          v_loss_unit_display := v_out_stock_unit;
        ELSE
          -- Saida em 'un' (ou unidade desconhecida): kg nao converte pra
          -- unidade discreta. Grava em kg mesmo — melhor que nada, e e
          -- literalmente o que o numero representa (massa que sumiu).
          v_loss_qty_display := p_loss_quantity_kg;
          v_loss_unit_display := 'kg';
        END IF;

        INSERT INTO stock_movements (
          tenant_id, ingredient_id, type, quantity, reason, operator_id, unit, production_batch_id, created_at
        ) VALUES (
          p_tenant_id, p_output_ingredient_id, 'loss', v_loss_qty_display,
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
