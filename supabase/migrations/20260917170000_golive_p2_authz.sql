-- Go-live Paranaguá (2026-09-17) — P2 autorização em RPCs SECURITY DEFINER.
-- Corpos copiados de pg_get_functiondef (produção, 2026-09-17); só o bloco de autorização é novo.
-- CREATE OR REPLACE preserva owner e GRANTs existentes.
--
-- "Confiável" = auth.role()='service_role' (Edges com client admin) OU session_user postgres/supabase_admin
-- (pg_cron, CLI, SQL editor). NÃO usar current_user: dentro de SECURITY DEFINER ele é sempre o owner (postgres).
-- Via PostgREST o session_user é 'authenticator', então anon/authenticated caem na checagem de membership.
-- auth_is_member_of cobre: dono (trigger on_tenant_created_platform_owner cria user_tenants em toda loja nova;
-- 0 lojas sem vínculo em 09-17), usuário tablet do totem (kiosk-auth faz upsert em user_tenants) e operadores.
-- Wrappers fn_get_kds_orders(uuid) e fn_get_cash_sessions_v2(uuid,int) delegam para a versão completa (checada lá).

BEGIN;

-- 1) enqueue_print_ticket
CREATE OR REPLACE FUNCTION public.enqueue_print_ticket(p_tenant_id uuid, p_order_id uuid, p_order_number text, p_station_key text, p_station_label text, p_content_type text DEFAULT 'ticket_json'::text, p_payload jsonb DEFAULT '{}'::jsonb, p_paper_style text DEFAULT '80mm'::text, p_force boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  -- Executável por anon (mesa-qr): o pedido tem que ser da loja informada.
  IF p_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM orders WHERE id = p_order_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Pedido não pertence à loja informada.' USING ERRCODE = '42501';
  END IF;

  -- Sem pedido (reimpressão avulsa/teste) não há o que amarrar à loja: exige membro da loja
  -- ou chamada confiável. Anon (auth.uid() nulo) nunca passa daqui sem p_order_id.
  IF p_order_id IS NULL AND NOT (
    auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin')
    OR (auth.uid() IS NOT NULL AND public.auth_is_member_of(p_tenant_id))
  ) THEN
    RAISE EXCEPTION 'Impressão sem pedido exige acesso à loja.' USING ERRCODE = '42501';
  END IF;

  IF NOT p_force AND p_order_id IS NOT NULL THEN
    -- Serializa o dedup (SELECT-then-INSERT) por loja+pedido+estação.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('enqueue_print_ticket:' || p_tenant_id::text || ':' || p_order_id::text || ':' || coalesce(p_station_key, ''), 0)
    );

    SELECT id INTO v_id
    FROM print_queue
    WHERE tenant_id = p_tenant_id
      AND order_id = p_order_id
      AND station_key = p_station_key
      AND (
        status IN ('pending', 'printing')
        OR (status = 'printed' AND created_at > now() - interval '2 minutes')
      )
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO print_queue (
    tenant_id, order_id, order_number,
    station_key, station_label,
    content_type, payload, paper_style,
    status, retry_count, max_retries
  ) VALUES (
    p_tenant_id, p_order_id, p_order_number,
    p_station_key, p_station_label,
    p_content_type, p_payload, p_paper_style,
    'pending', 0, 5
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- 2) leitores por p_tenant_id
-- fn_get_active_session(p_tenant_id uuid)
CREATE OR REPLACE FUNCTION public.fn_get_active_session(p_tenant_id uuid)
 RETURNS TABLE(id uuid, number text, opened_by uuid, opened_at timestamp with time zone, opening_amount numeric, last_order_number integer, is_training boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.number, s.opened_by, s.opened_at,
         s.opening_amount, s.last_order_number, s.is_training
  FROM sessions s
  WHERE s.tenant_id = p_tenant_id AND s.status = 'open'
  ORDER BY s.opened_at DESC
  LIMIT 1;
END;
$function$;

-- fn_get_cancelamentos_report(p_tenant_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
CREATE OR REPLACE FUNCTION public.fn_get_cancelamentos_report(p_tenant_id uuid, p_start timestamp with time zone DEFAULT (now() - '30 days'::interval), p_end timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cancelamentos jsonb;
  v_estornos jsonb;
  v_descontos jsonb;
  v_gorjetas jsonb;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  -- Cancelamentos
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'pedido', '#' || LPAD(o.number::text, 4, '0'),
      'mesa', COALESCE(o.destination_name, '—'),
      'motivo', COALESCE(o.cancel_reason, 'Não informado'),
      'valor', o.total_amount,
      'hora', TO_CHAR(o.cancelled_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
      'data', o.cancelled_at,
      'origem', o.origin_type::text
    )
    ORDER BY o.cancelled_at DESC
  )
  INTO v_cancelamentos
  FROM orders o
  WHERE o.tenant_id = p_tenant_id
    AND o.status = 'cancelled'
    AND o.cancelled_at BETWEEN p_start AND p_end
    AND o.is_training = false;

  -- Estornos
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'pedido', '#' || LPAD(o.number::text, 4, '0'),
      'cliente', COALESCE(o.destination_name, 'Consumidor'),
      'motivo', COALESCE(p.refund_reason, 'Não informado'),
      'valor', p.amount,
      'hora', TO_CHAR(p.refunded_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
      'data', p.refunded_at
    )
    ORDER BY p.refunded_at DESC
  )
  INTO v_estornos
  FROM payments p
  JOIN orders o ON o.id = p.order_id
  WHERE p.tenant_id = p_tenant_id
    AND p.is_refunded = true
    AND p.refunded_at BETWEEN p_start AND p_end;

  -- Descontos
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'pedido', '#' || LPAD(o.number::text, 4, '0'),
      'mesa', COALESCE(o.destination_name, '—'),
      'valor', o.discount_amount,
      'pct', CASE WHEN o.subtotal > 0
        THEN ROUND((o.discount_amount / o.subtotal) * 100, 1)
        ELSE 0 END,
      'hora', TO_CHAR(o.created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
      'data', o.created_at,
      'origem', o.origin_type::text
    )
    ORDER BY o.created_at DESC
  )
  INTO v_descontos
  FROM orders o
  WHERE o.tenant_id = p_tenant_id
    AND o.discount_amount > 0
    AND o.status != 'cancelled'
    AND o.created_at BETWEEN p_start AND p_end
    AND o.is_training = false;

  -- Gorjetas por usuário (origin_user)
  SELECT jsonb_agg(
    jsonb_build_object(
      'garcom', COALESCE(u.name, 'Desconhecido'),
      'pedidos', COUNT(o.id),
      'totalGorjeta', SUM(o.tip_amount),
      'mediaGorjeta', CASE WHEN COUNT(o.id) > 0 THEN ROUND(SUM(o.tip_amount) / COUNT(o.id), 2) ELSE 0 END,
      'pctPedidosGorjeta', ROUND(
        (COUNT(CASE WHEN o.tip_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(o.id), 0)) * 100, 0
      )
    )
    ORDER BY SUM(o.tip_amount) DESC
  )
  INTO v_gorjetas
  FROM orders o
  LEFT JOIN users u ON u.id = o.origin_user_id
  WHERE o.tenant_id = p_tenant_id
    AND o.tip_amount > 0
    AND o.created_at BETWEEN p_start AND p_end
    AND o.is_training = false
  GROUP BY o.origin_user_id, u.name;

  RETURN jsonb_build_object(
    'cancelamentos', COALESCE(v_cancelamentos, '[]'::jsonb),
    'estornos', COALESCE(v_estornos, '[]'::jsonb),
    'descontos', COALESCE(v_descontos, '[]'::jsonb),
    'gorjetas', COALESCE(v_gorjetas, '[]'::jsonb)
  );
