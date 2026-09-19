-- Antecipação de repasses do iFood por loja (2026-09-19).
--
-- Caso: Vila Leste › Pontal (2882833) recebe com "repasse antecipado": o relatório de conciliação traz a
-- data ORIGINAL (data_repasse_esperada 30/09, 07/10, 14/10), mas o Portal paga na quarta-feira seguinte à
-- semana de vendas (09/09, 16/09, 23/09 = 21 dias antes) descontando 1,59% ("Taxa de antecipação"), e essa
-- taxa não aparece em nenhuma linha do relatório. Paranaguá não antecipa (bate no centavo na data original).
--
-- Enquanto a API de antecipações (fin_ifood_anticipations) não tem dados, a loja configura:
--   fin_ifood_merchants.anticipation_pct  (null = não antecipa) e anticipation_days (padrão 21).
-- fin_ifood_entries.data_repasse passa a ser a data EFETIVA (antecipada quando configurado) e
-- data_repasse_original guarda a do relatório. Assim Inter, razão e tela usam a data em que o dinheiro cai.
-- Taxa = round(repasse da loja no dia × pct, 2) — confere com o portal: 1.356,37 → 21,57; 1.077,88 → 17,14;
-- 254,94 → 4,05.

alter table public.fin_ifood_merchants
  add column if not exists anticipation_pct numeric(6,3),
  add column if not exists anticipation_days int not null default 21;
alter table public.fin_ifood_merchants drop constraint if exists fin_ifood_merchants_anticipation_chk;
alter table public.fin_ifood_merchants add constraint fin_ifood_merchants_anticipation_chk
  check ((anticipation_pct is null or (anticipation_pct >= 0 and anticipation_pct < 20)) and anticipation_days between 0 and 60);

alter table public.fin_ifood_entries add column if not exists data_repasse_original date;
update public.fin_ifood_entries set data_repasse_original = data_repasse where data_repasse_original is null and data_repasse is not null;

-- Reaplica a data efetiva nas linhas já importadas de uma loja (chamada pela edge ao salvar a configuração).
create or replace function public.fn_ifood_apply_anticipation(p_tenant uuid, p_merchant text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int; v_pct numeric; v_days int;
begin
  select m.anticipation_pct, m.anticipation_days into v_pct, v_days
    from public.fin_ifood_merchants m where m.tenant_id = p_tenant and m.merchant_id = p_merchant;
  update public.fin_ifood_entries e
     set data_repasse = case when coalesce(v_pct, 0) > 0 then e.data_repasse_original - coalesce(v_days, 21) else e.data_repasse_original end
   where e.tenant_id = p_tenant and e.merchant_id = p_merchant and e.data_repasse_original is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.fn_ifood_apply_anticipation(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_ifood_apply_anticipation(uuid, text) to service_role;

-- Repasses por data: "esperado" já sem a taxa de antecipação (é o que cai no banco); o detalhe traz a taxa.
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
                            'bruto', round(coalesce(d.bruto, 0), 2), 'antecipacao', coalesce(d.taxa, 0))
  from d left join depagg on depagg.d = d.d left join inter on inter.d = d.d
  where coalesce(d.bruto, 0) <> 0
  order by d.d
$$;
revoke all on function public.fin_ifood_repasses(uuid, date, date) from public, anon;
grant execute on function public.fin_ifood_repasses(uuid, date, date) to authenticated, service_role;
