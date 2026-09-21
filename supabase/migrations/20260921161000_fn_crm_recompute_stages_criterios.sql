-- fn_crm_recompute_stages passa a ler os cortes de crm_stage_criteria.
--
-- Antes os numeros eram fixos no corpo da funcao. Agora cada loja define os
-- seus; `coalesce` garante os MESMOS valores de antes para quem nao configurou
-- (por isso a edge nao cria a linha sozinha: loja que nunca mexeu continua
-- acompanhando o padrao).
--
-- Virou temp table em vez de CTE unica porque o percentil do VIP agora e
-- parametro e precisa ser calculado antes do CASE que decide o estagio.
create or replace function public.fn_crm_recompute_stages(p_tenant_id uuid)
returns integer
language plpgsql
as $$
declare
  v_afetados integer;
  c_carrinho_horas integer;
  c_perdido_dias integer;
  c_risco_mult numeric;
  c_risco_min_dias integer;
  c_ciclo_padrao integer;
  c_fiel_min integer;
  c_vip_min_pedidos integer;
  c_vip_percentil numeric;
  c_vip_min_gasto numeric;
  v_corte_vip numeric;
begin
  select cr.carrinho_horas, cr.perdido_dias, cr.risco_multiplicador, cr.risco_min_dias,
         cr.ciclo_padrao_dias, cr.fiel_min_pedidos, cr.vip_min_pedidos, cr.vip_percentil, cr.vip_min_gasto
    into c_carrinho_horas, c_perdido_dias, c_risco_mult, c_risco_min_dias,
         c_ciclo_padrao, c_fiel_min, c_vip_min_pedidos, c_vip_percentil, c_vip_min_gasto
    from public.crm_stage_criteria cr
   where cr.tenant_id = p_tenant_id;

  c_carrinho_horas  := coalesce(c_carrinho_horas, 72);
  c_perdido_dias    := coalesce(c_perdido_dias, 90);
  c_risco_mult      := coalesce(c_risco_mult, 1.5);
  c_risco_min_dias  := coalesce(c_risco_min_dias, 21);
  c_ciclo_padrao    := coalesce(c_ciclo_padrao, 30);
  c_fiel_min        := coalesce(c_fiel_min, 6);
  c_vip_min_pedidos := coalesce(c_vip_min_pedidos, 6);
  c_vip_percentil   := coalesce(c_vip_percentil, 0.9);
  c_vip_min_gasto   := coalesce(c_vip_min_gasto, 0);

  create temp table tmp_crm_metrics on commit drop as
  select
    c.id as customer_id,
    c.phone as phone,
    count(o.id) as n,
    coalesce(sum(o.total_amount), 0)::numeric(12,2) as total,
    max(o.created_at) as last_at,
    min(o.created_at) as first_at
  from public.customers c
  left join public.orders o
    on o.customer_id = c.id
   and o.tenant_id = c.tenant_id
   and o.status <> 'cancelled'
   and coalesce(o.is_training, false) = false
  where c.tenant_id = p_tenant_id
  group by c.id, c.phone;

  select percentile_cont(c_vip_percentil) within group (order by total)
    into v_corte_vip
    from tmp_crm_metrics
   where n > 0;

  with abandono as (
    select distinct mv.phone
    from public.menu_visits mv
    where mv.tenant_id = p_tenant_id
      and mv.converted_at is null
      and mv.items_count > 0
      and mv.phone is not null
      and mv.last_seen_at > now() - make_interval(hours => c_carrinho_horas)
  ),
  calc as (
    select
      m.customer_id,
      m.n,
      m.total,
      m.last_at,
      case
        when m.n >= 2 then
          ((extract(epoch from (m.last_at - m.first_at)) / 86400.0) / (m.n - 1))::numeric(6,1)
      end as ciclo,
      case
        when m.last_at is not null then
          floor(extract(epoch from (now() - m.last_at)) / 86400.0)::integer
      end as dias,
      (a.phone is not null) as tem_carrinho
    from tmp_crm_metrics m
    left join abandono a on a.phone = m.phone
  ),
  final as (
    select
      c.customer_id, c.n, c.total, c.last_at, c.ciclo, c.dias,
      (case
        when c.tem_carrinho then 'carrinho_abandonado'
        when c.n = 0 then 'nunca_comprou'
        when c.dias > c_perdido_dias then 'perdido'
        when c.dias > greatest(c_risco_min_dias, (coalesce(c.ciclo, c_ciclo_padrao) * c_risco_mult)) then 'em_risco'
        when c.n = 1 then 'primeira_compra'
        when c.n >= c_vip_min_pedidos
             and c.total >= greatest(coalesce(v_corte_vip, 1e12), c_vip_min_gasto) then 'vip'
        when c.n >= c_fiel_min then 'fiel'
        else 'recorrente'
      end)::public.crm_stage as stage
    from calc c
  )
  insert into public.crm_customer_stage as cs (
    tenant_id, customer_id, stage, entered_at, computed_at,
    orders_count, total_spent, last_order_at, avg_cycle_days, days_since_last
  )
  select
    p_tenant_id, f.customer_id, f.stage, now(), now(),
    f.n, f.total, f.last_at, f.ciclo, f.dias
  from final f
  on conflict (tenant_id, customer_id) do update set
    stage = excluded.stage,
    entered_at = case when cs.stage = excluded.stage then cs.entered_at else now() end,
    computed_at = now(),
    orders_count = excluded.orders_count,
    total_spent = excluded.total_spent,
    last_order_at = excluded.last_order_at,
    avg_cycle_days = excluded.avg_cycle_days,
    days_since_last = excluded.days_since_last;

  get diagnostics v_afetados = row_count;
  drop table if exists tmp_crm_metrics;
  return v_afetados;
end;
$$;

comment on function public.fn_crm_recompute_stages(uuid) is
  'Recalcula crm_customer_stage da loja a partir de orders + menu_visits, usando os cortes de crm_stage_criteria (defaults quando a loja nao configurou). Idempotente: preserva entered_at enquanto o estagio nao muda.';

revoke all on function public.fn_crm_recompute_stages(uuid) from public, anon, authenticated;
grant execute on function public.fn_crm_recompute_stages(uuid) to service_role;
