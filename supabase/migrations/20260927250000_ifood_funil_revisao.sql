-- Funil do iFood — correções da revisão (2026-09-27):
-- * orders.ifood_repasse: só o pedido cujo dinheiro vem pelo REPASSE do iFood (pago no app, ou cobrado pelo entregador
--   do iFood) fica fora das somas de venda. Pedido do iFood cobrado na entrega pela loja (motoboy/balcão) é venda da
--   loja como qualquer outra (a conciliação do iFood exclui "recebido direto pela loja"). Pedido do repasse não tem
--   linha em payments (é marcado pago direto), então DRE/Receitas por pagamento já não o veem.
-- * fn_close_session não cancela o rascunho do iFood (a trava de cancelamento derrubava o fechamento inteiro).
-- * Trava de polling por loja (dois pollings ao mesmo tempo duplicavam itens/tickets).

alter table public.orders add column if not exists ifood_repasse boolean not null default false;
update public.orders set ifood_repasse = is_paid where ifood_order_id is not null and not ifood_repasse;
alter table public.ifood_pdv_config add column if not exists polling_lock_until timestamptz;

CREATE OR REPLACE FUNCTION public.fn_get_sales_report(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_total_revenue NUMERIC; v_total_orders INT; v_avg_ticket NUMERIC;
  v_orders_by_day JSON; v_top_items JSON; v_top_options JSON; v_by_destination JSON; v_by_payment JSON;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(o.total_amount),0), COUNT(*),
    CASE WHEN COUNT(*)>0 THEN COALESCE(SUM(o.total_amount),0)/COUNT(*) ELSE 0 END
  INTO v_total_revenue, v_total_orders, v_avg_ticket
  FROM orders o WHERE o.tenant_id=p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
    AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_orders_by_day FROM (
    SELECT (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue
    FROM orders o WHERE o.tenant_id=p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
    GROUP BY 1 ORDER BY 1) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_top_items FROM (
    SELECT oi.item_name, COALESCE(mc_by_id.name, mc_by_name.name, 'Sem categoria') AS category_name,
      SUM(oi.quantity) AS total_qty,
      SUM((oi.item_price + CASE WHEN o.origin_type::text='delivery' THEN COALESCE(oo.opt_sum,0) ELSE 0 END)*oi.quantity) AS total_revenue,
      CASE WHEN SUM(oi.quantity)>0 THEN SUM((oi.item_price + CASE WHEN o.origin_type::text='delivery' THEN COALESCE(oo.opt_sum,0) ELSE 0 END)*oi.quantity)/SUM(oi.quantity) ELSE 0 END AS avg_price
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    LEFT JOIN (SELECT order_item_id, SUM(additional_price) AS opt_sum FROM order_item_options WHERE tenant_id=p_tenant_id GROUP BY order_item_id) oo ON oo.order_item_id=oi.id
    LEFT JOIN menu_items mi_id ON mi_id.id=oi.item_id
    LEFT JOIN menu_categories mc_by_id ON mc_by_id.id=mi_id.category_id
    LEFT JOIN menu_items mi_name ON mi_name.name=oi.item_name AND mi_name.tenant_id=p_tenant_id AND mi_id.id IS NULL
    LEFT JOIN menu_categories mc_by_name ON mc_by_name.id=mi_name.category_id AND mi_id.id IS NULL
    WHERE o.tenant_id=p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
    GROUP BY oi.item_name, mc_by_id.name, mc_by_name.name ORDER BY total_qty DESC) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_top_options FROM (
    SELECT TRIM(oio.option_name) AS option_name, SUM(oi.quantity) AS total_qty, SUM(oio.additional_price*oi.quantity) AS total_revenue
    FROM order_item_options oio JOIN order_items oi ON oi.id=oio.order_item_id JOIN orders o ON o.id=oi.order_id
    WHERE o.tenant_id=p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
    GROUP BY TRIM(oio.option_name) ORDER BY total_revenue DESC, total_qty DESC) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_by_destination FROM (
    SELECT CASE WHEN o.origin_type::text='table' AND COALESCE(o.table_number,0)=0 THEN 'qr_universal' ELSE o.origin_type::text END AS destination,
      COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue
    FROM orders o WHERE o.tenant_id=p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
    GROUP BY 1) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_by_payment FROM (
    SELECT COALESCE(pm.name,'Outros') AS payment_method, COALESCE(pm.type::text,'other') AS payment_type,
      SUM(CASE WHEN pm.type='cash' OR pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%espécie%' THEN LEAST(p.amount,o.total_amount) ELSE p.amount END) AS total,
      COUNT(*) AS count
    FROM payments p LEFT JOIN payment_methods pm ON pm.id=p.payment_method_id JOIN orders o ON o.id=p.order_id
    WHERE o.tenant_id=p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse AND NOT p.is_refunded
    GROUP BY pm.name, pm.type) t;

  RETURN json_build_object('total_revenue',v_total_revenue,'total_orders',v_total_orders,'avg_ticket',v_avg_ticket,
    'orders_by_day',v_orders_by_day,'top_items',v_top_items,'top_options',v_top_options,'by_destination',v_by_destination,'by_payment',v_by_payment);
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_get_sales_report(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_total_revenue NUMERIC; v_total_orders INT; v_avg_ticket NUMERIC;
  v_orders_by_day JSON; v_top_items JSON; v_top_options JSON; v_by_destination JSON; v_by_payment JSON;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(o.total_amount),0), COUNT(*),
    CASE WHEN COUNT(*)>0 THEN COALESCE(SUM(o.total_amount),0)/COUNT(*) ELSE 0 END
  INTO v_total_revenue, v_total_orders, v_avg_ticket
  FROM orders o WHERE o.tenant_id=p_tenant_id
    AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
    AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_orders_by_day FROM (
    SELECT (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue
    FROM orders o WHERE o.tenant_id=p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
    GROUP BY 1 ORDER BY 1) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_top_items FROM (
    SELECT oi.item_name, COALESCE(mc_by_id.name, mc_by_name.name, 'Sem categoria') AS category_name,
      SUM(oi.quantity) AS total_qty,
      SUM((oi.item_price + CASE WHEN o.origin_type::text='delivery' THEN COALESCE(oo.opt_sum,0) ELSE 0 END)*oi.quantity) AS total_revenue,
      CASE WHEN SUM(oi.quantity)>0 THEN SUM((oi.item_price + CASE WHEN o.origin_type::text='delivery' THEN COALESCE(oo.opt_sum,0) ELSE 0 END)*oi.quantity)/SUM(oi.quantity) ELSE 0 END AS avg_price
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    LEFT JOIN (SELECT order_item_id, SUM(additional_price) AS opt_sum FROM order_item_options WHERE tenant_id=p_tenant_id GROUP BY order_item_id) oo ON oo.order_item_id=oi.id
    LEFT JOIN menu_items mi_id ON mi_id.id=oi.item_id
    LEFT JOIN menu_categories mc_by_id ON mc_by_id.id=mi_id.category_id
    LEFT JOIN menu_items mi_name ON mi_name.name=oi.item_name AND mi_name.tenant_id=p_tenant_id AND mi_id.id IS NULL
    LEFT JOIN menu_categories mc_by_name ON mc_by_name.id=mi_name.category_id AND mi_id.id IS NULL
    WHERE o.tenant_id=p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
    GROUP BY oi.item_name, mc_by_id.name, mc_by_name.name ORDER BY total_qty DESC) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_top_options FROM (
    SELECT TRIM(oio.option_name) AS option_name, SUM(oi.quantity) AS total_qty, SUM(oio.additional_price*oi.quantity) AS total_revenue
    FROM order_item_options oio JOIN order_items oi ON oi.id=oio.order_item_id JOIN orders o ON o.id=oi.order_id
    WHERE o.tenant_id=p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
    GROUP BY TRIM(oio.option_name) ORDER BY total_revenue DESC, total_qty DESC) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_by_destination FROM (
    SELECT CASE WHEN o.origin_type::text='table' AND COALESCE(o.table_number,0)=0 THEN 'qr_universal' ELSE o.origin_type::text END AS destination,
      COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue
    FROM orders o WHERE o.tenant_id=p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
    GROUP BY 1) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_by_payment FROM (
    SELECT COALESCE(pm.name,'Outros') AS payment_method, COALESCE(pm.type::text,'other') AS payment_type,
      SUM(CASE WHEN pm.type='cash' OR pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%espécie%' THEN LEAST(p.amount,o.total_amount) ELSE p.amount END) AS total,
      COUNT(*) AS count
    FROM payments p LEFT JOIN payment_methods pm ON pm.id=p.payment_method_id JOIN orders o ON o.id=p.order_id
    WHERE o.tenant_id=p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse AND NOT p.is_refunded
    GROUP BY pm.name, pm.type) t;

  RETURN json_build_object('total_revenue',v_total_revenue,'total_orders',v_total_orders,'avg_ticket',v_avg_ticket,
    'orders_by_day',v_orders_by_day,'top_items',v_top_items,'top_options',v_top_options,'by_destination',v_by_destination,'by_payment',v_by_payment);
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_get_cash_sessions_v2(p_tenant_id uuid, p_limit integer DEFAULT 30, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session RECORD;
  v_session_data jsonb;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  FOR v_session IN
    SELECT s.id, s.number, s.status, s.opened_at, s.closed_at,
           s.opening_amount, s.closing_amount_declared, s.opened_by
    FROM sessions s
    WHERE s.tenant_id = p_tenant_id
      AND (s.is_training IS NULL OR s.is_training = false)
      AND (
        p_start_date IS NULL OR p_end_date IS NULL OR
        (s.opened_at::date <= p_end_date AND (s.closed_at IS NULL OR s.closed_at::date >= p_start_date))
      )
    ORDER BY s.opened_at DESC
    LIMIT p_limit
  LOOP
    SELECT jsonb_build_object(
      'id', v_session.id,
      'numero', v_session.number,
      'status', v_session.status,
      'opened_at', v_session.opened_at,
      'closed_at', v_session.closed_at,
      'opening_amount', v_session.opening_amount,
      'closing_amount_declared', v_session.closing_amount_declared,
      'operador', (SELECT u.name FROM users u WHERE u.id = v_session.opened_by LIMIT 1),
      'faturamento', COALESCE((
        SELECT SUM(o.total_amount)
        FROM orders o
        WHERE o.session_id = v_session.id
          AND o.status NOT IN ('cancelled', 'draft')
          AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
      ), 0),
      'num_pedidos', COALESCE((
        SELECT COUNT(*) FROM orders o
        WHERE o.session_id = v_session.id
          AND o.status NOT IN ('cancelled', 'draft')
          AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
      ), 0),
      'num_cancelados', COALESCE((
        SELECT COUNT(*) FROM orders o
        WHERE o.session_id = v_session.id AND o.status = 'cancelled' AND NOT o.is_training AND NOT o.ifood_repasse
      ), 0),
      'total_descontos', COALESCE((
        SELECT SUM(od.discount_value) FROM order_discounts od
        JOIN orders o ON od.order_id = o.id
        WHERE o.session_id = v_session.id AND o.status NOT IN ('cancelled', 'draft') AND NOT o.ifood_repasse
      ), 0),
      'ifood', jsonb_build_object(
        'pedidos', COALESCE((SELECT COUNT(*) FROM orders o WHERE o.session_id = v_session.id
                             AND o.status NOT IN ('cancelled', 'draft') AND NOT o.is_training AND NOT o.is_draft
                             AND o.ifood_repasse), 0),
        'total', COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.session_id = v_session.id
                           AND o.status NOT IN ('cancelled', 'draft') AND NOT o.is_training AND NOT o.is_draft
                           AND o.ifood_repasse), 0)
      ),
      'total_troco', COALESCE((
        SELECT SUM(p.change_amount) FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE o.session_id = v_session.id AND o.status NOT IN ('cancelled', 'draft') AND NOT p.is_refunded
      ), 0),
      'cash_register', (
        SELECT jsonb_build_object(
          'id', cr.id,
          'opening_value', cr.opening_value,
          'closing_value_expected', cr.closing_value_expected,
          'closing_value_actual', cr.closing_value_actual,
          'closing_difference', cr.closing_difference,
          'closing_notes', cr.closing_notes,
          'opened_at', cr.opened_at,
          'closed_at', cr.closed_at,
          'status', cr.status
        )
        FROM cash_registers cr
        WHERE cr.session_id = v_session.id AND cr.tenant_id = p_tenant_id
        ORDER BY cr.opened_at DESC
        LIMIT 1
      ),
      'cash_registers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', cr.id,
          'opening_value', cr.opening_value,
          'closing_value_expected', cr.closing_value_expected,
          'closing_value_actual', cr.closing_value_actual,
          'closing_difference', cr.closing_difference,
          'closing_notes', cr.closing_notes,
          'opened_at', cr.opened_at,
          'closed_at', cr.closed_at,
          'status', cr.status,
          'operador', (SELECT u.name FROM users u WHERE u.id = cr.operator_id LIMIT 1),
          'total_retiradas', COALESCE((
            SELECT SUM(cm.amount) FROM cash_movements cm
            WHERE cm.cash_register_id = cr.id AND cm.type = 'out'
          ), 0),
          'total_adicoes', COALESCE((
            SELECT SUM(cm.amount) FROM cash_movements cm
            WHERE cm.cash_register_id = cr.id AND cm.type = 'in'
          ), 0)
        ) ORDER BY cr.opened_at ASC)
        FROM cash_registers cr
        WHERE cr.session_id = v_session.id AND cr.tenant_id = p_tenant_id
      ), '[]'::jsonb),
      'movimentos', jsonb_build_object(
        'retiradas', COALESCE((
          SELECT COUNT(*) FROM cash_movements cm
          JOIN cash_registers cr ON cm.cash_register_id = cr.id
          WHERE cr.session_id = v_session.id AND cm.type = 'out'
        ), 0),
        'adicoes', COALESCE((
          SELECT COUNT(*) FROM cash_movements cm
          JOIN cash_registers cr ON cm.cash_register_id = cr.id
          WHERE cr.session_id = v_session.id AND cm.type = 'in'
        ), 0),
        'total_retiradas', COALESCE((
          SELECT SUM(cm.amount) FROM cash_movements cm
          JOIN cash_registers cr ON cm.cash_register_id = cr.id
          WHERE cr.session_id = v_session.id AND cm.type = 'out'
        ), 0),
        'total_adicoes', COALESCE((
          SELECT SUM(cm.amount) FROM cash_movements cm
          JOIN cash_registers cr ON cm.cash_register_id = cr.id
          WHERE cr.session_id = v_session.id AND cm.type = 'in'
        ), 0),
        'lista', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'tipo', cm.type,
            'valor', cm.amount,
            'motivo', cm.reason,
            'hora', cm.created_at
          ) ORDER BY cm.created_at DESC)
          FROM cash_movements cm
          JOIN cash_registers cr ON cm.cash_register_id = cr.id
          WHERE cr.session_id = v_session.id
        ), '[]'::jsonb)
      ),
      'por_forma_pagamento', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'forma', COALESCE(pm.name, 'Outros'),
          'tipo', COALESCE(pm.type::text, 'other'),
          'total', sub_pf.total_val,
          'count', sub_pf.cnt
        ))
        FROM (
          SELECT p.payment_method_id,
            SUM(p.amount) as total_val,
            COUNT(*) as cnt
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE o.session_id = v_session.id
            AND o.status NOT IN ('cancelled', 'draft')
            AND NOT p.is_refunded
          GROUP BY p.payment_method_id
        ) sub_pf
        LEFT JOIN payment_methods pm ON pm.id = sub_pf.payment_method_id
      ), '[]'::jsonb),
      'por_origem', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'origem', sub_or.canal,
          'pedidos', sub_or.cnt,
          'total', sub_or.total_val
        ))
        FROM (
          SELECT CASE WHEN o.origin_type::text = 'table' AND COALESCE(o.table_number, 0) = 0
                      THEN 'qr_universal'
                      ELSE o.origin_type::text END as canal,
                 COUNT(*) as cnt,
                 COALESCE(SUM(o.total_amount), 0) as total_val
          FROM orders o
          WHERE o.session_id = v_session.id
            AND o.status NOT IN ('cancelled', 'draft')
            AND NOT o.is_training AND NOT o.ifood_repasse
          GROUP BY 1
        ) sub_or
      ), '[]'::jsonb),
      'cash_transactions', COALESCE((
        SELECT jsonb_agg(t ORDER BY (t->>'hora') DESC)
        FROM (
          SELECT jsonb_build_object(
            'id', MIN(p.id::text),
            'hora', MAX(p.created_at),
            'valor_venda', SUM(p.amount),
            'troco', SUM(COALESCE(p.change_amount, 0)),
            'valor_pago', SUM(p.amount) + SUM(COALESCE(p.change_amount, 0)),
            'operador', MAX(COALESCE(p.operator_name, (SELECT u.name FROM users u WHERE u.id = o.origin_user_id LIMIT 1))),
            'numero_pedido', string_agg(DISTINCT o.number, ', '),
            'origem', MAX(o.origin_type::text),
            'is_refunded', bool_or(p.is_refunded),
            'cash_register_id', MAX(p.cash_register_id::text),
            'payment_group_id', p.payment_group_id,
            'is_agrupado', COUNT(DISTINCT o.id) > 1,
            'total_transacoes', COUNT(DISTINCT o.id)
          ) AS t
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
          WHERE o.session_id = v_session.id
            AND o.status NOT IN ('cancelled', 'draft')
            AND NOT o.is_training
            AND (pm.type = 'cash' OR pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%esp%cie%' OR p.payment_method_id IS NULL)
          GROUP BY COALESCE(p.payment_group_id::text, p.id::text), p.payment_group_id
        ) grouped
      ), '[]'::jsonb)
    ) INTO v_session_data;

    RETURN NEXT v_session_data;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_close_session(p_session_id uuid, p_closed_by uuid, p_closing_amount numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_mesas_abertas integer;
  v_itens_cozinha integer;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM sessions WHERE id = p_session_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Sessão não encontrada.';
  END IF;

  -- [golive 2026-09-17] só membro da loja (ou service_role/DB admin) executa
  IF coalesce(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.auth_is_member_of(v_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  IF NOT p_force THEN
    SELECT COUNT(*) INTO v_mesas_abertas
    FROM table_sessions ts
    JOIN tables t ON t.id = ts.table_id
    WHERE ts.session_id = p_session_id AND ts.status = 'open';
    IF v_mesas_abertas > 0 THEN
      RAISE EXCEPTION 'Não é possível fechar a sessão: % mesa(s) ainda aberta(s). Feche todas as mesas primeiro.', v_mesas_abertas;
    END IF;

    SELECT COUNT(*) INTO v_itens_cozinha
    FROM order_item_units ou
    JOIN order_items oi ON oi.id = ou.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.session_id = p_session_id
      AND o.status NOT IN ('cancelled', 'delivered', 'draft')
      AND o.is_draft = false
      AND ou.status IN ('new', 'preparing', 'ready')
      AND oi.skip_kds = false;
    IF v_itens_cozinha > 0 THEN
      RAISE EXCEPTION 'Não é possível fechar a sessão: % item(s) ainda pendente(s) na cozinha. Aguarde a finalização.', v_itens_cozinha;
    END IF;

    PERFORM 1
    FROM orders
    WHERE session_id = p_session_id
      AND is_draft = false
      AND is_paid = false
      AND status NOT IN ('delivered', 'cancelled', 'draft')
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Não é possível fechar a sessão: existem pedidos em aberto (não pagos e não entregues/cancelados).';
    END IF;

    -- Pedido do tablet segurado que já recebeu dinheiro (pago ou parcial) não some no
    -- fechamento: o caixa termina de receber / manda pra cozinha antes de fechar.
    PERFORM 1
    FROM orders o
    WHERE o.session_id = p_session_id
      AND o.origin_type = 'self_service'
      AND o.status = 'draft'
      AND o.is_draft = true
      AND EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id = o.id AND pay.is_refunded = false)
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Não é possível fechar a sessão: há pedido do tablet com pagamento recebido que ainda não foi pra cozinha. Veja "Tablet — aguardando pagamento" no PDV.';
    END IF;
  END IF;

  UPDATE orders
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'Pix pelo app não pago até o fechamento do caixa'
   WHERE session_id = p_session_id
     AND origin_type = 'delivery'
     AND status = 'draft'
     AND is_draft = true
     AND ifood_order_id IS NULL;  -- pedido do iFood aguardando aceite fica (o aceite leva p/ o caixa aberto)

  UPDATE orders
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'Pedido do tablet não pago no caixa até o fechamento'
   WHERE session_id = p_session_id
     AND origin_type = 'self_service'
     AND status = 'draft'
     AND is_draft = true
     AND is_paid = false
     AND NOT EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id = orders.id AND pay.is_refunded = false);

  UPDATE sessions
     SET status = 'closed',
         closed_by = p_closed_by,
         closed_at = NOW(),
         closing_amount_declared = p_closing_amount,
         closing_notes = p_notes
   WHERE id = p_session_id;
END;
$function$;
