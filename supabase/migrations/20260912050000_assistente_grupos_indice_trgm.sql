-- Assistente pessoal — mensagens de grupo ficam guardadas para sempre (decisão do
-- dono, 2026-09-12); índice de trigramas para a busca por palavra do ler_grupo
-- (ILIKE '%x%') continuar rápida com meses de histórico. pg_trgm já está em
-- `extensions` (migração 20260912030000). Aplicada via MCP em 2026-09-12; cópia versionada.
create index if not exists asst_group_messages_content_trgm_idx
  on asst_group_messages using gin (content extensions.gin_trgm_ops);
create index if not exists asst_group_messages_sender_trgm_idx
  on asst_group_messages using gin (sender_name extensions.gin_trgm_ops);
analyze asst_group_messages;
