-- Chargeback Stone e reapresentação: mesma lógica do cancelamento (20260925120000_stone_cancelamentos.sql).
-- A edge grava raw.kind='chargeback' (débito, gross/net negativos) e 'chargeback_refund' (crédito, positivos).

CREATE OR REPLACE FUNCTION public.fn_stone_repasses(p_tenant uuid, p_from date, p_to date)
 RETURNS TABLE(dia date, pilha text, vendas integer, bruto numeric, taxa numeric, antecipacao numeric, liquido_stone numeric, depositado numeric, creditos integer, diferenca numeric, dia_liquido_stone numeric, dia_depositado numeric, situacao text, par_dia date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with f as (select * from public.fn_money_flow(p_tenant)),
  st as (
    select transaction_date as d,
           coalesce(raw->>'pilha', case when coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0 then 'antecipado' else 'debito' end) as p,
           (count(*) filter (where raw->>'kind' = 'installment'))::int as n,
           -- cancelamento/chargeback: raw.gross/raw.net vêm negativos (reapresentação: positivos) (bruto devolvido / valor descontado do repasse)
           round(sum(coalesce((raw->>'gross')::numeric, amount)), 2) as bruto,
           round(sum(coalesce((raw->>'gross')::numeric, amount) - coalesce((raw->>'net')::numeric, amount)
                     - coalesce((raw->>'advance_fee')::numeric, 0)), 2) as taxa,
           round(sum(coalesce((raw->>'advance_fee')::numeric, 0)), 2) as antecip,
           round(sum(coalesce((raw->>'net')::numeric, amount)), 2) as liq
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'stone'
       and ((raw->>'kind' = 'installment' and transaction_type = 'credit') or raw->>'kind' in ('cancellation', 'chargeback', 'chargeback_refund'))
       and status <> 'ignored'
       and transaction_date between p_from - 5 and p_to + 5
     group by 1, 2
  ),
  dep_all as (
    select i.transaction_date as d,
           case when i.description ilike '%antecipa%' then 'antecipado' else 'debito' end as p,
           i.amount
      from fin_bank_statement_imports i, f
     where i.tenant_id = p_tenant and f.card_provider = 'stone'
       and i.bank_account_id = f.card_deposit_account_id and i.source <> 'stone'
       and coalesce(i.raw->>'tipoTransacao', '') not in ('PIX', 'TRANSFERENCIA')
       and position(lower(f.card_deposit_match) in lower(coalesce(i.description, ''))) > 0
       and i.transaction_type = 'credit' and i.status <> 'ignored'
  ),
  primeiro as (select min(d) as d from dep_all),
  dep as (
    select d, p, count(*)::int as n, round(sum(amount), 2) as valor
      from dep_all where d between p_from - 5 and p_to + 5 group by 1, 2
  ),
  j as (
    select coalesce(st.d, dep.d) as d, coalesce(st.p, dep.p) as p,
           coalesce(st.n, 0) as n, coalesce(st.bruto, 0) as bruto, coalesce(st.taxa, 0) as taxa,
           coalesce(st.antecip, 0) as antecip, coalesce(st.liq, 0) as liq,
           coalesce(dep.valor, 0) as valor, coalesce(dep.n, 0) as n_dep,
           st.d is not null as tem_stone, dep.d is not null as tem_dep
      from st full join dep on dep.d = st.d and dep.p = st.p
  ),
  k as (
    select j.*,
           sum(j.liq) over (partition by j.d) as dia_liq,
           sum(j.valor) over (partition by j.d) as dia_valor,
           sum(j.n_dep) over (partition by j.d) as dia_n_dep,
           bool_or(j.tem_dep) over (partition by j.d) as dia_tem_dep,
           bool_or(j.tem_stone) over (partition by j.d) as dia_tem_stone
      from j
  ),
  s as (
    select k.*,
           case
             when (select d from primeiro) is null or (not k.dia_tem_dep and k.d < (select d from primeiro)) then 'sem_extrato'
             when abs(k.valor - k.liq) <= greatest(0.02, 0.01 * k.n_dep) then 'ok'
             when k.dia_tem_dep and k.dia_tem_stone
                  and abs(k.dia_valor - k.dia_liq) <= greatest(0.02, 0.01 * k.dia_n_dep) then 'dia_fecha'
             when not k.tem_stone then 'sem_venda'
             when not k.tem_dep then 'sem_deposito'
             when k.valor < k.liq then 'faltou'
             else 'sobrou'
           end as sit
      from k
  ),
  pares0 as (
    select distinct on (a.d, a.p) a.d as d1, b.d as d2, a.p
      from s a
      join s b on b.p = a.p and b.d > a.d and b.d <= a.d + 5
     where a.sit in ('faltou', 'sem_deposito')
       and b.sit in ('sobrou', 'sem_venda') and b.dia_tem_stone
       and abs((a.valor + b.valor) - (a.liq + b.liq)) <= greatest(0.02, 0.01 * (a.n_dep + b.n_dep))
     order by a.d, a.p, b.d
  ),
  pares as (
    select distinct on (d2, p) d1, d2, p from pares0 order by d2, p, d1
  )
  select s.d, s.p, s.n, s.bruto, s.taxa, s.antecip, s.liq, s.valor, s.n_dep,
         round(s.valor - s.liq, 2),
         round(s.dia_liq, 2), round(s.dia_valor, 2),
         case when pa.d1 is not null or pb.d2 is not null then 'atrasado' else s.sit end,
         coalesce(pa.d2, pb.d1)
    from s
    left join pares pa on pa.d1 = s.d and pa.p = s.p
    left join pares pb on pb.d2 = s.d and pb.p = s.p
   where s.d between p_from and p_to
   order by s.d desc, s.p;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_match_card_deposits(p_tenant uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  f record;
  cp record;
  g record;
  v_key text;
  v_conta text;
  v_groups int := 0;
  v_dep int := 0;
  v_det int := 0;
  v_transfers int := 0;
  v_atrasados int := 0;
  v_n int;
begin
  select * into f from public.fn_money_flow(p_tenant);
  select * into cp from public.fn_card_providers(p_tenant) where provider = 'stone';
  select name into v_conta from public.fin_bank_accounts where id = cp.deposit_account_id;

  if cp.provider = 'stone' and cp.deposit_account_id is not null and cp.deposit_match is not null then
    for g in
      with st as (
        select transaction_date as d,
               coalesce(raw->>'pilha', case when coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0 then 'antecipado' else 'debito' end) = 'antecipado' as adv,
               count(*) filter (where raw->>'kind' = 'installment') as n,
               round(sum(coalesce((raw->>'net')::numeric, amount)), 2) as liq,
               sum(coalesce((stone_installment_info->>'gross_amount')::numeric, amount)) as bruto,
               sum(coalesce((stone_installment_info->>'fee_amount')::numeric, 0)) as taxa,
               sum(coalesce((stone_installment_info->>'advance_fee')::numeric, 0)) as antecip
          from fin_bank_statement_imports
         where tenant_id = p_tenant and source = 'stone' and ((raw->>'kind' = 'installment' and transaction_type = 'credit') or raw->>'kind' in ('cancellation', 'chargeback', 'chargeback_refund'))
           and status <> 'ignored'
           and transaction_date between p_from and p_to
         group by 1, 2
      ),
      it as (
        select transaction_date as d,
               description ilike '%antecipa%' as adv,
               count(*) as n,
               sum(amount) as valor,
               array_agg(id) as ids
          from fin_bank_statement_imports
         where tenant_id = p_tenant and bank_account_id = cp.deposit_account_id and source <> 'stone'
           and coalesce(raw->>'tipoTransacao', '') not in ('PIX', 'TRANSFERENCIA')
           and position(lower(cp.deposit_match) in lower(coalesce(description, ''))) > 0
           and transaction_type = 'credit' and status <> 'ignored' and not coalesce(reconciled, false)
           and (match_group is null or match_group like 'stone:%')
           and transaction_date between p_from and p_to
         group by 1, 2
      )
      select st.d, st.adv, st.n, st.liq, st.bruto, st.taxa, st.antecip, it.valor, it.ids, it.n as n_dep
        from st join it on it.d = st.d and it.adv = st.adv
       where abs(it.valor - st.liq) <= greatest(0.02, 0.01 * it.n)
    loop
      v_key := 'stone:' || g.d || ':' || case when g.adv then 'antecipado' else 'normal' end;

      update fin_bank_statement_imports
         set status = 'matched', match_kind = 'stone_deposit', match_group = v_key,
             matched_at = coalesce(matched_at, now()),
             category = coalesce(category, 'Repasse Stone'),
             notes = format('Repasse Stone de %s (%s): %s venda(s), bruto R$ %s, taxas R$ %s%s. A Stone liquidou R$ %s no dia.',
                            to_char(g.d, 'DD/MM'),
                            case when g.adv then 'antecipado' else 'sem antecipação' end,
                            g.n,
                            replace(to_char(g.bruto, 'FM999999990.00'), '.', ','),
                            replace(to_char(g.taxa, 'FM999999990.00'), '.', ','),
                            case when g.antecip > 0 then ' (antecipação R$ ' || replace(to_char(g.antecip, 'FM999999990.00'), '.', ',') || ')' else '' end,
                            replace(to_char(g.liq, 'FM999999990.00'), '.', ','))
       where id = any(g.ids);
      get diagnostics v_n = row_count;
      v_dep := v_dep + v_n;

      update fin_bank_statement_imports
         set status = 'matched', match_kind = 'stone_detail', match_group = v_key,
             matched_at = coalesce(matched_at, now()),
             notes = format('Depositado em %s em %s (repasse %s).', coalesce(v_conta, 'outra conta'), to_char(g.d, 'DD/MM'),
                            case when g.adv then 'antecipado' else 'sem antecipação' end)
       where tenant_id = p_tenant and source = 'stone' and ((raw->>'kind' = 'installment' and transaction_type = 'credit') or raw->>'kind' in ('cancellation', 'chargeback', 'chargeback_refund'))
         and status <> 'ignored'
         and transaction_date = g.d
         and (coalesce(raw->>'pilha', case when coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0 then 'antecipado' else 'debito' end) = 'antecipado') = g.adv;
      get diagnostics v_n = row_count;
      v_det := v_det + v_n;
      v_groups := v_groups + 1;
    end loop;

    for g in
      with st as (
        select transaction_date as d,
               coalesce(raw->>'pilha', case when coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0 then 'antecipado' else 'debito' end) = 'antecipado' as adv,
               count(*) filter (where raw->>'kind' = 'installment') as n,
               round(sum(coalesce((raw->>'net')::numeric, amount)), 2) as liq,
               array_agg(id) as ids
          from fin_bank_statement_imports
         where tenant_id = p_tenant and source = 'stone' and ((raw->>'kind' = 'installment' and transaction_type = 'credit') or raw->>'kind' in ('cancellation', 'chargeback', 'chargeback_refund'))
           and status = 'pending'
           and transaction_date between p_from and p_to + 5
         group by 1, 2
      ),
      dias_stone as (
        select distinct transaction_date as d
          from fin_bank_statement_imports
         where tenant_id = p_tenant and source = 'stone' and raw->>'kind' = 'installment'
           and transaction_date between p_from and p_to + 5
        union
        select reference_date from fin_stone_imports
         where tenant_id = p_tenant and status = 'success' and reference_date between p_from and p_to + 5
      ),
      it as (
        select transaction_date as d,
               description ilike '%antecipa%' as adv,
               count(*) as n,
               sum(amount) as valor,
               array_agg(id) as ids
          from fin_bank_statement_imports
         where tenant_id = p_tenant and bank_account_id = cp.deposit_account_id and source <> 'stone'
           and coalesce(raw->>'tipoTransacao', '') not in ('PIX', 'TRANSFERENCIA')
           and position(lower(cp.deposit_match) in lower(coalesce(description, ''))) > 0
           and transaction_type = 'credit' and status = 'pending' and not coalesce(reconciled, false)
           and match_group is null
           and transaction_date between p_from and p_to + 5
         group by 1, 2
      ),
      pares as (
        select a.d as d1, ib.d as d2, a.adv,
               a.liq as liq1, coalesce(b.liq, 0) as liq2,
               coalesce(ia.valor, 0) as dep1, ib.valor as dep2,
               a.n + coalesce(b.n, 0) as vendas,
               coalesce(ia.ids, '{}'::uuid[]) || ib.ids as dep_ids,
               a.ids || coalesce(b.ids, '{}'::uuid[]) as stone_ids
          from st a
          left join it ia on ia.d = a.d and ia.adv = a.adv
          join it ib on ib.adv = a.adv and ib.d > a.d and ib.d <= a.d + 5
          left join st b on b.d = ib.d and b.adv = a.adv
         where a.d <= p_to
           and exists (select 1 from dias_stone ds where ds.d = ib.d)
           and coalesce(ia.valor, 0) - a.liq < -greatest(0.02, 0.01 * coalesce(ia.n, 0))
           and ib.valor - coalesce(b.liq, 0) > greatest(0.02, 0.01 * ib.n)
           and abs((coalesce(ia.valor, 0) + ib.valor) - (a.liq + coalesce(b.liq, 0)))
               <= greatest(0.02, 0.01 * (coalesce(ia.n, 0) + ib.n))
      )
      select distinct on (d1, adv) * from pares order by d1, adv, d2
    loop
      if exists (select 1 from fin_bank_statement_imports
                  where id = any(g.dep_ids || g.stone_ids) and (status <> 'pending' or match_group is not null)) then
        continue;
      end if;

      v_key := 'stone:' || g.d1 || '+' || g.d2 || ':' || case when g.adv then 'antecipado' else 'normal' end;

      update fin_bank_statement_imports
         set status = 'matched', match_kind = 'stone_deposit', match_group = v_key,
             matched_at = coalesce(matched_at, now()),
             category = coalesce(category, 'Repasse Stone'),
             notes = format('Repasse Stone de %s (%s) creditado pelo banco em duas datas: R$ %s em %s e R$ %s a mais em %s. Conferido junto com o repasse de %s: Stone R$ %s × banco R$ %s.',
                            to_char(g.d1, 'DD/MM'),
                            case when g.adv then 'antecipado' else 'sem antecipação' end,
                            replace(to_char(g.dep1, 'FM999999990.00'), '.', ','), to_char(g.d1, 'DD/MM'),
                            replace(to_char(round(g.dep2 - g.liq2, 2), 'FM999999990.00'), '.', ','), to_char(g.d2, 'DD/MM'),
                            to_char(g.d2, 'DD/MM'),
                            replace(to_char(g.liq1 + g.liq2, 'FM999999990.00'), '.', ','),
                            replace(to_char(g.dep1 + g.dep2, 'FM999999990.00'), '.', ','))
       where id = any(g.dep_ids);
      get diagnostics v_n = row_count;
      v_dep := v_dep + v_n;

      update fin_bank_statement_imports
         set status = 'matched', match_kind = 'stone_detail', match_group = v_key,
             matched_at = coalesce(matched_at, now()),
             notes = format('Depositado em %s entre %s e %s (parte do repasse de %s creditada com atraso).',
                            coalesce(v_conta, 'outra conta'), to_char(g.d1, 'DD/MM'), to_char(g.d2, 'DD/MM'), to_char(g.d1, 'DD/MM'))
       where id = any(g.stone_ids);
      get diagnostics v_n = row_count;
      v_det := v_det + v_n;
      v_groups := v_groups + 1;
      v_atrasados := v_atrasados + 1;
    end loop;
  end if;

  with own as (
    select distinct regexp_replace(raw->'detalhes'->>'cpfCnpjPagador', '\D', '', 'g') as doc
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'inter' and transaction_type = 'debit'
       and raw->>'tipoTransacao' = 'PIX' and coalesce(raw->'detalhes'->>'cpfCnpjPagador', '') <> ''
    union
    select regexp_replace(cnpj, '\D', '', 'g') from tenants where id = p_tenant and coalesce(cnpj, '') <> ''
  )
  update fin_bank_statement_imports i
     set status = 'matched', match_kind = 'internal_transfer', matched_at = coalesce(i.matched_at, now()),
         category = coalesce(i.category, 'Transferência entre contas'),
         notes = case when i.transaction_type = 'credit'
                      then 'Transferência entre contas da própria empresa' ||
                           coalesce(' (vinda de ' || nullif(i.raw->'detalhes'->>'nomeEmpresaPagador', '') || ')', '') || '.'
                      else 'Transferência para outra conta da própria empresa' ||
                           coalesce(' (' || nullif(i.raw->'detalhes'->>'nomeEmpresaRecebedor', '') || ')', '') ||
                           '. Não é despesa.' end
   where i.tenant_id = p_tenant and i.source = 'inter'
     and i.raw->>'tipoTransacao' in ('PIX', 'TRANSFERENCIA')
     and i.status = 'pending' and not coalesce(i.reconciled, false) and i.match_kind is null
     and i.transaction_date between p_from and p_to
     and (
       (i.transaction_type = 'credit' and regexp_replace(coalesce(i.raw->'detalhes'->>'cpfCnpjPagador', ''), '\D', '', 'g') in (select doc from own))
       or
       (i.transaction_type = 'debit' and regexp_replace(coalesce(i.raw->'detalhes'->>'cpfCnpjRecebedor', ''), '\D', '', 'g') in (select doc from own))
     );
  get diagnostics v_transfers = row_count;

  return jsonb_build_object('groups', v_groups, 'inter_rows', v_dep, 'stone_rows', v_det, 'transfers', v_transfers,
                            'delayed_pairs', v_atrasados, 'card_provider', coalesce(cp.provider, f.card_provider));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_dre_competencia_cartoes(p_tenant uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_stone_bruto numeric := 0;
  v_stone_mdr numeric := 0;
  v_stone_ativo boolean;
  v_ifood_receita numeric := 0;
  v_ifood_custo numeric := 0;
begin
  if not public.auth_is_member_of(p_tenant) then
    raise exception 'Sem acesso a esta loja' using errcode = '42501';
  end if;

  select exists (select 1 from fin_cash_flow where tenant_id = p_tenant and origin = 'stone_sale') into v_stone_ativo;
  if v_stone_ativo then
    select coalesce(sum(coalesce((raw->>'gross')::numeric, amount)), 0),
           coalesce(sum(coalesce((raw->>'gross')::numeric, amount) - coalesce((raw->>'net')::numeric, amount)
                        - coalesce((raw->>'advance_fee')::numeric, 0)), 0)
      into v_stone_bruto, v_stone_mdr
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'stone' and status <> 'ignored'
       -- cancelamento/chargeback abate a venda (reapresentação devolve) (raw.gross/raw.net negativos, capture_date = data da venda original)
       and ((raw->>'kind' = 'installment' and transaction_type = 'credit') or raw->>'kind' in ('cancellation', 'chargeback', 'chargeback_refund'))
       and (raw->>'capture_date') between p_from::text and p_to::text
       and transaction_date >= p_from;
  end if;

  with e as (
    select lower(coalesce(tipo_lancamento, '')) as t, lower(coalesce(descricao, '')) as d,
           valor as v, impacto_repasse as imp
      from fin_ifood_entries
     where tenant_id = p_tenant
       and (
         (order_created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
          and order_created_at < ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo'))
         or (order_created_at is null and data_apuracao_fim between p_from and p_to)
       )
  ),
  b as (
    select
      case when t like '%entrada%' then v
           when t like '%subs%' then case when d like '%custeada pela loja%' then -v else v end
           when t like '%reten%' then v
           else 0 end as vendas,
      case when t like '%entrada%' and not imp then v else 0 end as loja,
      case when t not like '%entrada%' and t not like '%subs%' and t not like '%reten%' and t like '%cobran%'
                and d ~ '(comiss|transa|mensalidade)' then -v else 0 end as taxas,
      case when t not like '%entrada%' and t like '%subs%' and d like '%custeada pela loja%' then -v
           when t not like '%entrada%' and t not like '%subs%' and t not like '%reten%' and t like '%cobran%'
                and d !~ '(comiss|transa|mensalidade)' then -v
           else 0 end as servicos,
      case when t not like '%entrada%' and t not like '%subs%' and t not like '%reten%' and t not like '%cobran%' then v else 0 end as ajustes
      from e
  )
  select coalesce(sum(vendas - loja), 0), coalesce(sum(taxas + servicos - ajustes), 0)
    into v_ifood_receita, v_ifood_custo
    from b;

  return jsonb_build_object(
    'stone_bruto', round(v_stone_bruto, 2), 'stone_mdr', round(v_stone_mdr, 2),
    'ifood_receita', round(v_ifood_receita, 2), 'ifood_custo', round(v_ifood_custo, 2)
  );
end;
$function$
;
