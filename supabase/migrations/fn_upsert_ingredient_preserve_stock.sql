-- =============================================================================
-- MIGRATION: fn_upsert_ingredient — UPDATE nao pode sobrescrever current_stock
-- Data: 2026-07-11
-- Problema: o UPDATE gravava current_stock=p_current_stock incondicionalmente.
--   O front (EstoqueContext.upsertInsumo) nao enviava o estoque na edicao e o
--   default virava 0 → QUALQUER edicao de insumo (nome/preco/minimo) ZERAVA o
--   estoque atual. Alem da perda de dado, havia corrida: mesmo enviando o
--   valor, ele era um snapshot velho que sobrescrevia vendas concorrentes.
-- Fix: estoque atual so muda via movimentacao (fn_add_stock_movement) ou
--   inventario. O UPDATE desta funcao nao toca mais em current_stock;
--   p_current_stock passa a valer apenas para o INSERT (estoque inicial).
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
