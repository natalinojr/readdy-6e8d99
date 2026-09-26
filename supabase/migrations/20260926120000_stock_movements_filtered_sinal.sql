-- Consumo (Estoque › Consumo): o ajuste de inventário vinha só com a quantidade absoluta e a tela somava
-- a ENTRADA de inventário como consumo (+69 kg de Chilli viraram R$ 1.984 de "custo"). Devolve o sinal
-- (signed_quantity) no fim — quem já chama continua funcionando.
drop function if exists public.fn_get_stock_movements_filtered(uuid, timestamptz, timestamptz, text[], uuid);
create function public.fn_get_stock_movements_filtered(p_tenant_id uuid, p_date_from timestamptz, p_date_to timestamptz, p_types text[] default null, p_ingredient_id uuid default null)
 returns table(id uuid, ingredient_id uuid, ingredient_name text, type text, quantity numeric, ingredient_unit text, reason text, created_at timestamptz, order_id uuid, signed_quantity numeric)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select public._assert_tenant_access(p_tenant_id);
  select
    sm.id,
    sm.ingredient_id,
    i.name as ingredient_name,
    sm.type::text,
    sm.quantity,
    coalesce(sm.unit, i.unit::text) as ingredient_unit,
    sm.reason,
    sm.created_at,
    sm.order_id,
    sm.signed_quantity
  from public.stock_movements sm
  join public.ingredients i on i.id = sm.ingredient_id
  where sm.tenant_id = p_tenant_id
    and sm.created_at >= p_date_from
    and sm.created_at <= p_date_to
    and (p_types is null or sm.type::text = any(p_types))
    and (p_ingredient_id is null or sm.ingredient_id = p_ingredient_id);
$function$;
revoke all on function public.fn_get_stock_movements_filtered(uuid, timestamptz, timestamptz, text[], uuid) from public, anon;
grant execute on function public.fn_get_stock_movements_filtered(uuid, timestamptz, timestamptz, text[], uuid) to authenticated, service_role;
