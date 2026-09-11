-- Despesa lançada pela tela Notas de Entrada (fiscal-inbound › import_bill) grava
-- reference_type='nfe_entrada' (reference_id = fiscal_inbound_documents.id), mas o CHECK
-- só aceitava purchase/manual/recurring/hr_payroll → "violates check constraint" ao lançar.
-- Aplicada via MCP em 2026-09-11.
alter table public.fin_accounts_payable drop constraint if exists fin_accounts_payable_reference_type_check;
alter table public.fin_accounts_payable add constraint fin_accounts_payable_reference_type_check
  check (reference_type = any (array['purchase'::text, 'manual'::text, 'recurring'::text, 'hr_payroll'::text, 'nfe_entrada'::text]));
