-- ═══════════════════════════════════════════════════════════════════════════
-- Pedidos de pagamento — ajustes da revisão (2026-09-24)
--  • Reembolso de mercadoria: a compra entra SEM conta a pagar; a conta nasce só quando o dono aprova
--    (antes nascia no lançamento, vencendo hoje, sem aprovação). Recusado: a compra fica, sem conta.
--  • Freela: aprovar recusa se já há diária registrada nos mesmos dias (pago antes pelo grupo/Inter);
--    o Pix do Inter adota a conta do pedido também pela chave Pix / favorecido / nome do pedido;
--    "Lançar a partir deste pagamento › Freelancer" bloqueia quando o Pix é de um pedido aprovado.
--  • Diárias divididas com trunc() (round podia deixar a última negativa).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Aprovar: vira conta a pagar em aberto (uma transação) ──
create or replace function public.fn_pedido_pagamento_aprovar(
  p_id uuid, p_user uuid, p_user_nome text, p_dre uuid default null, p_valor numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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

  v_valor := coalesce(p_valor, r.valor);
  if v_valor is null or v_valor <= 0 then raise exception 'valor inválido'; end if;
  v_nota := concat_ws(' · ',
    'Pedido pelo app de ' || coalesce(r.solicitado_por_nome, 'alguém da loja'),
    'aprovado por ' || coalesce(p_user_nome, 'dono'),
    case when r.pix_chave is not null then 'Pix: ' || r.pix_chave end,
    case when r.favorecido_doc is not null then 'Doc: ' || r.favorecido_doc end,
    'baixa pela conciliação');

  if r.tipo = 'freelancer' then
    r.dias := (select array_agg(distinct d order by d) from unnest(r.dias) d where d is not null);
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
    -- Diárias: valor dividido pelos dias (centavos que sobram no último)
    v_n := array_length(r.dias, 1);
    v_parte := trunc(v_valor / v_n, 2);
    for v_i in 1..v_n loop
      insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status, notes)
      values (r.tenant_id, v_free, r.dias[v_i],
              case when v_i = v_n then v_valor - v_parte * (v_n - 1) else v_parte end,
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
    dre_category_id = coalesce(v_dre, dre_category_id), freelancer_id = coalesce(v_free, freelancer_id),
    decidido_por = p_user, decidido_por_nome = p_user_nome, decidido_em = now(), updated_at = now()
  where id = r.id;
  update pendencias set status = 'resolvida', resolvida_em = now(), resolvida_por = p_user, updated_at = now()
    where tenant_id = r.tenant_id and kind = 'pedido_pagamento' and ref = r.id::text and status in ('aberta', 'vista');
  return jsonb_build_object('ok', true, 'bill_id', v_bill, 'valor', v_valor);
end $$;
revoke all on function public.fn_pedido_pagamento_aprovar(uuid, uuid, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.fn_pedido_pagamento_aprovar(uuid, uuid, text, uuid, numeric) to service_role;

create or replace function public.fn_freelancer_registrar_pagamento(p_payment_id uuid, p_dias date[] default null, p_funcao text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  p fin_inter_payments;
  v_nome text;
  v_free uuid;
  v_novo boolean := false;
  v_cat uuid;
  v_bill uuid;
  v_ja int;
  v_n int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into p from fin_inter_payments where id = p_payment_id;
  if not found then raise exception 'pagamento não encontrado'; end if;
  if not _fn_freelancer_pode(p.tenant_id) then raise exception 'sem acesso a esta loja'; end if;
  if p.status in ('cancelled', 'expired', 'rejected', 'failed') then raise exception 'pagamento % não vale (%): nada a registrar', p.id, p.status; end if;
  if coalesce(p.amount, 0) <= 0 then raise exception 'pagamento sem valor'; end if;
  if exists (select 1 from unnest(coalesce(p_dias, '{}'::date[])) d where d > v_hoje + 7 or d < v_hoje - 90) then
    raise exception 'dia fora do esperado (até 90 dias atrás ou 7 à frente)';
  end if;
  v_nome := coalesce(nullif(trim(p.beneficiary_name), ''), (select name from fin_pix_favorecidos where id = p.favorecido_id));
  if v_nome is null then raise exception 'pagamento sem nome de quem recebeu'; end if;

  -- 0) Pedido de freela aprovado pelo app, ainda em aberto e sem outro Pix: casa pela chave Pix do
  --    pedido, pelo favorecido ou pelo nome (o banco devolve o nome civil, que pode diferir do digitado).
  if p.bill_id is null then
    select pr.freelancer_id, ap.id into v_free, v_bill
      from fin_payment_requests pr join fin_accounts_payable ap on ap.id = pr.bill_id
      where pr.tenant_id = p.tenant_id and pr.tipo = 'freelancer' and pr.status = 'aprovada'
        and ap.status in ('pending', 'overdue') and ap.amount = p.amount and ap.reference_type = 'freelancer'
        and not exists (select 1 from fin_inter_payments ip where ip.bill_id = ap.id and ip.id <> p.id
                          and ip.status not in ('cancelled', 'expired', 'rejected', 'failed'))
        and ((p.pix_key is not null and lower(trim(pr.pix_chave)) = lower(trim(p.pix_key)))
          or (p.favorecido_id is not null and exists (select 1 from hr_freelancers f where f.id = pr.freelancer_id and f.pix_favorecido_id = p.favorecido_id))
          or lower(trim(pr.favorecido_nome)) = lower(v_nome))
      order by ap.due_date limit 1;
    if v_bill is not null then
      update fin_inter_payments set bill_id = v_bill, updated_at = now() where id = p.id and bill_id is null;
      p.bill_id := v_bill;
      if p.favorecido_id is not null then
        update hr_freelancers set pix_favorecido_id = p.favorecido_id, updated_at = now() where id = v_free and pix_favorecido_id is null;
      end if;
    end if;
  end if;

  -- 1) freelancer
  if v_free is null and p.favorecido_id is not null then
    select id into v_free from hr_freelancers where tenant_id = p.tenant_id and pix_favorecido_id = p.favorecido_id;
  end if;
  if v_free is null then
    select id into v_free from hr_freelancers where tenant_id = p.tenant_id and lower(name) = lower(v_nome) order by created_at limit 1;
    if v_free is not null and p.favorecido_id is not null then
      update hr_freelancers set pix_favorecido_id = p.favorecido_id, updated_at = now() where id = v_free and pix_favorecido_id is null;
    end if;
  end if;
  if v_free is null then
    insert into hr_freelancers (tenant_id, name, role, pix_favorecido_id)
    values (p.tenant_id, v_nome, nullif(trim(p_funcao), ''), p.favorecido_id) returning id into v_free;
    v_novo := true;
  elsif nullif(trim(p_funcao), '') is not null then
    update hr_freelancers set role = trim(p_funcao), updated_at = now() where id = v_free and role is null;
  end if;

  -- 2) conta a pagar (uma por Pix)
  v_bill := p.bill_id;
  if v_bill is null then
    -- Pedido aprovado pelo app (mesmo freela, mesmo valor, ainda em aberto e sem outro Pix): é esta conta.
    select ap.id into v_bill from fin_accounts_payable ap
      join fin_payment_requests pr on pr.bill_id = ap.id and pr.tipo = 'freelancer' and pr.status = 'aprovada'
      where ap.tenant_id = p.tenant_id and ap.reference_type = 'freelancer' and ap.reference_id = v_free
        and ap.status in ('pending', 'overdue') and ap.amount = p.amount
        and not exists (select 1 from fin_inter_payments ip where ip.bill_id = ap.id and ip.id <> p.id
                          and ip.status not in ('cancelled', 'expired', 'rejected', 'failed'))
      order by ap.due_date limit 1;
    if v_bill is not null then
      update fin_inter_payments set bill_id = v_bill, updated_at = now() where id = p.id and bill_id is null;
    end if;
  end if;
  if v_bill is null then
    select id into v_cat from fin_dre_categories
      where tenant_id = p.tenant_id and lower(name) = 'rh' and group_type = 'expense' and parent_id is null and deleted_at is null limit 1;
    if v_cat is null then
      insert into fin_dre_categories (tenant_id, name, group_type) values (p.tenant_id, 'RH', 'expense') returning id into v_cat;
    end if;
    insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                      payment_method, dre_category_id, reference_type, reference_id, notes)
    values (p.tenant_id, _fn_freelancer_descricao(v_nome, p_dias), v_nome, 'RH', p.amount,
            coalesce((p.paid_at at time zone 'America/Sao_Paulo')::date, v_hoje), 'pending',
            'Pix', v_cat, 'freelancer', v_free, 'Pagamento de freelancer pelo Inter (baixa pela conciliação).')
    returning id into v_bill;
    update fin_inter_payments set bill_id = v_bill, updated_at = now() where id = p.id and bill_id is null;
  elsif p_dias is not null then
    update fin_accounts_payable set description = _fn_freelancer_descricao(v_nome, p_dias), updated_at = now()
      where id = v_bill and reference_type = 'freelancer';
  end if;

  -- 3a) diárias gravadas pelo pedido do app (mesma conta, ainda sem Pix): passam a ser deste pagamento
  -- (com dias novos, o passo 3 apaga pelo payment_id e regrava — não sobra diária em dobro).
  update hr_freelancer_shifts set payment_id = p.id, updated_at = now()
    where bill_id = v_bill and payment_id is null;

  -- 3) diárias (não apaga dias já informados se a chamada não trouxe dias)
  select count(*) into v_ja from hr_freelancer_shifts where payment_id = p.id and status = 'registrada';
  if p_dias is not null or v_ja = 0 then
    v_n := _fn_freelancer_gravar_diarias(p, v_free, v_bill, p_dias);
  else
    v_n := v_ja;
  end if;

  return jsonb_build_object(
    'freelancer_id', v_free, 'freelancer', v_nome, 'freelancer_novo', v_novo,
    'conta_a_pagar_id', v_bill, 'dias_registrados', v_n, 'aguardando_dias', v_n = 0,
    'valor', p.amount, 'pagamento_pago', p.status = 'paid');
