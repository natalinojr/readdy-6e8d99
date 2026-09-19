-- v_divergencia_totais seguia só item_price × quantidade e ignorava a convenção de canal
-- (src/contexts/PDVContext.tsx › itemPriceDoCanal; fiscal-write › calcularValores):
-- em origin_type = 'delivery' o item_price é o preço BASE e os adicionais ficam em
-- order_item_options; nos demais canais o item_price já inclui os adicionais.
-- Resultado: todo delivery com adicional virava "divergência" (56 de 82 alarmes falsos,
-- ex.: pedido 0001 da Vila em 18/09 — Hamburguer Salada 25,90 + Batata frita 5,00 = 30,90,
-- gravado certo). O alerta semanal (weekly-divergence-alert) lê esta view. Mesmas colunas.
create or replace view public.v_divergencia_totais as
with linhas as (
  select o.id as order_id, o.number as order_number, o.origin_type as origin, o.status as order_status,
         o.subtotal, o.created_at, o.tenant_id, oi.id as item_id,
         (oi.item_price
           + case when o.origin_type::text = 'delivery'
                  then coalesce((select sum(op.additional_price) from public.order_item_options op where op.order_item_id = oi.id), 0)
                  else 0 end
         ) * oi.quantity::numeric as valor
    from public.orders o
    left join public.order_items oi on oi.order_id = o.id and oi.status::text <> 'cancelled'
   where o.status::text <> 'cancelled' and o.subtotal > 0 and o.is_training = false
)
select order_id, order_number, origin, order_status,
       subtotal as subtotal_declarado,
       coalesce(sum(valor), 0::numeric) as subtotal_real,
       round(abs(subtotal - coalesce(sum(valor), 0::numeric)), 2) as divergencia_abs,
       count(item_id) as qtd_itens,
       created_at as criado_em,
       tenant_id
  from linhas
 group by order_id, order_number, origin, order_status, subtotal, created_at, tenant_id
having abs(subtotal - coalesce(sum(valor), 0::numeric)) > 0.01 or count(item_id) = 0
 order by round(abs(subtotal - coalesce(sum(valor), 0::numeric)), 2) desc, created_at desc;