END;
$function$;

-- fn_get_cash_sessions_v2(p_tenant_id uuid, p_limit integer, p_start_date date, p_end_date date)
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
          AND NOT o.is_training AND NOT o.is_draft
      ), 0),
      'num_pedidos', COALESCE((
        SELECT COUNT(*) FROM orders o
        WHERE o.session_id = v_session.id
          AND o.status NOT IN ('cancelled', 'draft')
          AND NOT o.is_training AND NOT o.is_draft
      ), 0),
      'num_cancelados', COALESCE((
        SELECT COUNT(*) FROM orders o
        WHERE o.session_id = v_session.id AND o.status = 'cancelled' AND NOT o.is_training
      ), 0),
      'total_descontos', COALESCE((
        SELECT SUM(od.discount_value) FROM order_discounts od
        JOIN orders o ON od.order_id = o.id
        WHERE o.session_id = v_session.id AND o.status NOT IN ('cancelled', 'draft')
      ), 0),
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
            AND NOT o.is_training
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

-- fn_get_clientes_report(p_tenant_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
CREATE OR REPLACE FUNCTION public.fn_get_clientes_report(p_tenant_id uuid, p_start timestamp with time zone DEFAULT (now() - '30 days'::interval), p_end timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_top jsonb;
  v_risco jsonb;
  v_evolucao jsonb;
  v_kpis jsonb;
  v_total_unicos bigint;
  v_novos bigint;
  v_retornantes bigint;
  v_freq_media numeric;
  v_ticket_medio numeric;
  v_sem_visita_30 bigint;
  v_sem_visita_60 bigint;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT
    COUNT(DISTINCT c.id),
    COUNT(DISTINCT CASE WHEN c.first_visit_at >= p_start THEN c.id END),
    COUNT(DISTINCT CASE WHEN c.first_visit_at < p_start AND c.last_visit_at >= p_start THEN c.id END),
    ROUND(AVG(c.visit_count), 1),
    CASE WHEN SUM(c.visit_count) > 0 THEN ROUND(SUM(c.total_spent) / SUM(c.visit_count), 2) ELSE 0 END,
    COUNT(DISTINCT CASE WHEN c.last_visit_at < NOW() - INTERVAL '30 days' THEN c.id END),
    COUNT(DISTINCT CASE WHEN c.last_visit_at < NOW() - INTERVAL '60 days' THEN c.id END)
  INTO v_total_unicos, v_novos, v_retornantes, v_freq_media, v_ticket_medio, v_sem_visita_30, v_sem_visita_60
  FROM customers c
  WHERE c.tenant_id = p_tenant_id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'pos', ROW_NUMBER() OVER (ORDER BY c.total_spent DESC),
      'nome', c.name,
      'visitas', c.visit_count,
      'ultimaVisita', c.last_visit_at::date,
      'totalGasto', c.total_spent,
      'ticketMedio', CASE WHEN COALESCE(c.visit_count, 0) > 0 THEN ROUND(c.total_spent / c.visit_count, 2) ELSE 0 END,
      'tipo', 'pessoa'
    )
  )
  INTO v_top
  FROM (SELECT * FROM customers WHERE tenant_id = p_tenant_id AND total_spent > 0 ORDER BY total_spent DESC LIMIT 10) c;

  SELECT jsonb_agg(
    jsonb_build_object(
      'nome', c.name,
      'diasSemVisita', EXTRACT(DAY FROM NOW() - c.last_visit_at)::int,
      'ultimaVisita', TO_CHAR(c.last_visit_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'),
      'visitas', c.visit_count,
      'totalHistorico', c.total_spent
    )
    ORDER BY c.last_visit_at ASC
  )
  INTO v_risco
  FROM customers c
  WHERE c.tenant_id = p_tenant_id
    AND c.last_visit_at < NOW() - INTERVAL '30 days'
  LIMIT 15;

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'totalUnicos', COALESCE(v_total_unicos, 0),
      'novos', COALESCE(v_novos, 0),
      'retornantes', COALESCE(v_retornantes, 0),
      'frequenciaMedia', COALESCE(v_freq_media, 0),
      'ticketMedioGeral', COALESCE(v_ticket_medio, 0),
      'clientesSemVisita30', COALESCE(v_sem_visita_30, 0),
      'clientesSemVisita60', COALESCE(v_sem_visita_60, 0)
    ),
    'topClientes', COALESCE(v_top, '[]'::jsonb),
    'clientesRisco', COALESCE(v_risco, '[]'::jsonb)
  );
