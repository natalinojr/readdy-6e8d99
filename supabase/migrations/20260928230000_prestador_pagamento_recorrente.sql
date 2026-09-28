-- Pagamento recorrente do prestador MEI (2026-09-28, pedido do dono): no dia combinado nasce um
-- PEDIDO DE PAGAMENTO (fin_payment_requests, tipo 'prestador') com o valor do mês e o cartão no 📥.
-- O dono confere o valor (pode mudar), aprova e segue o caminho normal: fn_pedido_pagamento_aprovar
-- cria a conta em RH na competência → pedidos-pagamento prepara o Pix no Inter → PIN → baixa.
-- Recusar = não paga este mês (o gerador não recria o pedido do mesmo mês).

alter table public.hr_prestadores
  add column if not exists recorrente boolean not null default false,
  add column if not exists competencia_regra text not null default 'prev',
  add column if not exists pix_favorecido_id uuid references public.fin_pix_favorecidos(id) on delete set null,
  -- Dia em que a recorrência foi ligada: o automático só pede pagamentos cujo dia vem DEPOIS disto
  -- (ligar no dia 28 com pagamento no dia 5 não pode gerar o mês que já foi pago)
  add column if not exists recorrente_desde date;
do $$ begin
  alter table public.hr_prestadores add constraint hr_prestadores_competencia_regra_check check (competencia_regra in ('same', 'prev'));
exception when duplicate_object then null; end $$;

alter table public.fin_payment_requests
  add column if not exists prestador_id uuid references public.hr_prestadores(id) on delete set null,
  add column if not exists competencia date;
-- Pedido gerado pela recorrência (cron) não tem quem pediu: solicitado_por fica nulo
alter table public.fin_payment_requests alter column solicitado_por drop not null;
alter table public.fin_payment_requests drop constraint if exists fin_payment_requests_tipo_check;
alter table public.fin_payment_requests add constraint fin_payment_requests_tipo_check
  check (tipo in ('reembolso', 'freelancer', 'fornecedor', 'compra_online', 'prestador'));
-- Um pedido vivo por prestador e mês (dois toques / cron + botão não geram dois)
create unique index if not exists fin_payment_requests_prestador_mes_uidx
  on public.fin_payment_requests (prestador_id, competencia) where tipo = 'prestador' and status in ('pendente', 'aprovada');

