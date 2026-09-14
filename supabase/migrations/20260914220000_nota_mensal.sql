-- Nota do mês (2026-09-14): fornecedor que emite UMA nota no mês cobrindo vários pagamentos
-- (Pix/boleto) já feitos. A nota vira uma compra (ou despesa) na DATA DE EMISSÃO (decisão do dono),
-- com uma parcela por pagamento do extrato, já baixada na data/conta de cada um; o saldo que
-- faltar fica em aberto. Edge conciliacao-pagamentos › monthly_candidates / link_monthly / unlink_monthly.
--
-- settlement = 'monthly'            → a nota foi quitada pelos pagamentos do mês
-- settlement_statement_ids          → linhas de fin_bank_statement_imports usadas
-- O lançamento automático (fiscal-inbound) PULA fornecedor cuja última nota foi 'monthly':
-- a próxima também precisa ser vinculada aos pagamentos, senão viraria conta a pagar em dobro.

alter table public.fiscal_inbound_documents
  add column if not exists settlement text,
  add column if not exists settlement_statement_ids uuid[];

alter table public.fiscal_inbound_documents drop constraint if exists fiscal_inbound_documents_settlement_check;
alter table public.fiscal_inbound_documents add constraint fiscal_inbound_documents_settlement_check
  check (settlement is null or settlement in ('monthly'));
