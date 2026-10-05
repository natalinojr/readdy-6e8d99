-- Clientes & Marketing em 4 abas (2026-10-05): a aba Clientes filtra pelos estágios do Funil
-- (uma regra só; antes "VIP"/"Frequente" da lista tinham cortes fixos que contradiziam o Funil).
-- fn_get_customers_list devolve `estagio` (crm_customer_stage) e recalcula os estágios da loja
-- antes, só quando o cálculo tem mais de 5 minutos ou falta cliente (o Funil recalcula ao abrir;
-- a lista não pode mostrar estágio velho). Erro no recálculo não derruba a lista (WARNING).
CREATE OR REPLACE FUNCTION public.fn_get_customers_list(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result jsonb;
  v_ultimo timestamptz;
  v_com_estagio int;
  v_clientes int;
BEGIN
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT max(computed_at), count(*) INTO v_ultimo, v_com_estagio FROM crm_customer_stage WHERE tenant_id = p_tenant_id;
  SELECT count(*) INTO v_clientes FROM customers WHERE tenant_id = p_tenant_id;
  IF v_clientes > 0 AND (v_ultimo IS NULL OR v_ultimo < now() - interval '5 minutes' OR v_com_estagio < v_clientes) THEN
    BEGIN
      PERFORM public.fn_crm_recompute_stages(p_tenant_id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'fn_get_customers_list: recálculo do funil falhou na loja %: %', p_tenant_id, sqlerrm;
    END;
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
      'estagio', s.stage,
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
  LEFT JOIN crm_customer_stage s ON s.tenant_id = c.tenant_id AND s.customer_id = c.id
  WHERE c.tenant_id = p_tenant_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;
