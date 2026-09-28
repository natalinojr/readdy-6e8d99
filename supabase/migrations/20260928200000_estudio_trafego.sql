-- F3 do PLANO-TRAFEGO-PAGO-AGENTES.md: o gestor de tráfego pede arte ao Estúdio.
-- A arte usada num anúncio vira 'publicada' e guarda os ids da Meta (imagem, criativo, anúncio).
alter table public.studio_creatives drop constraint if exists studio_creatives_status_check;
alter table public.studio_creatives add constraint studio_creatives_status_check
  check (status in ('rascunho', 'aprovada', 'reprovada', 'publicada'));

alter table public.studio_creatives
  add column if not exists meta_image_hash   text,
  add column if not exists meta_creative_id  text,
  add column if not exists meta_ad_id        text,
  add column if not exists published_at      timestamptz;

create index if not exists studio_creatives_request_ref_idx on public.studio_creatives (tenant_id, request_ref) where request_ref is not null;
