-- Pedido do iFood (funil): a loja escolhe se imprime ao entrar na cozinha.
-- Lido pelo delivery-write › release_held_order (ticket da cozinha/bar e comprovante de entrega/retirada).
-- Padrão = imprime (comportamento de antes).
alter table public.ifood_pdv_config
  add column if not exists order_print_kitchen boolean not null default true,
  add column if not exists order_print_receipt boolean not null default true;
