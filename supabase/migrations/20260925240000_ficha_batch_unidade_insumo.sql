-- CMV/Fichas: a RPC da ficha em lote passa a devolver a unidade do insumo (dono, 2026-09-25).
-- A tela multiplicava a quantidade da ficha (ex.: 150 g) pelo preço por unidade do estoque (R$/kg) sem
-- converter: Burrito California aparecia com custo R$ 11.626 (certo: R$ 14,30). Aditivo: só inclui
-- ingredient_unit; o custo é calculado na tela com a conversão (custoLinhaFicha).

create or replace function public.fn_get_item_ingredients_batch(p_tenant_id uuid, p_item_ids uuid[])
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_user_id UUID;
  v_has_access BOOLEAN := FALSE;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    v_has_access := TRUE;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM user_tenants
      WHERE user_id = v_user_id AND tenant_id = p_tenant_id
    ) INTO v_has_access;
  END IF;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to tenant %', p_tenant_id;
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        ii.item_id,
        ii.ingredient_id,
        ii.quantity,
        COALESCE(ii.unit::text, 'unit') AS unit,
        COALESCE(ing.unit_price, 0) AS unit_price,
        ing.unit::text AS ingredient_unit
      FROM item_ingredients ii
      LEFT JOIN ingredients ing ON ing.id = ii.ingredient_id
      WHERE ii.tenant_id = p_tenant_id
        AND ii.item_id = ANY(p_item_ids)
    ) t
  );
END;
$function$;
