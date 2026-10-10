-- Entregador do iFood para pedido do iFood com entrega da loja (Shipping › "Pedidos na plataforma iFood"):
-- cotação (deliveryAvailabilities), chamada (requestDriver) e cancelamento da chamada (cancelRequestDriver).
-- { status: quoted|requested|allocated|going_to_origin|arrived_origin|in_transit|cancel_requested|concluded|cancelled|failed,
--   quote_id, quote, quoted_at, requested_at, by, error, uncertain, driver, timeline }
alter table public.ifood_orders add column if not exists driver_request jsonb;
comment on column public.ifood_orders.driver_request is 'Entregador do iFood chamado pelo ERPOS (pedido com entrega da loja). Ver edge ifood-shipping › order_driver_*.';
