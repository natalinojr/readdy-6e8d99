-- Grupos do WhatsApp que o assistente só LÊ (nunca escreve). Projeto pessoal do dono.
-- Aplicada via MCP (migração assistente_grupos) em 2026-09-12; cópia versionada.
create table if not exists asst_groups (
  group_jid text primary key,
  name text,
  is_enabled boolean not null default false,  -- liga sozinho só se o dono for participante
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists asst_group_messages (
  id bigserial primary key,
  message_id text unique,
  group_jid text not null references asst_groups(group_jid) on delete cascade,
  sender_jid text,
  sender_name text,
  content text not null,
  kind text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists asst_group_messages_group_idx on asst_group_messages (group_jid, sent_at desc);
create index if not exists asst_group_messages_sent_idx on asst_group_messages (sent_at);
alter table asst_groups enable row level security;
alter table asst_group_messages enable row level security;
grant all on asst_groups, asst_group_messages to service_role;
grant usage, select on all sequences in schema public to service_role;
