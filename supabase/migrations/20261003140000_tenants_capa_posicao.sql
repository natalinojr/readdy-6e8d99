-- Posição da foto de capa (qual parte aparece no topo do delivery e do QR).
-- Formato do CSS object-position: "X% Y%" (0–100). Nulo = centro.
alter table public.tenants add column if not exists cover_position text;

alter table public.tenants drop constraint if exists tenants_cover_position_fmt;
alter table public.tenants add constraint tenants_cover_position_fmt
  check (cover_position is null or cover_position ~ '^(100|[0-9]{1,2})(\.[0-9]+)?% (100|[0-9]{1,2})(\.[0-9]+)?%$');

comment on column public.tenants.cover_position is 'Posição da capa no topo do cardápio online ("X% Y%", object-position). Nulo = centro.';

grant select (cover_position) on public.tenants to anon;
