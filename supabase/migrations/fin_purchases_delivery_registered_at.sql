-- Momento real em que o recebimento foi registrado (delivery_confirmed_at pode ser só a data escolhida,
-- gravada ao meio-dia de Brasília). Serve para decidir o que entra ou não no estoque frente a uma contagem.
alter table public.fin_purchases add column if not exists delivery_registered_at timestamptz;
comment on column public.fin_purchases.delivery_registered_at is 'Hora real do clique que registrou o recebimento (≠ delivery_confirmed_at, que pode ser só a data do recebimento ao meio-dia). Nulo = compra anterior a 05/10/2026.';
