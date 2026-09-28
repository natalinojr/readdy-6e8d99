-- Compra online que JÁ FOI PAGA (2026-09-28, pedido do dono): sobe o print sem Pix copia e cola,
-- informando quando e como foi paga. Ao aprovar, o dono classifica (por item), a compra nasce sem
-- preparar Pix e, se foi Pix do banco da loja, o pedido-pagamento liga a saída do extrato à conta.
alter table public.fin_payment_requests
  add column if not exists ja_pago boolean not null default false,
  add column if not exists ja_pago_em date,
  add column if not exists pago_forma text check (pago_forma is null or pago_forma in ('pix', 'cartao', 'mercado_pago'));
