-- ═══════════════════════════════════════════════════════════════════════════
-- Benefícios pagos pela empresa — vale alimentação (2026-09-30)
--
-- Pedido do dono: lançar o VA na aba RH, referenciando cada funcionário. O VA de agosto costuma
-- ser pago no fim de julho, então a conta tem COMPETÊNCIA própria (competence_month, lida pela
-- DRE por competência desde 6b0d6328); no caixa entra na data da baixa.
--
-- Decisões do dono:
--   • em geral UM boleto/Pix para a operadora (VR, Alelo…); às vezes Pix direto a cada funcionário;
--   • valor fixo por funcionário, com ajuste por faltas em algum mês.
--
-- Modelo (igual a freelancers/prestadores): a conta a pagar é o dinheiro (1 por boleto ou 1 por
-- Pix — a baixa pelo extrato casa 1 débito com 1 conta) e hr_beneficios guarda quanto de cada
-- funcionário está nela. O "Vale Refeição" da folha continua sendo o DESCONTO no salário.
-- A conta vai na categoria DRE escolhida (padrão: a do sistema 'pessoal'), que a DRE soma à folha.
-- Escrita só pelas funções abaixo (security definer).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fin_accounts_payable drop constraint if exists fin_accounts_payable_reference_type_check;
alter table public.fin_accounts_payable add constraint fin_accounts_payable_reference_type_check
  check (reference_type = any (array['purchase', 'manual', 'recurring', 'hr_payroll', 'nfe_entrada', 'conciliacao_juros',
                                     'conciliacao_extrato', 'freelancer', 'pedido_pagamento', 'delivery_driver_settlement',
                                     'hr_beneficio']));

-- Valor fixo mensal do VA no cadastro do funcionário (vem preenchido ao lançar)
alter table public.hr_employees add column if not exists va_valor_mensal numeric(12,2);

