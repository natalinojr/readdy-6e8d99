-- Estoque › Movimentação: a busca só olhava o nome do insumo e só nas 500 movimentações
-- mais recentes já carregadas (na Paranaguá ~2 dias por causa das baixas de venda), então
-- "Bebidas" ou "798619" não achavam a entrada de uma compra de 5 dias atrás.
-- Agora a busca vai ao banco: nome do insumo, motivo (fornecedor + NF), observação e operador,
-- sem diferenciar acento/maiúscula. Troca a versão de 5 parâmetros por esta (mesmos nomes + p_search).
drop function if exists public.fn_get_stock_movements(uuid, integer, timestamptz, timestamptz, uuid);

create or replace function public.fn_get_stock_movements(
  p_tenant_id uuid, p_limit integer default 500,
  p_date_from timestamptz default null, p_date_to timestamptz default null,
  p_ingredient_id uuid default null, p_search text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  q text := nullif(extensions.unaccent(lower(btrim(coalesce(p_search, '')))), '');
begin
  perform public._assert_tenant_access(p_tenant_id);
  return (
    select coalesce(json_agg(row_to_json(t)), '[]'::json)
    from (
      select sm.id,
             sm.ingredient_id,
             i.name as ingredient_name,
             coalesce(sm.unit, i.unit::text) as ingredient_unit,
             sm.type::text,
             sm.quantity,
             sm.reason,
             sm.notes,
             sm.order_id,
             o.number as order_number,
             case
               when sm.reason like 'item_sale:%' then (
                 select oi.item_name from order_items oi
                  where oi.order_id = sm.order_id and oi.item_id = split_part(sm.reason, ':', 2)::uuid limit 1)
               when sm.reason like 'combo_sale:%' then (
                 select oi.item_name from order_items oi
                  where oi.order_id = sm.order_id and oi.combo_id = split_part(sm.reason, ':', 2)::uuid limit 1)
               else null
             end as sold_item_name,
             sm.operator_id,
             u.name as operator_name,
             sm.created_at
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
      left join users u on u.id = sm.operator_id
      left join orders o on o.id = sm.order_id
      where sm.tenant_id = p_tenant_id
        and (p_ingredient_id is null or sm.ingredient_id = p_ingredient_id)
        and (p_date_from is null or sm.created_at >= p_date_from)
        and (p_date_to is null or sm.created_at <= p_date_to)
        and (q is null or extensions.unaccent(lower(
              coalesce(i.name, '') || ' ' || coalesce(sm.reason, '') || ' ' || coalesce(sm.notes, '') || ' ' || coalesce(u.name, '')
            )) like '%' || q || '%')
      order by sm.created_at desc
      limit p_limit
    ) t
  );
end;
$function$;

revoke all on function public.fn_get_stock_movements(uuid, integer, timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.fn_get_stock_movements(uuid, integer, timestamptz, timestamptz, uuid, text) to authenticated, service_role;
