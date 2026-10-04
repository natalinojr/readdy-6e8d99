-- Produção: excluir um registro de produção agora desfaz o que ele fez no estoque (2026-10-04).
--
-- Antes, fn_production_crud › delete_batch só apagava production_batch_items e production_batches.
-- A criação (fn_register_production_and_stock_v2) tinha baixado os insumos e somado o produto
-- feito; nada disso voltava, e os movimentos ficavam órfãos (production_batch_id vira NULL pela FK).
--
-- Agora, para cada movimento da produção com efeito no estoque (signed_quantity <> 0):
--   - devolve o insumo / tira o produto (current_stock - signed_quantity) e grava o movimento
--     "Estorno (produção excluída): <receita>" no sentido contrário (o teórico por data fecha);
--   - insumo contado DEPOIS da produção fica como está: a contagem já mostra o real (mesma regra das
--     compras, fn_insumo_contado_entre), e ele volta em `pulados`.
-- A linha informativa de perda (type loss, signed_quantity 0) é apagada junto com a produção.
-- O preço médio do produto feito não é recalculado de volta.
--
-- Só o bloco delete_batch muda; o resto da função é reescrito como está no banco (troca de texto
-- conferida, aborta se a função tiver mudado).

do $$
declare
  v text;
  v_old constant text := $old$
      RETURN jsonb_build_object('error', 'Batch not found for this tenant');
    END IF;

    DELETE FROM production_batch_items WHERE batch_id = v_batch_id;
    DELETE FROM production_batches WHERE id = v_batch_id AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object('success', true);
$old$;
  v_new constant text := $new$
      RETURN jsonb_build_object('error', 'Batch not found for this tenant');
    END IF;

    -- 2026-10-04: devolve ao estoque o que a produção mexeu (ver 20261004160000_producao_excluir_estorna.sql).
    DECLARE
      v_mov record;
      v_receita text;
      v_estornados int := 0;
      v_pulados text[] := '{}';
    BEGIN
      SELECT recipe_name INTO v_receita FROM production_batches WHERE id = v_batch_id;
      FOR v_mov IN
        SELECT m.ingredient_id, m.signed_quantity, m.unit, m.created_at, i.name
          FROM stock_movements m
          JOIN ingredients i ON i.id = m.ingredient_id
         WHERE m.production_batch_id = v_batch_id
           AND m.tenant_id = p_tenant_id
           AND COALESCE(m.signed_quantity, 0) <> 0
      LOOP
        IF public.fn_insumo_contado_entre(p_tenant_id, v_mov.ingredient_id, v_mov.created_at, now()) IS NOT NULL THEN
          v_pulados := v_pulados || v_mov.name;
          CONTINUE;
        END IF;

        UPDATE ingredients
           SET current_stock = current_stock - v_mov.signed_quantity,
               is_depleted = (current_stock - v_mov.signed_quantity) <= 0,
               updated_at = now()
         WHERE id = v_mov.ingredient_id AND tenant_id = p_tenant_id;

        INSERT INTO stock_movements (
          tenant_id, ingredient_id, type, quantity, signed_quantity, reason, operator_id, unit, created_at
        ) VALUES (
          p_tenant_id, v_mov.ingredient_id,
          (CASE WHEN v_mov.signed_quantity > 0 THEN 'manual_out' ELSE 'in' END)::stock_movement_type,
          abs(v_mov.signed_quantity), -v_mov.signed_quantity,
          'Estorno (produção excluída): ' || COALESCE(v_receita, ''), p_user_id, v_mov.unit, now()
        );
        v_estornados := v_estornados + 1;
      END LOOP;

      DELETE FROM stock_movements
       WHERE production_batch_id = v_batch_id AND tenant_id = p_tenant_id
         AND type = 'loss' AND COALESCE(signed_quantity, 0) = 0;
      DELETE FROM production_batch_items WHERE batch_id = v_batch_id;
      DELETE FROM production_batches WHERE id = v_batch_id AND tenant_id = p_tenant_id;

      RETURN jsonb_build_object('success', true, 'estornados', v_estornados, 'pulados', to_jsonb(v_pulados));
    END;
$new$;
begin
  v := pg_get_functiondef('public.fn_production_crud(text,uuid,uuid,jsonb)'::regprocedure);
  if position('Estorno (produção excluída)' in v) > 0 then
    return;  -- já aplicado
  end if;
  if position(v_old in v) = 0 then
    raise exception 'fn_production_crud mudou: revisar o bloco delete_batch à mão';
  end if;
  execute replace(v, v_old, v_new);
end;
$$;
