-- 2026-10-04 — Saldo do Mercado Pago no "Quanto tenho?" (e em todo lugar que lê synced_balance).
--
-- Antes: a conta "Mercado Pago" não tinha saldo vindo do provedor; o painel mostrava o razão antigo
-- (= saldo inicial R$ 3,96, nunca somava as vendas liberadas nem os saques).
--
-- Agora o saldo sai do próprio Mercado Pago:
--   âncora = o saldo que o Relatório de Liberações informa (coluna BALANCE_AMOUNT), no ponto mais recente:
--     a) fechamento do relatório diário (fin_mp_reports.closing_balance/closing_at, gravado pela mp-conciliation), ou
--     b) linhas do relatório já no extrato (saque/reserva: raw.report = 'release', raw.balance).
--        Linhas no mesmo minuto não têm ordem: vale o saldo que fecha a conta do grupo
--        (saldo de uma linha = saldo antes do grupo + soma do grupo).
--   saldo = âncora + linhas do extrato do MP depois da âncora (vendas liberadas e estornos de payments/search),
--           sem contar liberação com data futura.
-- O resultado vai para synced_balance (synced_provider = 'mercadopago'); o gatilho existente
-- (tg_bank_synced_recalc) acerta o current_balance pelo extrato, como no Inter.

alter table public.fin_mp_reports
  add column if not exists closing_balance numeric(14,2),
  add column if not exists closing_at timestamptz;

create or replace function public.fn_mp_refresh_balance(p_account uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_agora timestamp := (now() at time zone 'America/Sao_Paulo');
  v_rep_ts timestamp; v_rep_bal numeric;
  v_ext_ts timestamp; v_ext_bal numeric; v_ext_soma numeric;
  v_ts timestamp; v_bal numeric; v_depois numeric; v_at timestamptz;
begin
  select tenant_id into v_tenant from fin_mp_config where bank_account_id = p_account limit 1;
  if v_tenant is null then return null; end if;

  -- a) fechamento do relatório diário
  select (closing_at at time zone 'America/Sao_Paulo'), closing_balance into v_rep_ts, v_rep_bal
    from fin_mp_reports
   where tenant_id = v_tenant and status = 'success' and closing_at is not null and closing_balance is not null
   order by closing_at desc limit 1;

  -- b) linhas do relatório no extrato
  select max(transaction_date + coalesce(nullif(raw->>'hora', ''), '00:00')::time) into v_ext_ts
    from fin_bank_statement_imports
   where bank_account_id = p_account and raw->>'report' = 'release' and raw->>'balance' is not null;
  if v_ext_ts is not null then
    with g as (
      select case when transaction_type = 'credit' then amount else -amount end as s, (raw->>'balance')::numeric as b
        from fin_bank_statement_imports
       where bank_account_id = p_account and raw->>'report' = 'release' and raw->>'balance' is not null
         and transaction_date + coalesce(nullif(raw->>'hora', ''), '00:00')::time = v_ext_ts)
    select (select sum(s) from g) into v_ext_soma;
    with g as (
      select case when transaction_type = 'credit' then amount else -amount end as s, (raw->>'balance')::numeric as b
        from fin_bank_statement_imports
       where bank_account_id = p_account and raw->>'report' = 'release' and raw->>'balance' is not null
         and transaction_date + coalesce(nullif(raw->>'hora', ''), '00:00')::time = v_ext_ts)
    select k.b into v_ext_bal from g k
     where exists (select 1 from g j where round(j.b - j.s + v_ext_soma, 2) = round(k.b, 2))
     order by k.b limit 1;
  end if;

  if v_rep_ts is not null and (v_ext_bal is null or v_rep_ts >= v_ext_ts) then
    v_ts := v_rep_ts; v_bal := v_rep_bal;
  elsif v_ext_bal is not null then
    v_ts := v_ext_ts; v_bal := v_ext_bal;
  else
    return null;  -- sem relatório do MP: não há saldo do provedor (fica o razão)
  end if;

  select coalesce(sum(case when transaction_type = 'credit' then amount else -amount end), 0), max(created_at)
    into v_depois, v_at
    from fin_bank_statement_imports
   where bank_account_id = p_account
     and coalesce(raw->>'report', '') <> 'release'
     and transaction_date + coalesce(nullif(raw->>'hora', ''), '00:00')::time > v_ts
     and transaction_date + coalesce(nullif(raw->>'hora', ''), '00:00')::time <= v_agora;

  v_bal := round(v_bal + v_depois, 2);
  -- "quando": a última vez que dado do MP chegou (linha nova ou relatório importado)
  v_at := greatest(
    (select max(created_at) from fin_bank_statement_imports where bank_account_id = p_account),
    (select max(imported_at) from fin_mp_reports where tenant_id = v_tenant and status = 'success'));

  update fin_bank_accounts
     set synced_balance = v_bal, synced_balance_at = coalesce(v_at, now()), synced_provider = 'mercadopago'
   where id = p_account and tenant_id = v_tenant
     and coalesce(synced_provider, 'mercadopago') = 'mercadopago'
     and (synced_balance is distinct from v_bal or synced_balance_at is distinct from coalesce(v_at, now()));
  return v_bal;
