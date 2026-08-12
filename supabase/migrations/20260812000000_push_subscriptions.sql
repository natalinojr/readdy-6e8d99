-- ═══════════════════════════════════════════════════════════════════════════
-- M2 — Web Push: assinaturas de push por aparelho
-- (ver ESTUDO-TAREFAS-MOBILE.md). Um usuário pode ter vários aparelhos.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null,
  -- Identifica o aparelho/navegador. Único: reinscrever atualiza a linha.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  -- Falhas consecutivas; a partir de certo ponto a assinatura é removida.
  failure_count int not null default 0
);

create index if not exists idx_push_subs_user
  on push_subscriptions(tenant_id, user_id);

alter table push_subscriptions enable row level security;

-- Cada um enxerga apenas as próprias assinaturas (as escritas vão pela
-- Edge Function send-push, com service role).
create policy push_subscriptions_select_own on push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on push_subscriptions to authenticated;
grant all on push_subscriptions to service_role;