END;
$function$;

-- fn_get_customer_orders(p_tenant_id uuid, p_customer_id uuid)
CREATE OR REPLACE FUNCTION public.fn_get_customer_orders(p_tenant_id uuid, p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'data', o.created_at,
      'valor', o.total_amount,
      'mesa', o.destination_name,
      'origem', o.origin_type,
      'status', o.status,
      'itens', (
        SELECT jsonb_agg(oi.item_name || CASE WHEN oi.quantity > 1 THEN ' x' || oi.quantity ELSE '' END)
        FROM order_items oi
        WHERE oi.order_id = o.id
      )
    )
    ORDER BY o.created_at DESC
  )
  INTO v_result
  FROM orders o
  WHERE o.tenant_id = p_tenant_id
    AND o.customer_id = p_customer_id
    AND o.status != 'cancelled'
    AND o.is_training = false
  LIMIT 20;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- fn_get_customers_list(p_tenant_id uuid)
CREATE OR REPLACE FUNCTION public.fn_get_customers_list(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'nome', c.name,
      'celular', c.phone,
      'email', c.email,
      'cpf', c.cpf,
      'dataNascimento', c.birth_date,
      'genero', c.gender,
      'notes', c.notes,
      'manualTags', COALESCE(to_jsonb(c.manual_tags), '[]'::jsonb),
      'aceitaMarketing', COALESCE(c.accepts_marketing, false),
      'ultimoContato', c.last_contacted_at,
      'primeiraVisita', c.first_visit_at,
      'ultimaVisita', c.last_visit_at,
      'totalVisitas', COALESCE(c.visit_count, 0),
      'valorTotal', COALESCE(c.total_spent, 0),
      'ticketMedio', CASE WHEN COALESCE(c.visit_count, 0) > 0
        THEN ROUND(COALESCE(c.total_spent, 0) / c.visit_count, 2)
        ELSE 0 END,
      'itensFavoritos', COALESCE((
        SELECT jsonb_agg(t.item_name ORDER BY t.qtd DESC)
        FROM (
          SELECT oi.item_name, SUM(oi.quantity) AS qtd
          FROM orders o2
          JOIN order_items oi ON oi.order_id = o2.id
          WHERE o2.tenant_id = c.tenant_id
            AND o2.customer_id = c.id
            AND o2.status <> 'cancelled'
            AND o2.is_training = false
          GROUP BY oi.item_name
          ORDER BY qtd DESC
          LIMIT 3
        ) t
      ), '[]'::jsonb)
    )
    ORDER BY c.last_visit_at DESC NULLS LAST
  )
  INTO v_result
  FROM customers c
  WHERE c.tenant_id = p_tenant_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- fn_get_dashboard_metrics(p_tenant_id uuid)
