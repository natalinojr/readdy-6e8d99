-- Compra online pelo print (2026-09-28): o que a IA leu do checkout (itens, desconto, frete,
-- total, entrega), conferido pela pessoa antes de enviar. Só informativo: o custo vem da NF-e.
alter table public.fin_payment_requests add column if not exists compra_detalhe jsonb;
