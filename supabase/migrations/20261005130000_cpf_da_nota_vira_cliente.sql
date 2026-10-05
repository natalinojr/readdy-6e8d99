-- CPF da nota vira cliente (2026-10-05, pedido do dono).
-- Em Paranaguá ~1/4 dos pedidos do tablet tem CPF na nota e NENHUM virava cliente: a loja não
-- sabia quem volta, quanto gasta nem o que pede. Agora:
--   • customers.phone pode ser NULL: cliente identificado só pelo CPF ("Cliente CPF ***.982.247-**").
--   • Gatilho em orders: pedido com CPF válido e sem cliente → liga ao cliente daquele CPF
--     (cria o "só CPF" se não existir). Contadores e pontos recalculam pelo gatilho de sempre.
--   • fn_juntar_clientes: junta dois cadastros da mesma pessoa (ex.: o "só CPF" com o do celular,
--     quando ela entra no clube ou o caixa completa o cadastro). Move tudo que aponta para cliente.
-- Mensagem para o cliente continua só com celular e aceite (o "só CPF" não tem como receber nada).
-- Erro aqui nunca impede gravar um pedido (WARNING).

-- 1) Cliente pode existir sem celular. UNIQUE(tenant_id, phone) segue valendo (NULLs não colidem).
alter table public.customers alter column phone drop not null;

-- 2) CPF válido (dígitos verificadores; recusa 000.000.000-00 e afins).
create or replace function public.fn_cpf_valido(p text)
returns boolean
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  s int;
  r int;
  i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;

-- 3) Nome provisório do "só CPF" (máscara usual: ***.982.247-**). Trocado pelo nome de verdade
--    quando a pessoa entra no clube ou o caixa completa o cadastro.
create or replace function public.fn_nome_cliente_cpf(p_cpf text)
returns text
language sql
immutable
as $$
  select 'Cliente CPF ***.' || substr(d, 4, 3) || '.' || substr(d, 7, 3) || '-**'
  from (select regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g') as d) x
$$;

-- 4) Cliente do CPF na loja: acha (não ressuscita apagado) ou cria o "só CPF".
create or replace function public.fn_cliente_do_cpf(p_tenant uuid, p_cpf text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_id uuid;
  v_apagado timestamptz;
begin
  if p_tenant is null or not public.fn_cpf_valido(v_cpf) then return null; end if;
  select id, deleted_at into v_id, v_apagado from public.customers where tenant_id = p_tenant and cpf = v_cpf limit 1;
  if v_id is not null then
    return case when v_apagado is null then v_id else null end;
  end if;
  insert into public.customers (tenant_id, name, phone, cpf, visit_count, total_spent, first_visit_at, last_visit_at)
  values (p_tenant, public.fn_nome_cliente_cpf(v_cpf), null, v_cpf, 0, 0, now(), now())
  on conflict (tenant_id, cpf) where cpf is not null do nothing
  returning id into v_id;
  if v_id is null then -- outro pedido criou ao mesmo tempo
    select id into v_id from public.customers where tenant_id = p_tenant and cpf = v_cpf and deleted_at is null limit 1;
  end if;
  return v_id;
end $$;

-- 5) Gatilho: pedido com CPF e sem cliente → cliente do CPF. AFTER + UPDATE do customer_id para o
--    gatilho dos contadores (UPDATE OF customer_id) rodar. Treino não vira cliente.
create or replace function public.fn_orders_cliente_pelo_cpf_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
begin
  if new.customer_id is not null or coalesce(new.is_training, false) then return null; end if;
  begin
    v_cliente := public.fn_cliente_do_cpf(new.tenant_id, new.customer_cpf);
    if v_cliente is not null then
      update public.orders set customer_id = v_cliente where id = new.id and customer_id is null;
    end if;
  exception when others then
    raise warning 'fn_orders_cliente_pelo_cpf: pedido %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_orders_cliente_pelo_cpf on public.orders;
create trigger trg_orders_cliente_pelo_cpf
  after insert or update of customer_cpf on public.orders
  for each row
  when (new.customer_cpf is not null and new.customer_id is null)
  execute function public.fn_orders_cliente_pelo_cpf_trg();

