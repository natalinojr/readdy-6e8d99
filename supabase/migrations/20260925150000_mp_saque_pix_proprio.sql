-- Conciliação do Mercado Pago: saques e reservas que ficavam pendentes (2026-09-25)
--
-- Três defeitos, vistos em Paranaguá (10 linhas pendentes na conta Mercado Pago):
--
-- 1. O saque do MP chega no banco como Pix do PRÓPRIO CNPJ ("Pix recebido - Ep Par Mall Ltda").
--    O nome "MERCADO PAGO IP LTDA." só aparece em raw.detalhes.nomeEmpresaPagador (Inter), não
--    na descrição — o casamento procurava o texto só na descrição e nunca achava.
-- 2. Antes do casamento do MP rodar, a regra de "transferência entre contas" (fim de
--    fn_match_stone_inter) já marcava esse Pix como internal_transfer. Com card_pix_mode =
--    'transfer', internal_transfer conta como RECEITA de Pix (fin_pix_recebidos) — o saque
--    entrava na receita junto com as vendas no cartão que ele repassa (contagem dupla).
--    Agora o casamento do MP recupera esse crédito (internal_transfer sem grupo) e o marca
--    card_deposit, que fica fora da receita de Pix.
-- 3. O relatório de liberações traz, para cada saque, o "payout" e um par reserve_for_payout
--    (−/+) que se anula; e reserve_for_refund (−/+) em vendas. As três viravam kind='payout'
--    ou 'movement' pendentes. Só o "payout" é o dinheiro saindo; pares que somam zero (mesmo
--    source_id + mesma descrição) viram match_kind 'mp_reserve' — não movimentam dinheiro.

create or replace function public.fn_match_mp_payouts(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  f record;
  cp record;
  g record;
  v_conta text;
  v_key text;
  v_pairs int := 0;
  v_rows int := 0;
  v_reserves int := 0;
  v_n int;
begin
  -- Reservas que se anulam: não dependem de maquininha configurada nem de conta de repasse.
  with grp as (
    select raw->>'source_id' as sid, raw->>'description' as descr
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'mercadopago'
       and raw->>'description' ilike 'reserve\_for\_%'
       and coalesce(raw->>'source_id', '') <> ''
       and transaction_date between p_from - 5 and p_to
     group by 1, 2
    having count(*) >= 2
       and abs(sum(case when transaction_type = 'credit' then amount else -amount end)) < 0.005
       and bool_or(status = 'pending')
  )
  update fin_bank_statement_imports i
     set status = 'matched', match_kind = 'mp_reserve',
         match_group = 'mpres:' || r.sid || ':' || r.descr,
         matched_at = coalesce(i.matched_at, now()),
         notes = 'Reserva e liberação do Mercado Pago no mesmo valor: não movimenta dinheiro.'
    from grp r
   where i.tenant_id = p_tenant and i.source = 'mercadopago'
     and i.raw->>'source_id' = r.sid and i.raw->>'description' = r.descr
     and i.status = 'pending' and i.match_group is null;
  get diagnostics v_reserves = row_count;

  select * into f from public.fn_money_flow(p_tenant);
  select * into cp from public.fn_card_providers(p_tenant) where provider = 'mercadopago';
  if cp.provider is distinct from 'mercadopago' or cp.deposit_account_id is null or cp.deposit_match is null then
    return jsonb_build_object('skipped', true, 'reserves', v_reserves,
                              'card_provider', coalesce(cp.provider, f.card_provider));
  end if;
  select name into v_conta from public.fin_bank_accounts where id = cp.deposit_account_id;

  for g in
    select mp.id as mp_id, mp.transaction_date as d, mp.amount as valor,
           c.id as dep_id, c.transaction_date as d_banco
      from fin_bank_statement_imports mp
      join lateral (
        select c.id, c.transaction_date
          from fin_bank_statement_imports c
         where c.tenant_id = p_tenant and c.bank_account_id = cp.deposit_account_id
           and coalesce(c.source, '') <> 'mercadopago'
           and position(lower(cp.deposit_match) in lower(
                 coalesce(c.description, '') || ' ' || coalesce(c.counterpart_name, '') || ' ' ||
                 coalesce(c.raw->'detalhes'->>'nomeEmpresaPagador', ''))) > 0
           and c.transaction_type = 'credit'
           -- pendente, ou já tomado pela regra de "transferência entre contas" (Pix do próprio
           -- CNPJ): o saque do MP é exatamente isso, e aqui ganha o destino certo
           and (c.status = 'pending' or (c.status = 'matched' and c.match_kind = 'internal_transfer'))
           and not coalesce(c.reconciled, false) and c.match_group is null
           and abs(c.amount - mp.amount) <= 0.02
           and c.transaction_date between mp.transaction_date - 1 and mp.transaction_date + 5
         order by abs(c.transaction_date - mp.transaction_date), c.id
         limit 1
      ) c on true
     where mp.tenant_id = p_tenant and mp.source = 'mercadopago' and mp.raw->>'kind' = 'payout'
       and coalesce(mp.raw->>'description', '') not ilike 'reserve%'
       and mp.transaction_type = 'debit' and mp.status = 'pending' and mp.match_group is null
       and mp.transaction_date between p_from and p_to
     order by mp.transaction_date, mp.id
  loop
    -- dois saques de valor igual podem escolher o mesmo crédito: o que perder fica pendente
    -- e casa na próxima rodada (o sync roda todo dia e ao abrir a Conciliação).
    if exists (select 1 from fin_bank_statement_imports where id = g.dep_id and match_group is not null)
       or exists (select 1 from fin_bank_statement_imports where id = g.mp_id and (status <> 'pending' or match_group is not null)) then
      continue;
    end if;

    v_key := 'mp:' || g.mp_id;

    update fin_bank_statement_imports
       set status = 'matched', match_kind = 'card_deposit', match_group = v_key,
           matched_at = coalesce(matched_at, now()),
           category = case when category is null or category = 'Transferência entre contas'
                           then 'Repasse Mercado Pago' else category end,
           notes = format('Saque do Mercado Pago pedido em %s (R$ %s).', to_char(g.d, 'DD/MM'),
                          replace(to_char(g.valor, 'FM999999990.00'), '.', ','))
     where id = g.dep_id;
    get diagnostics v_n = row_count;
    v_rows := v_rows + v_n;

    update fin_bank_statement_imports
       set status = 'matched', match_kind = 'card_payout', match_group = v_key,
           matched_at = coalesce(matched_at, now()),
           notes = format('Recebido em %s em %s.', coalesce(v_conta, 'outra conta'), to_char(g.d_banco, 'DD/MM'))
     where id = g.mp_id;
    get diagnostics v_n = row_count;
    v_rows := v_rows + v_n;
    v_pairs := v_pairs + 1;
  end loop;

  return jsonb_build_object('pairs', v_pairs, 'rows', v_rows, 'reserves', v_reserves,
                            'card_provider', coalesce(cp.provider, f.card_provider));
end;
$function$;

revoke all on function public.fn_match_mp_payouts(uuid, date, date) from anon, authenticated;
grant execute on function public.fn_match_mp_payouts(uuid, date, date) to service_role;
