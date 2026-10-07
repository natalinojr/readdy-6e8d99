-- fn_get_kds_orders passa a devolver ifood_order_id (2026-10-07): botão "Copiar link do cliente" no
-- pedido do iFood no Caixa e no Gestor de Pedidos (link /p/<código>, fn_ifood_link_cliente).
-- Aplicado como patch na definição viva (a função é grande e foi editada por várias migrações).
do $$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'fn_get_kds_orders';
  if position('''ifood_order_id''' in d) > 0 then return; end if;
  n := replace(d, '''out_for_delivery_at'', o.out_for_delivery_at,',
    '''out_for_delivery_at'', o.out_for_delivery_at,' || chr(10) || '      ''ifood_order_id'', o.ifood_order_id,');
  if n = d then raise exception 'fn_get_kds_orders: marcador out_for_delivery_at não encontrado'; end if;
  execute n;
end $$;
