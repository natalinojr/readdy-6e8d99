-- 2026-10-05 — Saldo do Mercado Pago desconta o saque que já caiu no banco.
--
-- O relatório de liberações do MP só cobre até o fim do dia anterior e chega no dia seguinte (o de
-- 04/10 chegou 05/10 às 19h; pedir um "até agora" o MP arredonda para o dia e gera às 02h). Entre
-- um relatório e outro o saldo era âncora + vendas — o saque de 05/10 (R$ 4.031,36, Pix do próprio
-- CNPJ no Inter às 14h37) não saía, e o Painel mostrava R$ 4.749,13 com a conta quase zerada.
--
-- Agora: saldo = âncora + vendas depois dela − saques do MP já creditados na conta de repasse
-- (fn_card_providers.deposit_account_id) depois da âncora e ainda não casados com o saque do
-- relatório (match_group nulo). Saque = crédito marcado como transferência do próprio CNPJ
-- (internal_transfer) cujo pagador é o MP (deposit_match). Quando o relatório traz o saque,
-- fn_match_mp_payouts casa os dois (match_group) e ele deixa de ser descontado aqui — já está na âncora.
-- O gatilho do extrato passa a recalcular o MP também quando muda a conta de repasse.

create or replace function public.fn_mp_refresh_balance(p_account uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_agora timestamp := (now() at time zone 'America/Sao_Paulo');
  v_rep_ts timestamp; v_rep_bal numeric;
  v_ext_ts timestamp; v_ext_bal numeric; v_ext_soma numeric;
  v_ts timestamp; v_bal numeric; v_depois numeric; v_saques numeric := 0; v_at timestamptz;
  cp record;
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

  -- c) saques já creditados no banco e ainda fora do relatório
  select * into cp from public.fn_card_providers(v_tenant) where provider = 'mercadopago';
  if cp.deposit_account_id is not null and coalesce(cp.deposit_match, '') <> '' then
    select coalesce(sum(c.amount), 0) into v_saques
      from fin_bank_statement_imports c
     where c.tenant_id = v_tenant and c.bank_account_id = cp.deposit_account_id
       and coalesce(c.source, '') <> 'mercadopago'
       and c.transaction_type = 'credit'
       and c.match_kind = 'internal_transfer' and c.match_group is null
       and position(lower(cp.deposit_match) in lower(
             coalesce(c.description, '') || ' ' || coalesce(c.counterpart_name, '') || ' ' ||
             coalesce(c.raw->'detalhes'->>'nomeEmpresaPagador', ''))) > 0
       and coalesce(
             case when coalesce(c.raw->>'dataInclusao', '') ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}'
                  then substr(c.raw->>'dataInclusao', 1, 16)::timestamp end,
             c.transaction_date + time '23:59') > v_ts;
  end if;

  v_bal := round(v_bal + v_depois - v_saques, 2);
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

-- Extrato mudou → recalcula o MP: linhas da própria conta MP ou de outra conta da mesma loja
-- (o saque cai no banco de repasse e é marcado depois, por update).
create or replace function public._tg_mp_balance_stmt() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.fn_mp_refresh_balance(x.id) from (
      select distinct c.bank_account_id as id from novas n join fin_mp_config c on c.tenant_id = n.tenant_id
       where c.bank_account_id is not null) x;
  elsif tg_op = 'DELETE' then
    perform public.fn_mp_refresh_balance(x.id) from (
      select distinct c.bank_account_id as id from antigas o join fin_mp_config c on c.tenant_id = o.tenant_id
       where c.bank_account_id is not null) x;
  else
    perform public.fn_mp_refresh_balance(x.id) from (
      select c.bank_account_id as id from novas n join fin_mp_config c on c.tenant_id = n.tenant_id where c.bank_account_id is not null
      union
      select c.bank_account_id from antigas o join fin_mp_config c on c.tenant_id = o.tenant_id where c.bank_account_id is not null) x;
  end if;
  return null;
end $$;

-- Acerta agora.
select public.fn_mp_refresh_balance(bank_account_id) from public.fin_mp_config where bank_account_id is not null;
