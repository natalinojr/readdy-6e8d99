-- =============================================================================
-- MIGRATION: fn_get_sales_report — separar canal QR universal
-- Data: 2026-06-15
-- Descricao: na aba "Origem dos Pedidos" (by_destination), pedidos de QR code
--   universal (origin_type 'table' sem mesa fisica, table_number 0/null) eram
--   rotulados como "Mesa (QR)" junto com QR de mesa real. Esta versao separa o
--   canal em 'qr_universal' (mesa 0/null) vs 'table' (mesa real > 0). O frontend
--   rotula 'qr_universal' como "QR CODE".
-- Unica parte alterada: o SELECT que monta v_by_destination (nos 2 overloads).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_sales_report(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_total_revenue NUMERIC;
  v_total_orders INT;
  v_avg_ticket NUMERIC;
  v_orders_by_day JSON;
  v_top_items JSON;
  v_by_destination JSON;
  v_by_payment JSON;
BEGIN
  -- Total: usa total_amount do pedido (valor da VENDA)
  SELECT
    COALESCE(SUM(o.total_amount), 0),
    COUNT(*),
    CASE WHEN COUNT(*) > 0
      THEN COALESCE(SUM(o.total_amount), 0) / COUNT(*)
      ELSE 0 END
  INTO v_total_revenue, v_total_orders, v_avg_ticket
  FROM orders o
  WHERE o.tenant_id = p_tenant_id
    AND (
      (p_session_id IS NOT NULL AND o.session_id = p_session_id)
      OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to)
    )
    AND o.is_paid = true AND o.status != 'cancelled'
    AND NOT o.is_training AND NOT o.is_draft;

  -- Por dia
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_orders_by_day
  FROM (
    SELECT (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*) AS orders,
           COALESCE(SUM(o.total_amount), 0) AS revenue
    FROM orders o
    WHERE o.tenant_id = p_tenant_id
      AND (
        (p_session_id IS NOT NULL AND o.session_id = p_session_id)
        OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to)
      )
      AND o.is_paid = true AND o.status != 'cancelled'
      AND NOT o.is_training AND NOT o.is_draft
    GROUP BY 1 ORDER BY 1
  ) t;

  -- Top itens
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_top_items
  FROM (
    SELECT
      oi.item_name,
      COALESCE(
        mc_by_id.name,
        mc_by_name.name,
        'Sem categoria'
      ) AS category_name,
      SUM(oi.quantity) AS total_qty,
      SUM(oi.item_price * oi.quantity) AS total_revenue,
      AVG(oi.item_price) AS avg_price
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN menu_items mi_id ON mi_id.id = oi.item_id
    LEFT JOIN menu_categories mc_by_id ON mc_by_id.id = mi_id.category_id
    LEFT JOIN menu_items mi_name ON mi_name.name = oi.item_name
      AND mi_name.tenant_id = p_tenant_id
      AND mi_id.id IS NULL
    LEFT JOIN menu_categories mc_by_name ON mc_by_name.id = mi_name.category_id
      AND mi_id.id IS NULL
    WHERE o.tenant_id = p_tenant_id
      AND (
        (p_session_id IS NOT NULL AND o.session_id = p_session_id)
        OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to)
      )
      AND o.is_paid = true AND o.status != 'cancelled'
      AND NOT o.is_training AND NOT o.is_draft
    GROUP BY oi.item_name, mc_by_id.name, mc_by_name.name
    ORDER BY total_qty DESC
  ) t;

  -- Por origem (canal): QR universal (mesa 0/null) separado de Mesa real
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_by_destination
  FROM (
    SELECT CASE WHEN o.origin_type::text = 'table' AND COALESCE(o.table_number, 0) = 0
                THEN 'qr_universal'
                ELSE o.origin_type::text END AS destination,
           COUNT(*) AS orders,
           COALESCE(SUM(o.total_amount), 0) AS revenue
    FROM orders o
    WHERE o.tenant_id = p_tenant_id
      AND (
        (p_session_id IS NOT NULL AND o.session_id = p_session_id)
        OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to)
      )
      AND o.is_paid = true AND o.status != 'cancelled'
      AND NOT o.is_training AND NOT o.is_draft
    GROUP BY 1
  ) t;

  -- Por forma de pagamento
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_by_payment
  FROM (
    SELECT
      COALESCE(pm.name, 'Outros') AS payment_method,
      COALESCE(pm.type::text, 'other') AS payment_type,
      SUM(
        CASE
          WHEN pm.type = 'cash' OR pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%espécie%'
          THEN LEAST(p.amount, o.total_amount)
          ELSE p.amount
        END
      ) AS total,
      COUNT(*) AS count
    FROM payments p
    LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
    JOIN orders o ON o.id = p.order_id
    WHERE o.tenant_id = p_tenant_id
      AND (
        (p_session_id IS NOT NULL AND o.session_id = p_session_id)
        OR (p_session_id IS NULL AND p.created_at BETWEEN p_date_from AND p_date_to)
      )
      AND o.is_paid = true AND o.status != 'cancelled'
      AND NOT o.is_training AND NOT o.is_draft
      AND NOT p.is_refunded
    GROUP BY pm.name, pm.type
  ) t;

  RETURN json_build_object(
    'total_revenue', v_total_revenue,
    'total_orders', v_total_orders,
    'avg_ticket', v_avg_ticket,
    'orders_by_day', v_orders_by_day,
    'top_items', v_top_items,
    'by_destination', v_by_destination,
    'by_payment', v_by_payment
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_sales_report(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_total_revenue NUMERIC;
  v_total_orders INT;
  v_avg_ticket NUMERIC;
  v_orders_by_day JSON;
  v_top_items JSON;
  v_by_destination JSON;
  v_by_payment JSON;
BEGIN
  SELECT
    COALESCE(SUM(o.total_amount), 0),
    COUNT(*),
    CASE WHEN COUNT(*) > 0
      THEN COALESCE(SUM(o.total_amount), 0) / COUNT(*)
      ELSE 0 END
  INTO v_total_revenue, v_total_orders, v_avg_ticket
  FROM orders o
  WHERE o.tenant_id = p_tenant_id
    AND o.created_at BETWEEN p_date_from AND p_date_to
    AND o.is_paid = true AND o.status != 'cancelled'
    AND NOT o.is_training AND NOT o.is_draft;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_orders_by_day
  FROM (
    SELECT (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*) AS orders,
           COALESCE(SUM(o.total_amount), 0) AS revenue
    FROM orders o
    WHERE o.tenant_id = p_tenant_id
      AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid = true AND o.status != 'cancelled'
      AND NOT o.is_training AND NOT o.is_draft
    GROUP BY 1 ORDER BY 1
  ) t;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_top_items
  FROM (
    SELECT
      oi.item_name,
      COALESCE(mc_by_id.name, mc_by_name.name, 'Sem categoria') AS category_name,
      SUM(oi.quantity) AS total_qty,
      SUM(oi.item_price * oi.quantity) AS total_revenue,
      AVG(oi.item_price) AS avg_price
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN menu_items mi_id ON mi_id.id = oi.item_id
    LEFT JOIN menu_categories mc_by_id ON mc_by_id.id = mi_id.category_id
    LEFT JOIN menu_items mi_name ON mi_name.name = oi.item_name
      AND mi_name.tenant_id = p_tenant_id
      AND mi_id.id IS NULL
    LEFT JOIN menu_categories mc_by_name ON mc_by_name.id = mi_name.category_id
      AND mi_id.id IS NULL
    WHERE o.tenant_id = p_tenant_id
      AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid = true AND o.status != 'cancelled'
      AND NOT o.is_training AND NOT o.is_draft
    GROUP BY oi.item_name, mc_by_id.name, mc_by_name.name
    ORDER BY total_qty DESC
  ) t;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_by_destination
  FROM (
    SELECT CASE WHEN o.origin_type::text = 'table' AND COALESCE(o.table_number, 0) = 0
                THEN 'qr_universal'
                ELSE o.origin_type::text END AS destination,
           COUNT(*) AS orders,
           COALESCE(SUM(o.total_amount), 0) AS revenue
    FROM orders o
    WHERE o.tenant_id = p_tenant_id
      AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid = true AND o.status != 'cancelled'
      AND NOT o.is_training AND NOT o.is_draft
    GROUP BY 1
  ) t;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_by_payment
  FROM (
    SELECT
      COALESCE(pm.name, 'Outros') AS payment_method,
      COALESCE(pm.type::text, 'other') AS payment_type,
      SUM(
        CASE
          WHEN pm.type = 'cash' OR pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%espécie%'
          THEN LEAST(p.amount, o.total_amount)
          ELSE p.amount
        END
      ) AS total,
      COUNT(*) AS count
    FROM payments p
    LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
    JOIN orders o ON o.id = p.order_id
    WHERE o.tenant_id = p_tenant_id
      AND p.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid = true AND o.status != 'cancelled'
      AND NOT o.is_training AND NOT o.is_draft
      AND NOT p.is_refunded
    GROUP BY pm.name, pm.type
  ) t;

  RETURN json_build_object(
    'total_revenue', v_total_revenue,
    'total_orders', v_total_orders,
    'avg_ticket', v_avg_ticket,
    'orders_by_day', v_orders_by_day,
    'top_items', v_top_items,
    'by_destination', v_by_destination,
    'by_payment', v_by_payment
  );
END;
$function$;
