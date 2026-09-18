-- Ticket ECONOMIA (2026-09-17): fn_get_kds_orders devolvia a sessão inteira de
-- caixa (todos os pedidos, inclusive entregues/pagos de horas antes) em toda
-- tela aberta (KDS, gestor de pedidos), ~3,6 KB por pedido. Maior consumidor
-- de egress do projeto (plano Free, 5 GB/mês).
--
-- Mudança: adiciona parâmetro opcional p_only_active (DEFAULT false, preserva
-- o comportamento atual para quem não passar o parâmetro). Quando true, o
-- retorno é filtrado para pedidos ainda não entregues OU entregues/atualizados
-- nas últimas 2 horas — cobre o que o KDS e o Gestor de Pedidos realmente
-- mostram (quadro do dia/aberto), sem tocar no modo histórico (que já usa
-- query paginada direta em src/hooks/useOrdersHistory.ts, fora desta RPC) nem
-- no modo "sessão completa" usado deliberadamente em /pedidos.
--
-- Corpo copiado da definição viva (2 args) em 2026-09-17, alterado no mínimo:
-- comentário 09-17 (só membro da loja) preservado, SECURITY DEFINER e checagem
-- de acesso preservados, só acrescentada a condição de filtro por atividade.

-- [go-live 09-17] O CREATE de uma assinatura com 1 parâmetro a mais NÃO substitui a viva de 2
-- args: criaria overload ambíguo e toda chamada com 2 args (front atual em produção: KDSContext,
-- useOrdersHistory, usePedidosAgrupados) falharia com "function is not unique". Por isso a de 2
-- args é removida: a de 3 args com DEFAULT atende essas chamadas sem mudança no front.
DROP FUNCTION IF EXISTS public.fn_get_kds_orders(uuid, uuid);
-- O atalho de 1 arg (que só repassava NULL) também sai: com a de 3 args (2 DEFAULT) uma chamada
-- de 1 arg casaria com as duas e voltaria a dar "not unique". Nenhum chamador usa só o tenant.
DROP FUNCTION IF EXISTS public.fn_get_kds_orders(uuid);

CREATE OR REPLACE FUNCTION public.fn_get_kds_orders(
  p_tenant_id uuid,
  p_session_id uuid DEFAULT NULL::uuid,
  p_only_active boolean DEFAULT false
)
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
      -- ECONOMIA 09-17: com p_only_active=true, corta pedidos já fechados há
      -- mais de 2h (entregues, sem atividade recente). Sem impacto quando o
      -- caller não passa o parâmetro (default false = comportamento antigo).
      AND (
        p_only_active = false
        OR o.status::text <> 'delivered'
        OR o.updated_at >= (now() - interval '2 hours')
      )
    ORDER BY o.created_at DESC
  ) sub;
  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_get_kds_orders(uuid, uuid, boolean) TO authenticated, service_role;

-- ── fn_get_session_revenue ──────────────────────────────────────────────────
-- O card de faturamento do Gestor de Pedidos (src/pages/gestor-pedidos/page.tsx)
-- somava `total_amount` dos pedidos 'entregue' presentes em `pedidos` (o array
-- vindo de fn_get_kds_orders). Com p_only_active=true essa lista deixa de trazer
-- entregues antigos, então o card ficaria errado (subcontando a sessão inteira).
-- Esta função devolve só o agregado (1 linha) para o mesmo cálculo, sem baixar
-- os pedidos inteiros de novo.
CREATE OR REPLACE FUNCTION public.fn_get_session_revenue(p_tenant_id uuid, p_session_id uuid)
 RETURNS TABLE(faturamento numeric, pedidos_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT COALESCE(SUM(o.total_amount), 0)::numeric, COUNT(*)::integer
  FROM orders o
  WHERE o.tenant_id = p_tenant_id
    AND o.session_id = p_session_id
    AND o.status::text = 'delivered'
    AND COALESCE(o.is_training, false) = false  -- pedido de treino não entra no faturamento
    AND o.total_amount > 0;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_get_session_revenue(uuid, uuid) TO authenticated, service_role;

-- Função recriada nasce executável por PUBLIC (ver 160000): revogar sempre após DROP+CREATE.
REVOKE ALL ON FUNCTION public.fn_get_kds_orders(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_get_session_revenue(uuid, uuid) FROM PUBLIC, anon;
