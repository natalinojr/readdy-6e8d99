-- Assistente pessoal — dedupe de updates do Telegram (2026-09-12). O Telegram
-- reenvia o mesmo update quando não recebe 200 a tempo (ex.: 502 de cold start);
-- a edge assistente-telegram grava o update_id aqui e ignora repetidos.
-- Limpeza: assistente-cron apaga linhas com mais de 7 dias. Aplicada via MCP; cópia versionada.
create table if not exists asst_tg_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);
create index if not exists asst_tg_updates_created_idx on asst_tg_updates (created_at);
alter table asst_tg_updates enable row level security;
grant all on asst_tg_updates to service_role;