end $$;
revoke all on function public.fn_mp_refresh_balance(uuid) from public, anon, authenticated;
grant execute on function public.fn_mp_refresh_balance(uuid) to service_role;

-- Extrato do MP mudou → recalcula (por comando: lote de vendas recalcula uma vez).
create or replace function public._tg_mp_balance_stmt() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.fn_mp_refresh_balance(x.id) from (
      select distinct n.bank_account_id as id from novas n join fin_mp_config c on c.bank_account_id = n.bank_account_id) x;
  elsif tg_op = 'DELETE' then
    perform public.fn_mp_refresh_balance(x.id) from (
      select distinct o.bank_account_id as id from antigas o join fin_mp_config c on c.bank_account_id = o.bank_account_id) x;
  else
    perform public.fn_mp_refresh_balance(x.id) from (
      select n.bank_account_id as id from novas n join fin_mp_config c on c.bank_account_id = n.bank_account_id
      union
      select o.bank_account_id from antigas o join fin_mp_config c on c.bank_account_id = o.bank_account_id) x;
  end if;
  return null;
end $$;
drop trigger if exists tg_stmt_mp_balance_ins on public.fin_bank_statement_imports;
drop trigger if exists tg_stmt_mp_balance_upd on public.fin_bank_statement_imports;
drop trigger if exists tg_stmt_mp_balance_del on public.fin_bank_statement_imports;
create trigger tg_stmt_mp_balance_ins after insert on public.fin_bank_statement_imports
  referencing new table as novas for each statement execute function public._tg_mp_balance_stmt();
create trigger tg_stmt_mp_balance_upd after update on public.fin_bank_statement_imports
  referencing old table as antigas new table as novas for each statement execute function public._tg_mp_balance_stmt();
create trigger tg_stmt_mp_balance_del after delete on public.fin_bank_statement_imports
  referencing old table as antigas for each statement execute function public._tg_mp_balance_stmt();

-- Relatório diário gravou o fechamento → recalcula.
create or replace function public._tg_mp_report_balance() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_mp_refresh_balance(c.bank_account_id) from fin_mp_config c
   where c.tenant_id = new.tenant_id and c.bank_account_id is not null;
  return null;
end $$;
drop trigger if exists tg_mp_report_balance on public.fin_mp_reports;
create trigger tg_mp_report_balance after insert or update of closing_balance, closing_at, status on public.fin_mp_reports
  for each row when (new.closing_balance is not null) execute function public._tg_mp_report_balance();

-- Conta trocada/desligada na configuração → a antiga deixa de ter saldo do MP; a nova calcula.
create or replace function public._tg_mp_config_balance() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update fin_bank_accounts set synced_balance = null, synced_balance_at = null, synced_provider = null
     where id = old.bank_account_id and synced_provider = 'mercadopago';
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if old.bank_account_id is distinct from new.bank_account_id then
      update fin_bank_accounts set synced_balance = null, synced_balance_at = null, synced_provider = null
       where id = old.bank_account_id and synced_provider = 'mercadopago';
    end if;
  end if;
  if new.bank_account_id is not null then
    perform public.fn_mp_refresh_balance(new.bank_account_id);
  end if;
  return null;
end $$;
drop trigger if exists tg_mp_config_balance on public.fin_mp_config;
create trigger tg_mp_config_balance after insert or update of bank_account_id or delete on public.fin_mp_config
  for each row execute function public._tg_mp_config_balance();

-- Acerta agora as contas Mercado Pago já ligadas.
select public.fn_mp_refresh_balance(bank_account_id) from public.fin_mp_config where bank_account_id is not null;
