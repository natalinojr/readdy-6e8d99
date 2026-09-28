-- ============================================================================
-- Estúdio de Criação (artes a partir do Kit da Marca + fotos do cardápio). 2026-09-28.
-- Contexto: PLANO-TRAFEGO-PAGO-AGENTES.md §3.2. Módulo separado do Tráfego Pago; o tráfego
-- (e, depois, cardápio/promoções) pede artes ao Estúdio.
--
--   * brand_kit         — 1 por loja: cores, fonte, tom de voz, regras, logo (bucket estudio).
--   * studio_assets     — fotos avaliadas pela IA (nota 0-10, pontos fortes/problemas); por
--                         enquanto só fotos do cardápio (menu_items.photo_url).
--   * studio_creatives  — artes geradas (PNG no bucket estudio), com modelo, item, textos e status.
--   * bucket estudio    — privado; leitura por URL assinada gerada na Edge.
-- Escrita SOMENTE pelo service_role (Edge Function `estudio`); o app só lê a própria loja.
-- ============================================================================

create table if not exists public.brand_kit (
  tenant_id              uuid primary key references public.tenants(id) on delete cascade,
  nome_marca             text,
  cor_primaria           text not null default '#7a1f1f',
  cor_secundaria         text not null default '#f5c518',
  cor_fundo              text not null default '#1a1a1a',
  cor_texto              text not null default '#ffffff',
  fonte                  text not null default 'Inter',
  tom_voz                text check (tom_voz is null or tom_voz in ('descontraido', 'familiar', 'premium', 'jovem')),
  usa_emoji              boolean not null default false,
  publico                text,
  diferenciais           text,
  bordoes                text,
  cta_padrao             text,
  mostrar_preco          boolean not null default true,
  estilo_foto            text,
  palavras_obrigatorias  text[] not null default '{}',
  palavras_proibidas     text[] not null default '{}',
  nunca_fazer            text,
  logo_path              text,
  preenchido_por_ia      boolean not null default false,
  updated_by_user_id     uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
comment on table public.brand_kit is 'Kit da Marca (Estúdio): cores, fonte, tom de voz, regras e logo de cada loja.';

create table if not exists public.studio_assets (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  -- cardapio (menu_items.photo_url) | logo | upload
  source                 text not null default 'cardapio' check (source in ('cardapio', 'logo', 'upload')),
  menu_item_id           uuid,
  url                    text,
  path                   text,
  nota_qualidade         int check (nota_qualidade is null or (nota_qualidade between 0 and 10)),
  analise                jsonb,
  analisado_em           timestamptz,
  created_at             timestamptz not null default now(),
  unique (tenant_id, source, menu_item_id)
);
comment on table public.studio_assets is 'Fotos avaliadas pela IA para o Estúdio (nota de qualidade e observações).';
create index if not exists studio_assets_tenant_idx on public.studio_assets (tenant_id);

create table if not exists public.studio_creatives (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  template               text not null,
  formato                text not null,
  largura                int not null,
  altura                 int not null,
  menu_item_id           uuid,
  item_name              text,
  textos                 jsonb not null default '{}'::jsonb,
  image_path             text not null,
  status                 text not null default 'rascunho' check (status in ('rascunho', 'aprovada', 'reprovada')),
  -- manual (tela) | trafego (pedido do gestor de tráfego) | cardapio
  origem                 text not null default 'manual',
  request_ref            text,
  created_by_user_id     uuid,
  created_by_name        text,
  decided_by_name        text,
  decided_at             timestamptz,
  created_at             timestamptz not null default now()
);
comment on table public.studio_creatives is 'Artes geradas pelo Estúdio (PNG no bucket estudio) com modelo, item, textos e status.';
create index if not exists studio_creatives_tenant_idx on public.studio_creatives (tenant_id, created_at desc);

-- Bucket privado para logo e artes. 8 MB por arquivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estudio', 'estudio', false, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ─── Grants e RLS (bypass do service_role NÃO substitui o GRANT) ─────────────
grant select on public.brand_kit, public.studio_assets, public.studio_creatives to authenticated;
grant select, insert, update, delete on public.brand_kit, public.studio_assets, public.studio_creatives to service_role;

alter table public.brand_kit enable row level security;
alter table public.studio_assets enable row level security;
alter table public.studio_creatives enable row level security;

do $$
declare t text;
begin
  foreach t in array array['brand_kit', 'studio_assets', 'studio_creatives'] loop
    execute format('drop policy if exists %I_select_auth on public.%I', t, t);
    execute format(
      'create policy %I_select_auth on public.%I for select to authenticated using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()))',
      t, t);
    execute format('drop policy if exists deny_direct_write_%I on public.%I', t, t);
    execute format('create policy deny_direct_write_%I on public.%I for all to authenticated using (false) with check (false)', t, t);
    execute format('drop policy if exists service_role_bypass_%I on public.%I', t, t);
    execute format('create policy service_role_bypass_%I on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;
