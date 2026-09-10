-- ── Cobrança online com forma de pagamento ───────────────────────────────────
-- fin_pix_payments passa a registrar também o cartão cobrado na maquininha (Mercado
-- Pago Point). `method` diz qual forma de pagamento da loja o settle usa na online-payments
-- (e, por ela, o tPag da NFC-e, a taxa e o prazo de recebimento). Linhas antigas: Pix.
alter table fin_pix_payments
  add column if not exists method text not null default 'pix';

alter table fin_pix_payments drop constraint if exists fin_pix_payments_method_check;
alter table fin_pix_payments
  add constraint fin_pix_payments_method_check check (method in ('pix', 'credit_card', 'debit_card'));
