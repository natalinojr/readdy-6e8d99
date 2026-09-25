-- DESFAZER rls_funcoes_checam_loja (2026-09-25): definições originais.

CREATE OR REPLACE FUNCTION public._fn_freelancer_pode(p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select auth.uid() is null or auth_is_member_of(p_tenant);
$function$;

CREATE OR REPLACE FUNCTION public.fn_card_providers(p_tenant uuid)
 RETURNS TABLE(provider text, deposit_account_id uuid, deposit_match text, pix_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.provider, coalesce(p.deposit_account_id, r.bank_account_id), p.deposit_match, p.pix_mode
    from public.fin_card_providers p
    left join public.fin_revenue_settings r on r.tenant_id = p.tenant_id
   where p.tenant_id = p_tenant and p.is_active
  union all
  select r.card_provider, coalesce(r.card_deposit_account_id, r.bank_account_id),
         coalesce(nullif(btrim(r.card_deposit_match), ''), case when r.card_provider = 'stone' then 'stone' end),
         coalesce(r.card_pix_mode, 'transfer')
    from public.fin_revenue_settings r
   where r.tenant_id = p_tenant and r.card_provider in ('stone', 'mercadopago', 'outra')
     and not exists (select 1 from public.fin_card_providers p where p.tenant_id = p_tenant and p.is_active)
$function$;

CREATE OR REPLACE FUNCTION public.fn_check_stock_alert_for_items(p_tenant_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_item_id uuid;
  v_qty_in_cart numeric;
  v_result jsonb := '[]'::jsonb;
  v_consumed_map jsonb := '{}'::jsonb;
  v_ingredient_id text;
  v_ing_name text;
  v_ing_stock numeric;
  v_ing_committed numeric;
  v_ing_available numeric;
  v_ing_unit text;
  v_consumed numeric;
  v_after_stock numeric;
  v_affected_item_name text;
  v_entry jsonb;
  v_ii_unit text;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_item->>'item_id')::uuid;
    v_qty_in_cart := COALESCE((v_item->>'quantity')::numeric, 1);

    FOR v_ingredient_id, v_ing_name, v_ing_stock, v_ing_committed, v_ing_unit, v_ii_unit, v_consumed, v_affected_item_name IN
      SELECT
        ii.ingredient_id::text,
        i.name,
        COALESCE(i.current_stock, 0),
        COALESCE((
          SELECT SUM(
            CASE
              WHEN convert_unit(oi2.quantity::numeric * ii2.quantity::numeric, ii2.unit::text, i.unit::text) IS NOT NULL
              THEN convert_unit(oi2.quantity::numeric * ii2.quantity::numeric, ii2.unit::text, i.unit::text)
              ELSE oi2.quantity::numeric * ii2.quantity::numeric
            END
          )
          FROM order_items oi2
          JOIN orders o2 ON o2.id = oi2.order_id
          JOIN item_ingredients ii2 ON ii2.item_id = oi2.item_id AND ii2.ingredient_id = i.id
          WHERE o2.tenant_id = p_tenant_id
            AND o2.status IN ('new', 'preparing')
            AND o2.is_training IS NOT TRUE
            AND o2.cancelled_at IS NULL
            AND oi2.status NOT IN ('cancelled')
        ), 0),
        i.unit::text,
        ii.unit::text,
        ii.quantity::numeric * v_qty_in_cart,
        mi.name
      FROM item_ingredients ii
      JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id
      JOIN menu_items mi ON mi.id = ii.item_id AND mi.tenant_id = p_tenant_id
      WHERE ii.item_id = v_item_id
        AND COALESCE(i.track_stock, true) IS TRUE
    LOOP
      DECLARE
        v_converted numeric;
      BEGIN
        v_converted := convert_unit(v_consumed, v_ii_unit, v_ing_unit);
        IF v_converted IS NOT NULL THEN
          v_consumed := v_converted;
        END IF;
      END;

      v_ing_available := v_ing_stock - v_ing_committed;

      IF v_consumed_map ? v_ingredient_id THEN
        v_entry := v_consumed_map->v_ingredient_id;
        v_consumed_map := jsonb_set(
          v_consumed_map,
          ARRAY[v_ingredient_id],
          jsonb_build_object(
            'nome', v_ing_name,
            'estoque_atual', v_ing_available,
            'unidade', v_ing_unit,
            'consumo_total', (COALESCE((v_entry->>'consumo_total')::numeric, 0) + v_consumed),
            'itens_afetados', (v_entry->'itens_afetados') || to_jsonb(v_affected_item_name)
          )
        );
      ELSE
        v_consumed_map := jsonb_set(
          v_consumed_map,
          ARRAY[v_ingredient_id],
          jsonb_build_object(
            'nome', v_ing_name,
            'estoque_atual', v_ing_available,
            'unidade', v_ing_unit,
            'consumo_total', v_consumed,
            'itens_afetados', jsonb_build_array(v_affected_item_name)
          )
        );
      END IF;
    END LOOP;
  END LOOP;

  FOR v_ingredient_id IN SELECT jsonb_object_keys(v_consumed_map)
  LOOP
    v_entry := v_consumed_map->v_ingredient_id;
    v_after_stock := (v_entry->>'estoque_atual')::numeric - (v_entry->>'consumo_total')::numeric;

    IF v_after_stock <= 0 THEN
      v_result := v_result || jsonb_build_object(
        'ingredientId', v_ingredient_id,
        'nome', v_entry->>'nome',
        'estoqueAtual', (v_entry->>'estoque_atual')::numeric,
        'unidade', v_entry->>'unidade',
        'consumoTotal', (v_entry->>'consumo_total')::numeric,
        'itensAfetados', v_entry->'itens_afetados'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_audit_log_v3(p_tenant_id uuid, p_limit integer DEFAULT 500, p_data_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone, p_data_fim timestamp with time zone DEFAULT NULL::timestamp with time zone, p_action_type text DEFAULT NULL::text, p_severity text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, tenant_id uuid, user_id uuid, action_type text, entity_type text, entity_id uuid, details jsonb, created_at timestamp with time zone, terminal text, ip_address text, user_name text, user_role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    al.id,
    al.tenant_id,
    al.user_id,
    al.action_type,
    al.entity_type,
    al.entity_id,
    al.details,
    al.created_at,
    al.terminal,
    al.ip_address,
    u.name AS user_name,
    ut.role::TEXT AS user_role
  FROM audit_log al
  LEFT JOIN users u ON u.id = al.user_id
  LEFT JOIN user_tenants ut ON ut.user_id = al.user_id AND ut.tenant_id = p_tenant_id
  WHERE al.tenant_id = p_tenant_id
    AND (p_data_inicio IS NULL OR al.created_at >= p_data_inicio)
    AND (p_data_fim IS NULL OR al.created_at < p_data_fim)
    AND (p_action_type IS NULL OR al.action_type = p_action_type)
    AND (p_severity IS NULL OR al.details->>'severity' = p_severity)
  ORDER BY al.created_at DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_ingredient_consumption_timeline(p_tenant_id uuid, p_ingredient_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start_date date;
  v_result jsonb;
BEGIN
  v_start_date := (CURRENT_DATE - (p_days || ' days')::interval)::date;

  WITH date_series AS (
    SELECT generate_series(v_start_date, CURRENT_DATE, '1 day'::interval)::date AS dia
  ),
  daily_consumption AS (
    SELECT 
      DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
      SUM(ABS(sm.quantity)) AS consumo
    FROM stock_movements sm
    WHERE sm.tenant_id = p_tenant_id
      AND sm.ingredient_id = p_ingredient_id
      AND sm.type IN ('theoretical_out', 'manual_out')
      AND DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo') >= v_start_date
    GROUP BY DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo')
  ),
  daily_stock AS (
    SELECT 
      DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
      SUM(CASE WHEN sm.type = 'in' THEN sm.quantity ELSE -ABS(sm.quantity) END) AS delta
    FROM stock_movements sm
    WHERE sm.tenant_id = p_tenant_id
      AND sm.ingredient_id = p_ingredient_id
      AND DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo') >= v_start_date
    GROUP BY DATE(sm.created_at AT TIME ZONE 'America/Sao_Paulo')
  ),
  current_stock_val AS (
    SELECT current_stock FROM ingredients WHERE id = p_ingredient_id AND tenant_id = p_tenant_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'dia', ds.dia,
      'consumo', COALESCE(dc.consumo, 0),
      'estoque', (
        SELECT current_stock FROM current_stock_val
      ) + COALESCE((
        SELECT SUM(delta) FROM daily_stock ds2 WHERE ds2.dia > ds.dia
      ), 0)
    ) ORDER BY ds.dia
  )
  INTO v_result
  FROM date_series ds
  LEFT JOIN daily_consumption dc ON dc.dia = ds.dia;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_ingredients_consumo(p_tenant_id uuid)
 RETURNS TABLE(id uuid, name text, unit text, category text, supplier text, current_stock numeric, min_stock numeric, unit_price numeric, usage_type text, deleted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.name,
    i.unit,
    i.category,
    i.supplier,
    i.current_stock,
    i.min_stock,
    i.unit_price,
    i.usage_type,
    i.deleted_at
  FROM public.ingredients i
  WHERE i.tenant_id = p_tenant_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_inventory_sessions_range(p_tenant_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'numero', s.numero,
      'operator_name', s.operator_name,
      'created_at', s.created_at,
      'itens_contados', s.itens_contados,
      'itens_com_diferenca', s.itens_com_diferenca,
      'valor_ajuste_liquido', s.valor_ajuste_liquido,
      'items', s.items
    ) ORDER BY s.created_at
  )
  INTO v_result
  FROM inventory_sessions s
  WHERE s.tenant_id = p_tenant_id
    AND s.created_at >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND s.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');

  RETURN jsonb_build_object('success', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_item_ingredients(p_tenant_id uuid, p_item_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        ii.id,
        ii.ingredient_id,
        i.name AS ingredient_name,
        ii.quantity,
        ii.unit::text AS unit,
        i.unit_price,
        i.unit::text AS ingredient_unit
      FROM item_ingredients ii
      JOIN ingredients i ON i.id = ii.ingredient_id
      WHERE ii.tenant_id = p_tenant_id AND ii.item_id = p_item_id
      ORDER BY i.name
    ) t
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_items_sem_estoque(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_bloquear boolean;
  v_reserva boolean;
BEGIN
  SELECT COALESCE(s.bloquear_item_sem_insumo, false), COALESCE(s.bloquear_item_sem_insumo_reserva, false)
    INTO v_bloquear, v_reserva
  FROM system_settings s
  WHERE s.tenant_id = p_tenant_id;

  IF v_bloquear IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH pend AS (
    SELECT oi.id, oi.item_id, oi.quantity::numeric AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.tenant_id = p_tenant_id
    WHERE v_reserva IS TRUE
      AND oi.tenant_id = p_tenant_id
      AND oi.item_id IS NOT NULL
      AND oi.skip_kds IS NOT TRUE
      AND oi.status::text IN ('new', 'preparing')
      AND o.status::text IN ('new', 'preparing')
      AND o.is_draft IS NOT TRUE
      AND o.is_training IS NOT TRUE
      AND o.cancelled_at IS NULL
      AND o.created_at >= now() - interval '12 hours'
  ),
  consumo AS (
    SELECT ii.ingredient_id,
           COALESCE(convert_unit(p.qty * ii.quantity::numeric, ii.unit::text, i.unit::text),
                    p.qty * ii.quantity::numeric) AS q
    FROM pend p
    JOIN item_ingredients ii ON ii.item_id = p.item_id AND ii.tenant_id = p_tenant_id
    JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id
    UNION ALL
    SELECT op.ingredient_id,
           p.qty * CASE
             WHEN NULLIF(trim(op.consumption_unit), '') IS NOT NULL
               THEN COALESCE(convert_unit(COALESCE(op.consumption_quantity, 1), trim(op.consumption_unit), i.unit::text),
                             COALESCE(op.consumption_quantity, 1))
             ELSE COALESCE(op.consumption_quantity, 1)
           END AS q
    FROM pend p
    JOIN (SELECT DISTINCT order_item_id, option_id FROM order_item_options) oio ON oio.order_item_id = p.id
    JOIN options op ON op.id = oio.option_id AND op.tenant_id = p_tenant_id AND op.ingredient_id IS NOT NULL
    JOIN ingredients i ON i.id = op.ingredient_id AND i.tenant_id = p_tenant_id
  ),
  comprometido AS (
    SELECT ingredient_id, SUM(q) AS q FROM consumo GROUP BY ingredient_id
  ),
  faltas AS (
    SELECT mi.id AS item_id,
           mi.name AS item_name,
           i.id AS ingredient_id,
           i.name AS ing_name,
           COALESCE(i.current_stock, 0) - COALESCE(c.q, 0) AS disponivel,
           i.unit::text AS unidade
    FROM item_ingredients ii
    JOIN menu_items mi ON mi.id = ii.item_id AND mi.tenant_id = p_tenant_id AND mi.deleted_at IS NULL
    JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id AND i.deleted_at IS NULL
    LEFT JOIN comprometido c ON c.ingredient_id = i.id
    WHERE ii.tenant_id = p_tenant_id
      AND COALESCE(i.track_stock, true) IS TRUE
      AND (
        COALESCE(i.current_stock, 0) - COALESCE(c.q, 0) <= 0
        OR COALESCE(i.current_stock, 0) - COALESCE(c.q, 0)
           < COALESCE(convert_unit(ii.quantity::numeric, ii.unit::text, i.unit::text), ii.quantity::numeric, 0)
      )
  )
  SELECT jsonb_agg(jsonb_build_object(
           'item_id', f.item_id::text,
           'item_name', f.item_name,
           'insumos_faltando', f.insumos))
  INTO v_result
  FROM (
    SELECT item_id, item_name,
           jsonb_agg(jsonb_build_object('id', ingredient_id::text, 'nome', ing_name,
                                        'estoque', disponivel, 'unidade', unidade)) AS insumos
    FROM faltas
    GROUP BY item_id, item_name
  ) f;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_kitchen_stations(p_tenant_id uuid)
 RETURNS TABLE(id uuid, name text, sla_minutes integer, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ks.id,
    ks.name,
    ks.sla_minutes,
    ks.is_active
  FROM kitchen_stations ks
  WHERE ks.tenant_id = p_tenant_id
    AND ks.is_active = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_opcoes_sem_estoque(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_bloquear boolean;
BEGIN
  SELECT COALESCE(s.bloquear_item_sem_insumo, false) INTO v_bloquear
  FROM system_settings s WHERE s.tenant_id = p_tenant_id;

  IF v_bloquear IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_agg(o.id::text)
  INTO v_result
  FROM options o
  JOIN ingredients i ON i.id = o.ingredient_id
  WHERE o.tenant_id = p_tenant_id
    AND o.ingredient_id IS NOT NULL
    AND o.deleted_at IS NULL
    AND o.is_active = true
    AND i.tenant_id = p_tenant_id
    AND i.deleted_at IS NULL
    AND COALESCE(i.track_stock, true) IS TRUE
    AND COALESCE(i.current_stock, 0) <= 0;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_orders_for_consumo(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone)
 RETURNS TABLE(id uuid, total numeric, status text, number text, origin_type text, destination_name text, table_number integer, paid_by_pdv text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.total,
    o.status,
    o.number,
    o.origin_type,
    o.destination_name,
    o.table_number,
    o.paid_by_pdv,
    o.created_at
  FROM public.orders o
  WHERE o.tenant_id = p_tenant_id
    AND o.created_at >= p_date_from
    AND o.created_at <= p_date_to;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_payment_methods(p_tenant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return (
    select coalesce(json_agg(row_to_json(t) order by t.sort_order), '[]'::json)
    from (
      select id, name, type::text, is_active, fee_percentage, requires_change, sort_order, days_to_receive, fiscal_code
      from payment_methods where tenant_id = p_tenant_id
    ) t
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_station_operators(p_tenant_id uuid)
 RETURNS TABLE(user_id uuid, station_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT so.user_id, so.station_id
  FROM station_operators so
  WHERE so.tenant_id = p_tenant_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_stock_critical_alerts(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_active_session_id uuid;
BEGIN
  -- Busca a sessão ativa atual do tenant
  SELECT id INTO v_active_session_id
  FROM sessions
  WHERE tenant_id = p_tenant_id
    AND status = 'open'
    AND (is_training IS NULL OR is_training = false)
  ORDER BY opened_at DESC
  LIMIT 1;

  WITH 
  -- Pedidos em aberto APENAS da sessão ativa atual
  pedidos_abertos AS (
    SELECT o.id, oi.item_id, oi.quantity
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.tenant_id = p_tenant_id
      AND o.status NOT IN ('cancelled', 'draft', 'delivered')
      AND NOT o.is_training
      AND NOT o.is_draft
      AND oi.item_id IS NOT NULL
      AND (
        CASE
          WHEN v_active_session_id IS NOT NULL THEN o.session_id = v_active_session_id
          ELSE false
        END
      )
  ),
  -- Consumo previsto por ingrediente com conversão de unidades
  consumo_previsto AS (
    SELECT 
      ii.ingredient_id,
      -- Converte a unidade da ficha técnica para a unidade do ingrediente no estoque
      SUM(
        CASE
          -- g -> kg
          WHEN ii.unit::text = 'g' AND i.unit::text = 'kg' THEN (ii.quantity / 1000.0) * pa.quantity
          -- kg -> g
          WHEN ii.unit::text = 'kg' AND i.unit::text = 'g' THEN (ii.quantity * 1000.0) * pa.quantity
          -- ml -> L
          WHEN ii.unit::text = 'ml' AND i.unit::text = 'L' THEN (ii.quantity / 1000.0) * pa.quantity
          -- L -> ml
          WHEN ii.unit::text = 'L' AND i.unit::text = 'ml' THEN (ii.quantity * 1000.0) * pa.quantity
          -- mesma unidade ou unit/unit
          ELSE ii.quantity * pa.quantity
        END
      ) AS total_consumo
    FROM item_ingredients ii
    JOIN pedidos_abertos pa ON pa.item_id = ii.item_id
    JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id
    WHERE ii.tenant_id = p_tenant_id
    GROUP BY ii.ingredient_id
  ),
  -- Ingredientes com projeção
  ingredientes_proj AS (
    SELECT 
      i.id,
      i.name,
      i.unit::text AS unit,
      i.current_stock,
      i.min_stock,
      COALESCE(cp.total_consumo, 0) AS consumo_previsto,
      i.current_stock - COALESCE(cp.total_consumo, 0) AS estoque_projetado,
      CASE 
        WHEN COALESCE(cp.total_consumo, 0) <= 0 THEN 'ok'
        WHEN i.current_stock - COALESCE(cp.total_consumo, 0) <= 0 THEN 'critico'
        WHEN i.current_stock - COALESCE(cp.total_consumo, 0) <= i.min_stock * 0.5 THEN 'critico'
        WHEN i.current_stock - COALESCE(cp.total_consumo, 0) <= i.min_stock THEN 'alerta'
        ELSE 'ok'
      END AS nivel_alerta
    FROM ingredients i
    LEFT JOIN consumo_previsto cp ON cp.ingredient_id = i.id
    WHERE i.tenant_id = p_tenant_id
      AND i.deleted_at IS NULL
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'nome', name,
      'unidade', unit,
      'estoque_atual', current_stock,
      'minimo', min_stock,
      'consumo_previsto', consumo_previsto,
      'estoque_projetado', estoque_projetado,
      'nivel_alerta', nivel_alerta
    ) ORDER BY estoque_projetado ASC
  )
  INTO v_result
  FROM ingredientes_proj
  WHERE nivel_alerta IN ('critico', 'alerta');

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_stock_movements(p_tenant_id uuid, p_limit integer DEFAULT 200)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT sm.id,
             sm.ingredient_id,
             i.name AS ingredient_name,
             COALESCE(sm.unit, i.unit::text) AS ingredient_unit,
             sm.type::text,
             sm.quantity,
             sm.reason,
             sm.notes,
             sm.order_id,
             o.number AS order_number,
             CASE
               WHEN sm.reason LIKE 'item_sale:%' THEN (
                 SELECT oi.item_name
                 FROM order_items oi
                 WHERE oi.order_id = sm.order_id
                   AND oi.item_id = split_part(sm.reason, ':', 2)::uuid
                 LIMIT 1
               )
               WHEN sm.reason LIKE 'combo_sale:%' THEN (
                 SELECT oi.item_name
                 FROM order_items oi
                 WHERE oi.order_id = sm.order_id
                   AND oi.combo_id = split_part(sm.reason, ':', 2)::uuid
                 LIMIT 1
               )
               ELSE NULL
             END AS sold_item_name,
             sm.operator_id,
             u.name AS operator_name,
             sm.created_at
      FROM stock_movements sm
      JOIN ingredients i ON i.id = sm.ingredient_id
      LEFT JOIN users u ON u.id = sm.operator_id
      LEFT JOIN orders o ON o.id = sm.order_id
      WHERE sm.tenant_id = p_tenant_id
      ORDER BY sm.created_at DESC
      LIMIT p_limit
    ) t
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_stock_movements(p_tenant_id uuid, p_limit integer DEFAULT 500, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ingredient_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT sm.id,
             sm.ingredient_id,
             i.name AS ingredient_name,
             COALESCE(sm.unit, i.unit::text) AS ingredient_unit,
             sm.type::text,
             sm.quantity,
             sm.reason,
             sm.notes,
             sm.order_id,
             o.number AS order_number,
             CASE
               WHEN sm.reason LIKE 'item_sale:%' THEN (
                 SELECT oi.item_name
                 FROM order_items oi
                 WHERE oi.order_id = sm.order_id
                   AND oi.item_id = split_part(sm.reason, ':', 2)::uuid
                 LIMIT 1
               )
               WHEN sm.reason LIKE 'combo_sale:%' THEN (
                 SELECT oi.item_name
                 FROM order_items oi
                 WHERE oi.order_id = sm.order_id
                   AND oi.combo_id = split_part(sm.reason, ':', 2)::uuid
                 LIMIT 1
               )
               ELSE NULL
             END AS sold_item_name,
             sm.operator_id,
             u.name AS operator_name,
             sm.created_at
      FROM stock_movements sm
      JOIN ingredients i ON i.id = sm.ingredient_id
      LEFT JOIN users u ON u.id = sm.operator_id
      LEFT JOIN orders o ON o.id = sm.order_id
      WHERE sm.tenant_id = p_tenant_id
        AND (p_ingredient_id IS NULL OR sm.ingredient_id = p_ingredient_id)
        AND (p_date_from IS NULL OR sm.created_at >= p_date_from)
        AND (p_date_to IS NULL OR sm.created_at <= p_date_to)
      ORDER BY sm.created_at DESC
      LIMIT p_limit
    ) t
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_stock_movements_filtered(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_types text[] DEFAULT NULL::text[], p_ingredient_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, ingredient_id uuid, ingredient_name text, type text, quantity numeric, ingredient_unit text, reason text, created_at timestamp with time zone, order_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    sm.id,
    sm.ingredient_id,
    i.name AS ingredient_name,
    sm.type::text,
    sm.quantity,
    COALESCE(sm.unit, i.unit::text) AS ingredient_unit,
    sm.reason,
    sm.created_at,
    sm.order_id
  FROM public.stock_movements sm
  JOIN public.ingredients i ON i.id = sm.ingredient_id
  WHERE sm.tenant_id = p_tenant_id
    AND sm.created_at >= p_date_from
    AND sm.created_at <= p_date_to
    AND (p_types IS NULL OR sm.type::text = ANY(p_types))
    AND (p_ingredient_id IS NULL OR sm.ingredient_id = p_ingredient_id);
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_tables(p_tenant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.number), '[]'::json)
    FROM (
      SELECT tbl.id, tbl.number, tbl.capacity, tbl.area, tbl.is_active, tbl.status,
             tbl.pos_x, tbl.pos_y,
             tbl.qr_token,
             tbl.observation,
             tbl.table_type,
             tbl.is_universal,
             ts.id AS table_session_id,
             ts.opened_at AS session_opened_at,
             ts.status::text AS session_status,
             ts.customer_name,
             (
               SELECT COUNT(*)
               FROM public.orders o
               WHERE o.table_session_id = ts.id AND o.status != 'cancelled'
             ) AS order_count,
             (
               SELECT COALESCE(SUM(o.total_amount), 0)
               FROM public.orders o
               WHERE o.table_session_id = ts.id AND o.status != 'cancelled'
             ) AS total_consumo
      FROM public.tables tbl
      LEFT JOIN public.table_sessions ts ON ts.table_id = tbl.id AND ts.status = 'open'
      WHERE tbl.tenant_id = p_tenant_id AND tbl.is_active = true
    ) t
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_kiosk_heartbeat(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE users
  SET last_access_at = now(),
      kiosk_online = true
  WHERE id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_kiosk_set_offline(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE users
  SET kiosk_online = false
  WHERE id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_list_kiosk_tokens(p_tenant_id uuid)
 RETURNS TABLE(id uuid, token text, label text, is_active boolean, last_used_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT kt.id, kt.token, kt.label, kt.is_active, kt.last_used_at, kt.created_at
  FROM kiosk_tokens kt
  WHERE kt.tenant_id = p_tenant_id
  ORDER BY kt.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_next_tenant_order_number(p_tenant_id uuid)
 RETURNS TABLE(seq integer, number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day        text;
  v_seq        integer;
  v_br         timestamp;
  v_cutoff     time;
  v_cutoff_hr  integer;
  v_cutoff_min integer;
  v_oper_day   date;
BEGIN
  v_br := NOW() AT TIME ZONE 'America/Sao_Paulo';

  v_cutoff := '05:00'::time;
  
  SELECT ss.business_day_cutoff
    INTO v_cutoff
    FROM system_settings ss
   WHERE ss.tenant_id = p_tenant_id
     AND ss.business_day_cutoff IS NOT NULL;

  v_cutoff_hr  := EXTRACT(HOUR   FROM v_cutoff)::integer;
  v_cutoff_min := EXTRACT(MINUTE FROM v_cutoff)::integer;

  IF EXTRACT(HOUR FROM v_br)::integer < v_cutoff_hr
     OR (EXTRACT(HOUR FROM v_br)::integer = v_cutoff_hr
         AND EXTRACT(MINUTE FROM v_br)::integer < v_cutoff_min)
  THEN
    v_oper_day := v_br::date - 1;
  ELSE
    v_oper_day := v_br::date;
  END IF;

  v_day := to_char(v_oper_day, 'DDMMYY');

  INSERT INTO tenant_day_order_seq (tenant_id, day, last_number)
  VALUES (p_tenant_id, v_day, 1)
  ON CONFLICT (tenant_id, day) DO UPDATE
  SET last_number = tenant_day_order_seq.last_number + 1
  RETURNING last_number INTO v_seq;

  RETURN QUERY SELECT
    v_seq,
    ('P' || v_day || LPAD(v_seq::text, 4, '0'))::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_peek_senha(p_tenant_id text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
AS $function$ SELECT COALESCE((SELECT counter FROM senha_counter WHERE tenant_id = p_tenant_id), 200); $function$;

CREATE OR REPLACE FUNCTION public.get_production_price_history(p_tenant_id uuid, p_ingredient_id uuid)
 RETURNS TABLE(recipe_id uuid, recipe_name text, batch_id uuid, produced_at timestamp with time zone, unit_cost numeric, produced_quantity numeric, notes text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Encontra a receita que produz este ingrediente
  WITH recipe AS (
    SELECT pr.id, pr.name
    FROM production_recipes pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.output_ingredient_id = p_ingredient_id
      AND pr.is_active = true
    LIMIT 1
  )
  -- Retorna bateladas dos últimos 6 meses
  SELECT 
    r.id AS recipe_id,
    r.name AS recipe_name,
    pb.id AS batch_id,
    pb.produced_at,
    pb.unit_cost,
    pb.produced_quantity,
    pb.notes
  FROM recipe r
  JOIN production_batches pb ON pb.recipe_id = r.id
  WHERE pb.tenant_id = p_tenant_id
    AND pb.produced_at >= (now() - interval '6 months')
  ORDER BY pb.produced_at ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_tenant_for_user(p_user_id uuid)
 RETURNS TABLE(tenant_id uuid, role text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  SELECT ut.tenant_id, ut.role::text FROM public.user_tenants ut WHERE ut.user_id = p_user_id;
$function$;
