-- Tarefas × OneDrive/SharePoint — Fase 1, passo 1: conexão com a conta Microsoft.
-- Ver BRIEFING-ONEDRIVE-TAREFAS.md. Uma conexão por pessoa (Tarefas é por usuário);
-- quem recebe pasta compartilhada usa a conexão do dono da pasta raiz.
-- Tokens só para o service role (Edge ms-graph): nenhuma policy para authenticated.

create table if not exists public.ms_graph_connections (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  ms_tenant_id      text,
  ms_user_id        text,
  ms_user_email     text,
  ms_user_name      text,
  access_token      text not null,
  refresh_token     text not null,
  token_expires_at  timestamptz not null,
  scopes            text,
  -- refresh recusado (consentimento revogado, 90 dias sem uso…): a tela pede "reconectar"
  needs_reconnect   boolean not null default false,
  last_error        text,
  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.ms_graph_connections enable row level security;

revoke all on public.ms_graph_connections from anon, authenticated;
grant select, insert, update, delete on public.ms_graph_connections to service_role;
