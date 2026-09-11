-- Rubricas da folha (importadas do Domínio), uma por item, com a categoria para relatório:
-- [{codigo, descricao, referencia, valor, tipo:'P'|'D', categoria}]
-- Aplicada em 2026-09-11 via MCP (apply_migration hr_payroll_rubricas).
alter table public.hr_payroll add column if not exists rubricas jsonb not null default '[]'::jsonb;
comment on column public.hr_payroll.rubricas is 'Rubricas da folha (ex.: extrato do Domínio): [{codigo, descricao, referencia, valor, tipo P|D, categoria}]';
notify pgrst, 'reload schema';
