-- Horário de exibição no cardápio do cliente (2026-10-02).
-- Item, categoria e destaque ganham `availability_schedule` (jsonb): lista de faixas
-- { "days": [0..6] (0=Dom), "start": "HH:MM", "end": "HH:MM" } no horário de Brasília.
-- null = aparece sempre. Fim menor que o início = passa da meia-noite.
-- Quem filtra é o front (src/lib/horarioExibicao.ts), reavaliando a cada minuto: o
-- servidor só devolve o campo (fn_get_full_menu, mesa-write get_cardapio,
-- delivery-write get_delivery_config). Destaque: vale o horário dele E o do item E o
-- da categoria (null no destaque = segue o do item).

alter table public.menu_items add column if not exists availability_schedule jsonb;
alter table public.menu_categories add column if not exists availability_schedule jsonb;
alter table public.menu_highlights add column if not exists availability_schedule jsonb;

alter table public.menu_items drop constraint if exists menu_items_availability_schedule_array;
alter table public.menu_items add constraint menu_items_availability_schedule_array
  check (availability_schedule is null or jsonb_typeof(availability_schedule) = 'array');
alter table public.menu_categories drop constraint if exists menu_categories_availability_schedule_array;
alter table public.menu_categories add constraint menu_categories_availability_schedule_array
  check (availability_schedule is null or jsonb_typeof(availability_schedule) = 'array');
alter table public.menu_highlights drop constraint if exists menu_highlights_availability_schedule_array;
alter table public.menu_highlights add constraint menu_highlights_availability_schedule_array
  check (availability_schedule is null or jsonb_typeof(availability_schedule) = 'array');

comment on column public.menu_items.availability_schedule is 'Horário em que o item aparece no cardápio do cliente: [{days:[0..6],start:"HH:MM",end:"HH:MM"}], Brasília. null = sempre.';
comment on column public.menu_categories.availability_schedule is 'Horário em que a categoria aparece no cardápio do cliente (mesmo formato de menu_items). null = sempre.';
comment on column public.menu_highlights.availability_schedule is 'Horário próprio do destaque (mesmo formato). null = segue o do item; vale sempre junto com o do item e o da categoria.';

-- Cardápio completo do admin/PDV/totem: devolve o horário de categoria e item.
-- Base = definição que estava NO AR em 2026-10-02 (sem 'ingredientes' das opções:
-- a migração 20260926020000_opcao_varios_insumos nunca foi aplicada em produção).
CREATE OR REPLACE FUNCTION public.fn_get_full_menu(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = p_tenant_id) then
    raise exception 'Unauthorized';
  end if;

  select jsonb_build_object(
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ks.id, 'name', ks.name, 'color', ks.color,
        'sort_order', ks.sort_order, 'sla_minutes', ks.sla_minutes, 'is_active', ks.is_active
      ) order by ks.sort_order)
      from public.kitchen_stations ks where ks.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mc.id, 'name', mc.name, 'station_id', mc.station_id,
        'station_name', ks.name, 'sort_order', mc.sort_order, 'is_active', mc.is_active,
        'ncm', mc.ncm, 'cest', mc.cest, 'cfop', mc.cfop, 'csosn', mc.csosn, 'cod_tributacao', mc.cod_tributacao,
        'availability_schedule', mc.availability_schedule,
        'item_count', (
          select count(*) from public.menu_items mi
          where mi.category_id = mc.id and mi.tenant_id = p_tenant_id and mi.deleted_at is null
        )
      ) order by mc.sort_order)
      from public.menu_categories mc
      left join public.kitchen_stations ks on ks.id = mc.station_id
      where mc.tenant_id = p_tenant_id and mc.deleted_at is null
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mi.id, 'category_id', mi.category_id, 'name', mi.name,
        'description', mi.description, 'price', mi.price, 'photo_url', mi.photo_url,
        'sla_minutes', mi.sla_minutes, 'is_active', mi.is_active, 'skip_kds', mi.skip_kds,
        'sort_order', mi.sort_order, 'channels', mi.channels,
        'is_featured', mi.is_featured,
        'delivery_config', mi.delivery_config,
        'ncm', mi.ncm, 'cest', mi.cest, 'cfop', mi.cfop, 'csosn', mi.csosn,
        'origem', mi.origem, 'cod_tributacao', mi.cod_tributacao, 'gtin', mi.gtin,
        'availability_schedule', mi.availability_schedule,
        'option_groups', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', og.id, 'name', og.name, 'is_required', og.is_required,
            'min_selections', og.min_selections, 'max_selections', og.max_selections,
            'sort_order', og.sort_order,
            'options', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', o.id, 'name', o.name, 'additional_price', o.additional_price,
                'is_active', o.is_active, 'sort_order', o.sort_order,
                'ingredient_id', o.ingredient_id,
                'production_recipe_id', o.production_recipe_id,
                'consumption_quantity', o.consumption_quantity,
                'consumption_unit', o.consumption_unit,
                'description', o.description
              ) order by o.sort_order)
              from public.options o
              where o.group_id = og.id and o.tenant_id = p_tenant_id and o.deleted_at is null
            ), '[]'::jsonb)
          ) order by og.sort_order)
          from public.option_groups og
          where og.item_id = mi.id and og.tenant_id = p_tenant_id and og.deleted_at is null
        ), '[]'::jsonb),
        'promotions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ip.id, 'promotional_price', ip.promotional_price,
            'days_of_week', coalesce(ip.days_of_week, '{}'),
            'is_recurring', ip.is_recurring,
            'specific_date', ip.specific_date, 'is_active', ip.is_active
          ))
          from public.item_promotions ip where ip.item_id = mi.id and ip.tenant_id = p_tenant_id
        ), '[]'::jsonb),
        'preset_observations', coalesce((
          select jsonb_agg(jsonb_build_object('id', ipo.id, 'text', ipo.text))
          from public.item_preset_observations ipo where ipo.item_id = mi.id and ipo.tenant_id = p_tenant_id
        ), '[]'::jsonb),
        'production_parts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ipp.id, 'name', ipp.name,
            'station_name', ipp.station_name, 'station_id', ipp.station_id,
            'sla_minutes', ipp.sla_minutes, 'sort_order', ipp.sort_order
          ) order by ipp.sort_order)
          from public.item_production_parts ipp
          where ipp.item_id = mi.id and ipp.tenant_id = p_tenant_id and ipp.deleted_at is null
        ), '[]'::jsonb)
      ) order by mi.sort_order)
      from public.menu_items mi where mi.tenant_id = p_tenant_id and mi.deleted_at is null
    ), '[]'::jsonb),
    'global_observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', go.id, 'text', go.text, 'is_active', go.is_active,
        'excluded_item_ids', coalesce(go.excluded_item_ids, '{}'),
        'excluded_category_ids', coalesce(go.excluded_category_ids, '{}')
      ))
      from public.global_observations go where go.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'combos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'photo_url', c.photo_url, 'price', c.price, 'is_active', c.is_active,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ci.id, 'item_id', ci.item_id, 'name', ci.name, 'quantity', ci.quantity
          ))
          from public.combo_items ci where ci.combo_id = c.id and ci.tenant_id = p_tenant_id and ci.deleted_at is null
        ), '[]'::jsonb)
      ))
      from public.combos c where c.tenant_id = p_tenant_id and c.deleted_at is null
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;
