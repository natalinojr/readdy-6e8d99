-- 2026-10-08: GPS do motoboy — de onde veio a posição (app Android ou site).
--
-- Em 07/10 o GPS de um motoboy da Vila sumiu por 7 min no meio de uma saída com 2 pedidos
-- (tela apagada no site ou app fechado pela economia de bateria) e não dava para saber qual.
-- `source` = 'app' | 'web' (null = versão antiga do front). O Gestor mostra no balão da moto.
--
-- fn_driver_ping ganha uma 2ª versão com p_source OBRIGATÓRIO (sem default), ao lado da antiga de 7
-- parâmetros: a Edge antiga (7 nomes) só casa com a antiga e a nova (sempre manda p_source, mesmo null)
-- só com a nova — com default as duas casariam e o PostgREST recusaria a chamada por ambiguidade.
-- A de 7 parâmetros pode sair depois que a Edge nova estiver no ar.

alter table public.delivery_driver_positions add column if not exists source text;
alter table public.delivery_driver_position_history add column if not exists source text;

create or replace function public.fn_driver_ping(
  p_tenant_id uuid, p_driver_id uuid, p_lat double precision, p_lng double precision,
  p_accuracy real, p_heading real, p_speed real, p_source text
) returns text
language plpgsql security definer set search_path to 'public', 'realtime' as $$
declare
  v_last timestamptz;
  v_source text := case when p_source in ('app', 'web') then p_source end;
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

  insert into delivery_driver_positions (driver_id, tenant_id, lat, lng, accuracy, heading, speed, source, recorded_at)
  values (p_driver_id, p_tenant_id, p_lat, p_lng, p_accuracy, p_heading, p_speed, v_source, now())
  on conflict (driver_id) do update set
    tenant_id = excluded.tenant_id, lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
    heading = excluded.heading, speed = excluded.speed, source = excluded.source, recorded_at = excluded.recorded_at;

  insert into delivery_driver_position_history (driver_id, tenant_id, lat, lng, accuracy, source, recorded_at)
  values (p_driver_id, p_tenant_id, p_lat, p_lng, p_accuracy, v_source, now());

  begin
    perform realtime.send(jsonb_build_object('driver_id', p_driver_id), 'driver_position',
                          'drivers-ping:' || p_tenant_id::text, false);
  exception when others then
    null; -- o aviso nunca bloqueia a gravação
  end;
  return 'ok';
end $$;

revoke all on function public.fn_driver_ping(uuid, uuid, double precision, double precision, real, real, real, text) from public, anon, authenticated;
grant execute on function public.fn_driver_ping(uuid, uuid, double precision, double precision, real, real, real, text) to service_role;

notify pgrst, 'reload schema';
