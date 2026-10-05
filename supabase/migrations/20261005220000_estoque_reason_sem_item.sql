-- Movimentos de venda sem item/combo (ex.: linha do funil do iFood sem vínculo, baixa só das opções)
-- gravam reason = 'item_sale:null:<order_item_id>'. As leituras faziam split_part(reason, ':', 2)::uuid
-- e a lista inteira de movimentos quebrava com 22P02 (invalid input syntax for type uuid: "null").
-- Agora o cast só acontece quando o pedaço é um uuid; senão o prato fica null ("Baixa automática por venda").
-- Corpo idêntico ao que estava no banco em 05/10/2026 (pg_get_functiondef), só o cast trocado.

CREATE OR REPLACE FUNCTION public.fn_estoque_ficha_insumo(p_tenant_id uuid, p_ingredient_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._assert_tenant_access(p_tenant_id);
  if not exists (select 1 from ingredients where id = p_ingredient_id and tenant_id = p_tenant_id) then
    raise exception 'Insumo não encontrado nesta loja.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pratos', coalesce((
      select jsonb_agg(jsonb_build_object('id', mi.id, 'nome', mi.name) order by mi.name)
        from (select distinct ii.item_id from item_ingredients ii
               where ii.tenant_id = p_tenant_id and ii.ingredient_id = p_ingredient_id) x
        join menu_items mi on mi.id = x.item_id and mi.deleted_at is null
    ), '[]'::jsonb),
    'movimentos', coalesce((
      select jsonb_agg(m order by m->>'created_at' desc) from (
        select jsonb_build_object(
                 'id', sm.id, 'tipo', sm.type::text, 'quantidade', sm.quantity, 'sinal', sm.signed_quantity,
                 'motivo', sm.reason, 'created_at', sm.created_at, 'operador', u.name, 'pedido', o.number,
                 'prato', case when sm.reason like 'item_sale:%' then (
                            select oi.item_name from order_items oi
                             where oi.order_id = sm.order_id and oi.item_id = (case when split_part(sm.reason, ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(sm.reason, ':', 2)::uuid end) limit 1)
                          end
               ) as m
          from stock_movements sm
          left join users u on u.id = sm.operator_id
          left join orders o on o.id = sm.order_id
         where sm.tenant_id = p_tenant_id and sm.ingredient_id = p_ingredient_id
         order by sm.created_at desc
         limit 8
      ) z
    ), '[]'::jsonb)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_stock_movements(p_tenant_id uuid, p_limit integer DEFAULT 500, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ingredient_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_types text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
             sm.signed_quantity,
             sm.reason,
             sm.notes,
             sm.order_id,
             o.number as order_number,
             case
               when sm.reason like 'item_sale:%' then (
                 select oi.item_name from order_items oi
                  where oi.order_id = sm.order_id and oi.item_id = (case when split_part(sm.reason, ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(sm.reason, ':', 2)::uuid end) limit 1)
               when sm.reason like 'combo_sale:%' then (
                 select oi.item_name from order_items oi
                  where oi.order_id = sm.order_id and oi.combo_id = (case when split_part(sm.reason, ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(sm.reason, ':', 2)::uuid end) limit 1)
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
        and (p_types is null or sm.type::text = any(p_types))
        and (q is null or extensions.unaccent(lower(
              coalesce(i.name, '') || ' ' || coalesce(sm.reason, '') || ' ' || coalesce(sm.notes, '') || ' ' || coalesce(u.name, '')
            )) like '%' || q || '%')
      order by sm.created_at desc
      limit p_limit
    ) t
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_stock_movements(p_tenant_id uuid, p_limit integer DEFAULT 200)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_tenant_access(p_tenant_id);
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT sm.id,
             sm.ingredient_id,
             i.name AS ingredient_name,
             COALESCE(sm.unit, i.unit::text) AS ingredient_unit,
             sm.type::text,
             sm.quantity,
             sm.reason,
             sm.notes,
             sm.order_id,
             o.number AS order_number,
             CASE
               WHEN sm.reason LIKE 'item_sale:%' THEN (
                 SELECT oi.item_name
                 FROM order_items oi
                 WHERE oi.order_id = sm.order_id
                   AND oi.item_id = (case when split_part(sm.reason, ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(sm.reason, ':', 2)::uuid end)
                 LIMIT 1
               )
               WHEN sm.reason LIKE 'combo_sale:%' THEN (
                 SELECT oi.item_name
                 FROM order_items oi
                 WHERE oi.order_id = sm.order_id
                   AND oi.combo_id = (case when split_part(sm.reason, ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(sm.reason, ':', 2)::uuid end)
                 LIMIT 1
               )
               ELSE NULL
             END AS sold_item_name,
             sm.operator_id,
             u.name AS operator_name,
             sm.created_at
      FROM stock_movements sm
      JOIN ingredients i ON i.id = sm.ingredient_id
      LEFT JOIN users u ON u.id = sm.operator_id
      LEFT JOIN orders o ON o.id = sm.order_id
      WHERE sm.tenant_id = p_tenant_id
      ORDER BY sm.created_at DESC
      LIMIT p_limit
    ) t
  );
END;
$function$
;
