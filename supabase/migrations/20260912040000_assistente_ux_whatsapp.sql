-- Assistente pessoal — recursos nativos do WhatsApp (2026-09-12):
-- enquete como menu de decisão (asst_polls), chave da mensagem na fila de
-- debounce (para reagir ✅ em todas as mensagens do lote) e preferências de UX.
-- Aplicada via MCP (apply_migration) em 2026-09-12; cópia versionada.

create table if not exists asst_polls (
  message_id text primary key,          -- key.id da enquete enviada pela Evolution
  chat_id text not null,
  question text not null,
  options jsonb not null,
  answer jsonb,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
alter table asst_polls enable row level security;
grant all on asst_polls to service_role;

alter table asst_inbox add column if not exists message_key jsonb;

-- ui: { edit_placeholder: false }  → true = manda "⏳" e edita com a resposta
insert into asst_settings (key, value) values ('ui', '{"edit_placeholder": false}'::jsonb)
on conflict (key) do nothing;
