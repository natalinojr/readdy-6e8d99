-- Vídeos da loja: sem limite de quantidade, até 50 MB somados (o config-write confere a soma
-- pelo tamanho real no Storage). O bucket passa a aceitar arquivo de até 50 MB (antes 10 MB).
alter table public.tenants drop constraint if exists tenants_cover_videos_fmt;
-- Só o formato; o teto de 100 itens é guarda contra lixo (50 MB acabam muito antes)
alter table public.tenants add constraint tenants_cover_videos_fmt
  check (jsonb_typeof(cover_videos) = 'array' and jsonb_array_length(cover_videos) <= 100);
update storage.buckets set file_size_limit = 52428800 where id = 'loja-videos';
comment on column public.tenants.cover_videos is 'Vídeos da loja (em ordem, até 50 MB somados): [{url, poster, bytes}]. Delivery/QR (topo) e tela de espera do totem. Arquivos no bucket loja-videos/<tenant_id>/.';
