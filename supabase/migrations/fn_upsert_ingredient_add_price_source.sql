-- =============================================================================
-- MIGRATION: fn_upsert_ingredient — adicionar p_price_source
-- Data: 2026-06-17
-- Descricao: o edge function stock-write (action 'upsert_ingredient') passou a
--   enviar p_price_source ('manual' | 'auto'), mas nenhuma overload de
--   fn_upsert_ingredient aceitava esse parametro. Resultado: o PostgREST nao
--   encontrava a funcao ("Could not find the function ... in the schema cache")
--   e a edicao do insumo (inclusive o preco unitario) falhava com 500.
--   Esta migration cria a overload de 15 parametros, gravando a coluna
--   price_source (ja existente na tabela ingredients) no UPDATE e no INSERT.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_upsert_ingredient(
  p_tenant_id uuid,
  p_id uuid,
  p_name text,
  p_unit ingredient_unit,
  p_unit_price numeric DEFAULT 0,
  p_min_stock numeric DEFAULT 0,
  p_current_stock numeric DEFAULT 0,
  p_category text DEFAULT ''::text,
  p_supplier text DEFAULT ''::text,
  p_usage_type text DEFAULT 'final'::text,
  p_purchase_unit text DEFAULT NULL::text,
  p_purchase_factor numeric DEFAULT 1,
  p_supplier_id uuid DEFAULT NULL::uuid,
  p_dre_category_id uuid DEFAULT NULL::uuid,
  p_price_source text DEFAULT 'manual'::text
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE ingredients
    SET name=p_name,
        unit=p_unit,
        unit_price=p_unit_price,
        min_stock=p_min_stock,
        current_stock=p_current_stock,
        category=p_category,
        supplier=p_supplier,
        usage_type=p_usage_type,
        purchase_unit=p_purchase_unit,
        purchase_factor=p_purchase_factor,
        supplier_id=p_supplier_id,
        dre_category_id=p_dre_category_id,
        price_source=p_price_source,
        updated_at=now()
    WHERE id=p_id AND tenant_id=p_tenant_id
    RETURNING id INTO v_id;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO ingredients(
      tenant_id, name, unit, unit_price, min_stock, current_stock,
      category, supplier, usage_type,
      purchase_unit, purchase_factor, supplier_id, dre_category_id,
      price_source
    )
    VALUES(
      p_tenant_id, p_name, p_unit, p_unit_price, p_min_stock, p_current_stock,
      p_category, p_supplier, p_usage_type,
      p_purchase_unit, p_purchase_factor, p_supplier_id, p_dre_category_id,
      p_price_source
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('id', v_id);
END;
$function$;
