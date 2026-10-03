-- Capa e cor da loja nas telas do cliente (delivery e QR da mesa / QR universal).
-- Configurações › Loja grava pelo config-write (update_tenant). As telas públicas
-- leem direto da tabela como anon — por isso o grant de coluna, igual ao logo_url
-- (rls_fechar_acesso_publico liberou só id, name, slug, logo_url, is_active).
alter table public.tenants add column if not exists cover_url text;
alter table public.tenants add column if not exists brand_color text;

alter table public.tenants drop constraint if exists tenants_brand_color_hex;
alter table public.tenants add constraint tenants_brand_color_hex
  check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.tenants.cover_url is 'Foto de capa do cardápio online (delivery e QR). URL pública do bucket menu-images.';
comment on column public.tenants.brand_color is 'Cor da loja nas telas do cliente (#RRGGBB). Nulo = cor padrão.';

grant select (cover_url, brand_color) on public.tenants to anon;
