-- Recalcula o estagio de funil de todos os clientes de uma loja.
--
-- Fonte da verdade: orders (pedidos validos) + menu_visits (carrinho parado).
-- Chamada pela Edge Function crm-funnel (recompute), no cron diario e ao abrir
-- a tela do funil.
--
-- Precedencia (a primeira que casar vence):
--   carrinho_abandonado > perdido > em_risco > nunca_comprou
--   > primeira_compra > vip > fiel > recorrente
--
-- "Sumiu" e relativo AO CLIENTE: 1,5x o ciclo medio dele, com piso de 21 dias
-- (quem pede toda semana sumiu em 10 dias; quem pede uma vez por mes, nao).

create or replace function public.fn_crm_recompute_stages(p_tenant_id uuid)
returns integer
language plpgsql
as $$
declare
  v_afetados integer;
begin
  with metrics as (
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
    group by c.id, c.phone
  ),
  -- Topo de gasto da loja: so entre quem ja comprou.
  corte_vip as (
    select percentile_cont(0.9) within group (order by total) as valor
    from metrics
    where n > 0
  ),
  -- Carrinho parado nas ultimas 72h e ainda nao convertido.
  abandono as (
    select distinct mv.phone
    from public.menu_visits mv
    where mv.tenant_id = p_tenant_id
      and mv.converted_at is null
      and mv.items_count > 0
      and mv.phone is not null
      and mv.last_seen_at > now() - interval '72 hours'
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
    from metrics m
    left join abandono a on a.phone = m.phone
  ),
  final as (
    select
      c.customer_id,
      c.n,
      c.total,
      c.last_at,
      c.ciclo,
      c.dias,
      (case
        when c.tem_carrinho then 'carrinho_abandonado'
        when c.n = 0 then 'nunca_comprou'
        when c.dias > 90 then 'perdido'
        when c.dias > greatest(21, (coalesce(c.ciclo, 30) * 1.5)) then 'em_risco'
        when c.n = 1 then 'primeira_compra'
        when c.n >= 6 and c.total >= coalesce((select valor from corte_vip), 1e12) then 'vip'
        when c.n >= 6 then 'fiel'
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
    -- so reinicia o relogio quando o estagio MUDA
    entered_at = case when cs.stage = excluded.stage then cs.entered_at else now() end,
    computed_at = now(),
    orders_count = excluded.orders_count,
    total_spent = excluded.total_spent,
    last_order_at = excluded.last_order_at,
    avg_cycle_days = excluded.avg_cycle_days,
    days_since_last = excluded.days_since_last;

  get diagnostics v_afetados = row_count;
  return v_afetados;
end;
$$;

comment on function public.fn_crm_recompute_stages(uuid) is
  'Recalcula crm_customer_stage da loja a partir de orders + menu_visits. Idempotente: preserva entered_at enquanto o estagio nao muda.';

revoke all on function public.fn_crm_recompute_stages(uuid) from public, anon, authenticated;
grant execute on function public.fn_crm_recompute_stages(uuid) to service_role;
