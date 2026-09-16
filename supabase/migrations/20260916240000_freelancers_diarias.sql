-- ═══════════════════════════════════════════════════════════════════════════
-- Freelancers e diárias (2026-09-16)
-- Aplicado via mcp__supabase__apply_migration; este arquivo é o registro.
--
-- Pedido do dono: pagamento de freelancer pedido no grupo tem que virar despesa, e o sistema tem que
-- saber QUAIS DIAS cada freelancer trabalhou. Sem os dias na mensagem, o assistente pergunta no grupo.
--
-- Decisões do dono:
--   • cadastro SEPARADO de freelancers (fora de hr_employees);
--   • paga na hora e pergunta os dias depois (diária fica "aguardando_dias");
--   • uma linha por DIA trabalhado (o Pix de 2 dias vira 2 diárias, valor dividido);
--   • categoria do DRE: RH (a que já existe).
--
-- Opção A (escolhida por causa da conciliação): UMA conta a pagar por Pix, e as diárias ficam em
-- hr_freelancer_shifts. A baixa pelo extrato casa 1 débito com 1 conta de mesmo valor; duas contas
-- de R$ 100 nunca casariam com o débito de R$ 200 — ficariam abertas ou seriam lançadas de novo.
-- No DRE o gasto sai no dia do pagamento; o custo por dia trabalhado sai das diárias.
--
-- Escrita só pelas funções abaixo (security definer), iguais para o assistente e para a tela.
-- ═══════════════════════════════════════════════════════════════════════════

-- Conta a pagar de freelancer tem origem própria (os relatórios e a baixa sabem de onde veio).
alter table public.fin_accounts_payable drop constraint if exists fin_accounts_payable_reference_type_check;
alter table public.fin_accounts_payable add constraint fin_accounts_payable_reference_type_check
  check (reference_type = any (array['purchase', 'manual', 'recurring', 'hr_payroll', 'nfe_entrada', 'conciliacao_juros', 'conciliacao_extrato', 'freelancer']));

create table if not exists public.hr_freelancers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  cpf text,
  phone text,
  role text,                         -- função (garçom, cozinha, entregador...)
  daily_rate numeric(12,2),          -- valor combinado da diária (referência)
  pix_favorecido_id uuid references public.fin_pix_favorecidos(id) on delete set null,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_hr_freelancers_favorecido
  on public.hr_freelancers(tenant_id, pix_favorecido_id) where pix_favorecido_id is not null;
create index if not exists idx_hr_freelancers_nome on public.hr_freelancers(tenant_id, lower(name));

create table if not exists public.hr_freelancer_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  freelancer_id uuid not null references public.hr_freelancers(id) on delete cascade,
  work_date date,                    -- nulo = ainda não se sabe o dia (status aguardando_dias)
  amount numeric(12,2) not null check (amount >= 0),
  payment_id uuid references public.fin_inter_payments(id) on delete set null,
  bill_id uuid references public.fin_accounts_payable(id) on delete set null,
  group_request_id bigint references public.asst_group_requests(id) on delete set null,
  status text not null default 'registrada' check (status in ('registrada', 'aguardando_dias')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_freelancer_shifts_dia_coerente check ((status = 'aguardando_dias') = (work_date is null))
);
create unique index if not exists uq_hr_freelancer_shift_pagamento_dia
  on public.hr_freelancer_shifts(payment_id, work_date) where payment_id is not null and work_date is not null;
create index if not exists idx_hr_freelancer_shifts_periodo on public.hr_freelancer_shifts(tenant_id, work_date);
create index if not exists idx_hr_freelancer_shifts_pendentes on public.hr_freelancer_shifts(tenant_id) where status = 'aguardando_dias';

alter table public.hr_freelancers enable row level security;
alter table public.hr_freelancer_shifts enable row level security;
drop policy if exists hr_freelancers_select on public.hr_freelancers;
create policy hr_freelancers_select on public.hr_freelancers for select to authenticated using (auth_is_member_of(tenant_id));
drop policy if exists hr_freelancer_shifts_select on public.hr_freelancer_shifts;
create policy hr_freelancer_shifts_select on public.hr_freelancer_shifts for select to authenticated using (auth_is_member_of(tenant_id));
grant select on public.hr_freelancers, public.hr_freelancer_shifts to authenticated;
grant all on public.hr_freelancers, public.hr_freelancer_shifts to service_role;

