-- Opção do cardápio com VÁRIOS insumos (dono, 2026-09-26). Ex.: "Guacamole + Sour cream + Tortilha de
-- milho" dá baixa nos três. Antes a opção só guardava um insumo (options.ingredient_id).
-- option_ingredients é a fonte da verdade; options.ingredient_id/production_recipe_id/consumption_* passam
-- a espelhar o PRIMEIRO insumo (quem ainda lê as colunas antigas — modelos de opções, exportação — continua
-- funcionando). Quem grava: menu-write (upsert_item, ligar_opcoes_estoque).

create table if not exists public.option_ingredients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  option_id uuid not null references public.options(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  production_recipe_id uuid references public.production_recipes(id) on delete set null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (option_id, ingredient_id)
);
create index if not exists option_ingredients_option_idx on public.option_ingredients (option_id);
create index if not exists option_ingredients_tenant_idx on public.option_ingredients (tenant_id);

alter table public.option_ingredients enable row level security;
revoke all on public.option_ingredients from anon;
grant select on public.option_ingredients to authenticated;
grant all on public.option_ingredients to service_role;
drop policy if exists option_ingredients_select on public.option_ingredients;
create policy option_ingredients_select on public.option_ingredients for select to authenticated
  using (exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = option_ingredients.tenant_id));

-- Vínculos que já existem
insert into public.option_ingredients (tenant_id, option_id, ingredient_id, production_recipe_id, quantity, unit, sort_order)
select o.tenant_id, o.id, o.ingredient_id, o.production_recipe_id,
       coalesce(nullif(o.consumption_quantity, 0), 1),
       coalesce(nullif(btrim(o.consumption_unit), ''), g.unit::text), 0
  from public.options o join public.ingredients g on g.id = o.ingredient_id
 where o.ingredient_id is not null
on conflict (option_id, ingredient_id) do nothing;

-- Colunas antigas da opção = primeiro insumo
create or replace function public.fn_option_ingredients_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opt uuid := coalesce(new.option_id, old.option_id);
  r record;
begin
  select * into r from public.option_ingredients where option_id = v_opt order by sort_order, created_at limit 1;
  update public.options set
      ingredient_id = r.ingredient_id, production_recipe_id = r.production_recipe_id,
      consumption_quantity = r.quantity, consumption_unit = r.unit
   where id = v_opt
     and (ingredient_id is distinct from r.ingredient_id or production_recipe_id is distinct from r.production_recipe_id
          or consumption_quantity is distinct from r.quantity or consumption_unit is distinct from r.unit);
  return null;
end $$;
drop trigger if exists trg_option_ingredients_sync on public.option_ingredients;
create trigger trg_option_ingredients_sync after insert or update or delete on public.option_ingredients
  for each row execute function public.fn_option_ingredients_sync();

-- Cardápio completo: cada opção traz a lista de insumos
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
                'description', o.description,
                'ingredientes', coalesce((select jsonb_agg(jsonb_build_object('ingredient_id', oi.ingredient_id, 'production_recipe_id', oi.production_recipe_id, 'quantity', oi.quantity, 'unit', oi.unit) order by oi.sort_order, oi.created_at) from public.option_ingredients oi where oi.option_id = o.id), '[]'::jsonb)
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
$function$

;
