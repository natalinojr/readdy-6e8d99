-- Funil do iFood (IFOOD-PEDIDOS-FUNIL.md, etapas 2/3, 2026-09-27): liga o pedido do ERPOS ao pedido do iFood.
-- orders.ifood_order_id preenchido = pedido que veio do iFood pelo funil. A venda desse pedido já é contada pelo
-- iFood (ifood_orders / conciliação fin_ifood_entries / fin_cash_flow 'ifood_sale'), então os relatórios que somam
-- venda por `orders`/`payments` devem ignorá-lo; cozinha, estoque, entrega e nota tratam como qualquer pedido.
-- Pedido lançado à mão no PDV com delivery_platform 'ifood' NÃO tem ifood_order_id e continua contando como hoje.

alter table public.orders add column if not exists ifood_order_id text;
create unique index if not exists orders_ifood_order_id_uidx on public.orders (tenant_id, ifood_order_id) where ifood_order_id is not null;

alter table public.ifood_orders add column if not exists order_id uuid references public.orders(id) on delete set null;
create index if not exists ifood_orders_order_id_idx on public.ifood_orders (order_id) where order_id is not null;
