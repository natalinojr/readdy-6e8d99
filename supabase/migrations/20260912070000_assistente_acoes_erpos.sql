-- Assistente pessoal — ações no ERPOS em nome do dono (2026-09-12). O brain obtém
-- uma sessão do dono (generateLink magiclink + verifyOtp) e chama as mesmas Edge
-- Functions das telas; cada chamada fica registrada aqui. Aplicada via MCP; cópia versionada.
create table if not exists asst_actions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  chat_id text,
  tenant_id uuid,
  funcao text not null,
  action text not null,
  payload jsonb,
  ok boolean not null,
  status int,
  result jsonb,
  error text,
  ms int
);
create index if not exists asst_actions_created_idx on asst_actions (created_at desc);
alter table asst_actions enable row level security;
grant all on asst_actions to service_role;
grant usage, select on all sequences in schema public to service_role;
