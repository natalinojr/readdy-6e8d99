-- Auditoria de números (2026-10-10).
-- fn_get_cash_sessions_v2: sessão entra no período pelo dia (Brasília) em que ABRIU — antes era interseção
--   em data UTC e "Hoje" trazia a sessão de ontem que fechou depois das 21h; total_descontos pelo
--   orders.discount_amount sem cortesia (order_discounts perdia desconto gravado só no pedido); faturamento e
--   pedidos só de pedido pago (venda = pedido pago, igual às outras telas); devolve num_cortesias e
--   valor_cortesias (a tela mostrava sempre 0).
-- fn_get_dashboard_pico: média por hora dividida pelos dias daquele dia da semana com pedido (era ÷4 fixo),
--   só pedido pago.
-- fn_contas_painel: repasse futuro do iFood pela regra da agenda (fin_ifood_repasses_base).
-- fn_estoque_mov_resumo: "Entradas" sem compra só registro (signed_quantity 0) e sem correção.

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
        (s.opened_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_start_date AND p_end_date
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
          AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse AND o.is_paid
      ), 0),
      'num_pedidos', COALESCE((
        SELECT COUNT(*) FROM orders o
        WHERE o.session_id = v_session.id
          AND o.status NOT IN ('cancelled', 'draft')
          AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse AND o.is_paid
      ), 0),
      'num_cancelados', COALESCE((
        SELECT COUNT(*) FROM orders o
        WHERE o.session_id = v_session.id AND o.status = 'cancelled' AND NOT o.is_training AND NOT o.ifood_repasse
      ), 0),
      'total_descontos', COALESCE((
        SELECT SUM(o.discount_amount) FROM orders o
        WHERE o.session_id = v_session.id AND o.status NOT IN ('cancelled', 'draft')
          AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse AND NOT o.is_cortesia
      ), 0),
      'num_cortesias', COALESCE((
        SELECT COUNT(*) FROM orders o
        WHERE o.session_id = v_session.id AND o.status NOT IN ('cancelled', 'draft')
          AND NOT o.is_training AND NOT o.is_draft AND o.is_cortesia
      ), 0),
      'valor_cortesias', COALESCE((
        SELECT SUM(o.subtotal) FROM orders o
        WHERE o.session_id = v_session.id AND o.status NOT IN ('cancelled', 'draft')
          AND NOT o.is_training AND NOT o.is_draft AND o.is_cortesia
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_dashboard_pico(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text := 'America/Sao_Paulo';
  -- início do dia de operação atual (6h de Brasília; de madrugada ainda é o dia anterior)
  v_op timestamptz := (date_trunc('day', (now() at time zone 'America/Sao_Paulo') - interval '6 hours') + interval '6 hours') at time zone 'America/Sao_Paulo';
begin
  if not (auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') or public.auth_is_member_of(p_tenant_id)) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;

  -- Média = pedidos naquele dia da semana e hora ÷ quantos daquele dia da semana tiveram pedido nas
  -- últimas 4 semanas (antes dividia sempre por 4: loja com 2 domingos de histórico saía com metade).
  -- Dia de operação com virada às 6h (pela hora do pedido, não pela sessão: uma sessão esquecida aberta
  -- juntaria dois dias no mesmo dia da semana).
  return coalesce((
    with ped as (
      select ((o.created_at at time zone v_tz) - interval '6 hours')::date as dia,
             extract(hour from o.created_at at time zone v_tz)::int as h
      from orders o
      where o.tenant_id = p_tenant_id
        and o.created_at >= v_op - interval '28 days' and o.created_at < v_op
        and o.status not in ('cancelled', 'draft') and not o.is_training and not o.is_draft and o.is_paid
    ), dias as (
      select extract(dow from dia)::int as dw, count(distinct dia) as n from ped group by 1
    ), x as (
      select extract(dow from dia)::int as d, h, count(*) as n from ped group by 1, 2
    )
    select jsonb_agg(jsonb_build_object('d', x.d, 'h', x.h, 'p', round(x.n::numeric / dias.n, 1)) order by x.d, x.h)
    from x join dias on dias.dw = x.d
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_contas_painel(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_inicio date;
  v_out jsonb;
begin
  if p_tenant is null then return null; end if;
  if auth.uid() is not null and p_tenant not in (select public.auth_lojas_financeiro()) then
    raise exception 'sem acesso ao financeiro desta loja' using errcode = '42501';
  end if;

  select coalesce(financeiro_inicio, date '2000-01-01') into v_inicio
    from fin_revenue_settings where tenant_id = p_tenant;
  v_inicio := coalesce(v_inicio, date '2000-01-01');

  with
  ab as (
    select c.*, a.installment_number as parcela, a.installments as parcelas, a.payment_method as forma_conta,
           a.boleto_origem, a.created_at as criada_em, dc.todo_mes as fixa,
           pu.id as compra_id, pu.invoice_number, pu.purchase_date, pu.payment_method as forma_compra,
           coalesce(pu.delivery_confirmed_at, pu.stock_applied_at) as chegou_em,
           case when pu.id is not null then public.fn_compra_espera_chegar(pu.id) else false end as espera_chegar,
           f.numero as nf_numero, (f.emitted_at at time zone 'America/Sao_Paulo')::date as nf_emitida, f.modelo as nf_modelo
      from public.fn_contas_em_aberto(array[p_tenant]) c
      join fin_accounts_payable a on a.id = c.id
      left join fin_dre_categories dc on dc.id = a.dre_category_id
      left join fin_purchases pu on c.origem = 'purchase' and pu.id = c.reference_id
      left join lateral (
        select fd.numero, fd.emitted_at, fd.modelo from fiscal_inbound_documents fd
         where fd.tenant_id = p_tenant
           and ((pu.id is not null and fd.purchase_id = pu.id) or a.id = any (fd.payable_ids))
         order by fd.emitted_at desc limit 1) f on true
  ),
  pg as (
    select a.id, coalesce(nullif(trim(a.supplier), ''), a.description, 'Conta') as nome, a.description as descricao,
           coalesce(a.paid_amount, a.amount) as valor, a.paid_date as pago_em, a.payment_method as forma,
           a.reference_type as origem, dc.todo_mes as fixa,
           pu.invoice_number, coalesce(pu.delivery_confirmed_at, pu.stock_applied_at) as chegou_em,
           f.numero as nf_numero,
           exists (select 1 from fin_bank_statement_imports s
                    where s.tenant_id = p_tenant and s.status in ('matched', 'reconciled')
                      and (s.match_ref_id = a.id or s.match_detail -> 'confirmed' -> 'bill_ids' ? a.id::text)) as banco
      from fin_accounts_payable a
      left join fin_dre_categories dc on dc.id = a.dre_category_id
      left join fin_purchases pu on a.reference_type = 'purchase' and pu.id = a.reference_id
      left join lateral (
        select fd.numero from fiscal_inbound_documents fd
         where fd.tenant_id = p_tenant and ((pu.id is not null and fd.purchase_id = pu.id) or a.id = any (fd.payable_ids))
         limit 1) f on true
     where a.tenant_id = p_tenant and a.status = 'paid'
       and a.paid_date >= v_hoje - 35
       and coalesce(a.reference_type, '') <> 'conciliacao_juros'
  ),
  notas as (
    select fd.id, fd.emitente_nome as nome, fd.numero, fd.emitted_at, fd.valor_total,
           (p.value ->> 'valor')::numeric as valor, (p.value ->> 'vencimento')::date as vencimento,
           p.ordinality as parcela, jsonb_array_length(fd.parcelas) as parcelas
      from fiscal_inbound_documents fd
      cross join lateral jsonb_array_elements(fd.parcelas) with ordinality p
     where fd.tenant_id = p_tenant and fd.status = 'new'
       and coalesce(fd.sefaz_status, 1) <> 2
       and fd.emitted_at::date >= v_inicio
       and jsonb_typeof(fd.parcelas) = 'array' and jsonb_array_length(fd.parcelas) > 0
       and nullif(p.value ->> 'vencimento', '') is not null
  ),
  extrato as (
    select s.id, s.transaction_date::date as data, s.amount as valor, s.description as descricao,
           s.source, s.transaction_type as tipo, s.bank_account_id
      from fin_bank_statement_imports s
     where s.tenant_id = p_tenant and s.status = 'pending'
       and s.transaction_date::date >= v_inicio
       and s.source is distinct from 'stone'   -- linhas 'stone' são o arquivo de vendas da maquininha, não o banco
       and coalesce(s.category, '') not in ('Transferência entre contas')
  ),
  -- vendas por dia (data da venda), últimos ~200 dias:
  -- pdv = o que foi registrado no caixa (todas as formas); adq = cartão das maquininhas (data da venda)
  pdv as (
    select (p.created_at at time zone 'America/Sao_Paulo')::date as d,
           sum(p.amount - coalesce(p.change_amount, 0)) as total,
           sum(p.amount) filter (where pm.type::text in ('credit_card', 'debit_card')) as cartao
      from payments p
      left join payment_methods pm on pm.id = p.payment_method_id
      left join orders o on o.id = p.order_id
     where p.tenant_id = p_tenant and not coalesce(p.is_refunded, false)
       and o.ifood_order_id is null   -- iFood entra pelo repasse exato (fin_ifood_entries), não pela média
       and p.created_at >= (v_hoje - 200)::timestamp
     group by 1
  ),
  adq as (
    select d, sum(bruto) as cartao, sum(bruto - liquido) as taxa from (
      select (s.stone_installment_info ->> 'capture_date')::date as d,
             (s.stone_installment_info ->> 'gross_amount')::numeric * greatest(1, coalesce((s.stone_installment_info ->> 'total_installments')::int, 1)) as bruto,
             (s.stone_installment_info ->> 'net_amount')::numeric * greatest(1, coalesce((s.stone_installment_info ->> 'total_installments')::int, 1)) as liquido
        from fin_bank_statement_imports s
       where s.tenant_id = p_tenant and s.source = 'stone' and s.transaction_type = 'credit'
         and coalesce((s.stone_installment_info ->> 'installment_number')::int, 1) = 1
      union all
      select (s.raw ->> 'approved_date')::date, (s.raw ->> 'gross')::numeric, coalesce((s.raw ->> 'net')::numeric, s.amount)
        from fin_bank_statement_imports s
       where s.tenant_id = p_tenant and s.source = 'mercadopago' and s.transaction_type = 'credit'
         and s.raw ->> 'payment_type' in ('credit_card', 'debit_card', 'prepaid_card')
    ) x where d >= v_hoje - 200 group by d
  ),
  dias as (
    select coalesce(pdv.d, adq.d) as d, pdv.total as pdv_total, pdv.cartao as pdv_cartao,
           adq.cartao as adq_cartao, adq.taxa as adq_taxa
      from pdv full join adq on adq.d = pdv.d
  )
  select jsonb_build_object(
    'hoje', v_hoje,
    'inicio', nullif(v_inicio, date '2000-01-01'),
    'abertas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nome', nome, 'descricao', descricao, 'valor', valor, 'total', total, 'vencimento', vencimento,
        'status', status, 'origem', origem, 'reference_id', reference_id,
        'forma', coalesce(forma_conta, forma_compra), 'tem_boleto', tem_boleto, 'boleto_origem', boleto_origem, 'ja_paga', ja_paga,
        'parcela', parcela, 'parcelas', parcelas, 'fixa', coalesce(fixa, false),
        'compra_id', compra_id, 'nf', coalesce(nf_numero::text, nullif(invoice_number, '')), 'nf_sefaz', nf_numero is not null,
        'nf_emitida', nf_emitida, 'compra_em', purchase_date, 'chegou_em', chegou_em, 'espera_chegar', espera_chegar
      ) order by vencimento) from ab), '[]'::jsonb),
    'pagas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nome', nome, 'descricao', descricao, 'valor', valor, 'pago_em', pago_em, 'forma', forma,
        'origem', origem, 'fixa', coalesce(fixa, false), 'nf', coalesce(nf_numero::text, nullif(invoice_number, '')),
        'chegou_em', chegou_em, 'banco', banco
      ) order by pago_em desc) from pg), '[]'::jsonb),
    'notas_sem_conta', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id || ':' || parcela, 'doc_id', id, 'nome', nome, 'numero', numero, 'emitida', (emitted_at at time zone 'America/Sao_Paulo')::date,
        'valor', valor, 'vencimento', vencimento, 'parcela', parcela, 'parcelas', parcelas
      ) order by vencimento) from notas), '[]'::jsonb),
    'extrato_pendente', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', data, 'valor', valor, 'descricao', descricao, 'source', source, 'tipo', tipo, 'bank_account_id', bank_account_id
      ) order by data) from extrato), '[]'::jsonb),
    'saldos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'nome', b.name, 'saldo', coalesce(b.synced_balance, b.current_balance, 0),
        'atualizado_em', b.synced_balance_at, 'integrado', b.synced_provider is not null
      ) order by b.name) from fin_bank_accounts b where b.tenant_id = p_tenant and b.is_active), '[]'::jsonb),
    'vendas', coalesce((select jsonb_agg(jsonb_build_object(
        'd', d, 'pdv_total', pdv_total, 'pdv_cartao', pdv_cartao, 'adq_cartao', adq_cartao, 'adq_taxa', adq_taxa
      ) order by d) from dias where d is not null), '[]'::jsonb),
    'ifood', coalesce((select jsonb_agg(jsonb_build_object('data', data_repasse, 'valor', valor) order by data_repasse)
        -- Mesma regra da agenda de recebíveis (fin_ifood_repasses_base: só o que impacta o repasse,
        -- menos a antecipação; bateu centavo a centavo com o Inter). Antes somava todas as linhas
        -- do relatório e errava o repasse para mais ou para menos (07/10: +82,46).
        from (select r.data_repasse, r.esperado as valor
                from public.fin_ifood_repasses_base(p_tenant, v_hoje + 1, v_hoje + 120) r
               where r.recebido_inter = 0) z), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_estoque_mov_resumo(p_tenant_id uuid, p_de timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ate timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v jsonb;
  v_dias jsonb;
begin
  perform public._assert_tenant_access(p_tenant_id);

  with m as (
    select sm.type::text as tipo, sm.quantity, sm.signed_quantity, coalesce(sm.reason, '') as motivo, sm.order_id,
           sm.production_batch_id, sm.created_at,
           coalesce(nullif(i.unit_price, 0), i.last_purchase_price, 0) as preco
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
     where sm.tenant_id = p_tenant_id
       and (p_de is null or sm.created_at >= p_de)
       and (p_ate is null or sm.created_at <= p_ate)
  )
  select jsonb_build_object(
    -- mercadoria que entrou (compra, entrada manual); sem volta de venda cancelada, produção, estorno,
    -- "compra (só registro)" (signed_quantity = 0: não entrou no estoque) e correção de conversão
    'entradas', count(*) filter (where tipo = 'in' and order_id is null and production_batch_id is null
                                   and coalesce(signed_quantity, 1) <> 0 and motivo !~* '^(estorno|entrada \(produ|corre)'),
    'entradas_custo', round(coalesce(sum(quantity * preco) filter (where tipo = 'in' and order_id is null
                                   and production_batch_id is null and coalesce(signed_quantity, 1) <> 0
                                   and motivo !~* '^(estorno|entrada \(produ|corre)'), 0), 2),
    'vendas', count(*) filter (where tipo = 'theoretical_out'),
    'vendas_custo', round(coalesce(sum(quantity * preco) filter (where tipo = 'theoretical_out'), 0), 2),
    'saidas', count(*) filter (where tipo = 'manual_out' and production_batch_id is null and motivo !~* '^(estorno|sa[ií]da \(produ)'),
    'perdas', count(*) filter (where tipo = 'loss' and coalesce(signed_quantity, -1) <> 0),
    'perdas_custo', round(coalesce(sum(quantity * preco) filter (where tipo = 'loss' and coalesce(signed_quantity, -1) <> 0), 0), 2),
    'producoes', count(distinct production_batch_id) filter (where production_batch_id is not null),
    'ajustes_contagem', count(*) filter (where tipo = 'inventory_adjustment')
  ) into v from m;

  -- Baixas de venda por dia (Brasília): uma linha por dia na lista.
  select coalesce(jsonb_agg(d order by d->>'dia' desc), '[]'::jsonb) into v_dias from (
    select jsonb_build_object(
             'dia', (sm.created_at at time zone 'America/Sao_Paulo')::date,
             'linhas', count(*),
             'pedidos', count(distinct sm.order_id),
             'custo', round(sum(sm.quantity * coalesce(nullif(i.unit_price, 0), i.last_purchase_price, 0)), 2)
           ) as d
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
     where sm.tenant_id = p_tenant_id and sm.type = 'theoretical_out'
       and (p_de is null or sm.created_at >= p_de)
       and (p_ate is null or sm.created_at <= p_ate)
     group by (sm.created_at at time zone 'America/Sao_Paulo')::date
  ) z;

  return v || jsonb_build_object('vendas_por_dia', v_dias);
end;
$function$
;
