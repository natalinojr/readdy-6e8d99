-- Até 10 fotos de capa no cardápio online (delivery e QR), passando sozinhas.
-- Lista ordenada de {url, position}; position no formato do cover_position ("X% Y%", vazio = centro).
-- cover_url/cover_position continuam espelhando a 1ª foto (o config-write mantém),
-- então quem só lê a capa única segue funcionando.
alter table public.tenants add column if not exists cover_images jsonb not null default '[]'::jsonb;

alter table public.tenants drop constraint if exists tenants_cover_images_fmt;
alter table public.tenants add constraint tenants_cover_images_fmt
  check (jsonb_typeof(cover_images) = 'array' and jsonb_array_length(cover_images) <= 10);

-- Lojas que já tinham capa começam com ela como 1ª (e única) foto
update public.tenants
   set cover_images = jsonb_build_array(jsonb_build_object('url', cover_url, 'position', coalesce(cover_position, '')))
 where cover_url is not null and cover_url <> '' and cover_images = '[]'::jsonb;

comment on column public.tenants.cover_images is 'Fotos de capa do cardápio online (até 10, em ordem): [{url, position}]. A 1ª é espelhada em cover_url/cover_position.';

grant select (cover_images) on public.tenants to anon;
