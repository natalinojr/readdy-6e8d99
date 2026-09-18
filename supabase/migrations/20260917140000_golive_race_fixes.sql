-- =============================================================================
-- Go-live Paranaguá (2026-09-17): corridas e permissões em funções SECURITY DEFINER
--
-- 1. fn_next_queue_token: max(access_token)+1 sem trava gerava senha repetida sob
--    concorrência (tsp_queue_token_uidx -> 500). Agora pega pg_advisory_xact_lock por
--    sessão de caixa. O lock vale até o fim da TRANSAÇÃO, então cobre o INSERT feito
--    no mesmo statement pelos chamadores (fn_create_queue_ticket,
--    fn_create_mesa_participant_auto). A leitura do max roda depois do lock com
--    snapshot novo (READ COMMITTED + função VOLATILE), então enxerga o commit anterior.
-- 2. enqueue_print_ticket: dedup SELECT-then-INSERT corria (10 chamadas -> 4 jobs).
--    Lock por tenant+pedido+estação antes do SELECT. E, como anon executa (mesa-qr),
--    recusa order_id que não pertence a p_tenant_id.
-- 3. fn_open_table_session (3 e 4 args): idempotente. Se a mesa já tem sessão 'open'
--    na loja, devolve o id existente. Lock por mesa + fallback em unique_violation
--    (índice table_sessions_one_open_per_table, migration 20260917120000 — não recriado aqui).
-- 4. Permissões:
--    a) Internas, só chamadas por Edge com service_role (order-write, mesa-write,
--       delivery-write, online-payments, simulate-pdv-orders) ou por outra função
--       SECURITY DEFINER: revoga de PUBLIC/anon/authenticated, garante service_role.
--    b) Chamadas pelo front LOGADO (JWT): revoga de PUBLIC/anon, mantém
--       authenticated + service_role.
--       Obs.: proacl NULL = PUBLIC executa; revogar só de anon não bastaria.
--    c) Escrita chamada pelo front com JWT (fn_close_session, fn_cancel_order_item,
--       fn_cancel_and_refund_order): checagem de membro da loja no início.
--
-- Idempotente: CREATE OR REPLACE + REVOKE/GRANT (repetíveis). Assinaturas preservadas.
-- =============================================================================

