-- 2026-09-25 — "Saldo no ERP" das contas ligadas ao banco passa a sair do extrato.
--
-- Antes: current_balance = saldo inicial + fn_bank_debit/fn_bank_credit. Só os pagamentos de contas
-- desciam o saldo; repasses Stone/MP, Pix e iFood nunca subiam (Inter Paranaguá: −R$ 72 mil
-- com R$ 2.253,78 no banco).
--
-- Agora, para conta com saldo vindo do banco (synced_balance) e linhas de extrato:
--   abertura       = saldo do banco − Σ linhas do extrato até o dia do saldo  (saldo inicial acertado pelo extrato)
--   saldo no ERP   = abertura
--                  + Σ linhas já resolvidas (conciliadas ou ignoradas)
--                  + Σ lançamentos do ERP que nenhuma linha resolvida explica (pagou no ERP, ainda não saiu do banco)
-- Logo, diferença banco − ERP = linhas a conciliar − pagamentos do ERP sem linha no extrato.
-- Venda roteada para a conta (reference_type 'sale') não entra no "sem linha": nessas contas o recebimento
-- só vale pelo extrato (senão contaria junto com o repasse da maquininha).
-- Contas sem saldo do banco (Stone, Mercado Pago, manuais) continuam no razão antigo.
--
-- Mantido por gatilhos: extrato, razão e saldo do banco mudam → recalcula a conta inteira (idempotente).

