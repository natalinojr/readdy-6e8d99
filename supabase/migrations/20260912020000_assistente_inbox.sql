-- Fila curta de mensagens do WhatsApp para juntar mensagens seguidas (debounce)
-- numa resposta só. Projeto pessoal do dono. Aplicada via MCP
-- (migração assistente_inbox_debounce) em 2026-09-12; cópia versionada.
create table if not exists asst_inbox (
  id bigserial primary key,
  chat_id text not null,
  text text not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists asst_inbox_pending_idx on asst_inbox (chat_id, id) where processed_at is null;
alter table asst_inbox enable row level security;
grant all on asst_inbox to service_role;
grant usage, select on all sequences in schema public to service_role;