-- ── Quem pode escrever: service role (assistente) ou membro da loja (tela) ──
create or replace function public._fn_freelancer_pode(p_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is null or auth_is_member_of(p_tenant);
$$;

-- ── Diárias de um pagamento: apaga as atuais e grava de novo ──
-- Sem dias → uma linha "aguardando_dias" com o valor todo. Com N dias → N linhas, valor dividido
-- em partes iguais (os centavos que sobram vão para o último dia).
create or replace function public._fn_freelancer_gravar_diarias(p_payment fin_inter_payments, p_freelancer uuid, p_bill uuid, p_dias date[])
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_dias date[] := (select array_agg(distinct d order by d) from unnest(coalesce(p_dias, '{}'::date[])) d where d is not null);
  v_n int := coalesce(array_length(v_dias, 1), 0);
  v_parte numeric(12,2);
  v_i int;
begin
  delete from hr_freelancer_shifts where payment_id = p_payment.id;
  if v_n = 0 then
    insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, payment_id, bill_id, group_request_id, status)
    values (p_payment.tenant_id, p_freelancer, null, p_payment.amount, p_payment.id, p_bill, p_payment.group_request_id, 'aguardando_dias');
    return 0;
  end if;
  v_parte := trunc(p_payment.amount / v_n, 2);
  for v_i in 1..v_n loop
    insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, payment_id, bill_id, group_request_id, status)
    values (p_payment.tenant_id, p_freelancer, v_dias[v_i],
            case when v_i = v_n then p_payment.amount - v_parte * (v_n - 1) else v_parte end,
            p_payment.id, p_bill, p_payment.group_request_id, 'registrada');
  end loop;
  return v_n;
end $$;

-- ── Texto da conta a pagar: nome e dias (ou "dias a informar") ──
create or replace function public._fn_freelancer_descricao(p_nome text, p_dias date[])
returns text language sql immutable as $$
  select 'Freelancer — ' || p_nome || ' (' ||
    coalesce((select string_agg(to_char(d, 'DD/MM'), ', ' order by d) from (select distinct unnest(p_dias) d) x where d is not null), 'dias a informar')
    || ')';
$$;

-- ── Registrar o pagamento de um freelancer ──
-- Idempotente: chamar de novo no mesmo pagamento não duplica nada (só atualiza dias, se vierem).
-- 1) acha ou cria o freelancer (pela chave Pix cadastrada; senão pelo nome);
-- 2) garante UMA conta a pagar do Pix, em aberto, categoria RH — a baixa vem da conciliação
--    quando o Inter confirma (nunca lançar já paga: o extrato debitaria de novo);
-- 3) grava as diárias.
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

  -- 1) freelancer
  if p.favorecido_id is not null then
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

-- ── Informar os dias depois (resposta no grupo, ou pela tela) ──
create or replace function public.fn_freelancer_informar_dias(p_payment_id uuid, p_dias date[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(array_length(p_dias, 1), 0) = 0 then raise exception 'informe pelo menos um dia'; end if;
  if not exists (select 1 from hr_freelancer_shifts where payment_id = p_payment_id) then
    raise exception 'esse pagamento não está registrado como freelancer';
  end if;
  return fn_freelancer_registrar_pagamento(p_payment_id, p_dias, null);
end $$;

revoke all on function public._fn_freelancer_gravar_diarias(fin_inter_payments, uuid, uuid, date[]) from public, authenticated;
grant execute on function public.fn_freelancer_registrar_pagamento(uuid, date[], text) to authenticated, service_role;
grant execute on function public.fn_freelancer_informar_dias(uuid, date[]) to authenticated, service_role;

-- ── Editar o cadastro pela tela (aplicado como migration freelancer_salvar) ──
create or replace function public.fn_freelancer_salvar(p_id uuid, p_role text, p_phone text, p_cpf text, p_daily_rate numeric, p_is_active boolean, p_notes text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from hr_freelancers where id = p_id;
  if v_tenant is null then raise exception 'freelancer não encontrado'; end if;
  if not _fn_freelancer_pode(v_tenant) then raise exception 'sem acesso a esta loja'; end if;
  update hr_freelancers set
    role = nullif(trim(p_role), ''), phone = nullif(trim(p_phone), ''), cpf = nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), ''),
    daily_rate = p_daily_rate, is_active = coalesce(p_is_active, true), notes = nullif(trim(p_notes), ''), updated_at = now()
  where id = p_id;
end $$;
grant execute on function public.fn_freelancer_salvar(uuid, text, text, text, numeric, boolean, text) to authenticated, service_role;
