-- Pix pelo app (Mercado Pago, Checkout) tem taxa própria (0,99% na conta da Vila Leste em 10/2026),
-- diferente do Pix direto na conta da loja (0%). A venda continua na forma "PIX" da loja (tPag 17,
-- relatórios por tipo), mas a taxa lançada vem daqui. Nulo = taxa da forma PIX (comportamento antigo).
alter table public.fin_payment_provider_config
  add column if not exists pix_fee_percentage numeric;

comment on column public.fin_payment_provider_config.pix_fee_percentage is 'Mercado Pago online: taxa (%) do Pix pelo app. Nula = taxa da forma "PIX" da loja.';
