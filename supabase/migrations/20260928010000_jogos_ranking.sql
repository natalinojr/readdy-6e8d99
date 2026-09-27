-- Jogos enquanto espera — ranking semanal com prêmio para o top 3 (Fase 3).
--
-- Tudo passa pela Edge Function `jogos` (service_role): o celular nunca grava direto.
-- A pontuação é CALCULADA NO SERVIDOR refazendo a partida (semente sorteada pelo
-- servidor + quadros em que houve toque); o número que vem do celular é ignorado.
-- Só joga valendo quem tem pedido de verdade na loja nas últimas horas.

-- Configuração por loja (desligado por padrão: a loja decide ligar e o prêmio)
create table if not exists public.game_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  ranking_enabled boolean not null default false,
  games text[] not null default array['voa','corre'],
  -- [{ "posicao": 1, "descricao": "Combo grátis" }, ...]
  prizes jsonb not null default '[]'::jsonb,
  rules text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Partida iniciada: a semente é do servidor e fica guardada aqui
create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  game text not null check (game in ('voa','corre')),
  seed bigint not null,
  order_id uuid references public.orders(id) on delete set null,
  player_phone text not null,
  player_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists game_sessions_order_idx on public.game_sessions (order_id, started_at desc);
create index if not exists game_sessions_phone_idx on public.game_sessions (tenant_id, player_phone, started_at desc);

-- Pontuação conferida (1 por partida)
create table if not exists public.game_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  game text not null check (game in ('voa','corre')),
  session_id uuid not null unique references public.game_sessions(id) on delete cascade,
  player_phone text not null,
  player_name text not null,
  score integer not null check (score >= 0),
  frames integer not null,
  inputs integer[] not null,
  week_start date not null,
  created_at timestamptz not null default now()
);
create index if not exists game_scores_ranking_idx on public.game_scores (tenant_id, week_start, game, score desc, created_at);

-- Prêmio entregue (a loja marca na tela; foto do vencedor na hora do fechamento)
create table if not exists public.game_awards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  week_start date not null,
  game text not null,
  position integer not null check (position between 1 and 10),
  player_phone text not null,
  player_name text not null,
  score integer not null,
  prize text,
  delivered_at timestamptz not null default now(),
  delivered_by uuid,
  unique (tenant_id, week_start, game, position)
);

alter table public.game_settings enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_scores enable row level security;
alter table public.game_awards enable row level security;
-- sem policies: só a Edge Function (service_role) lê e grava
revoke all on public.game_settings, public.game_sessions, public.game_scores, public.game_awards from anon, authenticated;
grant all on public.game_settings, public.game_sessions, public.game_scores, public.game_awards to service_role;