create or replace function public._fn_bank_position(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a record;
  v_ref date;
  v_n int;
  v_ate_ref numeric;
  v_resolvido numeric;
  v_pend numeric;
  v_pend_n int;
  v_primeira date;
  v_ties uuid[];
  v_sem_linha numeric;
  v_sem_linha_n int;
  v_abertura numeric;
begin
  select id, synced_balance, synced_balance_at into a from fin_bank_accounts where id = p_account;
  if not found or a.synced_balance is null then return null; end if;
  v_ref := coalesce((a.synced_balance_at at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date);

  select count(*)::int,
         coalesce(sum(v) filter (where transaction_date <= v_ref), 0),
         coalesce(sum(v) filter (where resolvida), 0),
         coalesce(sum(v) filter (where not resolvida), 0),
         (count(*) filter (where not resolvida))::int,
         min(transaction_date)
    into v_n, v_ate_ref, v_resolvido, v_pend, v_pend_n, v_primeira
    from (select case when transaction_type = 'credit' then amount else -amount end as v,
                 transaction_date,
                 (status = 'ignored' or coalesce(reconciled, false) or status in ('matched', 'manual')) as resolvida
            from fin_bank_statement_imports where bank_account_id = p_account) l;
  if v_n = 0 then return null; end if;

  -- O que as linhas resolvidas explicam: a referência casada + todo id citado no detalhe (conta, nota, folha...).
  select coalesce(array_agg(distinct x), '{}') into v_ties from (
    select match_ref_id as x from fin_bank_statement_imports
     where bank_account_id = p_account and match_ref_id is not null
       and (status = 'ignored' or coalesce(reconciled, false) or status in ('matched', 'manual'))
    union all
    select (m[1])::uuid from fin_bank_statement_imports s,
           regexp_matches(s.match_detail::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m
     where s.bank_account_id = p_account and s.match_detail is not null
       and (s.status = 'ignored' or coalesce(s.reconciled, false) or s.status in ('matched', 'manual'))
  ) t;

  select coalesce(sum(case when t.type = 'credit' then t.amount else -t.amount end), 0), count(*)::int
    into v_sem_linha, v_sem_linha_n
    from fin_bank_transactions t
   where t.bank_account_id = p_account
     and coalesce(t.reference_type, '') <> 'sale'
     and (t.reference_id is null or not (t.reference_id = any(v_ties)))
     and not exists (select 1 from fin_bank_statement_imports s where s.matched_transaction_id = t.id);

  v_abertura := round(a.synced_balance - v_ate_ref, 2);
  return jsonb_build_object(
    'abertura', v_abertura,
    'abertura_data', v_primeira,
    'resolvido', round(v_resolvido, 2),
    'pendente', round(v_pend, 2),
    'pendente_qtd', v_pend_n,
    'erp_sem_extrato', round(v_sem_linha, 2),
    'erp_sem_extrato_qtd', v_sem_linha_n,
    'saldo_erp', round(v_abertura + v_resolvido + v_sem_linha, 2)
  );
end $$;
revoke all on function public._fn_bank_position(uuid) from public, anon, authenticated;
grant execute on function public._fn_bank_position(uuid) to service_role;

create or replace function public.fn_bank_recalc_balance(p_account uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare v jsonb; v_bal numeric;
begin
  v := public._fn_bank_position(p_account);
  if v is null then return null; end if;
  v_bal := (v->>'saldo_erp')::numeric;
  update fin_bank_accounts set current_balance = v_bal, updated_at = now()
   where id = p_account and current_balance is distinct from v_bal;
  return v_bal;
end $$;
revoke all on function public.fn_bank_recalc_balance(uuid) from public, anon, authenticated;
grant execute on function public.fn_bank_recalc_balance(uuid) to service_role;

-- Detalhe para a tela (Conciliação): de onde vem o saldo e a diferença.
create or replace function public.fn_bank_balance_breakdown(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid; v jsonb;
begin
  select tenant_id into v_tenant from fin_bank_accounts where id = p_account;
  if v_tenant is null then return null; end if;
  perform public._assert_tenant_access(v_tenant);
  v := public._fn_bank_position(p_account);
  if v is null then return null; end if;
  return v || jsonb_build_object('erp_sem_extrato_itens', coalesce((
    select jsonb_agg(jsonb_build_object('data', t.transaction_date, 'descricao', t.description, 'tipo', t.type, 'valor', t.amount) order by t.transaction_date desc)
      from (select t.* from fin_bank_transactions t
             where t.bank_account_id = p_account
               and coalesce(t.reference_type, '') <> 'sale'
               and (t.reference_id is null or not (t.reference_id = any(coalesce((
                 select array_agg(distinct x) from (
                   select match_ref_id as x from fin_bank_statement_imports
                    where bank_account_id = p_account and match_ref_id is not null
                      and (status = 'ignored' or coalesce(reconciled, false) or status in ('matched', 'manual'))
                   union all
                   select (m[1])::uuid from fin_bank_statement_imports s,
                          regexp_matches(s.match_detail::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m
                    where s.bank_account_id = p_account and s.match_detail is not null
                      and (s.status = 'ignored' or coalesce(s.reconciled, false) or s.status in ('matched', 'manual'))) q), '{}'))))
               and not exists (select 1 from fin_bank_statement_imports s where s.matched_transaction_id = t.id)
             order by t.transaction_date desc limit 50) t), '[]'::jsonb));
end $$;
revoke all on function public.fn_bank_balance_breakdown(uuid) from public, anon;
grant execute on function public.fn_bank_balance_breakdown(uuid) to authenticated, service_role;

-- Gatilhos por comando (lote de 1.000 linhas recalcula a conta uma vez só).
create or replace function public._tg_bank_recalc_new() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_bank_recalc_balance(x.bank_account_id) from (select distinct bank_account_id from novas where bank_account_id is not null) x;
  return null;
end $$;
create or replace function public._tg_bank_recalc_old() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_bank_recalc_balance(x.bank_account_id) from (select distinct bank_account_id from antigas where bank_account_id is not null) x;
  return null;
end $$;
create or replace function public._tg_bank_recalc_upd() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_bank_recalc_balance(x.bank_account_id) from (
    select bank_account_id from novas union select bank_account_id from antigas) x where x.bank_account_id is not null;
  return null;
end $$;

drop trigger if exists tg_stmt_recalc_ins on public.fin_bank_statement_imports;
drop trigger if exists tg_stmt_recalc_upd on public.fin_bank_statement_imports;
drop trigger if exists tg_stmt_recalc_del on public.fin_bank_statement_imports;
create trigger tg_stmt_recalc_ins after insert on public.fin_bank_statement_imports
  referencing new table as novas for each statement execute function public._tg_bank_recalc_new();
create trigger tg_stmt_recalc_upd after update on public.fin_bank_statement_imports
  referencing old table as antigas new table as novas for each statement execute function public._tg_bank_recalc_upd();
create trigger tg_stmt_recalc_del after delete on public.fin_bank_statement_imports
  referencing old table as antigas for each statement execute function public._tg_bank_recalc_old();

drop trigger if exists tg_banktx_recalc_ins on public.fin_bank_transactions;
drop trigger if exists tg_banktx_recalc_del on public.fin_bank_transactions;
create trigger tg_banktx_recalc_ins after insert on public.fin_bank_transactions
  referencing new table as novas for each statement execute function public._tg_bank_recalc_new();
create trigger tg_banktx_recalc_del after delete on public.fin_bank_transactions
  referencing old table as antigas for each statement execute function public._tg_bank_recalc_old();

create or replace function public._tg_bank_synced_recalc() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_bank_recalc_balance(new.id);
  return null;
end $$;
drop trigger if exists tg_bank_synced_recalc on public.fin_bank_accounts;
create trigger tg_bank_synced_recalc after update of synced_balance, synced_balance_at on public.fin_bank_accounts
  for each row when (old.synced_balance is distinct from new.synced_balance or old.synced_balance_at is distinct from new.synced_balance_at)
  execute function public._tg_bank_synced_recalc();

-- Acerta agora todas as contas ligadas ao banco (todas as lojas).
select public.fn_bank_recalc_balance(id) from public.fin_bank_accounts where synced_balance is not null;
