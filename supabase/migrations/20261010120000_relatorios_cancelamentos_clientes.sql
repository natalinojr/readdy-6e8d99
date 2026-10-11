-- Auditoria de números (2026-10-10): Relatórios › Cancelamentos e › Clientes/CRM.
-- As duas funções davam erro em TODA chamada (42803: agregado aninhado / função de janela dentro de
-- jsonb_agg) e o front mostrava "nenhum cancelamento" / tudo zero.
-- Cancelamentos: gorjetas agregadas numa subconsulta; descontos e cancelamentos só da loja (a promoção
-- do iFood — pedido com ifood_repasse — não é desconto dado pela loja); estorno devolve order_id para o
-- front não contar 2x o pedido cancelado E estornado; rascunho fora.
-- Clientes: KPIs só de quem já comprou (visit_count > 0 — cadastro sem compra inflava "sem visita" e
-- derrubava a frequência média); posição do ranking numa subconsulta; o LIMIT 15 dos "em risco" passa
-- a valer (antes incidia sobre o agregado).

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
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'pedido', '#' || o.number::text,
      'mesa', COALESCE(o.destination_name, '—'),
      'motivo', COALESCE(o.cancel_reason, 'Não informado'),
      'valor', o.total_amount,
      'hora', TO_CHAR(o.cancelled_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
      'data', o.cancelled_at,
      'origem', o.origin_type::text,
      'pago', o.is_paid
    )
    ORDER BY o.cancelled_at DESC
  )
  INTO v_cancelamentos
  FROM orders o
  WHERE o.tenant_id = p_tenant_id
    AND o.status = 'cancelled'
    AND o.cancelled_at BETWEEN p_start AND p_end
    AND o.is_training = false
    AND o.is_draft = false
    AND o.ifood_repasse = false;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'order_id', o.id,
      'pedido', '#' || o.number::text,
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'pedido', '#' || o.number::text,
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
    AND o.is_training = false
    AND o.is_draft = false
    AND o.ifood_repasse = false;

  SELECT jsonb_agg(
    jsonb_build_object(
      'garcom', g.garcom,
      'pedidos', g.pedidos,
      'totalGorjeta', g.total,
      'mediaGorjeta', CASE WHEN g.pedidos > 0 THEN ROUND(g.total / g.pedidos, 2) ELSE 0 END,
      'pctPedidosGorjeta', ROUND((g.com_gorjeta::numeric / NULLIF(g.pedidos, 0)) * 100, 0)
    )
    ORDER BY g.total DESC
  )
  INTO v_gorjetas
  FROM (
    SELECT COALESCE(u.name, 'Desconhecido') AS garcom,
           COUNT(o.id) AS pedidos,
           SUM(o.tip_amount) AS total,
           COUNT(*) FILTER (WHERE o.tip_amount > 0) AS com_gorjeta
    FROM orders o
    LEFT JOIN users u ON u.id = o.origin_user_id
    WHERE o.tenant_id = p_tenant_id
      AND o.tip_amount > 0
      AND o.created_at BETWEEN p_start AND p_end
      AND o.is_training = false
    GROUP BY o.origin_user_id, u.name
  ) g;

  RETURN jsonb_build_object(
    'cancelamentos', COALESCE(v_cancelamentos, '[]'::jsonb),
    'estornos', COALESCE(v_estornos, '[]'::jsonb),
    'descontos', COALESCE(v_descontos, '[]'::jsonb),
    'gorjetas', COALESCE(v_gorjetas, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_clientes_report(p_tenant_id uuid, p_start timestamp with time zone DEFAULT (now() - '30 days'::interval), p_end timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_top jsonb;
  v_risco jsonb;
  v_total_unicos bigint;
  v_novos bigint;
  v_retornantes bigint;
  v_freq_media numeric;
  v_ticket_medio numeric;
  v_sem_visita_30 bigint;
  v_sem_visita_60 bigint;
BEGIN
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
  WHERE c.tenant_id = p_tenant_id
    AND COALESCE(c.visit_count, 0) > 0;

  SELECT jsonb_agg(
    jsonb_build_object(
      'pos', t.pos,
      'nome', t.name,
      'visitas', t.visit_count,
      'ultimaVisita', t.last_visit_at::date,
      'totalGasto', t.total_spent,
      'ticketMedio', CASE WHEN COALESCE(t.visit_count, 0) > 0 THEN ROUND(t.total_spent / t.visit_count, 2) ELSE 0 END,
      'tipo', 'pessoa'
    )
    ORDER BY t.pos
  )
  INTO v_top
  FROM (
    SELECT c.*, ROW_NUMBER() OVER (ORDER BY c.total_spent DESC) AS pos
    FROM customers c
    WHERE c.tenant_id = p_tenant_id AND c.total_spent > 0
    ORDER BY c.total_spent DESC
    LIMIT 10
  ) t;

  SELECT jsonb_agg(
    jsonb_build_object(
      'nome', r.name,
      'diasSemVisita', EXTRACT(DAY FROM NOW() - r.last_visit_at)::int,
      'ultimaVisita', TO_CHAR(r.last_visit_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'),
      'visitas', r.visit_count,
      'totalHistorico', r.total_spent
    )
    ORDER BY r.last_visit_at ASC
  )
  INTO v_risco
  FROM (
    SELECT c.*
    FROM customers c
    WHERE c.tenant_id = p_tenant_id
      AND COALESCE(c.visit_count, 0) > 0
      AND c.last_visit_at < NOW() - INTERVAL '30 days'
    ORDER BY c.last_visit_at ASC
    LIMIT 15
  ) r;

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