-- Quem mexe em prestador (cadastro, chave Pix, pedir pagamento): só admin/gerente da loja — a chave Pix
-- escolhida vira o destino do Pix do pedido (revisão 2026-09-28: bastava ser da loja). Cron/service_role passam.
create or replace function public._fn_prestador_pode(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') in ('service_role', '')
      or (auth.uid() is not null and exists (
            select 1 from public.user_tenants ut
             where ut.user_id = auth.uid() and ut.tenant_id = p_tenant and ut.role::text in ('admin', 'manager')))
$$;
revoke all on function public._fn_prestador_pode(uuid) from public, anon;

-- Pix permitidos da loja para escolher no cadastro do prestador (a lista branca só se edita no Assistente)
create or replace function public.fn_pix_favorecidos_opcoes(p_tenant uuid)
returns table (id uuid, name text, chave text) language plpgsql stable security definer set search_path = public as $$
begin
  if not _fn_prestador_pode(p_tenant) then raise exception 'sem acesso a esta loja'; end if;
  return query select f.id, f.name,
    case when length(f.pix_key) > 6 then left(f.pix_key, 3) || '…' || right(f.pix_key, 3) else f.pix_key end
    from fin_pix_favorecidos f where f.tenant_id = p_tenant and f.is_active order by f.name;
end $$;
revoke all on function public.fn_pix_favorecidos_opcoes(uuid) from public, anon;
grant execute on function public.fn_pix_favorecidos_opcoes(uuid) to authenticated, service_role;

-- Salvar prestador agora com a recorrência
drop function if exists public.fn_prestador_salvar(uuid, uuid, text, text, text, text, numeric, int, boolean, text);
create or replace function public.fn_prestador_salvar(
  p_tenant uuid, p_id uuid, p_name text, p_cpf text, p_cnpj text, p_role text,
  p_valor_mensal numeric, p_dia_pagamento int, p_is_active boolean, p_notes text,
  p_recorrente boolean default false, p_competencia_regra text default 'prev', p_pix_favorecido_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_nome text := nullif(trim(p_name), '');
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
  v_regra text := case when p_competencia_regra = 'same' then 'same' else 'prev' end;
begin
  if not _fn_prestador_pode(p_tenant) then raise exception 'sem acesso a esta loja'; end if;
  if v_nome is null then raise exception 'informe o nome'; end if;
  if v_cpf is not null and length(v_cpf) <> 11 then raise exception 'CPF deve ter 11 dígitos'; end if;
  if v_cnpj is not null and length(v_cnpj) <> 14 then raise exception 'CNPJ deve ter 14 dígitos'; end if;
  if p_valor_mensal is not null and p_valor_mensal < 0 then raise exception 'valor mensal inválido'; end if;
  if coalesce(p_recorrente, false) and (coalesce(p_valor_mensal, 0) <= 0 or p_dia_pagamento is null) then
    raise exception 'para pagamento recorrente informe o valor mensal e o dia do pagamento';
  end if;
  if p_pix_favorecido_id is not null and not exists (
    select 1 from fin_pix_favorecidos where id = p_pix_favorecido_id and tenant_id = p_tenant and is_active) then
    raise exception 'chave Pix não está entre os Pix permitidos desta loja';
  end if;
  if p_id is null then
    insert into hr_prestadores (tenant_id, name, cpf, cnpj, role, valor_mensal, dia_pagamento, is_active, notes, recorrente, competencia_regra, pix_favorecido_id)
    values (p_tenant, v_nome, v_cpf, v_cnpj, nullif(trim(p_role), ''), p_valor_mensal, p_dia_pagamento, coalesce(p_is_active, true),
            nullif(trim(p_notes), ''), coalesce(p_recorrente, false), v_regra, p_pix_favorecido_id)
    returning id into v_id;
    if coalesce(p_recorrente, false) then
      update hr_prestadores set recorrente_desde = (now() at time zone 'America/Sao_Paulo')::date where id = v_id;
    end if;
  else
    update hr_prestadores set name = v_nome, cpf = v_cpf, cnpj = v_cnpj, role = nullif(trim(p_role), ''),
      valor_mensal = p_valor_mensal, dia_pagamento = p_dia_pagamento, is_active = coalesce(p_is_active, true),
      notes = nullif(trim(p_notes), ''), recorrente = coalesce(p_recorrente, false), competencia_regra = v_regra,
      pix_favorecido_id = p_pix_favorecido_id,
      recorrente_desde = case when not coalesce(p_recorrente, false) then null
                              when recorrente then coalesce(recorrente_desde, (now() at time zone 'America/Sao_Paulo')::date)
                              else (now() at time zone 'America/Sao_Paulo')::date end,
      updated_at = now()
    where id = p_id and tenant_id = p_tenant returning id into v_id;
    if v_id is null then raise exception 'prestador não encontrado'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.fn_prestador_salvar(uuid, uuid, text, text, text, text, numeric, int, boolean, text, boolean, text, uuid) from public, anon;
grant execute on function public.fn_prestador_salvar(uuid, uuid, text, text, text, text, numeric, int, boolean, text, boolean, text, uuid) to authenticated, service_role;

-- Gera o pedido do mês. Cron (sem argumentos): todos os recorrentes cujo dia já chegou.
-- Botão "Pedir pagamento agora" (p_prestador + p_forcar): esse prestador, mesmo antes do dia.
create or replace function public.fn_prestador_gerar_pedidos(p_tenant uuid default null, p_prestador uuid default null, p_forcar boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare
  pr hr_prestadores;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ult int := extract(day from (date_trunc('month', v_hoje) + interval '1 month - 1 day'))::int;
  v_comp date;
  v_chave text;
  v_req uuid;
  v_valor text;
  v_n int := 0;
begin
  -- Usuário (tela) só gera para uma loja a que pertence; o cron roda como postgres
  if auth.uid() is not null and (p_tenant is null or not _fn_prestador_pode(p_tenant)) then
    raise exception 'sem acesso a esta loja';
  end if;
  for pr in select * from hr_prestadores
             where is_active and coalesce(valor_mensal, 0) > 0
               and (recorrente or (p_forcar and p_prestador is not null))
               and (p_tenant is null or tenant_id = p_tenant)
               and (p_prestador is null or id = p_prestador) loop
    if not p_forcar and (pr.dia_pagamento is null or extract(day from v_hoje)::int < least(pr.dia_pagamento, v_ult)
        or (date_trunc('month', v_hoje)::date + least(pr.dia_pagamento, v_ult) - 1) < coalesce(pr.recorrente_desde, v_hoje)) then continue; end if;
    v_comp := case when pr.competencia_regra = 'same' then date_trunc('month', v_hoje)::date
                   else (date_trunc('month', v_hoje) - interval '1 month')::date end;
    -- Já tem pedido vivo do mês (ou recusado, no automático) ou o serviço do mês já foi lançado
    if exists (select 1 from fin_payment_requests where prestador_id = pr.id and competencia = v_comp
                 and status in ('pendente', 'aprovada') or (prestador_id = pr.id and competencia = v_comp and status = 'recusada' and not p_forcar)) then continue; end if;
    if exists (select 1 from hr_prestador_pagamentos pp join fin_accounts_payable ap on ap.id = pp.bill_id
                where pp.prestador_id = pr.id and pp.tipo = 'servico' and pp.competencia = v_comp and ap.status <> 'cancelled') then continue; end if;
    -- No automático: já saiu neste mês um Pix para o CPF/CNPJ dele de pelo menos metade do combinado
    -- (lançado como despesa comum, por regra, ou ainda sem lançar) → provavelmente já pago; não pede de novo
    if not p_forcar and exists (select 1 from fin_bank_statement_imports s
                where s.tenant_id = pr.tenant_id and s.transaction_type = 'debit'
                  and s.transaction_date between date_trunc('month', v_hoje)::date and v_hoje
                  and regexp_replace(coalesce(s.counterpart_doc, ''), '\D', '', 'g') in (coalesce(pr.cpf, '-'), coalesce(pr.cnpj, '-'))
                  and s.amount >= pr.valor_mensal * 0.5) then continue; end if;
    v_chave := (select pix_key from fin_pix_favorecidos where id = pr.pix_favorecido_id and tenant_id = pr.tenant_id and is_active);
    insert into fin_payment_requests (tenant_id, ref, tipo, status, descricao, valor, vencimento, favorecido_nome, favorecido_doc,
                                      pix_chave, prestador_id, competencia, solicitado_por, solicitado_por_nome)
    values (pr.tenant_id, 'prestador:' || pr.id || ':' || to_char(v_comp, 'YYYY-MM') || ':' || extract(epoch from now())::bigint, 'prestador', 'pendente', 'Serviço de ' || to_char(v_comp, 'MM/YYYY') || ' (MEI)', pr.valor_mensal, v_hoje,
            pr.name, coalesce(pr.cnpj, pr.cpf), v_chave, pr.id, v_comp, auth.uid(), 'Pagamento recorrente')
    on conflict do nothing
    returning id into v_req;
    if v_req is null then continue; end if;
    v_valor := 'R$ ' || translate(to_char(pr.valor_mensal, 'FM999,999,990.00'), ',.', '.,');
    perform fn_pendencia_upsert(pr.tenant_id, 'pedido_pagamento', v_req::text,
      'Prestador MEI de ' || v_valor || ' — ' || pr.name,
      'Serviço de ' || to_char(v_comp, 'MM/YYYY') || '. Pagamento recorrente: confira o valor (dá para mudar antes de aprovar).'
        || case when v_chave is null then ' Sem chave Pix no cadastro: depois de aprovar, pague pelo app do banco — a conciliação dá baixa.' else '' end,
      jsonb_build_object('pedido_id', v_req, 'tipo', 'prestador', 'valor', pr.valor_mensal, 'prestador_id', pr.id, 'competencia', v_comp),
      '/receber?aprovar=1', 'normal', true, 'app', false);
    v_n := v_n + 1;
    v_req := null;
  end loop;
  return v_n;
end $$;
revoke all on function public.fn_prestador_gerar_pedidos(uuid, uuid, boolean) from public, anon;
grant execute on function public.fn_prestador_gerar_pedidos(uuid, uuid, boolean) to authenticated, service_role;

-- Aprovar: ramo do prestador (serviço em RH na competência + hr_prestador_pagamentos).
-- Remendo cirúrgico no corpo atual da função (as outras regras ficam exatamente como estão).
do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.fn_pedido_pagamento_aprovar(uuid, uuid, text, uuid, numeric)'::regprocedure);
  if position('r.tipo = ''prestador''' in v_def) > 0 then return; end if;
  v_novo := replace(v_def, E'  else\n    v_dre := coalesce(p_dre, r.dre_category_id);', E'  elsif r.tipo = ''prestador'' then
    -- Prestador MEI (2026-09-28): serviço do mês em RH, na competência do pedido
    if r.prestador_id is null then raise exception ''pedido de prestador sem o cadastro''; end if;
    if exists (select 1 from hr_prestador_pagamentos pp join fin_accounts_payable ap on ap.id = pp.bill_id
               where pp.prestador_id = r.prestador_id and pp.tipo = ''servico'' and pp.competencia = r.competencia and ap.status <> ''cancelled'') then
      raise exception ''Já existe pagamento do serviço de % para %. Recuse este pedido ou confira em RH / Folha › Prestadores MEI.'',
        to_char(r.competencia, ''MM/YYYY''), trim(r.favorecido_nome);
    end if;
    select id, name into v_dre, v_dre_nome from fin_dre_categories
      where tenant_id = r.tenant_id and lower(name) = ''rh'' and group_type = ''expense'' and parent_id is null and deleted_at is null limit 1;
    if v_dre is null then
      insert into fin_dre_categories (tenant_id, name, group_type) values (r.tenant_id, ''RH'', ''expense'') returning id into v_dre;
    end if;
    insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                      payment_method, dre_category_id, reference_type, reference_id, notes, competence_month)
    values (r.tenant_id, ''Prestador MEI — '' || trim(r.favorecido_nome) || coalesce('' (serviço '' || to_char(r.competencia, ''MM/YYYY'') || '')'', ''''),
            trim(r.favorecido_nome), ''RH'', v_valor, v_hoje, ''pending'', ''Pix'', v_dre, ''pedido_pagamento'', r.id, v_nota, r.competencia)
    returning id into v_bill;
    insert into hr_prestador_pagamentos (tenant_id, prestador_id, bill_id, tipo, competencia, amount)
    values (r.tenant_id, r.prestador_id, v_bill, ''servico'', r.competencia, v_valor);
  else
    v_dre := coalesce(p_dre, r.dre_category_id);');
  if v_novo = v_def then raise exception 'fn_pedido_pagamento_aprovar mudou: ponto de inserção não encontrado'; end if;
  execute v_novo;
end $$;

-- Todo dia às 08:10 (Brasília) gera os pedidos dos recorrentes cujo dia chegou
select cron.unschedule('prestador-pedidos-mensais') where exists (select 1 from cron.job where jobname = 'prestador-pedidos-mensais');
select cron.schedule('prestador-pedidos-mensais', '10 11 * * *', $$select public.fn_prestador_gerar_pedidos()$$);
