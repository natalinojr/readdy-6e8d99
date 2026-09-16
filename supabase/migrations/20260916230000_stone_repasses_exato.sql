-- Repasses Stone: casamento pelo líquido EXATO e quadro de diferenças (2026-09-16)
--
-- 1. fn_match_card_deposits somava fin_bank_statement_imports.amount (líquido já arredondado venda a
--    venda). Em dias com muitas vendas o arredondamento passava da tolerância (10/08: 105 vendas,
--    R$ 0,10) sem nenhuma diferença real. Agora soma raw->>'net' (todas as casas da Stone) e arredonda
--    uma vez só; a tolerância passa a ser R$ 0,01 por crédito do banco (mínimo R$ 0,02), que é o
--    arredondamento que o banco faz. Os 140 repasses já conciliados continuam fechando (máx. R$ 0,01).
-- 2. fn_stone_repasses: dia × pilha (antecipado/débito) com Stone liquidou × entrou no banco × diferença
--    e uma situação legível. Alimenta o quadro "Repasses Stone", o alerta e o detalhe da transação.

create or replace function public.fn_match_card_deposits(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  f record;
  g record;
  v_key text;
  v_conta text;
  v_groups int := 0;
  v_dep int := 0;
  v_det int := 0;
  v_transfers int := 0;
  v_n int;
begin
  select * into f from public.fn_money_flow(p_tenant);
  select name into v_conta from public.fin_bank_accounts where id = f.card_deposit_account_id;

  if f.card_provider = 'stone' and f.card_deposit_account_id is not null and f.card_deposit_match is not null then
    for g in
      with st as (
        select transaction_date as d,
               coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0 as adv,
               count(*) as n,
               round(sum(coalesce((raw->>'net')::numeric, amount)), 2) as liq,
               sum(coalesce((stone_installment_info->>'gross_amount')::numeric, amount)) as bruto,
               sum(coalesce((stone_installment_info->>'fee_amount')::numeric, 0)) as taxa,
               sum(coalesce((stone_installment_info->>'advance_fee')::numeric, 0)) as antecip
          from fin_bank_statement_imports
         where tenant_id = p_tenant and source = 'stone' and raw->>'kind' = 'installment'
           and transaction_type = 'credit' and status <> 'ignored'
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
         where tenant_id = p_tenant and bank_account_id = f.card_deposit_account_id and source <> 'stone'
           and coalesce(raw->>'tipoTransacao', '') not in ('PIX', 'TRANSFERENCIA')
           and position(lower(f.card_deposit_match) in lower(coalesce(description, ''))) > 0
           and transaction_type = 'credit' and status <> 'ignored' and not coalesce(reconciled, false)
           and (match_group is null or match_group like 'stone:%')
           and transaction_date between p_from and p_to
         group by 1, 2
      )
      select st.d, st.adv, st.n, st.liq, st.bruto, st.taxa, st.antecip, it.valor, it.ids, it.n as n_dep
        from st join it on it.d = st.d and it.adv = st.adv
       -- o banco arredonda cada crédito (quebra por bandeira): até 1 centavo por crédito
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
       where tenant_id = p_tenant and source = 'stone' and raw->>'kind' = 'installment'
         and transaction_type = 'credit' and status <> 'ignored'
         and transaction_date = g.d
         and (coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0) = g.adv;
      get diagnostics v_n = row_count;
      v_det := v_det + v_n;
      v_groups := v_groups + 1;
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
                            'card_provider', f.card_provider);
end;
$function$;

-- Quadro dos repasses: uma linha por dia × pilha.
-- situacao:
--   ok             Stone liquidou e o banco recebeu o mesmo valor
--   dia_fecha      a pilha não fecha, mas o DIA inteiro fecha (a Stone não informou a antecipação, ex.: maio/2026)
--   faltou         o banco recebeu MENOS do que a Stone liquidou (diferença real a conferir)
--   sobrou         o banco recebeu MAIS do que a Stone liquidou
--   sem_deposito   a Stone liquidou e nada entrou no banco nesse dia/pilha
--   sem_venda      entrou no banco e não há vendas da Stone importadas para o dia
--   sem_extrato    dia anterior ao primeiro crédito da Stone no extrato do banco (não dá para conferir)
create or replace function public.fn_stone_repasses(p_tenant uuid, p_from date, p_to date)
returns table (
  dia date, pilha text, vendas int, bruto numeric, taxa numeric, antecipacao numeric,
  liquido_stone numeric, depositado numeric, creditos int, diferenca numeric,
  dia_liquido_stone numeric, dia_depositado numeric, situacao text
)
language sql
stable
set search_path to 'public'
as $function$
  with f as (select * from public.fn_money_flow(p_tenant)),
  st as (
    select transaction_date as d,
           case when coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0 then 'antecipado' else 'debito' end as p,
           count(*)::int as n,
           round(sum(coalesce((raw->>'gross')::numeric, amount)), 2) as bruto,
           round(sum(coalesce((raw->>'gross')::numeric, amount) - coalesce((raw->>'net')::numeric, amount)
                     - coalesce((raw->>'advance_fee')::numeric, 0)), 2) as taxa,
           round(sum(coalesce((raw->>'advance_fee')::numeric, 0)), 2) as antecip,
           round(sum(coalesce((raw->>'net')::numeric, amount)), 2) as liq
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'stone' and raw->>'kind' = 'installment'
       and transaction_type = 'credit' and status <> 'ignored'
       and transaction_date between p_from and p_to
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
      from dep_all where d between p_from and p_to group by 1, 2
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
  )
  select k.d, k.p, k.n, k.bruto, k.taxa, k.antecip, k.liq, k.valor, k.n_dep,
         round(k.valor - k.liq, 2),
         round(k.dia_liq, 2), round(k.dia_valor, 2),
         case
           when (select d from primeiro) is null or (not k.dia_tem_dep and k.d < (select d from primeiro)) then 'sem_extrato'
           when abs(k.valor - k.liq) <= greatest(0.02, 0.01 * k.n_dep) then 'ok'
           when k.dia_tem_dep and k.dia_tem_stone
                and abs(k.dia_valor - k.dia_liq) <= greatest(0.02, 0.01 * k.dia_n_dep) then 'dia_fecha'
           when not k.tem_stone then 'sem_venda'
           when not k.tem_dep then 'sem_deposito'
           when k.valor < k.liq then 'faltou'
           else 'sobrou'
         end
    from k
   order by k.d desc, k.p;
$function$;

revoke all on function public.fn_stone_repasses(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_stone_repasses(uuid, date, date) to service_role;