CREATE OR REPLACE FUNCTION public.fn_get_dashboard_metrics(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tz text := 'America/Sao_Paulo';
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_yesterday_start timestamptz;
  v_active_session_id uuid;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  v_today_start := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_today_end := v_today_start + interval '1 day';
  v_yesterday_start := v_today_start - interval '1 day';

  -- Busca a sessão ativa atual (se houver)
  SELECT id INTO v_active_session_id
  FROM sessions
  WHERE tenant_id = p_tenant_id
    AND status = 'open'
    AND (is_training IS NULL OR is_training = false)
  ORDER BY opened_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    -- Faturamento REALIZADO: pedidos pagos e não cancelados
    'faturamento_hoje', COALESCE((
      SELECT SUM(o.total_amount)
      FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_today_start AND o.created_at < v_today_end
        AND o.is_paid = true AND o.status != 'cancelled'
        AND NOT o.is_training AND NOT o.is_draft
    ), 0),
    'faturamento_ontem', COALESCE((
      SELECT SUM(o.total_amount)
      FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_yesterday_start AND o.created_at < v_today_start
        AND o.is_paid = true AND o.status != 'cancelled'
        AND NOT o.is_training AND NOT o.is_draft
    ), 0),
    -- Pedidos pagos hoje
    'pedidos_hoje', COALESCE((
      SELECT COUNT(*) FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_today_start AND o.created_at < v_today_end
        AND o.is_paid = true AND o.status != 'cancelled'
        AND NOT o.is_training AND NOT o.is_draft
    ), 0),
    'pedidos_ontem', COALESCE((
      SELECT COUNT(*) FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_yesterday_start AND o.created_at < v_today_start
        AND o.is_paid = true AND o.status != 'cancelled'
        AND NOT o.is_training AND NOT o.is_draft
    ), 0),
    -- Pedidos EM ANDAMENTO hoje (não pagos, não cancelados, não rascunhos)
    'pedidos_andamento_hoje', COALESCE((
      SELECT COUNT(*) FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_today_start AND o.created_at < v_today_end
        AND o.status IN ('new', 'preparing', 'ready')
        AND NOT o.is_training AND NOT o.is_draft
    ), 0),
    -- Faturamento em andamento
    'faturamento_andamento_hoje', COALESCE((
      SELECT SUM(o.total_amount)
      FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_today_start AND o.created_at < v_today_end
        AND o.status IN ('new', 'preparing', 'ready')
        AND NOT o.is_training AND NOT o.is_draft
    ), 0),
    -- NOVO: pedidos abertos (não pagos, não cancelados, não rascunhos)
    'pedidos_abertos_valor', COALESCE((
      SELECT SUM(o.total_amount)
      FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_today_start AND o.created_at < v_today_end
        AND o.is_paid = false AND o.status NOT IN ('cancelled', 'draft')
        AND NOT o.is_training AND NOT o.is_draft
    ), 0),
    'pedidos_abertos_count', COALESCE((
      SELECT COUNT(*) FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_today_start AND o.created_at < v_today_end
        AND o.is_paid = false AND o.status NOT IN ('cancelled', 'draft')
        AND NOT o.is_training AND NOT o.is_draft
    ), 0),
    -- Ticket médio dos pagos hoje
    'ticket_medio', COALESCE((
      SELECT AVG(o.total_amount)
      FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_today_start AND o.created_at < v_today_end
        AND o.is_paid = true AND o.status != 'cancelled'
        AND NOT o.is_training AND NOT o.is_draft
        AND o.total_amount > 0
    ), 0),
    'ticket_medio_ontem', COALESCE((
      SELECT AVG(o.total_amount)
      FROM orders o
      WHERE o.tenant_id = p_tenant_id
        AND o.created_at >= v_yesterday_start AND o.created_at < v_today_start
        AND o.is_paid = true AND o.status != 'cancelled'
        AND NOT o.is_training AND NOT o.is_draft
        AND o.total_amount > 0
    ), 0),
    'mesas_ocupadas', COALESCE((SELECT COUNT(*) FROM tables WHERE tenant_id = p_tenant_id AND status = 'occupied'), 0),
    'mesas_total', COALESCE((SELECT COUNT(*) FROM tables WHERE tenant_id = p_tenant_id AND is_active = true), 0),
    -- Pedidos em tempo real
    'pedidos_new', COALESCE((
      SELECT COUNT(*) FROM orders
      WHERE tenant_id = p_tenant_id
        AND status = 'new'
        AND NOT is_training AND NOT is_draft
        AND (
          CASE
            WHEN v_active_session_id IS NOT NULL THEN session_id = v_active_session_id
            ELSE created_at >= v_today_start AND created_at < v_today_end
          END
        )
    ), 0),
    'pedidos_preparing', COALESCE((
      SELECT COUNT(*) FROM orders
      WHERE tenant_id = p_tenant_id
        AND status = 'preparing'
        AND NOT is_training AND NOT is_draft
        AND (
          CASE
            WHEN v_active_session_id IS NOT NULL THEN session_id = v_active_session_id
            ELSE created_at >= v_today_start AND created_at < v_today_end
          END
        )
    ), 0),
    'pedidos_ready', COALESCE((
      SELECT COUNT(*) FROM orders
      WHERE tenant_id = p_tenant_id
        AND status = 'ready'
        AND NOT is_training AND NOT is_draft
        AND (
          CASE
            WHEN v_active_session_id IS NOT NULL THEN session_id = v_active_session_id
            ELSE created_at >= v_today_start AND created_at < v_today_end
          END
        )
    ), 0),
    'pedidos_delivered_today', COALESCE((
      SELECT COUNT(*) FROM orders
      WHERE tenant_id = p_tenant_id AND is_paid = true AND status != 'cancelled'
        AND created_at >= v_today_start AND NOT is_training AND NOT is_draft
    ), 0),
    -- Vendas por hora: pedidos pagos
    'vendas_por_hora', COALESCE((
      SELECT jsonb_agg(h ORDER BY (h->>'hora'))
      FROM (
        SELECT jsonb_build_object(
          'hora', TO_CHAR(date_trunc('hour', o.created_at AT TIME ZONE v_tz), 'HH24:MI'),
          'valor', ROUND(SUM(o.total_amount)::numeric, 2)
        ) as h
        FROM orders o
        WHERE o.tenant_id = p_tenant_id
          AND o.created_at >= v_today_start AND o.created_at < v_today_end
          AND o.is_paid = true AND o.status != 'cancelled'
          AND NOT o.is_training AND NOT o.is_draft
        GROUP BY date_trunc('hour', o.created_at AT TIME ZONE v_tz)
      ) sub
    ), '[]'::jsonb),
    -- Últimos pedidos: TODOS do dia
    'ultimos_pedidos', COALESCE((
      SELECT jsonb_agg(r ORDER BY (r->>'created_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', o.id, 'numero', o.number, 'status', o.status,
          'total', o.total_amount, 'created_at', o.created_at,
          'origin', o.origin_type, 'destination', o.destination_type,
          'destination_name', o.destination_name,
          'is_paid', EXISTS(SELECT 1 FROM payments p2 WHERE p2.order_id = o.id AND NOT p2.is_refunded),
          'operador', (SELECT u.name FROM users u WHERE u.id = o.origin_user_id LIMIT 1),
          'itens', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('nome', oi.item_name, 'qtd', oi.quantity, 'valor', oi.item_price * oi.quantity))
            FROM order_items oi WHERE oi.order_id = o.id
          ), '[]'::jsonb),
          'pagamentos', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', p.id,
              'amount', p.amount,
              'change_amount', p.change_amount,
              'payment_method_name', pm.name,
              'payment_method_type', pm.type,
              'operator_name', p.operator_name,
              'cash_register_id', p.cash_register_id,
              'cash_register_name', null,
              'is_refunded', p.is_refunded
            ) ORDER BY p.created_at)
            FROM payments p
            LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
            WHERE p.order_id = o.id AND NOT p.is_refunded
          ), '[]'::jsonb)
        ) as r
        FROM orders o
        WHERE o.tenant_id = p_tenant_id
          AND o.created_at >= v_today_start
          AND NOT o.is_training AND NOT o.is_draft
        ORDER BY o.created_at DESC LIMIT 15
      ) sub
    ), '[]'::jsonb),
    'mesas_mapa', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'numero', t.number, 'status', t.status,
        'tempo', CASE WHEN ts.id IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - ts.opened_at)) / 60 ELSE NULL END,
        'valor', COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.table_session_id = ts.id AND o.is_paid = true AND o.status != 'cancelled' AND NOT o.is_training), 0),
        'pessoas', (SELECT COUNT(*) FROM table_session_customers tsc WHERE tsc.table_session_id = ts.id)
      ) ORDER BY t.number)
      FROM tables t
      LEFT JOIN table_sessions ts ON ts.table_id = t.id AND ts.status = 'open'
      WHERE t.tenant_id = p_tenant_id AND t.is_active = true
    ), '[]'::jsonb),
    'alertas_estoque', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'nome', i.name, 'estoque', i.current_stock, 'minimo', i.min_stock, 'unidade', i.unit, 'critico', (i.current_stock <= 0 OR i.is_depleted)) ORDER BY i.current_stock ASC)
      FROM ingredients i
      WHERE i.tenant_id = p_tenant_id AND i.min_stock > 0 AND (i.current_stock <= i.min_stock OR i.is_depleted = true)
      LIMIT 10
    ), '[]'::jsonb)
  );
