-- Compra online já paga (2026-09-28, regra do dono): quem pede diz COMO pagou (Pix, boleto ou dinheiro)
-- e o sistema tem que ACHAR o pagamento — saída do extrato (Pix/boleto) ou sangria de fornecedor do
-- caixa (dinheiro). Sem pagamento achado, o pedido não entra. O pedido guarda qual foi o escolhido e a
-- aprovação liga a compra exatamente a ele.
alter table public.fin_payment_requests drop constraint if exists fin_payment_requests_pago_forma_check;
alter table public.fin_payment_requests add constraint fin_payment_requests_pago_forma_check
  check (pago_forma is null or pago_forma in ('pix', 'boleto', 'dinheiro', 'cartao', 'mercado_pago'));
alter table public.fin_payment_requests
  add column if not exists pago_ref_tipo text check (pago_ref_tipo is null or pago_ref_tipo in ('extrato', 'sangria')),
  add column if not exists pago_ref_id uuid;
-- Um pagamento só serve para um pedido
create unique index if not exists fin_payment_requests_pago_ref_uq on public.fin_payment_requests (pago_ref_tipo, pago_ref_id)
  where pago_ref_id is not null and status in ('pendente', 'aprovada');
