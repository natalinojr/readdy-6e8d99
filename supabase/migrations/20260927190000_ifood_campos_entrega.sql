-- 2026-09-27: campos de entrega no pedido do iFood (servem ao desenho IFOOD-PEDIDOS-FUNIL.md).
-- Histórico: a "Fase 4" separada (pedido do iFood no funil sem virar `orders`, commit d95420e) foi DESFEITA no mesmo
-- dia — o dono escolheu o desenho em que o pedido do iFood vira pedido do ERPOS. Ficam só os campos que o desenho
-- reaproveita; o resto (motoboy em ifood_orders, ledger.ifood_order_id, gatilho e ranking com union) sai.

-- Coordenadas e taxa (mapa, motoboy, acerto) + código de entrega (verifyDeliveryCode) com limite de tentativas
alter table public.ifood_orders add column if not exists delivery_lat numeric;
alter table public.ifood_orders add column if not exists delivery_lng numeric;
alter table public.ifood_orders add column if not exists delivery_fee numeric;
alter table public.ifood_orders add column if not exists delivery_code_ok boolean not null default false;
alter table public.ifood_orders add column if not exists delivery_code_fails int not null default 0;
update public.ifood_orders
   set delivery_lat = nullif((address->'coordinates'->>'latitude')::numeric, 0),
       delivery_lng = nullif((address->'coordinates'->>'longitude')::numeric, 0),
       delivery_fee = (total->>'deliveryFee')::numeric
 where delivery_fee is null and (address is not null or total is not null);

-- Desfaz o caminho separado
drop trigger if exists trg_delivery_driver_ledger_ifood on public.ifood_orders;
drop function if exists public.fn_delivery_driver_ledger_ifood_trg();
drop index if exists public.delivery_driver_ledger_ifood_entrega_uq;
drop index if exists public.delivery_driver_ledger_ifood_estorno_uq;
alter table public.delivery_driver_ledger drop column if exists ifood_order_id;
drop index if exists public.ifood_orders_entrega_propria_idx;
alter table public.ifood_orders
  drop column if exists motoboy_driver_id, drop column if exists motoboy_status, drop column if exists motoboy_note,
  drop column if exists motoboy_problems, drop column if exists motoboy_timeline, drop column if exists motoboy_updated_at,
  drop column if exists delivery_notes, drop column if exists out_for_delivery_at, drop column if exists entregue_at;

-- Ranking volta a ser só dos pedidos do ERPOS (o pedido do iFood entra por `orders` no desenho novo)
-- ── Ranking por entregador (relatório de delivery) ──
-- Base: pedidos de delivery entregues por motoboy da loja no período (dia da entrega, America/Sao_Paulo).
create or replace function public.fn_delivery_ranking_entregadores(p_tenant uuid, p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_out jsonb;
begin
  if not _acerto_motoboy_pode(p_tenant) then raise exception 'sem permissão para o relatório desta loja'; end if;
  if p_ate - p_de > 366 then raise exception 'período muito longo (máximo 1 ano)'; end if;
  with o as (
    select o.id, o.motoboy_driver_id as driver_id, o.created_at, o.delivery_sla_min, o.delivery_distance_km,
           coalesce((o.motoboy_timeline->>'entregou')::timestamptz, o.out_for_delivery_at, o.updated_at) as entregue_at,
           (o.motoboy_timeline->>'coletou')::timestamptz as coletou_at
      from orders o
     where o.tenant_id = p_tenant and o.origin_type = 'delivery' and o.status = 'delivered'
       and o.motoboy_driver_id is not null and not coalesce(o.is_training, false)
       and o.created_at >= (p_de::timestamp at time zone 'America/Sao_Paulo') - interval '1 day'
       and o.created_at <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), f as (
    select * from o
     where (entregue_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  ), custo as (
    select l.driver_id, sum(l.amount) as custo
      from delivery_driver_ledger l
     where l.tenant_id = p_tenant and l.kind in ('entrega', 'diaria', 'estorno') and l.status <> 'estornado'
       and l.work_date between p_de and p_ate
     group by 1
  ), r as (
    select d.id as driver_id, d.name,
           count(f.id) as entregas,
           round(avg(extract(epoch from (f.entregue_at - f.created_at)) / 60)::numeric, 0) as tempo_total_min,
           round(avg(extract(epoch from (f.entregue_at - f.coletou_at)) / 60) filter (where f.coletou_at is not null)::numeric, 0) as tempo_rota_min,
           count(*) filter (where f.delivery_sla_min is not null and f.entregue_at > f.created_at + make_interval(mins => f.delivery_sla_min)) as atrasos,
           round(coalesce(sum(f.delivery_distance_km), 0)::numeric, 1) as km,
           coalesce(max(c.custo), 0) as custo
      from f join delivery_drivers d on d.id = f.driver_id and d.tenant_id = p_tenant
      left join custo c on c.driver_id = d.id
     group by d.id, d.name
  )
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
           'custo_por_entrega', case when r.entregas > 0 then round(r.custo / r.entregas, 2) end,
           'pct_atraso', case when r.entregas > 0 then round(100.0 * r.atrasos / r.entregas, 0) end)
           order by r.entregas desc, r.name), '[]'::jsonb)
    into v_out from r;
  return v_out;
end $$;

