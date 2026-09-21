-- Cardapio em outros idiomas (ingles/espanhol) nas telas do CLIENTE.
--
-- Desenho:
--   * O portugues continua sendo a FONTE DA VERDADE. Nada aqui altera
--     menu_items/menu_categories/options: a traducao e uma camada separada,
--     aplicada so na RESPOSTA dos canais publicos (delivery, mesa-qr, totem).
--   * Por isso o pedido, o KDS e a impressao da cozinha seguem em portugues
--     SEMPRE — ver comentario em fn_menu_translations_pending.
--   * Uma tabela unica e generica (entity_type + entity_id) em vez de uma
--     tabela por entidade: item, categoria, grupo de opcao, opcao e observacao
--     padrao tem todos o mesmo par (nome, descricao) a traduzir.
--   * `source_text_hash` guarda o hash do texto PT que ORIGINOU a traducao.
--     Quando o dono edita o item em portugues, o hash diverge e a traducao
--     aparece como "desatualizada" — sem isso o cardapio em ingles envelhece
--     em silencio.
--
-- Leitura/escrita pela Edge Function menu-translate (service_role) e leitura
-- pelas edges dos canais publicos. RLS ligado e sem policy: nada de PostgREST
-- direto, o mesmo padrao das demais tabelas escritas por edge.

-- ── Idiomas que cada loja oferece ────────────────────────────────────────────
-- Loja sem linha nenhuma aqui = so portugues = seletor de idioma nem aparece.
create table if not exists public.tenant_locales (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  locale text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (tenant_id, locale),
  constraint tenant_locales_locale_chk check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);

comment on table public.tenant_locales is
  'Idiomas oferecidos ao cliente por loja. O portugues (pt-BR) e implicito e nao precisa de linha.';

-- ── Traducoes ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'menu_translation_entity') then
    create type public.menu_translation_entity as enum (
      'item',
      'category',
      'option_group',
      'option',
      'preset_obs'
    );
  end if;
end $$;

create table if not exists public.menu_translations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type public.menu_translation_entity not null,
  entity_id uuid not null,
  locale text not null,
  name text,
  description text,
  -- 'ai' = gerada pela IA e ainda nao conferida por gente.
  -- 'manual' = digitada ou corrigida por uma pessoa; a IA NAO sobrescreve.
  source text not null default 'ai',
  is_reviewed boolean not null default false,
  -- md5 do texto PT (nome + '\n' + descricao) no momento em que traduziu
  source_text_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entity_type, entity_id, locale)
);

comment on table public.menu_translations is
  'Traducao do cardapio por loja e idioma. Camada sobreposta: o portugues nunca sai daqui.';
comment on column public.menu_translations.source is
  'ai = gerada pela IA (pode ser regerada). manual = mexida por gente, a IA nunca sobrescreve.';
comment on column public.menu_translations.source_text_hash is
  'md5 do texto PT de origem. Diferente do atual = o portugues mudou e esta traducao esta velha.';

create index if not exists idx_menu_translations_lookup
  on public.menu_translations (tenant_id, locale, entity_type);

create index if not exists idx_menu_translations_entity
  on public.menu_translations (tenant_id, entity_type, entity_id);

-- updated_at automatico
create or replace function public.fn_menu_translations_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_menu_translations_touch on public.menu_translations;
create trigger trg_menu_translations_touch
  before update on public.menu_translations
  for each row execute function public.fn_menu_translations_touch();

-- ── RLS + grants ─────────────────────────────────────────────────────────────
alter table public.tenant_locales enable row level security;
alter table public.menu_translations enable row level security;

grant select, insert, update, delete on public.tenant_locales to service_role;
grant select, insert, update, delete on public.menu_translations to service_role;