END;
$function$;

-- fn_get_kds_orders(p_tenant_id uuid, p_session_id uuid)
CREATE OR REPLACE FUNCTION public.fn_get_kds_orders(p_tenant_id uuid, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result json;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT json_agg(o_data)
  INTO v_result
  FROM (
    SELECT json_build_object(
      'id', o.id,
      'number', o.number,
      'status', o.status,
      'destination_type', o.destination_type,
      'destination_name', o.destination_name,
      'destination_phone', o.destination_phone,
      'origin_type', o.origin_type,
      'table_session_id', o.table_session_id,
      'table_number', o.table_number,
      'participant_id', o.participant_id,
      'participant_token', (
        SELECT tsp.access_token
        FROM table_session_participants tsp
        WHERE tsp.id = o.participant_id
        LIMIT 1
      ),
      'participant_name', (
        SELECT tsp.name
        FROM table_session_participants tsp
        WHERE tsp.id = o.participant_id
        LIMIT 1
      ),
      'customer_name', CASE
        WHEN o.destination_type = 'table' THEN
          CASE
            WHEN o.destination_name IS NOT NULL AND o.destination_name !~ '^Mesa\\s+\\d+$' THEN o.destination_name
            ELSE NULL
          END
        ELSE o.destination_name
      END,
      'created_at', o.created_at,
      'is_training', o.is_training,
      'total_amount', o.total_amount,
      'cancel_reason', o.cancel_reason,
      'customer_cpf', o.customer_cpf,
      'customer_email', o.customer_email,
      'is_paid', o.is_paid,
      'paid_by_pdv', o.paid_by_pdv,
      'session_id', o.session_id,
      'session_number', (SELECT s.number FROM sessions s WHERE s.id = o.session_id LIMIT 1),
      'is_editing', o.is_editing,
      'editing_by_user_id', o.editing_by_user_id,
      'editing_started_at', o.editing_started_at,
      'editing_by_name', (
        SELECT u.name FROM users u WHERE u.id = o.editing_by_user_id LIMIT 1
      ),
      'waiter_name', (
        SELECT u.name FROM users u WHERE u.id = o.origin_user_id LIMIT 1
      ),
      'delivery_fee', o.delivery_fee,
      'delivery_address', o.delivery_address,
      'delivery_platform', o.delivery_platform,
      'notes', o.notes,
      'out_for_delivery_at', o.out_for_delivery_at,
      'payments', (
        SELECT COALESCE(json_agg(json_build_object(
          'id', p.id,
          'amount', p.amount,
          'change_amount', p.change_amount,
          'is_refunded', p.is_refunded,
          'payment_method_id', p.payment_method_id,
          'payment_method_name', pm.name,
          'payment_method_type', pm.type,
          'operator_name', p.operator_name,
          'cash_register_id', p.cash_register_id,
          'cash_register_name', (
            SELECT s.number
            FROM cash_registers cr2
            LEFT JOIN sessions s ON s.id = cr2.session_id
            WHERE cr2.id = p.cash_register_id
            LIMIT 1
          ),
          'origin_type', COALESCE(p.origin_type::text, o.origin_type::text),
          'payment_group_id', p.payment_group_id
        ) ORDER BY p.created_at), '[]'::json)
        FROM payments p
        LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
        WHERE p.order_id = o.id AND p.is_refunded = false
      ),
      'items', (
        SELECT COALESCE(json_agg(json_build_object(
          'id', oi.id,
          'item_id', oi.item_id,
          'item_name', oi.item_name,
          'item_price', oi.item_price,
          'quantity', oi.quantity,
          'station_id', oi.station_id,
          'status', oi.status,
          'notes', oi.notes,
          'skip_kds', oi.skip_kds,
          'combo_id', oi.combo_id,
          'entered_kds_at', oi.entered_kds_at,
          'started_preparing_at', oi.started_preparing_at,
          'ready_at', oi.ready_at,
          'delivered_at', oi.delivered_at,
          'operator_id', oi.operator_id,
          'operator_name', (
            SELECT u.name FROM users u WHERE u.id = oi.operator_id LIMIT 1
          ),
          'delivered_by_user_id', oi.delivered_by_user_id,
          'delivered_by_name', (
            SELECT u.name FROM users u WHERE u.id = oi.delivered_by_user_id LIMIT 1
          ),
          'category_name', (
            SELECT mc.name 
            FROM menu_items mi 
            JOIN menu_categories mc ON mc.id = mi.category_id
            WHERE mi.id = oi.item_id 
            LIMIT 1
          ),
          'options', (
            SELECT COALESCE(json_agg(json_build_object(
              'option_name', op.option_name,
              'group_name', op.group_name,
              'additional_price', op.additional_price,
              'is_required', COALESCE(
                (SELECT og.is_required 
                 FROM options opt
                 JOIN option_groups og ON og.id = opt.group_id
                 WHERE opt.id = op.option_id
                 LIMIT 1),
                false
              )
            )), '[]'::json)
            FROM order_item_options op WHERE op.order_item_id = oi.id
          ),
          'observations', (
            SELECT COALESCE(json_agg(json_build_object(
              'id', ob.id,
              'text', ob.text,
              'is_checked', ob.is_checked
            )), '[]'::json)
            FROM order_item_observations ob WHERE ob.order_item_id = oi.id
          ),
          'obs_checks', (
            SELECT COALESCE(json_agg(json_build_object(
              'observation_index', oc.observation_index,
              'observation_text', oc.observation_text,
              'checked_by_name', oc.checked_by_name,
              'checked_at', oc.checked_at
            )), '[]'::json)
            FROM order_item_observation_checks oc
            WHERE oc.order_item_id = oi.id
          ),
          'units', (
            SELECT COALESCE(json_agg(json_build_object(
              'id', u.id,
              'unit_number', u.unit_number,
              'status', u.status,
              'operator_id', u.operator_id,
              'operator_name', (
                SELECT usr.name FROM users usr WHERE usr.id = u.operator_id LIMIT 1
              ),
              'delivered_by_user_id', u.delivered_by_user_id,
              'delivered_by_name', (
                SELECT usr.name FROM users usr WHERE usr.id = u.delivered_by_user_id LIMIT 1
              ),
              'entered_kds_at', u.entered_kds_at,
              'started_preparing_at', u.started_preparing_at,
              'ready_at', u.ready_at,
              'delivered_at', u.delivered_at
            ) ORDER BY u.unit_number), '[]'::json)
            FROM order_item_units u WHERE u.order_item_id = oi.id
          ),
          'parts', (
            SELECT COALESCE(json_agg(json_build_object(
              'id', oip.id,
              'name', oip.name,
              'station_id', oip.station_id,
              'station_name', (
                SELECT ks.name FROM kitchen_stations ks WHERE ks.id = oip.station_id LIMIT 1
              ),
              'sla_minutes', oip.sla_minutes,
              'sort_order', oip.sort_order,
              'status', oip.status,
              'operator_id', oip.operator_id,
              'operator_name', (
                SELECT u.name FROM users u WHERE u.id = oip.operator_id LIMIT 1
              ),
              'started_preparing_at', oip.started_preparing_at,
              'ready_at', oip.ready_at,
              'delivered_at', oip.delivered_at
            ) ORDER BY oip.sort_order), '[]'::json)
            FROM order_item_parts oip WHERE oip.order_item_id = oi.id
          )
        ) ORDER BY oi.created_at), '[]'::json)
        FROM order_items oi
        WHERE oi.order_id = o.id AND oi.status != 'cancelled'
      )
    ) AS o_data
    FROM orders o
    WHERE o.tenant_id = p_tenant_id
      AND o.is_draft = false
      AND (
        (p_session_id IS NOT NULL AND o.session_id = p_session_id)
        OR (p_session_id IS NULL AND o.created_at >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
      )
    ORDER BY o.created_at DESC
  ) sub;
  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;

-- fn_get_sales_report(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone)
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
    AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_orders_by_day FROM (
    SELECT (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue
    FROM orders o WHERE o.tenant_id=p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft
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
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft
    GROUP BY oi.item_name, mc_by_id.name, mc_by_name.name ORDER BY total_qty DESC) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_top_options FROM (
    SELECT TRIM(oio.option_name) AS option_name, SUM(oi.quantity) AS total_qty, SUM(oio.additional_price*oi.quantity) AS total_revenue
    FROM order_item_options oio JOIN order_items oi ON oi.id=oio.order_item_id JOIN orders o ON o.id=oi.order_id
    WHERE o.tenant_id=p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft
    GROUP BY TRIM(oio.option_name) ORDER BY total_revenue DESC, total_qty DESC) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_by_destination FROM (
    SELECT CASE WHEN o.origin_type::text='table' AND COALESCE(o.table_number,0)=0 THEN 'qr_universal' ELSE o.origin_type::text END AS destination,
      COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue
    FROM orders o WHERE o.tenant_id=p_tenant_id AND o.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft
    GROUP BY 1) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_by_payment FROM (
    SELECT COALESCE(pm.name,'Outros') AS payment_method, COALESCE(pm.type::text,'other') AS payment_type,
      SUM(CASE WHEN pm.type='cash' OR pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%espécie%' THEN LEAST(p.amount,o.total_amount) ELSE p.amount END) AS total,
      COUNT(*) AS count
    FROM payments p LEFT JOIN payment_methods pm ON pm.id=p.payment_method_id JOIN orders o ON o.id=p.order_id
    WHERE o.tenant_id=p_tenant_id AND p.created_at BETWEEN p_date_from AND p_date_to
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT p.is_refunded
    GROUP BY pm.name, pm.type) t;

  RETURN json_build_object('total_revenue',v_total_revenue,'total_orders',v_total_orders,'avg_ticket',v_avg_ticket,
    'orders_by_day',v_orders_by_day,'top_items',v_top_items,'top_options',v_top_options,'by_destination',v_by_destination,'by_payment',v_by_payment);
END; $function$;

-- fn_get_sales_report(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_session_id uuid)
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
    AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_orders_by_day FROM (
    SELECT (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue
    FROM orders o WHERE o.tenant_id=p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft
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
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft
    GROUP BY oi.item_name, mc_by_id.name, mc_by_name.name ORDER BY total_qty DESC) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_top_options FROM (
    SELECT TRIM(oio.option_name) AS option_name, SUM(oi.quantity) AS total_qty, SUM(oio.additional_price*oi.quantity) AS total_revenue
    FROM order_item_options oio JOIN order_items oi ON oi.id=oio.order_item_id JOIN orders o ON o.id=oi.order_id
    WHERE o.tenant_id=p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft
    GROUP BY TRIM(oio.option_name) ORDER BY total_revenue DESC, total_qty DESC) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_by_destination FROM (
    SELECT CASE WHEN o.origin_type::text='table' AND COALESCE(o.table_number,0)=0 THEN 'qr_universal' ELSE o.origin_type::text END AS destination,
      COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue
    FROM orders o WHERE o.tenant_id=p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft
    GROUP BY 1) t;

  SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) INTO v_by_payment FROM (
    SELECT COALESCE(pm.name,'Outros') AS payment_method, COALESCE(pm.type::text,'other') AS payment_type,
      SUM(CASE WHEN pm.type='cash' OR pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%espécie%' THEN LEAST(p.amount,o.total_amount) ELSE p.amount END) AS total,
      COUNT(*) AS count
    FROM payments p LEFT JOIN payment_methods pm ON pm.id=p.payment_method_id JOIN orders o ON o.id=p.order_id
    WHERE o.tenant_id=p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id=p_session_id) OR (p_session_id IS NULL AND p.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid=true AND o.status!='cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT p.is_refunded
    GROUP BY pm.name, pm.type) t;

  RETURN json_build_object('total_revenue',v_total_revenue,'total_orders',v_total_orders,'avg_ticket',v_avg_ticket,
    'orders_by_day',v_orders_by_day,'top_items',v_top_items,'top_options',v_top_options,'by_destination',v_by_destination,'by_payment',v_by_payment);
END; $function$;

-- 3) fn_get_active_cash_register(p_session_id) — sem p_tenant_id
CREATE OR REPLACE FUNCTION public.fn_get_active_cash_register(p_session_id uuid)
 RETURNS TABLE(id uuid, opening_value numeric, opened_at timestamp with time zone, operator_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- go-live 09-17: a loja vem da sessão; só membro dela (ou chamada confiável) lê o caixa.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin')) AND EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = p_session_id AND NOT public.auth_is_member_of(s.tenant_id)
  ) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT cr.id, cr.opening_value, cr.opened_at, cr.operator_id
  FROM cash_registers cr
  WHERE cr.session_id = p_session_id AND cr.status = 'open'
  ORDER BY cr.opened_at DESC
  LIMIT 1;
END;
$function$;

COMMIT;