-- ─── 1. fn_next_queue_token ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_next_queue_token(p_session_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_max int;
begin
  -- Serializa o cálculo da senha por sessão de caixa até o fim da transação
  -- (cobre o INSERT do chamador). Sessão nula: chave fixa.
  perform pg_advisory_xact_lock(
    hashtextextended('fn_next_queue_token:' || coalesce(p_session_id::text, 'null'), 0)
  );

  select coalesce(max(tsp.access_token::int), 299) into v_max
  from table_session_participants tsp
  left join table_sessions ts on ts.id = tsp.table_session_id
  where coalesce(tsp.session_id, ts.session_id) = p_session_id
    and tsp.access_token ~ '^\d+$';
  return greatest(v_max + 1, 300)::text;
end $function$;

-- ─── 2. enqueue_print_ticket ─────────────────────────────────────────────────
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

-- ─── 3. fn_open_table_session (idempotente) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_open_table_session(p_tenant_id uuid, p_table_id uuid, p_session_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    DECLARE
      v_ts_id UUID;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('fn_open_table_session:' || p_table_id::text, 0));

      UPDATE tables SET status = 'occupied' WHERE id = p_table_id AND tenant_id = p_tenant_id;

      SELECT id INTO v_ts_id FROM table_sessions
      WHERE table_id = p_table_id AND tenant_id = p_tenant_id AND status = 'open'
      ORDER BY opened_at LIMIT 1;
      IF v_ts_id IS NOT NULL THEN
        RETURN json_build_object('id', v_ts_id);
      END IF;

      BEGIN
        INSERT INTO table_sessions(tenant_id, table_id, session_id, opened_at, status)
        VALUES(p_tenant_id, p_table_id, p_session_id, now(), 'open')
        RETURNING id INTO v_ts_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_ts_id FROM table_sessions
        WHERE table_id = p_table_id AND tenant_id = p_tenant_id AND status = 'open'
        ORDER BY opened_at LIMIT 1;
        IF v_ts_id IS NULL THEN RAISE; END IF;
      END;

      RETURN json_build_object('id', v_ts_id);
    END;
    $function$;

CREATE OR REPLACE FUNCTION public.fn_open_table_session(p_tenant_id uuid, p_table_id uuid, p_session_id uuid, p_customer_name text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    DECLARE
      v_ts_id UUID;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('fn_open_table_session:' || p_table_id::text, 0));

      UPDATE tables SET status = 'occupied' WHERE id = p_table_id AND tenant_id = p_tenant_id;

      SELECT id INTO v_ts_id FROM table_sessions
      WHERE table_id = p_table_id AND tenant_id = p_tenant_id AND status = 'open'
      ORDER BY opened_at LIMIT 1;
      IF v_ts_id IS NOT NULL THEN
        RETURN json_build_object('id', v_ts_id);
      END IF;

      BEGIN
        INSERT INTO table_sessions(tenant_id, table_id, session_id, opened_at, status, customer_name)
        VALUES(p_tenant_id, p_table_id, p_session_id, now(), 'open', p_customer_name)
        RETURNING id INTO v_ts_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_ts_id FROM table_sessions
        WHERE table_id = p_table_id AND tenant_id = p_tenant_id AND status = 'open'
        ORDER BY opened_at LIMIT 1;
        IF v_ts_id IS NULL THEN RAISE; END IF;
      END;

      RETURN json_build_object('id', v_ts_id);
    END;
    $function$;

-- ─── 4c. Escrita chamada pelo front com JWT: checagem de membro ──────────────
-- Corpos copiados da definição viva (2026-09-17); única mudança = bloco [golive].
CREATE OR REPLACE FUNCTION public.fn_cancel_and_refund_order(p_order_id uuid, p_user_id uuid, p_reason text, p_restock boolean DEFAULT false)
 RETURNS TABLE(cancelled boolean, refund_amount numeric, payments_refunded integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_refund numeric := 0;
  v_payments_refunded integer := 0;
  v_payment_record RECORD;
  v_tenant_id uuid;
  v_first_payment_id uuid;
BEGIN
  -- Get tenant
  SELECT tenant_id INTO v_tenant_id FROM orders WHERE id = p_order_id;
  IF v_tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 0::numeric, 0;
    RETURN;
  END IF;

  -- [golive 2026-09-17] só membro da loja (ou service_role/DB admin) executa
  IF coalesce(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.auth_is_member_of(v_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  -- Cancel order
  UPDATE orders
  SET status = 'cancelled',
      cancel_reason = p_reason,
      cancelled_by = p_user_id,
      cancelled_at = now(),
      updated_at = now()
  WHERE id = p_order_id;

  -- Cancel items
  -- [golive 2026-09-17] order_items não tem updated_at (a versão anterior dava 42703 e o estorno nunca funcionava)
  UPDATE order_items
  SET status = 'cancelled'
  WHERE order_id = p_order_id AND status IN ('new', 'preparing', 'ready');

  -- Calculate refund amount and mark payments as refunded
  FOR v_payment_record IN
    SELECT id, amount
    FROM payments
    WHERE order_id = p_order_id AND is_refunded = false
    ORDER BY created_at
  LOOP
    v_total_refund := v_total_refund + v_payment_record.amount;
    v_payments_refunded := v_payments_refunded + 1;

    IF v_first_payment_id IS NULL THEN
      v_first_payment_id := v_payment_record.id;
    END IF;

    UPDATE payments
    SET is_refunded = true,
        refund_reason = p_reason,
        refund_authorized_by = p_user_id,
        refunded_at = now()
    WHERE id = v_payment_record.id;
  END LOOP;

  -- Insert refund record if there was any payment to refund
  IF v_total_refund > 0 THEN
    INSERT INTO refunds (
      tenant_id,
      order_id,
      payment_id,
      refund_amount,
      reason_type,
      notes,
      refund_method,
      restock_items,
      requested_by,
      approved_by,
      approved_at,
      status,
      processed_at
    ) VALUES (
      v_tenant_id,
      p_order_id,
      v_first_payment_id,
      v_total_refund,
      'customer_request',
      p_reason,
      'same_method',
      p_restock,
      p_user_id,
      p_user_id,
      now(),
      'processed',
      now()
    );
  END IF;

  RETURN QUERY SELECT true, v_total_refund, v_payments_refunded;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cancel_order_item(p_order_item_id uuid, p_user_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_tenant_id uuid;
  v_item_status text;
  v_item_value numeric;
  v_remaining integer;
  v_out RECORD;
  v_already_restocked boolean;
  v_restock_reason text;
BEGIN
  -- Identifica pedido + tenant + status + valor do item a cancelar
  SELECT order_id, tenant_id, status::text, COALESCE(item_price, 0) * quantity
    INTO v_order_id, v_tenant_id, v_item_status, v_item_value
  FROM order_items WHERE id = p_order_item_id;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Item do pedido nao encontrado';
  END IF;

  -- [golive 2026-09-17] só membro da loja (ou service_role/DB admin) executa
  IF coalesce(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.auth_is_member_of(v_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  -- Idempotente: se ja esta cancelado, nao refaz estorno nem mexe nos totais
  IF v_item_status = 'cancelled' THEN
    RETURN;
  END IF;

  -- 1) Cancela o item
  UPDATE order_items SET status = 'cancelled' WHERE id = p_order_item_id;

  -- 2) Estorna o estoque REALMENTE baixado para ESTE item
  --    (baixas tem reason 'item_sale:<item>:<order_item_id>'; so existem se o item chegou a ready/delivered)
  --    Dedup por item -> nao duplica e nao pula itens distintos que dividem o mesmo ingrediente.
  v_restock_reason := 'Estorno item:' || p_order_item_id::text || ' pedido #' || substring(v_order_id::text, 1, 8);

  FOR v_out IN
    SELECT ingredient_id, quantity, unit
    FROM stock_movements
    WHERE order_id = v_order_id
      AND type = 'theoretical_out'
      AND reason LIKE '%:' || p_order_item_id::text
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM stock_movements
      WHERE order_id = v_order_id
        AND ingredient_id = v_out.ingredient_id
        AND type = 'in'
        AND reason LIKE 'Estorno item:' || p_order_item_id::text || '%'
    ) INTO v_already_restocked;

    IF v_already_restocked THEN
      CONTINUE;
    END IF;

    INSERT INTO stock_movements (tenant_id, ingredient_id, type, quantity, unit, reason, order_id, operator_id)
    VALUES (v_tenant_id, v_out.ingredient_id, 'in', v_out.quantity, v_out.unit, v_restock_reason, v_order_id, p_user_id);

    PERFORM fn_update_ingredient_stock(v_out.ingredient_id, v_tenant_id, v_out.quantity);
  END LOOP;

  -- 3) Ajusta os totais por DELTA: subtrai SO o valor do item cancelado.
  --    Preserva taxa de entrega (delivery_fee, embutida no total dos pedidos de delivery),
  --    adicionais (que podem nao estar no item_price), desconto e gorjeta.
  SELECT COUNT(*) INTO v_remaining
  FROM order_items WHERE order_id = v_order_id AND status <> 'cancelled';

  IF v_remaining = 0 THEN
    -- Nao sobrou item ativo: cancela o pedido inteiro
    UPDATE orders
    SET status = 'cancelled', cancel_reason = p_reason,
        cancelled_by = p_user_id, cancelled_at = now(),
        subtotal = GREATEST(0, COALESCE(subtotal, 0) - v_item_value),
        total_amount = GREATEST(0, COALESCE(total_amount, 0) - v_item_value),
        updated_at = now()
    WHERE id = v_order_id;
  ELSE
    UPDATE orders
    SET subtotal = GREATEST(0, COALESCE(subtotal, 0) - v_item_value),
        total_amount = GREATEST(0, COALESCE(total_amount, 0) - v_item_value),
        updated_at = now()
    WHERE id = v_order_id;
  END IF;
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
  END IF;

  UPDATE orders
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'Pix pelo app não pago até o fechamento do caixa'
   WHERE session_id = p_session_id
     AND origin_type = 'delivery'
     AND status = 'draft'
     AND is_draft = true;

  UPDATE sessions
     SET status = 'closed',
         closed_by = p_closed_by,
         closed_at = NOW(),
         closing_amount_declared = p_closing_amount,
         closing_notes = p_notes
   WHERE id = p_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_close_session(p_session_id uuid, p_closed_by uuid, p_closing_amount numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_mesas_abertas integer;
  v_itens_cozinha integer;
BEGIN
  -- Buscar tenant da sessão
  SELECT tenant_id INTO v_tenant_id
  FROM sessions
  WHERE id = p_session_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Sessão não encontrada.';
  END IF;

  -- [golive 2026-09-17] só membro da loja (ou service_role/DB admin) executa
  IF coalesce(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.auth_is_member_of(v_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  -- 1) Verificar mesas abertas (table_sessions abertas desta sessão)
  SELECT COUNT(*) INTO v_mesas_abertas
  FROM table_sessions ts
  JOIN tables t ON t.id = ts.table_id
  WHERE ts.session_id = p_session_id
    AND ts.status = 'open';

  IF v_mesas_abertas > 0 THEN
    RAISE EXCEPTION 'Não é possível fechar a sessão: % mesa(s) ainda aberta(s). Feche todas as mesas primeiro.', v_mesas_abertas;
  END IF;

  -- 2) Verificar pedidos pendentes na cozinha
  -- order_item_units -> order_items -> orders
  SELECT COUNT(*) INTO v_itens_cozinha
  FROM order_item_units ou
  JOIN order_items oi ON oi.id = ou.order_item_id
  JOIN orders o ON o.id = oi.order_id
  WHERE o.session_id = p_session_id
    AND o.status NOT IN ('cancelled', 'delivered')
    AND o.is_draft = false
    AND ou.status IN ('new', 'preparing', 'ready')
    AND oi.skip_kds = false;

  IF v_itens_cozinha > 0 THEN
    RAISE EXCEPTION 'Não é possível fechar a sessão: % item(s) ainda pendente(s) na cozinha. Aguarde a finalização.', v_itens_cozinha;
  END IF;

  -- 3) Verificar se há orders não-delivered nem cancelled da sessão (fallback geral)
  PERFORM 1
  FROM orders
  WHERE session_id = p_session_id
    AND is_draft = false
    AND status NOT IN ('delivered', 'cancelled')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Não é possível fechar a sessão: existem pedidos ainda não entregues ou não cancelados.';
  END IF;

  -- Tudo ok — fechar a sessão
  UPDATE sessions
     SET status = 'closed',
         closed_by = p_closed_by,
         closed_at = NOW(),
         closing_amount_declared = p_closing_amount,
         closing_notes = p_notes
   WHERE id = p_session_id;
END;
$function$;

-- ─── 4a. Internas (só service_role / outras funções SECURITY DEFINER) ────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'fn_update_ingredient_stock',
        'fn_record_payment_bypass',
        'fn_create_order_bypass',
        'fn_create_order_items_bypass',
        'upsert_customer'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.fn);
  END LOOP;
END $$;

-- ─── 4b. Front logado: tira anon/PUBLIC, mantém authenticated + service_role ─
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'fn_next_tenant_order_number',
        'fn_get_sales_report',
        'fn_get_dashboard_metrics',
        'fn_get_cash_sessions_v2',
        'fn_get_kds_orders',
        'fn_get_cancelamentos_report',
        'fn_close_session',
        'fn_cancel_order_item',
        'fn_cancel_and_refund_order'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.fn);
  END LOOP;
END $$;
