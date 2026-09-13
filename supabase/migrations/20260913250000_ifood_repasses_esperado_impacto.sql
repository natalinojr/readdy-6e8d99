-- Valor esperado de cada repasse = soma das linhas do relatório com impacto no repasse (e não a soma
-- dos "depósitos" valor_transacao, que não batem com o extrato). Conferido 2026-09-13: com as duas lojas
-- de Paranaguá importadas, todo repasse de 01/07 a 09/09 bate no centavo com os créditos "iFood" do Inter.
create or replace function public.fin_ifood_repasses(p_tenant uuid, p_from date, p_to date)
returns table (data_repasse date, esperado numeric, depositos int, recebido_inter numeric, linhas_inter int, detalhe jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with lin as (
    select e.data_repasse as d, e.valor, e.valor_transacao, e.metodo_pagamento, e.impacto_repasse
    from public.fin_ifood_entries e
    where public.auth_is_member_of(p_tenant) and e.tenant_id = p_tenant
      and e.data_repasse between p_from and p_to
  ), d as (
    select lin.d, sum(lin.valor) filter (where lin.impacto_repasse) as esperado
    from lin group by lin.d
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
    join public.fin_bank_statement_imports i
      on i.tenant_id = p_tenant and i.source = 'inter' and i.transaction_type = 'credit'
     and i.transaction_date between d.d and d.d + 1
     and (coalesce(i.description, '') || ' ' || coalesce(i.counterpart_name, '')) ilike '%ifood%'
    group by d.d
  )
  select d.d, round(coalesce(d.esperado, 0), 2), coalesce(depagg.n, 0)::int, coalesce(inter.tot, 0), coalesce(inter.n, 0)::int,
         jsonb_build_object('ifood', coalesce(depagg.deps, '[]'::jsonb), 'inter', coalesce(inter.lin, '[]'::jsonb))
  from d left join depagg on depagg.d = d.d left join inter on inter.d = d.d
  where coalesce(d.esperado, 0) <> 0
  order by d.d
$$;
revoke all on function public.fin_ifood_repasses(uuid, date, date) from public, anon;
grant execute on function public.fin_ifood_repasses(uuid, date, date) to authenticated, service_role;
