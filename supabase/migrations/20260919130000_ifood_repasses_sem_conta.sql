-- Repasses do iFood: detalhe.sem_conta = a loja não tem conta de depósito do iFood configurada
-- ("Como o dinheiro entra") — sem extrato não dá para dizer "não achado" (caso Vila Leste, Itaú sem API).
create or replace function public.fin_ifood_repasses(p_tenant uuid, p_from date, p_to date)
returns table (data_repasse date, esperado numeric, depositos int, recebido_inter numeric, linhas_inter int, detalhe jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with acc as (
    select ifood_deposit_account_id as id from public.fn_money_flow(p_tenant)
  ), lin as (
    select e.data_repasse as d, e.merchant_id, e.valor, e.valor_transacao, e.metodo_pagamento, e.impacto_repasse
    from public.fin_ifood_entries e
    where public.auth_is_member_of(p_tenant) and e.tenant_id = p_tenant
      and e.data_repasse between p_from and p_to
  ), porloja as (
    select lin.d, lin.merchant_id, sum(lin.valor) filter (where lin.impacto_repasse) as bruto
    from lin group by 1, 2
  ), ant as (
    select p.d, p.merchant_id, coalesce(p.bruto, 0) as bruto,
           case when coalesce(m.anticipation_pct, 0) > 0 then round(coalesce(p.bruto, 0) * m.anticipation_pct / 100, 2) else 0 end as taxa
    from porloja p
    left join public.fin_ifood_merchants m on m.tenant_id = p_tenant and m.merchant_id = p.merchant_id
  ), d as (
    select ant.d, sum(ant.bruto) as bruto, sum(ant.taxa) as taxa from ant group by ant.d
  ), dep as (
    select lin.d, lin.valor_transacao as v, max(lin.metodo_pagamento) as m
    from lin where lin.valor_transacao is not null group by 1, 2
  ), depagg as (
    select dep.d, count(*) as n, jsonb_agg(jsonb_build_object('valor', dep.v, 'metodo', dep.m) order by dep.v) as deps
    from dep group by dep.d
  ), inter as (
    select d.d, sum(i.amount) as tot, count(*) as n,
           jsonb_agg(jsonb_build_object('data', i.transaction_date, 'valor', i.amount, 'descricao', i.description) order by i.transaction_date, i.amount) as lin
    from d
    join acc on acc.id is not null
    join public.fin_bank_statement_imports i
      on i.tenant_id = p_tenant and i.bank_account_id = acc.id and i.source <> 'stone'
     and i.transaction_type = 'credit'
     and i.transaction_date between d.d and d.d + 1
     and (coalesce(i.description, '') || ' ' || coalesce(i.counterpart_name, '')) ilike '%ifood%'
    group by d.d
  )
  select d.d, round(coalesce(d.bruto, 0) - coalesce(d.taxa, 0), 2), coalesce(depagg.n, 0)::int, coalesce(inter.tot, 0), coalesce(inter.n, 0)::int,
         jsonb_build_object('ifood', coalesce(depagg.deps, '[]'::jsonb), 'inter', coalesce(inter.lin, '[]'::jsonb),
                            'bruto', round(coalesce(d.bruto, 0), 2), 'antecipacao', coalesce(d.taxa, 0),
                            'sem_conta', (select acc.id is null from acc))
  from d left join depagg on depagg.d = d.d left join inter on inter.d = d.d
  where coalesce(d.bruto, 0) <> 0
  order by d.d
$$;
revoke all on function public.fin_ifood_repasses(uuid, date, date) from public, anon;
grant execute on function public.fin_ifood_repasses(uuid, date, date) to authenticated, service_role;
