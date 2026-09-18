-- Limite de tentativas do login por matrícula + PIN (Edge login-pin, pública).
-- A edge grava cada tentativa (service_role) e recusa com 429 quando há falhas demais
-- na janela de 15 min por matrícula (>= 5) ou por IP (>= 20). Limpeza (> 7 dias) é
-- feita pela própria edge, de forma oportunista. Sem policy: só service_role acessa.

create table if not exists public.login_pin_attempts (
  id          uuid primary key default gen_random_uuid(),
  badge_number text not null,
  ip          text,
  tenant_id   uuid null,
  success     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists login_pin_attempts_badge_created_idx
  on public.login_pin_attempts (badge_number, created_at);
create index if not exists login_pin_attempts_ip_created_idx
  on public.login_pin_attempts (ip, created_at);

alter table public.login_pin_attempts enable row level security;

revoke all on table public.login_pin_attempts from anon, authenticated;
grant all on table public.login_pin_attempts to service_role;
