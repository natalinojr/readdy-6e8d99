-- Período da Conciliação salvo por conta bancária (2026-09-16)
--
-- A tela abria sempre em "hoje − 30 dias". Agora o "De" é salvo na conta e só muda
-- quando o usuário muda. Na primeira vez vale a data da conciliação mais antiga da conta.
--   reconciliation_from     = o "De" da tela
--   reconciliation_earliest = conciliação mais antiga conhecida quando o "De" foi gravado.
--     Se aparecer conciliação mais antiga que ela (ex.: importou extrato de meses atrás),
--     o "De" recua sozinho; se o usuário avançou o "De" de propósito, fica como ele deixou.

alter table public.fin_bank_accounts
  add column if not exists reconciliation_from date,
  add column if not exists reconciliation_earliest date;

comment on column public.fin_bank_accounts.reconciliation_from is
  'Início do período da tela Conciliação (salvo; só muda pelo usuário ou quando surge conciliação mais antiga).';
comment on column public.fin_bank_accounts.reconciliation_earliest is
  'Data da conciliação mais antiga conhecida quando reconciliation_from foi definido.';
