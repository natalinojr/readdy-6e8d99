-- 2026-10-04 — "No sistema" (current_balance) não conta linha do extrato que ainda não aconteceu.
--
-- O Mercado Pago grava a venda no extrato com a data da LIBERAÇÃO (voucher/crédito: D+15, D+30…).
-- O saldo do MP (fn_mp_refresh_balance) só soma o que já foi liberado (data+hora <= agora), mas a
-- posição do sistema (_fn_bank_position → fn_bank_recalc_balance → current_balance) somava todas as
-- linhas: a venda de voucher de 04/10 que libera em 19/10 virou "diferença de -R$ 46,35" no Painel.
--
-- Agora a posição usa o mesmo corte: linha com data+hora depois de agora (horário de Brasília) fica de
-- fora até o dia/hora chegar. Bancos (Inter) não têm linha futura, então nada muda para eles; o resto
-- da função é igual ao de 20260926220000_saldo_erp_pelo_extrato.sql.

create or replace function public._fn_bank_position(p_account uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
  v_agora timestamp := (now() at time zone 'America/Sao_Paulo');
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
            from fin_bank_statement_imports
           where bank_account_id = p_account
             -- liberação futura (Mercado Pago) ainda não é dinheiro na conta
             and transaction_date + case when raw->>'hora' ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
                                         then (raw->>'hora')::time else '00:00'::time end <= v_agora) l;
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
end $function$;

-- Acerta agora as contas com saldo do provedor (só muda onde havia linha futura).
select public.fn_bank_recalc_balance(id) from public.fin_bank_accounts where synced_balance is not null;
