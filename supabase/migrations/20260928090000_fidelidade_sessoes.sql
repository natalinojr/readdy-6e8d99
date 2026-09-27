-- Clube de fidelidade fora do tablet (2026-09-28): o cliente entra pela internet
-- (/clube/<loja>) e usa os prêmios na mesa (QR), no delivery próprio e no caixa.
--
--   * loyalty_sessions: "cartão do clube" no celular do cliente. Guardamos só o
--     HASH do token (sha-256); o token fica no aparelho. Vale 90 dias.
--   * loyalty_login_links: link de uso único (10 min) que o tablet mostra em QR
--     depois de o cliente confirmar os 4 últimos dígitos do celular.
-- Leitura/escrita só pelas Edge Functions (service_role).

create table if not exists public.loyalty_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash text not null unique,
  criado_via text not null default 'web',   -- 'web' | 'qr_tablet'
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  revoked_at timestamptz
);
create index if not exists idx_loyalty_sessions_customer on public.loyalty_sessions (customer_id);

create table if not exists public.loyalty_login_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz
);

alter table public.loyalty_sessions enable row level security;
alter table public.loyalty_login_links enable row level security;
grant select, insert, update, delete on public.loyalty_sessions to service_role;
grant select, insert, update, delete on public.loyalty_login_links to service_role;
