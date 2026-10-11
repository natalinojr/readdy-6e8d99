-- Auditoria de números (2026-10-10): Relatórios › CMV & Margem (fn_get_cmv_report).
-- 1) Sem custo gravado na venda (order_items.unit_cost), o custo teórico das opções só olhava
--    options.ingredient_id e ignorava option_ingredients (opção com vários insumos / ligada a produto):
--    Burritos Duo Mex saía com 3,8% de CMV (certo ≈ 30%). Agora segue a mesma regra da baixa de estoque
--    (_shared/stock.ts): option_ingredients quando existem, senão o vínculo antigo da opção; receita de
--    produção vira o insumo que ela produz.
-- 2) "Tem ficha" exige ficha completa: custo gravado, ficha do item/combo, ou TODAS as opções escolhidas
--    com custo (antes um combo com só a bebida ligada contava como ficha, com CMV de 0,8%).
-- 3) Item cancelado fica fora; no delivery/iFood o item_price é só o preço base, então os adicionais
--    entram na receita (igual ao fn_get_sales_report).
-- Saída igual à anterior (por_item + resumo).

CREATE OR REPLACE FUNCTION public.fn_get_cmv_report(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._assert_tenant_access(p_tenant_id);

  WITH linhas AS (
    SELECT oi.id, oi.item_name, oi.combo_id, oi.quantity, oi.unit_cost, mi.id AS mi_id,
           COALESCE(mc.name, 'Sem categoria') AS category_name,
           oi.item_price + CASE WHEN o.origin_type::text = 'delivery'
             THEN COALESCE((SELECT SUM(x.additional_price) FROM order_item_options x WHERE x.order_item_id = oi.id AND x.tenant_id = p_tenant_id), 0)
             ELSE 0 END AS preco
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN menu_items mi ON mi.id = oi.item_id
    LEFT JOIN menu_categories mc ON mc.id = mi.category_id
    WHERE o.tenant_id = p_tenant_id
      AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid = true AND o.status != 'cancelled'
      AND NOT o.is_training AND NOT o.is_draft
      AND COALESCE(oi.status::text, '') <> 'cancelled'
  ),
  -- Custo de cada opção escolhida (por unidade do item) e se ela tem de onde tirar custo.
  opcoes AS (
    SELECT l.id AS linha_id,
           COALESCE(oc.custo, 0) AS custo,
           (oc.tem_custo IS TRUE) AS tem_custo
    FROM linhas l
    JOIN order_item_options oio ON oio.order_item_id = l.id AND oio.tenant_id = p_tenant_id
    LEFT JOIN options opt ON opt.id = oio.option_id
    LEFT JOIN LATERAL (
      SELECT
        CASE WHEN EXISTS (SELECT 1 FROM option_ingredients z WHERE z.option_id = opt.id AND z.tenant_id = p_tenant_id)
          THEN (SELECT COALESCE(SUM(convert_unit(oin.quantity, oin.unit,
                                        COALESCE(ing.unit::text, oin.unit)) * COALESCE(ing.unit_price, 0)), 0)
                FROM option_ingredients oin
                LEFT JOIN production_recipes pr ON pr.id = oin.production_recipe_id
                LEFT JOIN ingredients ing ON ing.id = COALESCE(oin.ingredient_id, pr.output_ingredient_id)
                WHERE oin.option_id = opt.id AND oin.tenant_id = p_tenant_id)
          ELSE (SELECT COALESCE(SUM(convert_unit(COALESCE(opt.consumption_quantity, 1),
                                        COALESCE(NULLIF(opt.consumption_unit, ''), ing.unit::text), ing.unit::text) * COALESCE(ing.unit_price, 0)), 0)
                FROM ingredients ing
                WHERE ing.id = COALESCE(opt.ingredient_id,
                                        (SELECT pr.output_ingredient_id FROM production_recipes pr WHERE pr.id = opt.production_recipe_id)))
        END AS custo,
        (EXISTS (SELECT 1 FROM option_ingredients z WHERE z.option_id = opt.id AND z.tenant_id = p_tenant_id)
          OR opt.ingredient_id IS NOT NULL OR opt.production_recipe_id IS NOT NULL) AS tem_custo
    ) oc ON true
  ),
  op_por_linha AS (
    SELECT linha_id, SUM(custo) AS custo, bool_and(tem_custo) AS todas_com_custo, bool_or(tem_custo) AS alguma_com_custo
    FROM opcoes GROUP BY linha_id
  ),
  base AS (
    SELECT l.*,
           (SELECT COALESCE(SUM(convert_unit(ii.quantity, ii.unit::text, ing.unit::text) * COALESCE(ing.unit_price, 0)), 0)
              FROM item_ingredients ii JOIN ingredients ing ON ing.id = ii.ingredient_id
             WHERE ii.item_id = l.mi_id AND ii.tenant_id = p_tenant_id) AS c_item,
           EXISTS (SELECT 1 FROM item_ingredients ii WHERE ii.item_id = l.mi_id AND ii.tenant_id = p_tenant_id) AS f_item,
           (SELECT COALESCE(SUM(convert_unit(ci.quantity, ci.unit, ing.unit::text) * COALESCE(ing.unit_price, 0)), 0)
              FROM combo_ingredients ci JOIN ingredients ing ON ing.id = ci.ingredient_id
             WHERE ci.combo_id = l.combo_id AND ci.tenant_id = p_tenant_id AND ci.deleted_at IS NULL)
           + (SELECT COALESCE(SUM(
                (SELECT COALESCE(SUM(convert_unit(ii2.quantity, ii2.unit::text, ing2.unit::text) * COALESCE(ing2.unit_price, 0)), 0)
                   FROM item_ingredients ii2 JOIN ingredients ing2 ON ing2.id = ii2.ingredient_id
                  WHERE ii2.item_id = cmi.item_id AND ii2.tenant_id = p_tenant_id) * cmi.quantity), 0)
                FROM combo_items cmi
               WHERE cmi.combo_id = l.combo_id AND cmi.tenant_id = p_tenant_id AND cmi.deleted_at IS NULL) AS c_combo,
           (l.combo_id IS NOT NULL AND (
              EXISTS (SELECT 1 FROM combo_ingredients ci WHERE ci.combo_id = l.combo_id AND ci.tenant_id = p_tenant_id AND ci.deleted_at IS NULL)
              OR EXISTS (SELECT 1 FROM combo_items cmi WHERE cmi.combo_id = l.combo_id AND cmi.tenant_id = p_tenant_id AND cmi.deleted_at IS NULL))) AS f_combo,
           COALESCE(op.custo, 0) AS c_opcoes,
           op.linha_id IS NOT NULL AS tem_opcoes,
           COALESCE(op.todas_com_custo, false) AS opcoes_completas
    FROM linhas l
    LEFT JOIN op_por_linha op ON op.linha_id = l.id
  ),
  calc AS (
    SELECT b.*,
           COALESCE(b.unit_cost, b.c_item + b.c_combo + b.c_opcoes) * b.quantity AS custo_linha,
           b.preco * b.quantity AS receita_linha,
           (b.unit_cost IS NOT NULL OR b.f_item OR b.f_combo OR (b.tem_opcoes AND b.opcoes_completas)) AS tem_ficha
    FROM base b
  ),
  por_item AS (
    SELECT item_name, mi_id AS item_id, category_name,
           SUM(quantity) AS total_qty,
           SUM(receita_linha) AS receita_total,
           COALESCE(SUM(custo_linha), 0) AS custo_total,
           CASE WHEN SUM(receita_linha) > 0 THEN ROUND(COALESCE(SUM(custo_linha), 0) / SUM(receita_linha) * 100, 2) ELSE 0 END AS cmv_pct,
           SUM(receita_linha) - COALESCE(SUM(custo_linha), 0) AS margem_bruta,
           bool_and(tem_ficha) AS tem_ficha_tecnica
    FROM calc
    GROUP BY item_name, category_name, mi_id
  )
  SELECT jsonb_build_object(
    'por_item', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY t.receita_total DESC) FROM por_item t), '[]'::jsonb),
    'resumo', jsonb_build_object(
      'receita_total', (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o
                         WHERE o.tenant_id = p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
                           AND o.is_paid = true AND o.status != 'cancelled' AND NOT o.is_training AND NOT o.is_draft),
      'itens_com_ficha', (SELECT COUNT(DISTINCT item_name) FROM por_item WHERE tem_ficha_tecnica),
      'itens_sem_ficha', (SELECT COUNT(DISTINCT item_name) FROM por_item WHERE NOT tem_ficha_tecnica),
      'cobertura_pct', (SELECT CASE WHEN COUNT(DISTINCT item_name) > 0
                                 THEN ROUND(COUNT(DISTINCT item_name) FILTER (WHERE tem_ficha_tecnica)::numeric / COUNT(DISTINCT item_name) * 100, 1)
                                 ELSE 0 END FROM por_item)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
