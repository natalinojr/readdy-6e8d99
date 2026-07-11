-- =============================================================================
-- MIGRATION: fn_add_stock_movement — tipo 'loss' deve SUBTRAIR estoque
-- Data: 2026-07-11
-- Problema: v_is_sub nao incluia 'loss'; uma perda caia no ramo de entrada e
--   SOMAVA estoque (v_delta = +ABS). O gatilho era facil: o edge stock-write
--   converte qualquer saida cujo motivo contenha "perda" para o tipo 'loss'.
--   Latente ate hoje (0 movimentos 'loss' no banco), mas corrompia estoque na
--   primeira perda registrada com esse texto.
-- Fix: incluir 'loss' na lista de tipos de subtracao (delta negativo + baixa
--   de lote quando p_batch_id informado).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_add_stock_movement(
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
AS $function$
DECLARE
  v_delta NUMERIC;
  v_is_sub BOOLEAN;
  v_movement_id UUID;
  v_result JSONB;
  v_recorded_quantity NUMERIC;
BEGIN
  v_is_sub := p_type IN ('manual_out', 'theoretical_out', 'transfer_out', 'loss');

  -- BUG-31: inventory_adjustment pode ser positivo (ganho) ou negativo (perda).
  -- O sinal de p_quantity determina a direcao do ajuste:
  --   positivo → entrada (current_stock aumenta)
  --   negativo → saida  (current_stock diminui)
  -- Para outros tipos, o comportamento permanece inalterado.
  IF p_type = 'inventory_adjustment' THEN
    v_delta := p_quantity;
    v_recorded_quantity := ABS(p_quantity);
  ELSE
    v_delta := CASE WHEN v_is_sub THEN -ABS(p_quantity) ELSE ABS(p_quantity) END;
    v_recorded_quantity := ABS(p_quantity);
  END IF;

  INSERT INTO stock_movements (
    tenant_id, ingredient_id, type, quantity, unit, reason, notes, order_id, operator_id, batch_id
  ) VALUES (
    p_tenant_id, p_ingredient_id, p_type::stock_movement_type, v_recorded_quantity, p_unit,
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
$function$;
