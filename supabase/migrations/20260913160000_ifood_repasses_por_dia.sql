-- Casamento por dia: os depósitos que o relatório lista (valor_transacao) não batem 1:1
-- com o extrato (o cartão chega como "Crédito domicílio cartão - Ifood" em valores
-- próprios, e o "Saldo" chega descontado). Todo crédito do Inter com "ifood" na
-- descrição/contraparte, perto de um dia de repasse, vira repasse iFood.
create or replace function public.fn_match_ifood_inter(p_tenant uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.fin_bank_statement_imports i
     set status = 'matched', match_kind = 'ifood_deposit',
         match_group = 'ifood:' || i.transaction_date::text,
         matched_at = now(), category = coalesce(i.category, 'Repasse iFood'),
         notes = 'Repasse iFood (conciliação iFood)'
   where i.tenant_id = p_tenant and i.source = 'inter' and i.transaction_type = 'credit'
     and i.match_kind is null and coalesce(i.reconciled, false) = false
     and i.transaction_date between p_from - 1 and p_to + 2
     and (coalesce(i.description, '') || ' ' || coalesce(i.counterpart_name, '')) ilike '%ifood%';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.fn_match_ifood_inter(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_match_ifood_inter(uuid, date, date) to service_role;

-- Repasses por data: previsto no relatório do iFood × créditos iFood no Inter (D e D+1).
-- Para a aba iFood (o app não lê fin_bank_statement_imports direto).
create or replace function public.fin_ifood_repasses(p_tenant uuid, p_from date, p_to date)
returns table (data_repasse date, esperado numeric, depositos int, recebido_inter numeric, linhas_inter int, detalhe jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with dep as (
    select e.data_repasse as d, e.valor_transacao as v, max(e.metodo_pagamento) as m
    from public.fin_ifood_entries e
    where public.auth_is_member_of(p_tenant) and e.tenant_id = p_tenant
      and e.data_repasse between p_from and p_to and e.valor_transacao is not null
    group by 1, 2
  ), d as (
    select dep.d, sum(dep.v) as esperado, count(*) as depositos,
           jsonb_agg(jsonb_build_object('valor', dep.v, 'metodo', dep.m) order by dep.v) as deps
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
  select d.d, d.esperado, d.depositos::int, coalesce(inter.tot, 0), coalesce(inter.n, 0)::int,
         jsonb_build_object('ifood', d.deps, 'inter', coalesce(inter.lin, '[]'::jsonb))
  from d left join inter on inter.d = d.d
  order by d.d
$$;
revoke all on function public.fin_ifood_repasses(uuid, date, date) from public, anon;
grant execute on function public.fin_ifood_repasses(uuid, date, date) to authenticated, service_role;
