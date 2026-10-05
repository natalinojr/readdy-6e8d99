-- Área iFood (2026-10-05): avisos no celular do iFood (edge ifood-avisos, a cada 10 min).
-- 1) fin_ifood_repasses passa a ter uma base sem a checagem de quem chama (só service_role executa), para o
--    aviso "o repasse caiu?" usar a MESMA conta da tela. A função da tela continua igual por fora.
-- 2) Cron que chama a edge com a chave interna (mesmo padrão de fn_ifood_shipping_poll).

create or replace function public.fin_ifood_repasses_base(p_tenant uuid, p_from date, p_to date)
returns table(data_repasse date, esperado numeric, depositos integer, recebido_inter numeric, linhas_inter integer, detalhe jsonb)
language sql stable security definer set search_path to 'public'
as $function$
  with acc as (
    select ifood_deposit_account_id as id from public.fn_money_flow(p_tenant)
  ), lin as (
    select e.data_repasse as d, e.merchant_id, e.valor, e.valor_transacao, e.metodo_pagamento, e.impacto_repasse
    from public.fin_ifood_entries e
    where e.tenant_id = p_tenant
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
$function$;

revoke all on function public.fin_ifood_repasses_base(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fin_ifood_repasses_base(uuid, date, date) to service_role;

-- A da tela: mesma resposta de antes, só para quem pode ver o financeiro da loja.
create or replace function public.fin_ifood_repasses(p_tenant uuid, p_from date, p_to date)
returns table(data_repasse date, esperado numeric, depositos integer, recebido_inter numeric, linhas_inter integer, detalhe jsonb)
language sql stable security definer set search_path to 'public'
as $function$
  select * from public.fin_ifood_repasses_base(p_tenant, p_from, p_to) where public.auth_pode_financeiro(p_tenant)
$function$;

create or replace function public.fn_ifood_avisos_cron()
returns text language plpgsql security definer set search_path to 'public', 'extensions', 'vault'
as $function$
declare v_key text; v_anon text;
begin
  if not exists (select 1 from public.ifood_pdv_config where order_enabled)
     and not exists (select 1 from public.fin_ifood_merchants where api_sync) then
    return 'nada a acompanhar';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault'; end if;
  perform net.http_post(
    url := 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/ifood-avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key,
                                  'apikey', v_anon, 'Authorization', 'Bearer ' || v_anon),
    body := '{"action":"rodar"}'::jsonb,
    timeout_milliseconds := 55000
  );
  return 'chamado';
end;
$function$;
revoke all on function public.fn_ifood_avisos_cron() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ifood-avisos';
select cron.schedule('ifood-avisos', '*/10 * * * *', $$select public.fn_ifood_avisos_cron();$$);
