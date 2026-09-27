-- Pedido de pagamento de freelancer com valor POR DIA (2026-09-27, pedido do dono).
-- Antes: um valor total dividido igualmente pelos dias. Agora quem pede informa o valor de cada dia
-- trabalhado; o total é a soma (calculada pela Edge, não digitada). valores_dia[i] vale para dias[i]
-- (a Edge grava os dois ordenados e alinhados). Pedido antigo (sem valores_dia) segue dividindo.

alter table public.fin_payment_requests add column if not exists valores_dia numeric(12,2)[];

create or replace function public.fn_pedido_pagamento_aprovar(p_id uuid, p_user uuid, p_user_nome text, p_dre uuid DEFAULT NULL::uuid, p_valor numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r fin_payment_requests;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_valor numeric(12,2);
  v_dre uuid;
  v_dre_nome text;
  v_free uuid;
  v_bill uuid;
  v_n int;
  v_parte numeric(12,2);
  v_i int;
  v_nota text;
  v_por_dia boolean := false;
  v_valores numeric(12,2)[];
begin
  select * into r from fin_payment_requests where id = p_id for update;
  if not found then raise exception 'pedido não encontrado'; end if;
  if r.status <> 'pendente' then raise exception 'esse pedido já foi %', r.status; end if;

  -- Reembolso de mercadoria: a compra já foi lançada no recebimento (CMV + estoque) SEM conta a pagar.
  -- Aprovar cria a conta da compra (mesma forma do purchase-write), em nome de quem recebe o Pix.
  if r.purchase_id is not null then
    if r.bill_id is null then
      insert into fin_accounts_payable (tenant_id, supplier, description, category, amount, due_date, status,
                                        is_recurring, payment_method, notes, reference_id, reference_type)
      select r.tenant_id, trim(r.favorecido_nome), 'Reembolso — compra em ' || pu.supplier, 'Compras', r.valor, v_hoje, 'pending',
             false, 'PIX',
             concat_ws(' · ', 'Reembolso pedido pelo app por ' || coalesce(r.solicitado_por_nome, 'alguém da loja'),
                       'aprovado por ' || coalesce(p_user_nome, 'dono'), 'Pix: ' || r.pix_chave, 'baixa pela conciliação'),
             pu.id, 'purchase'
        from fin_purchases pu where pu.id = r.purchase_id and pu.tenant_id = r.tenant_id
      returning id into v_bill;
      if v_bill is null then raise exception 'a compra desse reembolso não existe mais'; end if;
    else
      v_bill := r.bill_id;
    end if;
    update fin_payment_requests set status = 'aprovada', bill_id = v_bill, decidido_por = p_user, decidido_por_nome = p_user_nome,
      decidido_em = now(), updated_at = now() where id = r.id;
    update pendencias set status = 'resolvida', resolvida_em = now(), resolvida_por = p_user, updated_at = now()
      where tenant_id = r.tenant_id and kind = 'pedido_pagamento' and ref = r.id::text and status in ('aberta', 'vista');
    return jsonb_build_object('ok', true, 'bill_id', v_bill, 'valor', r.valor);
  end if;

  -- Freela com valor por dia: pares (dia, valor) ordenados; o total é a soma
  if r.tipo = 'freelancer' and r.valores_dia is not null
     and array_length(r.valores_dia, 1) = array_length(r.dias, 1)
     and (select count(distinct d) from unnest(r.dias) d where d is not null) = array_length(r.dias, 1)
     and not exists (select 1 from unnest(r.valores_dia) v where v is null or v <= 0) then
    select array_agg(x.d order by x.d), array_agg(x.v order by x.d) into r.dias, v_valores
      from unnest(r.dias, r.valores_dia) as x(d, v);
    v_por_dia := true;
    -- Aprovar com outro total (não usado pela tela hoje) volta a dividir igualmente
    if p_valor is not null and p_valor <> (select sum(v) from unnest(v_valores) v) then v_por_dia := false; end if;
  end if;

  v_valor := coalesce(p_valor, case when v_por_dia then (select sum(v) from unnest(v_valores) v) end, r.valor);
  if v_valor is null or v_valor <= 0 then raise exception 'valor inválido'; end if;
  v_nota := concat_ws(' · ',
    'Pedido pelo app de ' || coalesce(r.solicitado_por_nome, 'alguém da loja'),
    'aprovado por ' || coalesce(p_user_nome, 'dono'),
    case when r.pix_chave is not null then 'Pix: ' || r.pix_chave end,
    case when r.favorecido_doc is not null then 'Doc: ' || r.favorecido_doc end,
    'baixa pela conciliação');

  if r.tipo = 'freelancer' then
    if not v_por_dia then
      r.dias := (select array_agg(distinct d order by d) from unnest(r.dias) d where d is not null);
    end if;
    if coalesce(array_length(r.dias, 1), 0) = 0 then raise exception 'pedido de freelancer sem os dias trabalhados'; end if;
    v_free := r.freelancer_id;
    if v_free is null then
      select id into v_free from hr_freelancers where tenant_id = r.tenant_id and lower(name) = lower(trim(r.favorecido_nome)) order by created_at limit 1;
    end if;
    if v_free is null then
      insert into hr_freelancers (tenant_id, name, cpf, role)
      values (r.tenant_id, trim(r.favorecido_nome), nullif(r.favorecido_doc, ''), nullif(trim(r.freelancer_funcao), ''))
      returning id into v_free;
    end if;
    if exists (select 1 from hr_freelancer_shifts s where s.freelancer_id = v_free and s.status = 'registrada' and s.work_date = any (r.dias)) then
      raise exception 'Já existe diária registrada para % em % (foi pago antes?). Recuse este pedido ou confira em Financeiro › Freelancers.',
        trim(r.favorecido_nome), (select string_agg(to_char(s.work_date, 'DD/MM'), ', ' order by s.work_date) from hr_freelancer_shifts s
                                  where s.freelancer_id = v_free and s.status = 'registrada' and s.work_date = any (r.dias));
    end if;
    select id, name into v_dre, v_dre_nome from fin_dre_categories
      where tenant_id = r.tenant_id and lower(name) = 'rh' and group_type = 'expense' and parent_id is null and deleted_at is null limit 1;
    if v_dre is null then
      insert into fin_dre_categories (tenant_id, name, group_type) values (r.tenant_id, 'RH', 'expense') returning id into v_dre;
    end if;
    insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                      payment_method, dre_category_id, reference_type, reference_id, notes)
    values (r.tenant_id, _fn_freelancer_descricao(trim(r.favorecido_nome), r.dias), trim(r.favorecido_nome), 'RH', v_valor,
            v_hoje, 'pending', 'Pix', v_dre, 'freelancer', v_free, v_nota)
    returning id into v_bill;
    -- Diárias: valor de cada dia (pedido novo) ou total dividido pelos dias (centavos que sobram no último)
    v_n := array_length(r.dias, 1);
    v_parte := trunc(v_valor / v_n, 2);
    for v_i in 1..v_n loop
      insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status, notes)
      values (r.tenant_id, v_free, r.dias[v_i],
              case when v_por_dia then v_valores[v_i]
                   when v_i = v_n then v_valor - v_parte * (v_n - 1) else v_parte end,
              v_bill, 'registrada', 'Pedido de pagamento pelo app');
    end loop;
  else
    v_dre := coalesce(p_dre, r.dre_category_id);
    if v_dre is null then raise exception 'escolha a classificação (DRE) antes de aprovar'; end if;
    select name into v_dre_nome from fin_dre_categories
      where id = v_dre and tenant_id = r.tenant_id and deleted_at is null and group_type not in ('revenue', 'tax');
    if v_dre_nome is null then raise exception 'classificação inválida para esta loja'; end if;
    insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                      payment_method, dre_category_id, reference_type, reference_id, notes)
    values (r.tenant_id,
            case when r.tipo = 'reembolso' then 'Reembolso — ' || r.descricao else r.descricao || ' (sem nota)' end,
            trim(r.favorecido_nome), v_dre_nome, v_valor,
            case when r.tipo = 'fornecedor' then greatest(coalesce(r.vencimento, v_hoje), v_hoje) else v_hoje end,
            'pending', 'Pix', v_dre, 'pedido_pagamento', r.id, v_nota)
    returning id into v_bill;
  end if;

  update fin_payment_requests set status = 'aprovada', valor = v_valor, bill_id = v_bill, dias = r.dias,
    valores_dia = case when v_por_dia then v_valores else null end,
    dre_category_id = coalesce(v_dre, dre_category_id), freelancer_id = coalesce(v_free, freelancer_id),
    decidido_por = p_user, decidido_por_nome = p_user_nome, decidido_em = now(), updated_at = now()
  where id = r.id;
  update pendencias set status = 'resolvida', resolvida_em = now(), resolvida_por = p_user, updated_at = now()
    where tenant_id = r.tenant_id and kind = 'pedido_pagamento' and ref = r.id::text and status in ('aberta', 'vista');
  return jsonb_build_object('ok', true, 'bill_id', v_bill, 'valor', v_valor);
end $function$;
revoke all on function public.fn_pedido_pagamento_aprovar(uuid, uuid, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.fn_pedido_pagamento_aprovar(uuid, uuid, text, uuid, numeric) to service_role;
