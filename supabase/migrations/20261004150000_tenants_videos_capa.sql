-- Até 3 vídeos curtos da loja: tocam no topo do delivery/QR (junto com as fotos de capa)
-- e em loop na tela de espera do totem. Lista ordenada de {url, poster}; poster = quadro
-- do vídeo em JPEG (bucket menu-images), mostrado enquanto o vídeo carrega ou quando o
-- celular está em economia de dados.
alter table public.tenants add column if not exists cover_videos jsonb not null default '[]'::jsonb;

alter table public.tenants drop constraint if exists tenants_cover_videos_fmt;
alter table public.tenants add constraint tenants_cover_videos_fmt
  check (jsonb_typeof(cover_videos) = 'array' and jsonb_array_length(cover_videos) <= 3);

comment on column public.tenants.cover_videos is 'Vídeos da loja (até 3, em ordem): [{url, poster}]. Delivery/QR (topo) e tela de espera do totem. Arquivos no bucket loja-videos/<tenant_id>/.';

grant select (cover_videos) on public.tenants to anon;

-- Bucket público só de vídeo. Upload sai por URL assinada criada no config-write
-- (service role, depois de checar admin/gerente da loja), então não há policy de insert.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loja-videos', 'loja-videos', true, 10485760, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
