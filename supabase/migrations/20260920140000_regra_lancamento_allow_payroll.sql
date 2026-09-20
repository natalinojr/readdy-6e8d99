-- ═══════════════════════════════════════════════════════════════════════════
-- "Não é salário" fica guardado na regra de lançamento (2026-09-20)
--
-- Caso real do dono: a Joziane foi funcionária (hoje `status = 'inactive'`) e voltou como
-- freelancer. Ao lançar o Pix ele marcou "não é salário" e o lançamento passou, mas a REGRA foi
-- recusada — a trava olhava só o CPF, sem ver se a pessoa ainda é funcionária.
--
-- Correções (a trava em si mudou na edge conciliacao-pagamentos):
--   • funcionário com status 'inactive' não trava mais nada (nem lançamento, nem regra);
--   • quando o dono marca "não é salário", a exceção fica gravada na regra, para o próximo
--     pagamento do mesmo CPF não travar de novo no lançamento automático.
-- (Aplicada via apply_migration; este arquivo é o registro.)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fin_reconciliation_rules
  add column if not exists allow_payroll boolean not null default false;

comment on column public.fin_reconciliation_rules.allow_payroll is
  'true = o dono confirmou que os pagamentos deste CPF não são salário (ex.: ex-funcionário que hoje é freelancer)';
