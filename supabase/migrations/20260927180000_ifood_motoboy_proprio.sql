-- 2026-09-27: Delivery Fase 4 — pedido do iFood entregue pelo MOTOBOY DA LOJA (delivered_by = MERCHANT)
-- passa pelo funil do ERPOS (Gestor de Entregas + portal do motoboy + acerto dos entregadores).
--
-- Decisão: o pedido do iFood NÃO vira linha em `orders` (entraria no faturamento/estoque/KDS/nota e o iFood já é
-- somado pela conciliação — contaria em dobro). Ele continua em ifood_orders e ganha os campos do motoboy.
-- Gestor e portal leem as duas fontes (_shared/ifood-motoboy.ts); o acerto ganha ifood_order_id no lançamento.
-- "Entregue" no ERPOS = entregue_at preenchido (motoboy validou o código de entrega no iFood, ou a loja marcou).

alter table public.ifood_orders add column if not exists motoboy_driver_id uuid references public.delivery_drivers(id) on delete set null;
alter table public.ifood_orders add column if not exists motoboy_status text;
alter table public.ifood_orders add column if not exists motoboy_note text;
alter table public.ifood_orders add column if not exists motoboy_problems jsonb not null default '[]';
alter table public.ifood_orders add column if not exists motoboy_timeline jsonb not null default '{}';
alter table public.ifood_orders add column if not exists motoboy_updated_at timestamptz;
alter table public.ifood_orders add column if not exists delivery_notes jsonb not null default '[]';
alter table public.ifood_orders add column if not exists out_for_delivery_at timestamptz;
alter table public.ifood_orders add column if not exists entregue_at timestamptz;
alter table public.ifood_orders add column if not exists delivery_code_ok boolean not null default false;
alter table public.ifood_orders add column if not exists delivery_lat numeric;
alter table public.ifood_orders add column if not exists delivery_lng numeric;
alter table public.ifood_orders add column if not exists delivery_fee numeric;

-- Coordenadas e taxa dos pedidos que já existem (0,0 = pedido de teste sem posição)
update public.ifood_orders
   set delivery_lat = nullif((address->'coordinates'->>'latitude')::numeric, 0),
       delivery_lng = nullif((address->'coordinates'->>'longitude')::numeric, 0),
       delivery_fee = (total->>'deliveryFee')::numeric
 where delivery_fee is null and (address is not null or total is not null);

-- Pedidos de entrega própria em aberto de uma loja (Gestor/portal leem a cada poucos segundos)
create index if not exists ifood_orders_entrega_propria_idx on public.ifood_orders (tenant_id, ordered_at)
  where order_type = 'DELIVERY' and delivered_by = 'MERCHANT';

-- ── Acerto: lançamento pode vir de um pedido do iFood ──
alter table public.delivery_driver_ledger add column if not exists ifood_order_id uuid references public.ifood_orders(id) on delete set null;
create unique index if not exists delivery_driver_ledger_ifood_entrega_uq on public.delivery_driver_ledger (ifood_order_id) where kind = 'entrega';
create unique index if not exists delivery_driver_ledger_ifood_estorno_uq on public.delivery_driver_ledger (ifood_order_id) where kind = 'estorno';

