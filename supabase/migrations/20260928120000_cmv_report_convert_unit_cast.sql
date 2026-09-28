-- fn_get_cmv_report quebrava com 42883: convert_unit(numeric, ingredient_unit, ingredient_unit) does not exist.
-- ingredients.unit e item_ingredients.unit são o enum ingredient_unit (desde o schema base), e só existe
-- convert_unit(numeric, text, text). A função foi criada fora das migrações (época do Readdy) sem cast,
-- então o relatório de CMV (Relatórios > CMV, useCmvRelatorio) voltava vazio — o front engole o erro.
-- Correção: só casts ::text nas unidades passadas para convert_unit. Regra de cálculo inalterada.
-- (combo_ingredients.unit e options.consumption_unit já são text.)
-- Segundo bug que estava escondido atrás do primeiro: tem_ficha_tecnica usava oi.combo_id/oi.id fora do
-- GROUP BY (42803). Agora é bool_or(...) = "alguma venda desse item tem ficha", que é o que a coluna quer dizer.

CREATE OR REPLACE FUNCTION public.fn_get_cmv_report(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'por_item', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT
          oi.item_name,
          COALESCE(mc.name, 'Sem categoria') AS category_name,
          SUM(oi.quantity) AS total_qty,
          SUM(oi.item_price * oi.quantity) AS receita_total,
          COALESCE(SUM(
            COALESCE(
              oi.unit_cost,
              (
                COALESCE(
                  (SELECT COALESCE(SUM(convert_unit(ii.quantity, ii.unit::text, ing.unit::text) * COALESCE(ing.unit_price, 0)), 0)
                   FROM item_ingredients ii
                   JOIN ingredients ing ON ing.id = ii.ingredient_id
                   WHERE ii.item_id = mi.id AND ii.tenant_id = p_tenant_id
                  ), 0
                )
                +
                COALESCE(
                  (SELECT COALESCE(SUM(convert_unit(ci.quantity, ci.unit, ing.unit::text) * COALESCE(ing.unit_price, 0)), 0)
                   FROM combo_ingredients ci
                   JOIN ingredients ing ON ing.id = ci.ingredient_id
                   WHERE ci.combo_id = oi.combo_id AND ci.tenant_id = p_tenant_id AND ci.deleted_at IS NULL
                  ), 0
                )
                +
                COALESCE(
                  (SELECT COALESCE(SUM(
                    (SELECT COALESCE(SUM(convert_unit(ii2.quantity, ii2.unit::text, ing2.unit::text) * COALESCE(ing2.unit_price, 0)), 0)
                     FROM item_ingredients ii2
                     JOIN ingredients ing2 ON ing2.id = ii2.ingredient_id
                     WHERE ii2.item_id = cmi.item_id AND ii2.tenant_id = p_tenant_id
                    ) * cmi.quantity
                  ), 0)
                   FROM combo_items cmi
                   WHERE cmi.combo_id = oi.combo_id AND cmi.tenant_id = p_tenant_id AND cmi.deleted_at IS NULL
                  ), 0
                )
                +
                COALESCE(
                  (SELECT COALESCE(SUM(
                    convert_unit(
                      COALESCE(opt.consumption_quantity, 0),
                      COALESCE(NULLIF(opt.consumption_unit, ''), ing_opt.unit::text),
                      ing_opt.unit::text
                    ) * COALESCE(ing_opt.unit_price, 0)
                  ), 0)
                   FROM order_item_options oio
                   JOIN options opt ON opt.id = oio.option_id
                   JOIN ingredients ing_opt ON ing_opt.id = opt.ingredient_id
                   WHERE oio.order_item_id = oi.id AND oio.tenant_id = p_tenant_id AND opt.ingredient_id IS NOT NULL
                  ), 0
                )
              )
            ) * oi.quantity
          ), 0) AS custo_total,
          CASE 
            WHEN SUM(oi.item_price * oi.quantity) > 0 THEN
              ROUND(
                COALESCE(SUM(
                  COALESCE(
                    oi.unit_cost,
                    (
                      COALESCE(
                        (SELECT COALESCE(SUM(convert_unit(ii.quantity, ii.unit::text, ing.unit::text) * COALESCE(ing.unit_price, 0)), 0)
                         FROM item_ingredients ii
                         JOIN ingredients ing ON ing.id = ii.ingredient_id
                         WHERE ii.item_id = mi.id AND ii.tenant_id = p_tenant_id
                        ), 0
                      )
                      +
                      COALESCE(
                        (SELECT COALESCE(SUM(convert_unit(ci.quantity, ci.unit, ing.unit::text) * COALESCE(ing.unit_price, 0)), 0)
                         FROM combo_ingredients ci
                         JOIN ingredients ing ON ing.id = ci.ingredient_id
                         WHERE ci.combo_id = oi.combo_id AND ci.tenant_id = p_tenant_id AND ci.deleted_at IS NULL
                        ), 0
                      )
                      +
                      COALESCE(
                        (SELECT COALESCE(SUM(
                          (SELECT COALESCE(SUM(convert_unit(ii2.quantity, ii2.unit::text, ing2.unit::text) * COALESCE(ing2.unit_price, 0)), 0)
                           FROM item_ingredients ii2
                           JOIN ingredients ing2 ON ing2.id = ii2.ingredient_id
                           WHERE ii2.item_id = cmi.item_id AND ii2.tenant_id = p_tenant_id
                          ) * cmi.quantity
                        ), 0)
                         FROM combo_items cmi
                         WHERE cmi.combo_id = oi.combo_id AND cmi.tenant_id = p_tenant_id AND cmi.deleted_at IS NULL
                        ), 0
                      )
                      +
                      COALESCE(
                        (SELECT COALESCE(SUM(
                          convert_unit(
                            COALESCE(opt.consumption_quantity, 0),
                            COALESCE(NULLIF(opt.consumption_unit, ''), ing_opt.unit::text),
                            ing_opt.unit::text
                          ) * COALESCE(ing_opt.unit_price, 0)
                        ), 0)
                         FROM order_item_options oio
                         JOIN options opt ON opt.id = oio.option_id
                         JOIN ingredients ing_opt ON ing_opt.id = opt.ingredient_id
                         WHERE oio.order_item_id = oi.id AND oio.tenant_id = p_tenant_id AND opt.ingredient_id IS NOT NULL
                        ), 0
                      )
                    )
                  ) * oi.quantity
                ), 0) / SUM(oi.item_price * oi.quantity) * 100, 2
              )
            ELSE 0
          END AS cmv_pct,
          SUM(oi.item_price * oi.quantity) - COALESCE(SUM(
            COALESCE(
              oi.unit_cost,
              (
                COALESCE(
                  (SELECT COALESCE(SUM(convert_unit(ii.quantity, ii.unit::text, ing.unit::text) * COALESCE(ing.unit_price, 0)), 0)
                   FROM item_ingredients ii
                   JOIN ingredients ing ON ing.id = ii.ingredient_id
                   WHERE ii.item_id = mi.id AND ii.tenant_id = p_tenant_id
                  ), 0
                )
                +
                COALESCE(
                  (SELECT COALESCE(SUM(convert_unit(ci.quantity, ci.unit, ing.unit::text) * COALESCE(ing.unit_price, 0)), 0)
                   FROM combo_ingredients ci
                   JOIN ingredients ing ON ing.id = ci.ingredient_id
                   WHERE ci.combo_id = oi.combo_id AND ci.tenant_id = p_tenant_id AND ci.deleted_at IS NULL
                  ), 0
                )
                +
                COALESCE(
                  (SELECT COALESCE(SUM(
                    (SELECT COALESCE(SUM(convert_unit(ii2.quantity, ii2.unit::text, ing2.unit::text) * COALESCE(ing2.unit_price, 0)), 0)
                     FROM item_ingredients ii2
                     JOIN ingredients ing2 ON ing2.id = ii2.ingredient_id
                     WHERE ii2.item_id = cmi.item_id AND ii2.tenant_id = p_tenant_id
                    ) * cmi.quantity
                  ), 0)
                   FROM combo_items cmi
                   WHERE cmi.combo_id = oi.combo_id AND cmi.tenant_id = p_tenant_id AND cmi.deleted_at IS NULL
                  ), 0
                )
                +
                COALESCE(
                  (SELECT COALESCE(SUM(
                    convert_unit(
                      COALESCE(opt.consumption_quantity, 0),
                      COALESCE(NULLIF(opt.consumption_unit, ''), ing_opt.unit::text),
                      ing_opt.unit::text
                    ) * COALESCE(ing_opt.unit_price, 0)
                  ), 0)
                   FROM order_item_options oio
                   JOIN options opt ON opt.id = oio.option_id
                   JOIN ingredients ing_opt ON ing_opt.id = opt.ingredient_id
                   WHERE oio.order_item_id = oi.id AND oio.tenant_id = p_tenant_id AND opt.ingredient_id IS NOT NULL
                  ), 0
                )
              )
            ) * oi.quantity
          ), 0) AS margem_bruta,
          bool_or(CASE WHEN EXISTS(
            SELECT 1 FROM item_ingredients ii3 WHERE ii3.item_id = mi.id AND ii3.tenant_id = p_tenant_id
          ) OR (
            oi.combo_id IS NOT NULL AND (
              EXISTS(SELECT 1 FROM combo_ingredients ci3 WHERE ci3.combo_id = oi.combo_id AND ci3.tenant_id = p_tenant_id AND ci3.deleted_at IS NULL)
              OR EXISTS(SELECT 1 FROM combo_items cmi2 WHERE cmi2.combo_id = oi.combo_id AND cmi2.tenant_id = p_tenant_id AND cmi2.deleted_at IS NULL)
            )
          ) OR EXISTS(
            SELECT 1 FROM order_item_options oio2
            JOIN options opt2 ON opt2.id = oio2.option_id
            WHERE oio2.order_item_id = oi.id AND oio2.tenant_id = p_tenant_id AND opt2.ingredient_id IS NOT NULL
          ) THEN true ELSE false END) AS tem_ficha_tecnica
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN menu_items mi ON mi.id = oi.item_id
        LEFT JOIN menu_categories mc ON mc.id = mi.category_id
        WHERE o.tenant_id = p_tenant_id
          AND o.created_at BETWEEN p_date_from AND p_date_to
          AND o.is_paid = true AND o.status != 'cancelled'
          AND NOT o.is_training AND NOT o.is_draft
        GROUP BY oi.item_name, mc.name, mi.id
        ORDER BY receita_total DESC
      ) t
    ), '[]'::jsonb),

    'resumo', (
      SELECT jsonb_build_object(
        'receita_total', COALESCE(SUM(o.total_amount), 0),
        'itens_com_ficha', (
          SELECT COUNT(DISTINCT oi2.item_name)
          FROM order_items oi2
          JOIN orders o2 ON o2.id = oi2.order_id
          LEFT JOIN menu_items mi2 ON mi2.id = oi2.item_id
          WHERE o2.tenant_id = p_tenant_id
            AND o2.created_at BETWEEN p_date_from AND p_date_to
            AND o2.is_paid = true AND o2.status != 'cancelled'
            AND NOT o2.is_training AND NOT o2.is_draft
            AND (
              EXISTS(
                SELECT 1 FROM item_ingredients ii3 WHERE ii3.item_id = mi2.id AND ii3.tenant_id = p_tenant_id
              )
              OR (
                oi2.combo_id IS NOT NULL AND (
                  EXISTS(SELECT 1 FROM combo_ingredients ci3 WHERE ci3.combo_id = oi2.combo_id AND ci3.tenant_id = p_tenant_id AND ci3.deleted_at IS NULL)
                  OR EXISTS(SELECT 1 FROM combo_items cmi3 WHERE cmi3.combo_id = oi2.combo_id AND cmi3.tenant_id = p_tenant_id AND cmi3.deleted_at IS NULL)
                )
              )
              OR EXISTS(
                SELECT 1 FROM order_item_options oio3
                JOIN options opt3 ON opt3.id = oio3.option_id
                WHERE oio3.order_item_id = oi2.id AND oio3.tenant_id = p_tenant_id AND opt3.ingredient_id IS NOT NULL
              )
            )
        ),
        'itens_sem_ficha', (
          SELECT COUNT(DISTINCT oi3.item_name)
          FROM order_items oi3
          JOIN orders o3 ON o3.id = oi3.order_id
          LEFT JOIN menu_items mi3 ON mi3.id = oi3.item_id
          WHERE o3.tenant_id = p_tenant_id
            AND o3.created_at BETWEEN p_date_from AND p_date_to
            AND o3.is_paid = true AND o3.status != 'cancelled'
            AND NOT o3.is_training AND NOT o3.is_draft
            AND NOT (
              EXISTS(
                SELECT 1 FROM item_ingredients ii4 WHERE ii4.item_id = mi3.id AND ii4.tenant_id = p_tenant_id
              )
              OR (
                oi3.combo_id IS NOT NULL AND (
                  EXISTS(SELECT 1 FROM combo_ingredients ci4 WHERE ci4.combo_id = oi3.combo_id AND ci4.tenant_id = p_tenant_id AND ci4.deleted_at IS NULL)
                  OR EXISTS(SELECT 1 FROM combo_items cmi4 WHERE cmi4.combo_id = oi3.combo_id AND cmi4.tenant_id = p_tenant_id AND cmi4.deleted_at IS NULL)
                )
              )
              OR EXISTS(
                SELECT 1 FROM order_item_options oio4
                JOIN options opt4 ON opt4.id = oio4.option_id
                WHERE oio4.order_item_id = oi3.id AND oio4.tenant_id = p_tenant_id AND opt4.ingredient_id IS NOT NULL
              )
            )
        ),
        'cobertura_pct', (
          SELECT CASE 
            WHEN COUNT(DISTINCT oi4.item_name) > 0 THEN
              ROUND(
                COUNT(DISTINCT CASE WHEN (
                  EXISTS(
                    SELECT 1 FROM item_ingredients ii5 WHERE ii5.item_id = mi4.id AND ii5.tenant_id = p_tenant_id
                  )
                  OR (
                    oi4.combo_id IS NOT NULL AND (
                      EXISTS(SELECT 1 FROM combo_ingredients ci5 WHERE ci5.combo_id = oi4.combo_id AND ci5.tenant_id = p_tenant_id AND ci5.deleted_at IS NULL)
                      OR EXISTS(SELECT 1 FROM combo_items cmi5 WHERE cmi5.combo_id = oi4.combo_id AND cmi5.tenant_id = p_tenant_id AND cmi5.deleted_at IS NULL)
                    )
                  )
                  OR EXISTS(
                    SELECT 1 FROM order_item_options oio5
                    JOIN options opt5 ON opt5.id = oio5.option_id
                    WHERE oio5.order_item_id = oi4.id AND oio5.tenant_id = p_tenant_id AND opt5.ingredient_id IS NOT NULL
                  )
                ) THEN oi4.item_name END)::numeric 
                / COUNT(DISTINCT oi4.item_name) * 100, 1
              )
            ELSE 0
          END
          FROM order_items oi4
          JOIN orders o4 ON o4.id = oi4.order_id
          LEFT JOIN menu_items mi4 ON mi4.id = oi4.item_id
          WHERE o4.tenant_id = p_tenant_id
            AND o4.created_at BETWEEN p_date_from AND p_date_to
            AND o4.is_paid = true AND o4.status != 'cancelled'
            AND NOT o4.is_training AND NOT o4.is_draft
        )
      )
      FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at BETWEEN p_date_from AND p_date_to
        AND o.is_paid = true AND o.status != 'cancelled'
        AND NOT o.is_training AND NOT o.is_draft
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