end $$;
grant execute on function public.fn_freelancer_registrar_pagamento(uuid, date[], text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_freelancer_do_extrato(p_bill_id uuid, p_nome text, p_dias date[] DEFAULT NULL::date[], p_funcao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b fin_accounts_payable;
  v_nome text := nullif(trim(p_nome), '');
  v_free uuid;
  v_novo boolean := false;
  v_dias date[];
  v_n int;
  v_parte numeric(12,2);
  v_i int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into b from fin_accounts_payable where id = p_bill_id;
  if not found then raise exception 'conta a pagar nao encontrada'; end if;
  if not _fn_freelancer_pode(b.tenant_id) then raise exception 'sem acesso a esta loja'; end if;
  if v_nome is null then raise exception 'sem nome de quem recebeu'; end if;
  if coalesce(b.amount, 0) <= 0 then raise exception 'conta sem valor'; end if;
  if exists (select 1 from unnest(coalesce(p_dias, '{}'::date[])) d where d > v_hoje + 7 or d < v_hoje - 365) then
    raise exception 'dia fora do esperado (ate um ano atras ou 7 dias a frente)';
  end if;

  -- Pedido de freela aprovado pelo app (mesmo valor, mesmo nome) com conta em aberto: esse Pix é dele.
  -- Lançar de novo daria duas contas e diárias em dobro — o certo é ligar o débito à conta do pedido.
  if exists (select 1 from fin_payment_requests pr join fin_accounts_payable ap on ap.id = pr.bill_id
             where pr.tenant_id = b.tenant_id and pr.tipo = 'freelancer' and pr.status = 'aprovada'
               and ap.status in ('pending', 'overdue') and ap.amount = b.amount and ap.id <> b.id
               and split_part(lower(trim(pr.favorecido_nome)), ' ', 1) = split_part(lower(v_nome), ' ', 1)) then
    raise exception 'Esse Pix parece ser do pedido de freelancer aprovado pelo app (mesmo nome e valor). Ligue o pagamento à conta a pagar desse pedido em vez de lançar de novo.';
  end if;

  select id into v_free from hr_freelancers
    where tenant_id = b.tenant_id and lower(name) = lower(v_nome) order by created_at limit 1;
  if v_free is null then
    insert into hr_freelancers (tenant_id, name, role)
    values (b.tenant_id, v_nome, nullif(trim(p_funcao), '')) returning id into v_free;
    v_novo := true;
  elsif nullif(trim(p_funcao), '') is not null then
    update hr_freelancers set role = trim(p_funcao), updated_at = now() where id = v_free and role is null;
  end if;

  v_dias := (select array_agg(distinct d order by d) from unnest(coalesce(p_dias, '{}'::date[])) d where d is not null);
  v_n := coalesce(array_length(v_dias, 1), 0);
  delete from hr_freelancer_shifts where bill_id = b.id;
  if v_n = 0 then
    insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status)
    values (b.tenant_id, v_free, null, b.amount, b.id, 'aguardando_dias');
  else
    v_parte := trunc(b.amount / v_n, 2);
    for v_i in 1..v_n loop
      insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status)
      values (b.tenant_id, v_free, v_dias[v_i],
              case when v_i = v_n then b.amount - v_parte * (v_n - 1) else v_parte end,
              b.id, 'registrada');
    end loop;
  end if;

  update fin_accounts_payable
    set description = _fn_freelancer_descricao(v_nome, v_dias), supplier = v_nome, updated_at = now()
    where id = b.id;

  return jsonb_build_object(
    'freelancer_id', v_free, 'freelancer', v_nome, 'freelancer_novo', v_novo,
    'conta_a_pagar_id', b.id, 'dias_registrados', v_n, 'aguardando_dias', v_n = 0, 'valor', b.amount);
end $function$;
grant execute on function public.fn_freelancer_do_extrato(uuid, text, date[], text) to authenticated, service_role;
