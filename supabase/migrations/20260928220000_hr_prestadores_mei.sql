-- Prestadores MEI (2026-09-28): quem trabalha na loja pelo CNPJ de MEI (ex.: supervisor), fora da folha
-- do Domínio (sem INSS/FGTS/13º). O pagamento vem do extrato: Conciliação › Lançar › "Prestador MEI"
-- (edge conciliacao-pagamentos, kind 'prestador'): serviço do mês = despesa em RH na competência;
-- reembolso = despesa na categoria do que ele comprou. Cada lançamento fica em hr_prestador_pagamentos
-- (some junto com a conta quando o lançamento é desfeito).
-- Mesmo padrão de hr_freelancers: leitura pela loja (RLS), escrita só por função SECURITY DEFINER.

create table if not exists public.hr_prestadores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  cpf text,
  cnpj text,
  role text,
  valor_mensal numeric(12,2),
  dia_pagamento int check (dia_pagamento between 1 and 31),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_prestadores_tenant_idx on public.hr_prestadores (tenant_id);

create table if not exists public.hr_prestador_pagamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  prestador_id uuid not null references public.hr_prestadores(id) on delete cascade,
  bill_id uuid not null unique references public.fin_accounts_payable(id) on delete cascade,
  statement_id uuid,
  tipo text not null check (tipo in ('servico', 'reembolso')),
  competencia date,
  amount numeric(12,2) not null,
  paid_date date,
  created_at timestamptz not null default now()
);
create index if not exists hr_prestador_pagamentos_prest_idx on public.hr_prestador_pagamentos (prestador_id, competencia);
create index if not exists hr_prestador_pagamentos_tenant_idx on public.hr_prestador_pagamentos (tenant_id);

alter table public.hr_prestadores enable row level security;
alter table public.hr_prestador_pagamentos enable row level security;
drop policy if exists hr_prestadores_select on public.hr_prestadores;
create policy hr_prestadores_select on public.hr_prestadores for select using (auth_is_member_of(tenant_id));
drop policy if exists hr_prestador_pagamentos_select on public.hr_prestador_pagamentos;
create policy hr_prestador_pagamentos_select on public.hr_prestador_pagamentos for select using (auth_is_member_of(tenant_id));

revoke all on public.hr_prestadores, public.hr_prestador_pagamentos from anon, authenticated;
grant select on public.hr_prestadores, public.hr_prestador_pagamentos to authenticated;
grant all on public.hr_prestadores, public.hr_prestador_pagamentos to service_role;

-- Cria (p_id nulo) ou atualiza um prestador. Devolve o id.
create or replace function public.fn_prestador_salvar(
  p_tenant uuid, p_id uuid, p_name text, p_cpf text, p_cnpj text, p_role text,
  p_valor_mensal numeric, p_dia_pagamento int, p_is_active boolean, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_nome text := nullif(trim(p_name), '');
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
begin
  if not _fn_freelancer_pode(p_tenant) then raise exception 'sem acesso a esta loja'; end if;
  if v_nome is null then raise exception 'informe o nome'; end if;
  if v_cpf is not null and length(v_cpf) <> 11 then raise exception 'CPF deve ter 11 dígitos'; end if;
  if v_cnpj is not null and length(v_cnpj) <> 14 then raise exception 'CNPJ deve ter 14 dígitos'; end if;
  if p_valor_mensal is not null and p_valor_mensal < 0 then raise exception 'valor mensal inválido'; end if;
  if p_id is null then
    insert into hr_prestadores (tenant_id, name, cpf, cnpj, role, valor_mensal, dia_pagamento, is_active, notes)
    values (p_tenant, v_nome, v_cpf, v_cnpj, nullif(trim(p_role), ''), p_valor_mensal, p_dia_pagamento, coalesce(p_is_active, true), nullif(trim(p_notes), ''))
    returning id into v_id;
  else
    update hr_prestadores set name = v_nome, cpf = v_cpf, cnpj = v_cnpj, role = nullif(trim(p_role), ''),
      valor_mensal = p_valor_mensal, dia_pagamento = p_dia_pagamento, is_active = coalesce(p_is_active, true),
      notes = nullif(trim(p_notes), ''), updated_at = now()
    where id = p_id and tenant_id = p_tenant returning id into v_id;
    if v_id is null then raise exception 'prestador não encontrado'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.fn_prestador_salvar(uuid, uuid, text, text, text, text, numeric, int, boolean, text) from public, anon;
grant execute on function public.fn_prestador_salvar(uuid, uuid, text, text, text, text, numeric, int, boolean, text) to authenticated, service_role;

-- Cadastro de freelancer pela aba RH (antes só nascia pelo pagamento).
create or replace function public.fn_freelancer_criar(p_tenant uuid, p_name text, p_role text, p_phone text, p_cpf text, p_daily_rate numeric, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_nome text := nullif(trim(p_name), '');
begin
  if not _fn_freelancer_pode(p_tenant) then raise exception 'sem acesso a esta loja'; end if;
  if v_nome is null then raise exception 'informe o nome'; end if;
  if exists (select 1 from hr_freelancers where tenant_id = p_tenant and lower(name) = lower(v_nome)) then
    raise exception 'já existe um freelancer com esse nome';
  end if;
  insert into hr_freelancers (tenant_id, name, role, phone, cpf, daily_rate, notes)
  values (p_tenant, v_nome, nullif(trim(p_role), ''), nullif(trim(p_phone), ''),
          nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), ''), p_daily_rate, nullif(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.fn_freelancer_criar(uuid, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.fn_freelancer_criar(uuid, text, text, text, text, numeric, text) to authenticated, service_role;
