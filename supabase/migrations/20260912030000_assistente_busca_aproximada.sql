-- Busca por nome aproximado para o assistente pessoal (tolera erro de grafia e acento).
-- Motivo: o dono perguntou da "Voxi" e o sistema tem "VOXY-SC LTDA"; a busca exata
-- (ILIKE '%voxi%') não achava e o assistente respondeu que não existia.
-- Aplicada via MCP (migração assistente_busca_aproximada) em 2026-09-12; cópia versionada.
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
grant usage on schema extensions to asst_reader;
