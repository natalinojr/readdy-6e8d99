-- Estoque › Consumo: o "Faturamento" sempre mostrava R$ 0,00 — a função lia orders.total, coluna que não
-- existe (é total_amount), e dava erro que a tela engolia. Também fica de fora pedido de treinamento/rascunho.
create or replace function public.fn_get_orders_for_consumo(p_tenant_id uuid, p_date_from timestamptz, p_date_to timestamptz)
 returns table(id uuid, total numeric, status text, number text, origin_type text, destination_name text, table_number integer, paid_by_pdv text, created_at timestamptz)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public._assert_tenant_access(p_tenant_id);
  return query
  select
    o.id,
    o.total_amount,
    o.status::text,
    o.number,
    o.origin_type::text,
    o.destination_name,
    o.table_number,
    o.paid_by_pdv,
    o.created_at
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.created_at >= p_date_from
    and o.created_at <= p_date_to
    and not coalesce(o.is_training, false)
    and not coalesce(o.is_draft, false);
end;
$function$;