create table if not exists public.hr_beneficios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lote_id uuid not null,                        -- um lançamento (pode ter 1 conta ou 1 por funcionário)
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  employee_name text not null,
  tipo text not null default 'vale_alimentacao' check (tipo in ('vale_alimentacao')),
  competencia date not null check (extract(day from competencia) = 1),
  valor numeric(12,2) not null check (valor > 0),
  valor_fixo numeric(12,2),                     -- base do mês (para mostrar o ajuste)
  faltas int not null default 0 check (faltas >= 0),
  dias_base int check (dias_base is null or dias_base > 0),
  bill_id uuid not null references public.fin_accounts_payable(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_hr_beneficios_comp on public.hr_beneficios(tenant_id, competencia);
create index if not exists idx_hr_beneficios_bill on public.hr_beneficios(bill_id);
create index if not exists idx_hr_beneficios_func on public.hr_beneficios(employee_id, competencia);

alter table public.hr_beneficios enable row level security;
drop policy if exists hr_beneficios_select on public.hr_beneficios;
create policy hr_beneficios_select on public.hr_beneficios for select to authenticated using (auth_is_member_of(tenant_id));
grant select on public.hr_beneficios to authenticated;
grant all on public.hr_beneficios to service_role;

-- Permissão: admin, ou gerente/financeiro DA LOJA com a aba RH liberada (fin_rh)
create or replace function public._beneficio_pode(p_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is null or exists (
    select 1 from user_tenants ut
     where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and (ut.role::text = 'admin'
            or (ut.role::text in ('manager', 'financeiro')
                and not exists (select 1 from permissions p
                                 where p.tenant_id = p_tenant and p.role::text = ut.role::text
                                   and p.permission_key = 'fin_rh' and p.allowed = false)))
  );
$$;

-- ── Lançar ──
-- p_modo: 'operadora' = 1 conta no total (fornecedor p_fornecedor); 'pix' = 1 conta por funcionário.
-- p_itens: [{employee_id, valor, valor_fixo?, faltas?, dias_base?}]
create or replace function public.fn_beneficio_lancar(
  p_tenant uuid, p_competencia date, p_modo text, p_fornecedor text, p_vencimento date,
  p_dre_category_id uuid, p_itens jsonb
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_mes text;
  v_cat uuid := p_dre_category_id;
  v_lote uuid := gen_random_uuid();
  v_bill uuid;
  v_bills uuid[] := '{}';
  v_total numeric(12,2);
  v_n int;
  v_forn text := nullif(trim(coalesce(p_fornecedor, '')), '');
  it record;
begin
  if not _beneficio_pode(p_tenant) then raise exception 'sem permissão para lançar benefícios nesta loja'; end if;
  if p_competencia is null then raise exception 'informe a competência'; end if;
  if p_vencimento is null then raise exception 'informe o vencimento ou a data do pagamento'; end if;
  if p_modo not in ('operadora', 'pix') then raise exception 'forma de pagamento inválida'; end if;
  if p_modo = 'operadora' and v_forn is null then raise exception 'informe a operadora (ex.: VR, Alelo)'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'nenhum funcionário no lançamento'; end if;

  if v_cat is null then
    select id into v_cat from fin_dre_categories where tenant_id = p_tenant and system_key = 'pessoal' limit 1;
  elsif not exists (select 1 from fin_dre_categories where id = v_cat and tenant_id = p_tenant) then
    raise exception 'categoria da DRE não é desta loja';
  end if;
  if v_cat is null then raise exception 'escolha a categoria da DRE'; end if;

  drop table if exists _itens;
  create temp table _itens on commit drop as
  select (x->>'employee_id')::uuid as employee_id,
         round((x->>'valor')::numeric, 2) as valor,
         round(nullif(x->>'valor_fixo', '')::numeric, 2) as valor_fixo,
         coalesce(nullif(x->>'faltas', '')::int, 0) as faltas,
         nullif(x->>'dias_base', '')::int as dias_base,
         e.name as nome
    from jsonb_array_elements(p_itens) x
    left join hr_employees e on e.id = (x->>'employee_id')::uuid and e.tenant_id = p_tenant;

  if exists (select 1 from _itens where nome is null) then raise exception 'funcionário que não é desta loja'; end if;
  if exists (select 1 from _itens where valor is null or valor <= 0) then raise exception 'todo funcionário precisa de valor maior que zero'; end if;
  if (select count(*) from _itens) <> (select count(distinct employee_id) from _itens) then raise exception 'funcionário repetido no lançamento'; end if;

  select sum(valor), count(*) into v_total, v_n from _itens;
  v_mes := to_char(v_comp, 'MM/YYYY');

  if p_modo = 'operadora' then
    insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                      dre_category_id, reference_type, reference_id, competence_month, notes)
    values (p_tenant, 'Vale alimentação ' || v_mes || ' — ' || v_n || ' funcionário' || case when v_n = 1 then '' else 's' end,
            v_forn, 'Benefícios', v_total, p_vencimento, 'pending', v_cat, 'hr_beneficio', v_lote, v_comp,
            'Lançado em RH › Benefícios: ' || (select string_agg(nome, ', ' order by nome) from _itens))
    returning id into v_bill;
    v_bills := array[v_bill];
    insert into hr_beneficios (tenant_id, lote_id, employee_id, employee_name, competencia, valor, valor_fixo, faltas, dias_base, bill_id, created_by)
    select p_tenant, v_lote, employee_id, nome, v_comp, valor, valor_fixo, faltas, dias_base, v_bill, auth.uid() from _itens;
  else
    for it in select * from _itens order by nome loop
      insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status, payment_method,
                                        dre_category_id, reference_type, reference_id, competence_month, notes)
      values (p_tenant, 'Vale alimentação ' || v_mes || ' — ' || it.nome, it.nome, 'Benefícios', it.valor, p_vencimento, 'pending', 'Pix',
              v_cat, 'hr_beneficio', v_lote, v_comp, 'Lançado em RH › Benefícios (Pix direto ao funcionário)')
      returning id into v_bill;
      v_bills := v_bills || v_bill;
      insert into hr_beneficios (tenant_id, lote_id, employee_id, employee_name, competencia, valor, valor_fixo, faltas, dias_base, bill_id, created_by)
      values (p_tenant, v_lote, it.employee_id, it.nome, v_comp, it.valor, it.valor_fixo, it.faltas, it.dias_base, v_bill, auth.uid());
    end loop;
  end if;

  -- O valor fixo usado passa a ser o do cadastro (vem preenchido no mês seguinte)
  update hr_employees e set va_valor_mensal = i.valor_fixo, updated_at = now()
    from _itens i where e.id = i.employee_id and i.valor_fixo is not null and i.valor_fixo > 0
     and e.va_valor_mensal is distinct from i.valor_fixo;

  return jsonb_build_object('lote_id', v_lote, 'bill_ids', to_jsonb(v_bills), 'total', v_total, 'funcionarios', v_n,
                            'dre_category_id', v_cat);
end $$;

-- ── Desfazer um lançamento (só com as contas em aberto, sem pagamento nem Pix em andamento) ──
create or replace function public.fn_beneficio_desfazer(p_tenant uuid, p_lote uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_bills uuid[];
begin
  if not _beneficio_pode(p_tenant) then raise exception 'sem permissão para desfazer benefícios nesta loja'; end if;
  select array_agg(distinct bill_id) into v_bills from hr_beneficios where tenant_id = p_tenant and lote_id = p_lote;
  if v_bills is null then raise exception 'lançamento não encontrado'; end if;
  perform 1 from fin_accounts_payable where id = any(v_bills) for update;
  if exists (select 1 from fin_accounts_payable where id = any(v_bills) and (status <> 'pending' or coalesce(paid_amount, 0) > 0)) then
    raise exception 'já tem pagamento registrado neste lançamento: desfaça o pagamento em Contas a Pagar antes';
  end if;
  if exists (select 1 from fin_inter_payments where bill_id = any(v_bills) and status not in ('cancelled', 'expired', 'rejected', 'failed')) then
    raise exception 'já existe um Pix para uma conta deste lançamento: cancele o Pix antes';
  end if;
  delete from fin_accounts_payable where id = any(v_bills) and tenant_id = p_tenant;  -- hr_beneficios sai em cascata
  return coalesce(array_length(v_bills, 1), 0);
end $$;

revoke all on function public._beneficio_pode(uuid) from public, anon;
revoke all on function public.fn_beneficio_lancar(uuid, date, text, text, date, uuid, jsonb) from public, anon;
revoke all on function public.fn_beneficio_desfazer(uuid, uuid) from public, anon;
grant execute on function public._beneficio_pode(uuid) to authenticated, service_role;
grant execute on function public.fn_beneficio_lancar(uuid, date, text, text, date, uuid, jsonb) to authenticated, service_role;
grant execute on function public.fn_beneficio_desfazer(uuid, uuid) to authenticated, service_role;