-- Mesmas regras do gatilho de orders (fn_delivery_driver_ledger_trg), com a chave ifood_order_id.
create or replace function public.fn_delivery_driver_ledger_ifood_trg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_cfg jsonb;
  v_e delivery_driver_ledger;
  v_calc jsonb;
  v_agora timestamptz := now();
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  begin
    select * into v_e from delivery_driver_ledger where ifood_order_id = new.id and kind = 'entrega' for update;

    if new.entregue_at is not null and new.status <> 'cancelled' and new.motoboy_driver_id is not null
       and new.order_type = 'DELIVERY' and new.delivered_by = 'MERCHANT' then
      if v_e.id is null then
        select delivery_config->'acerto_motoboy' into v_cfg from system_settings where tenant_id = new.tenant_id;
        if v_cfg is null or coalesce(v_cfg->>'ativo', '') <> 'true' then return new; end if;
        if not exists (select 1 from delivery_drivers where id = new.motoboy_driver_id and tenant_id = new.tenant_id) then return new; end if;
        v_calc := _acerto_motoboy_valor(v_cfg, null, new.delivery_fee);
        insert into delivery_driver_ledger (tenant_id, driver_id, ifood_order_id, kind, amount, km, occurred_at, work_date, regra, note)
        values (new.tenant_id, new.motoboy_driver_id, new.id, 'entrega', (v_calc->>'valor')::numeric, null, v_agora, v_dia,
                v_calc->'regra', 'iFood #' || coalesce(new.display_id, ''))
        on conflict (ifood_order_id) where kind = 'entrega' do nothing;
      elsif v_e.status = 'estornado' then
        update delivery_driver_ledger set status = 'aberto', driver_id = new.motoboy_driver_id,
               occurred_at = v_agora, work_date = v_dia, updated_at = v_agora
         where id = v_e.id and status = 'estornado';
      elsif v_e.status = 'aberto' and v_e.driver_id <> new.motoboy_driver_id then
        update delivery_driver_ledger set driver_id = new.motoboy_driver_id, updated_at = v_agora
         where id = v_e.id and status = 'aberto';
      end if;
      delete from delivery_driver_ledger where ifood_order_id = new.id and kind = 'estorno' and status = 'aberto';
    elsif v_e.id is not null then
      -- cancelado no iFood depois de entregue, entrega desfeita ou sem entregador
      if v_e.status = 'aberto' then
        update delivery_driver_ledger set status = 'estornado', updated_at = v_agora where id = v_e.id and status = 'aberto';
      elsif v_e.status = 'fechado' then
        insert into delivery_driver_ledger (tenant_id, driver_id, ifood_order_id, kind, amount, km, occurred_at, work_date, note)
        values (v_e.tenant_id, v_e.driver_id, new.id, 'estorno', -v_e.amount, v_e.km, v_agora, v_dia,
                'iFood #' || coalesce(new.display_id, '') || ' desfeito depois do acerto')
        on conflict (ifood_order_id) where kind = 'estorno' do nothing;
      end if;
    end if;
  exception when others then
    begin
      perform fn_dev_error_report(jsonb_build_object(
        'source', 'other', 'severity', 'error', 'tenant_id', new.tenant_id, 'fn', 'fn_delivery_driver_ledger_ifood_trg',
        'message', 'Acerto do motoboy (iFood) não lançado: ' || sqlerrm,
        'context', jsonb_build_object('ifood_order_row', new.id, 'status', new.status, 'sqlstate', sqlstate)));
    exception when others then
      raise warning 'acerto_motoboy_ifood: pedido % — %', new.id, sqlerrm;
    end;
  end;
  return new;
end $$;

drop trigger if exists trg_delivery_driver_ledger_ifood on public.ifood_orders;
create trigger trg_delivery_driver_ledger_ifood
  after update of entregue_at, status, motoboy_driver_id on public.ifood_orders
  for each row
  when (new.order_type = 'DELIVERY' and new.delivered_by = 'MERCHANT'
        and ((new.entregue_at is distinct from old.entregue_at)
             or (new.entregue_at is not null and new.status is distinct from old.status and (new.status = 'cancelled' or old.status = 'cancelled'))
             or (new.entregue_at is not null and new.motoboy_driver_id is distinct from old.motoboy_driver_id)))
  execute function public.fn_delivery_driver_ledger_ifood_trg();

-- ── Ranking por entregador: + pedidos do iFood com motoboy da loja (Fase 4) ──
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
    union all
    -- Fase 4: pedidos do iFood entregues pelo motoboy da loja (sem SLA/km do ERPOS)
    select i.id, i.motoboy_driver_id, coalesce(i.ordered_at, i.created_at), null::int, null::numeric,
           i.entregue_at, (i.motoboy_timeline->>'coletou')::timestamptz
      from ifood_orders i
     where i.tenant_id = p_tenant and i.order_type = 'DELIVERY' and i.delivered_by = 'MERCHANT'
       and i.entregue_at is not null and i.status <> 'cancelled' and i.motoboy_driver_id is not null
       and i.entregue_at >= (p_de::timestamp at time zone 'America/Sao_Paulo') - interval '1 day'
       and i.entregue_at <  ((p_ate + 2)::timestamp at time zone 'America/Sao_Paulo')
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


-- Revisão (Opus): código de entrega errado conta tentativa; 5 erros travam o pedido até o Gestor liberar o entregador.
alter table public.ifood_orders add column if not exists delivery_code_fails int not null default 0;
