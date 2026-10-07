-- Link para o cliente do iFood acompanhar o pedido (2026-10-06).
-- A loja cola no chat do iFood "Acompanhe seu pedido: <link>". O link abre /p/<código> (público):
-- situação do pedido, motoboy no mapa quando a entrega é nossa e ele está em rota, e o convite para o
-- delivery próprio e o clube. O código é aleatório (64 bits) e só quem é da loja gera; nunca o número do
-- pedido, que é sequencial e daria para adivinhar.

alter table public.ifood_orders add column if not exists link_codigo text;
create unique index if not exists ifood_orders_link_codigo_uk on public.ifood_orders (link_codigo) where link_codigo is not null;

create or replace function public.fn_ifood_link_cliente(p_ifood_order_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_tenant uuid;
  v_codigo text;
begin
  select id, tenant_id, link_codigo into v_id, v_tenant, v_codigo
    from public.ifood_orders where ifood_order_id = p_ifood_order_id;
  if v_id is null or not public.auth_is_member_of(v_tenant) then
    raise exception 'Pedido do iFood não encontrado nesta loja.';
  end if;
  if v_codigo is not null then return v_codigo; end if;

  update public.ifood_orders
     set link_codigo = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
   where id = v_id and link_codigo is null
  returning link_codigo into v_codigo;
  -- Duas pessoas clicando juntas: a segunda não atualiza nada e lê o código que a primeira gravou.
  if v_codigo is null then
    select link_codigo into v_codigo from public.ifood_orders where id = v_id;
  end if;
  return v_codigo;
end;
$$;

revoke all on function public.fn_ifood_link_cliente(text) from public, anon;
grant execute on function public.fn_ifood_link_cliente(text) to authenticated;