-- 6) Junta dois cadastros da mesma pessoa: tudo do p_remover passa para o p_manter, que herda os
--    dados que não tinha (nome de verdade no lugar do provisório, celular, CPF, nascimento…), e o
--    p_remover é apagado. Opt-out de um vale para o junto. Pontos e contadores recalculados.
create or replace function public.fn_juntar_clientes(p_tenant uuid, p_manter uuid, p_remover uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.customers%rowtype;
  r public.customers%rowtype;
begin
  if p_manter is null or p_remover is null or p_manter = p_remover then
    raise exception 'Clientes inválidos para juntar.';
  end if;
  select * into m from public.customers where id = p_manter and tenant_id = p_tenant for update;
  select * into r from public.customers where id = p_remover and tenant_id = p_tenant for update;
  if m.id is null or r.id is null then
    raise exception 'Cliente não encontrado nesta loja.';
  end if;

  -- Tabelas com unicidade por cliente: o que o que fica já tem, o que sai perde.
  delete from public.crm_customer_stage where customer_id = p_remover;
  delete from public.loyalty_benefits b where b.customer_id = p_remover
    and exists (select 1 from public.loyalty_benefits x where x.customer_id = p_manter and x.ref = b.ref);
  delete from public.loyalty_spins s where s.customer_id = p_remover
    and exists (select 1 from public.loyalty_spins x where x.customer_id = p_manter and x.ref = s.ref);
  delete from public.loyalty_transactions t where t.customer_id = p_remover and t.ref is not null and t.deleted_at is null
    and exists (select 1 from public.loyalty_transactions x where x.customer_id = p_manter and x.ref = t.ref and x.deleted_at is null);
  delete from public.table_session_customers t where t.customer_id = p_remover
    and exists (select 1 from public.table_session_customers x where x.customer_id = p_manter and x.table_session_id = t.table_session_id);

  update public.crm_sends set customer_id = p_manter where customer_id = p_remover;
  update public.game_scores set customer_id = p_manter where customer_id = p_remover;
  update public.game_sessions set customer_id = p_manter where customer_id = p_remover;
  update public.loyalty_benefits set customer_id = p_manter where customer_id = p_remover;
  update public.loyalty_login_links set customer_id = p_manter where customer_id = p_remover;
  update public.loyalty_sessions set customer_id = p_manter where customer_id = p_remover;
  update public.loyalty_spins set customer_id = p_manter where customer_id = p_remover;
  update public.loyalty_transactions set customer_id = p_manter where customer_id = p_remover;
  update public.menu_visits set customer_id = p_manter where customer_id = p_remover;
  update public.table_reservations set customer_id = p_manter where customer_id = p_remover;
  update public.table_session_customers set customer_id = p_manter where customer_id = p_remover;
  update public.table_session_participants set customer_id = p_manter where customer_id = p_remover;
  update public.table_sessions set responsible_customer_id = p_manter where responsible_customer_id = p_remover;
  update public.vouchers set customer_id = p_manter where customer_id = p_remover;
  update public.waiter_calls set customer_id = p_manter where customer_id = p_remover;
  -- Por último os pedidos: o gatilho dos contadores recalcula os dois lados.
  update public.orders set customer_id = p_manter where customer_id = p_remover;

  -- Libera os índices únicos (celular/CPF) antes de passar os dados para o que fica.
  update public.customers set cpf = null, phone = null where id = p_remover;
  update public.customers c set
    name = case when c.name like 'Cliente CPF %' and r.name not like 'Cliente CPF %' then r.name else c.name end,
    phone = coalesce(nullif(c.phone, ''), nullif(r.phone, '')),
    cpf = coalesce(c.cpf, r.cpf),
    email = coalesce(c.email, r.email),
    birth_date = coalesce(c.birth_date, r.birth_date),
    birthday = coalesce(c.birthday, r.birthday),
    gender = coalesce(c.gender, r.gender),
    address = coalesce(c.address, r.address),
    neighborhood = coalesce(c.neighborhood, r.neighborhood),
    city = coalesce(c.city, r.city),
    notes = case
      when coalesce(r.notes, '') = '' then c.notes
      when coalesce(c.notes, '') = '' then r.notes
      else c.notes || E'\n' || r.notes end,
    manual_tags = (select coalesce(array_agg(distinct t), '{}') from unnest(coalesce(c.manual_tags, '{}') || coalesce(r.manual_tags, '{}')) t),
    accepts_marketing = c.accepts_marketing or r.accepts_marketing,
    gdpr_consent_at = coalesce(c.gdpr_consent_at, r.gdpr_consent_at),
    crm_opt_out_at = coalesce(c.crm_opt_out_at, r.crm_opt_out_at),
    loyalty_joined_at = least(c.loyalty_joined_at, r.loyalty_joined_at),
    last_contacted_at = greatest(c.last_contacted_at, r.last_contacted_at),
    updated_at = now()
  where c.id = p_manter;

  delete from public.customers where id = p_remover;

  perform public.fn_sync_customer_counters(p_manter);
  perform public.fn_sync_customer_loyalty(p_manter);
  return p_manter;
end $$;

revoke all on function public.fn_cliente_do_cpf(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_juntar_clientes(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_orders_cliente_pelo_cpf_trg() from public, anon, authenticated;
grant execute on function public.fn_cliente_do_cpf(uuid, text) to service_role;
grant execute on function public.fn_juntar_clientes(uuid, uuid, uuid) to service_role;
