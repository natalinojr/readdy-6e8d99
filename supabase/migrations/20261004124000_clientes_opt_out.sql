-- Revisão de Clientes & Marketing (2026-10-04): respeitar quem pediu para não receber mensagens
-- (customers.crm_opt_out_at, marcado pelo Funil › "Não perturbe" ou pelo 131050 da Meta).
-- 1) fn_get_customers_list devolve `optOut` — a aba Clientes desliga WhatsApp/campanha/Público
--    do Meta para essas pessoas (antes só o Funil sabia do opt-out).
-- 2) fn_generate_birthday_vouchers não gera voucher para quem saiu (o modal oferecia "Enviar").

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
      'optOut', c.crm_opt_out_at,
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

CREATE OR REPLACE FUNCTION public.fn_generate_birthday_vouchers(p_tenant_id uuid, p_scope text DEFAULT 'today'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg        jsonb;
  v_enabled    boolean;
  v_only_optin boolean;
  v_dtype      text;
  v_dval       numeric;
  v_minorder   numeric;
  v_validity   int;
  v_vtype      text;
  v_today      date := (now() at time zone 'America/Sao_Paulo')::date;
  v_year       int  := extract(year from v_today);
  v_note       text;
  v_expires    timestamptz;
  v_chars      text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code       text;
  v_attempt    int;
  v_created    int := 0;
  v_skipped    int := 0;
  v_items      jsonb := '[]'::jsonb;
  v_voucher_id uuid;
  c            record;
BEGIN
  SELECT birthday_voucher_config INTO v_cfg FROM system_settings WHERE tenant_id = p_tenant_id;
  IF v_cfg IS NULL THEN v_cfg := '{}'::jsonb; END IF;

  v_enabled    := COALESCE((v_cfg->>'enabled')::boolean, false);
  v_only_optin := COALESCE((v_cfg->>'only_opt_in')::boolean, false);
  v_dtype      := COALESCE(v_cfg->>'discount_type', 'percent');
  v_dval       := COALESCE((v_cfg->>'discount_value')::numeric, 0);
  v_minorder   := COALESCE((v_cfg->>'min_order_amount')::numeric, 0);
  v_validity   := COALESCE((v_cfg->>'validity_days')::int, 15);
  v_note       := 'Aniversário ' || v_year;
  v_expires    := now() + (v_validity || ' days')::interval;
  v_vtype      := CASE WHEN v_dtype = 'gift_card' THEN 'gift_card' ELSE 'discount' END;

  IF p_scope = 'today' AND NOT v_enabled THEN
    RETURN jsonb_build_object('created', 0, 'skipped', 0, 'enabled', false, 'items', '[]'::jsonb);
  END IF;

  IF v_dval <= 0 THEN
    RETURN jsonb_build_object('created', 0, 'skipped', 0, 'error', 'discount_value invalido', 'items', '[]'::jsonb);
  END IF;

  FOR c IN
    SELECT cu.id, cu.name, cu.phone
    FROM customers cu
    WHERE cu.tenant_id = p_tenant_id
      AND cu.deleted_at IS NULL
      AND cu.birth_date IS NOT NULL
      AND extract(month from cu.birth_date) = extract(month from v_today)
      AND (p_scope <> 'today' OR extract(day from cu.birth_date) = extract(day from v_today))
      AND (NOT v_only_optin OR cu.accepts_marketing = true)
      AND cu.crm_opt_out_at IS NULL
  LOOP
    IF EXISTS(
      SELECT 1 FROM vouchers v
      WHERE v.tenant_id = p_tenant_id AND v.customer_id = c.id
        AND v.notes = v_note AND v.status <> 'cancelled'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_code := NULL;
    FOR v_attempt IN 1..6 LOOP
      v_code := 'BD-'
        || (SELECT string_agg(substr(v_chars, 1 + floor(random()*length(v_chars))::int, 1), '') FROM generate_series(1,4))
        || '-'
        || (SELECT string_agg(substr(v_chars, 1 + floor(random()*length(v_chars))::int, 1), '') FROM generate_series(1,4));
      PERFORM 1 FROM vouchers WHERE tenant_id = p_tenant_id AND code = v_code;
      IF NOT FOUND THEN EXIT; END IF;
      v_code := NULL;
    END LOOP;
    IF v_code IS NULL THEN CONTINUE; END IF;

    INSERT INTO vouchers (
      tenant_id, code, voucher_type, original_amount, current_balance,
      discount_type, discount_value, min_order_amount,
      valid_from, expires_at, status, customer_id, customer_name,
      claim_token, max_uses, notes
    ) VALUES (
      p_tenant_id, v_code, v_vtype, v_dval, v_dval,
      CASE WHEN v_vtype = 'discount' THEN v_dtype ELSE NULL END,
      CASE WHEN v_vtype = 'discount' THEN v_dval ELSE NULL END,
      NULLIF(v_minorder, 0),
      now(), v_expires, 'active', c.id, c.name,
      replace(gen_random_uuid()::text, '-', ''), 1, v_note
    ) RETURNING id INTO v_voucher_id;

    INSERT INTO voucher_transactions (tenant_id, voucher_id, transaction_type, amount, balance_after, processed_by)
    VALUES (p_tenant_id, v_voucher_id, 'issued', v_dval, v_dval, NULL);

    v_created := v_created + 1;
    v_items := v_items || jsonb_build_object('customer_id', c.id, 'name', c.name, 'phone', c.phone, 'code', v_code);
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped, 'enabled', v_enabled, 'items', v_items);
END;
$function$
;
