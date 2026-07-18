-- =============================================================================
-- MIGRATION: fn_get_cash_sessions_v2 — somar p.amount direto (fim dos workarounds)
-- Data: 2026-07-17
-- Contexto: ate 2026-07-17 o pedido principal de um pagamento em grupo gravava
--   payments.amount = total do GRUPO (os vinculados gravavam a parte deles), entao
--   somar p.amount contava em dobro. Esta funcao contornava isso reconstruindo a
--   receita a partir de o.total_amount:
--     - por_forma_pagamento: SUM(o.total_amount * p.amount / SUM(amount do pedido))
--     - cash_transactions:   SUM(o.total_amount) quando COUNT(*) > 1
--   A ORIGEM foi corrigida (PagamentoRapidoModal/PagamentoModal: cada pedido grava
--   so a sua parte) e os dados historicos inequivocos foram normalizados, entao os
--   workarounds viraram redundantes — e nocivos:
--     1. por_forma_pagamento inflava PAGAMENTO PARCIAL: pedido de 100 pago so 50
--        virava 100 (100 * 50/50), porque forcava o total da venda.
--     2. cash_transactions contava CARTAO COMO DINHEIRO: o filtro pega so linhas
--        cash, mas somava o.total_amount inteiro do pedido — num pedido pago metade
--        dinheiro / metade cartao, a metade do cartao entrava no total em especie.
--   Agora cada linha de payments guarda a parte real daquele pedido naquele metodo,
--   entao a soma direta de p.amount e o valor correto e lida com parcial e split.
-- Alterado em relacao a versao anterior: apenas 'por_forma_pagamento' e
--   'cash_transactions'. O agrupamento visual por payment_group_id foi mantido
--   (a tela mostra "N ped." numa linha so).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_cash_sessions_v2(p_tenant_id uuid, p_limit integer DEFAULT 30, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session RECORD;
  v_session_data jsonb;
BEGIN
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
          -- Cada linha de payments grava a parte real daquele pedido naquele metodo,
          -- entao a soma direta e o recebido correto (vale p/ parcial e split).
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
          -- QR universal (mesa sem numero fisico) vira o canal 'qr_universal';
          -- QR de mesa real (table_number > 0) continua 'table' (Mesa QR).
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
          -- 1 linha por grupo de pagamento (pedidos pagos juntos). Os valores saem
          -- de p.amount: 'valor_venda' e o quanto daquela venda entrou EM ESPECIE
          -- (nao o total do pedido, que pode ter parte em cartao) e 'valor_pago' e
          -- o que o cliente entregou na mao (venda em especie + troco).
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
