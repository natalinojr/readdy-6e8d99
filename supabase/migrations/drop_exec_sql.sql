-- ============================================================
  -- MIGRATION: drop_exec_sql.sql
  -- Descrição: Remove a função insegura exec_sql(text) que permitia execução
  --            de SQL arbitrário via API. Esta função era usada exclusivamente
  --            pela edge function grant permissions (já removida).
  --            Nenhum outro arquivo no projeto faz referência a exec_sql.
  -- Data: 2026-06-12
  -- ============================================================

  -- A função pode não existir (já removida ou ambiente diferente).
  -- O DROP IF EXISTS já cobre todos os casos; o REVOKE é desnecessário
  -- se a função não existir, e falharia com erro 42883.
  -- Não execute REVOKE — execute apenas o DROP IF EXISTS abaixo.
  DROP FUNCTION IF EXISTS public.exec_sql(text);