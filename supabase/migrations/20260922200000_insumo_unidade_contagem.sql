-- Unidade de contagem por insumo (dono, 2026-09-22).
--
-- A barbacoa fica em kg no estoque, mas na câmara fria está em pacotes de 500 g: é mais fácil (e dá
-- menos erro) a equipe contar pacotes. O inventário continua gravando na unidade do estoque — a tela
-- e a contagem rápida do assistente só convertem (contado × count_factor).
--
--   count_unit   text     nome livre ('pacote', 'balde'); NULL = conta na unidade do estoque.
--   count_factor numeric  quanto 1 unidade de contagem vale na unidade do estoque (pacote 500 g, estoque kg → 0,5).
-- Separada de purchase_unit: a compra pode vir em caixa com vários pacotes.

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS count_unit text,
  ADD COLUMN IF NOT EXISTS count_factor numeric;

ALTER TABLE public.ingredients
  DROP CONSTRAINT IF EXISTS ingredients_count_factor_positivo;
ALTER TABLE public.ingredients
  ADD CONSTRAINT ingredients_count_factor_positivo CHECK (count_factor IS NULL OR count_factor > 0);

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
             COALESCE(count_inventory, true) AS count_inventory,
             count_unit, count_factor
      FROM ingredients
      WHERE tenant_id = p_tenant_id
        AND deleted_at IS NULL
      ORDER BY name
    ) t
  );
END;
$function$;
