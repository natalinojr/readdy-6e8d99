-- Visitas ao cardapio do delivery (carrinho abandonado) + "entrou e nao pediu".
--
-- Por que: ate aqui so sabiamos de quem CADASTROU e nao pediu (customers sem
-- pedido). Quem ja tinha cadastro, abriu o cardapio e saiu era invisivel — o
-- lookup_customer e so leitura e nao existia nenhum registro de visita.
--
-- Duas pecas:
--   1. delivery_customers.last_seen_at -> "entrou no cardapio em".
--   2. menu_visits                     -> uma linha por sessao no cardapio, com
--      ate onde a pessoa chegou e o que tinha no carrinho quando parou.
--
-- Leitura/escrita passam pela Edge Function delivery-write (service_role): a
-- tabela fica com RLS ligado e SEM policy, ou seja, anon/authenticated nao leem
-- direto. Telefone de visitante e dado pessoal; nao expor no PostgREST.

alter table public.delivery_customers
  add column if not exists last_seen_at timestamptz;

comment on column public.delivery_customers.last_seen_at is
  'Ultima vez que o telefone foi identificado no cardapio (lookup_customer). Diferente de last_used_at, que marca o ultimo uso do cadastro em pedido.';

create table if not exists public.menu_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- id gerado no aparelho (localStorage), estavel enquanto a pessoa navega.
  visit_key text not null,
  phone text,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- ultima etapa vista: preview | identificacao | modo_entrega | endereco | cardapio | confirmacao
  last_step text,
  items_count integer not null default 0,
  cart_total numeric(12,2) not null default 0,
  -- resumo do carrinho no momento em que parou: [{nome, qtd, total}]
  cart_items jsonb,
  order_id uuid references public.orders(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint menu_visits_visit_key_uk unique (tenant_id, visit_key)
);

comment on table public.menu_visits is
  'Uma linha por sessao no cardapio do delivery. Serve para ver quem entrou e nao pediu e quem abandonou o carrinho. Escrita pela Edge Function delivery-write (track_visit).';

create index if not exists idx_menu_visits_tenant_last_seen
  on public.menu_visits (tenant_id, last_seen_at desc);

-- Fila do carrinho abandonado: visitas que nao viraram pedido.
create index if not exists idx_menu_visits_abandonados
  on public.menu_visits (tenant_id, last_seen_at desc)
  where converted_at is null;

alter table public.menu_visits enable row level security;

-- Tabela NOVA escrita direto pelo service_role: sem GRANT da 42501/500.
-- Ver "Grants service_role" no AI_SYSTEM_MAP.
grant select, insert, update, delete on public.menu_visits to service_role;
