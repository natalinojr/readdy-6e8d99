-- 2026-09-26: Delivery Fase 1 — GPS do motoboy + rastreio para o cliente.
--
-- delivery_driver_positions  = ÚLTIMA posição de cada motoboy (1 linha por driver, upsert).
-- delivery_driver_position_history = histórico curto (limpo por cron após 7 dias).
--
-- Escrita SÓ pela Edge `motoboy-signal` (service_role) via fn_driver_ping, que numa única
-- chamada valida o motoboy (loja + ativo), aplica o limite de frequência no servidor
-- (≥ 10 s entre gravações do mesmo motoboy), grava última posição + histórico e avisa as
-- telas pelo broadcast público `drivers-ping:<tenant>` com payload mínimo ({ driver_id }) —
-- a posição NÃO trafega no canal; o Gestor relê pela leitura autenticada (RLS por loja).
-- Carga: o front só manda ping com pedido em rota/turno ligado, a cada ≥15 s e ≥30 m.

create table if not exists public.delivery_driver_positions (
  driver_id   uuid primary key references public.delivery_drivers(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    real,
  heading     real,
  speed       real,
  recorded_at timestamptz not null default now()
);
create index if not exists delivery_driver_positions_tenant_idx
  on public.delivery_driver_positions (tenant_id, recorded_at desc);

create table if not exists public.delivery_driver_position_history (
  id          bigint generated always as identity primary key,
  driver_id   uuid not null references public.delivery_drivers(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    real,
  recorded_at timestamptz not null default now()
);
create index if not exists delivery_driver_position_history_driver_idx
  on public.delivery_driver_position_history (driver_id, recorded_at desc);
create index if not exists delivery_driver_position_history_recorded_idx
  on public.delivery_driver_position_history (recorded_at);

alter table public.delivery_driver_positions enable row level security;
alter table public.delivery_driver_position_history enable row level security;

drop policy if exists delivery_driver_positions_select_membership on public.delivery_driver_positions;
create policy delivery_driver_positions_select_membership on public.delivery_driver_positions
  for select to authenticated using (auth_is_member_of(tenant_id));
drop policy if exists delivery_driver_position_history_select_membership on public.delivery_driver_position_history;
create policy delivery_driver_position_history_select_membership on public.delivery_driver_position_history
  for select to authenticated using (auth_is_member_of(tenant_id));

revoke all on public.delivery_driver_positions from anon, authenticated;
revoke all on public.delivery_driver_position_history from anon, authenticated;
grant select on public.delivery_driver_positions to authenticated;
grant select on public.delivery_driver_position_history to authenticated;
grant all on public.delivery_driver_positions to service_role;
grant all on public.delivery_driver_position_history to service_role;

-- Ping de posição (chamado só pela Edge motoboy-signal, com service_role).
-- Retorna 'ok' | 'throttled' | 'driver_invalido' | 'coord_invalida'.
create or replace function public.fn_driver_ping(
  p_tenant_id uuid, p_driver_id uuid, p_lat double precision, p_lng double precision,
  p_accuracy real default null, p_heading real default null, p_speed real default null
) returns text
language plpgsql security definer set search_path to 'public', 'realtime' as $$
declare
  v_last timestamptz;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or (p_lat = 0 and p_lng = 0) then
    return 'coord_invalida';
  end if;
  if not exists (select 1 from delivery_drivers d
                  where d.id = p_driver_id and d.tenant_id = p_tenant_id and d.is_active) then
    return 'driver_invalido';
  end if;
  select recorded_at into v_last from delivery_driver_positions where driver_id = p_driver_id;
  if v_last is not null and v_last > now() - interval '10 seconds' then
    return 'throttled';
  end if;

  insert into delivery_driver_positions (driver_id, tenant_id, lat, lng, accuracy, heading, speed, recorded_at)
  values (p_driver_id, p_tenant_id, p_lat, p_lng, p_accuracy, p_heading, p_speed, now())
  on conflict (driver_id) do update set
    tenant_id = excluded.tenant_id, lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
    heading = excluded.heading, speed = excluded.speed, recorded_at = excluded.recorded_at;

  insert into delivery_driver_position_history (driver_id, tenant_id, lat, lng, accuracy, recorded_at)
  values (p_driver_id, p_tenant_id, p_lat, p_lng, p_accuracy, now());

  begin
    perform realtime.send(jsonb_build_object('driver_id', p_driver_id), 'driver_position',
                          'drivers-ping:' || p_tenant_id::text, false);
  exception when others then
    null; -- o aviso nunca bloqueia a gravação
  end;
  return 'ok';
end $$;

revoke all on function public.fn_driver_ping(uuid, uuid, double precision, double precision, real, real, real) from public, anon, authenticated;
grant execute on function public.fn_driver_ping(uuid, uuid, double precision, double precision, real, real, real) to service_role;

-- Limpeza diária do histórico (> 7 dias). 06h40 UTC, fora do pico.
do $$
begin
  perform cron.unschedule('driver-positions-limpeza')
    where exists (select 1 from cron.job where jobname = 'driver-positions-limpeza');
  perform cron.schedule('driver-positions-limpeza', '40 6 * * *',
    $q$delete from public.delivery_driver_position_history where recorded_at < now() - interval '7 days'$q$);
end $$;
