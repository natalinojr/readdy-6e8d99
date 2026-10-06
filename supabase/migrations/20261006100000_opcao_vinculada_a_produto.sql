-- Opção do cardápio vinculada a um PRODUTO inteiro (dono, 2026-10-06). Ex.: no grupo "Escolha seu primeiro
-- Burrito", a opção "Burrito Chilli com Carne" aponta para o produto de mesmo nome: a baixa de estoque, o custo
-- e os avisos da opção passam a ser os da FICHA TÉCNICA ATUAL do produto (vínculo vivo).
-- Como funciona: options.linked_item_id guarda o produto; os insumos dele são espelhados em option_ingredients
-- (from_item_id preenchido) por fn_option_sync_linked — assim a baixa (_shared/stock.ts), o custo, o bloqueio por
-- estoque e o aviso de insumo zerado continuam lendo option_ingredients, sem mudar. Mexeu na ficha do produto
-- (item_ingredients) → as opções ligadas a ele são refeitas na hora. Insumo digitado à mão na opção (from_item_id
-- nulo) vale mais que o do produto quando é o mesmo insumo.

alter table public.options add column if not exists linked_item_id uuid references public.menu_items(id) on delete set null;
create index if not exists options_linked_item_idx on public.options (linked_item_id) where linked_item_id is not null;
alter table public.option_ingredients add column if not exists from_item_id uuid references public.menu_items(id) on delete cascade;

create or replace function public.fn_option_sync_linked(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opt record;
begin
  select id, tenant_id, linked_item_id into v_opt from public.options where id = p_option_id;
  if not found then return; end if;
  delete from public.option_ingredients where option_id = p_option_id and from_item_id is not null;
  if v_opt.linked_item_id is null then return; end if;
  insert into public.option_ingredients (tenant_id, option_id, ingredient_id, quantity, unit, sort_order, from_item_id)
  select v_opt.tenant_id, p_option_id, ii.ingredient_id, ii.quantity, ii.unit::text, 1000 + row_number() over (order by ii.created_at, ii.id), v_opt.linked_item_id
    from public.item_ingredients ii
   where ii.item_id = v_opt.linked_item_id and ii.tenant_id = v_opt.tenant_id and coalesce(ii.quantity, 0) > 0
  on conflict (option_id, ingredient_id) do nothing;
end $$;
revoke all on function public.fn_option_sync_linked(uuid) from public, anon, authenticated;
grant execute on function public.fn_option_sync_linked(uuid) to service_role;

-- Trocou o produto da opção → refaz
create or replace function public.fn_options_linked_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.linked_item_id is null then return null; end if;
  perform public.fn_option_sync_linked(new.id);
  return null;
end $$;
drop trigger if exists trg_options_linked on public.options;
create trigger trg_options_linked after insert or update of linked_item_id on public.options
  for each row execute function public.fn_options_linked_trg();

-- Mexeu na ficha do produto → refaz as opções ligadas a ele
create or replace function public.fn_item_ingredients_linked_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid := coalesce(new.item_id, old.item_id);
  r record;
begin
  for r in select id from public.options where linked_item_id = v_item and deleted_at is null loop
    perform public.fn_option_sync_linked(r.id);
  end loop;
  return null;
end $$;
drop trigger if exists trg_item_ingredients_linked on public.item_ingredients;
create trigger trg_item_ingredients_linked after insert or update or delete on public.item_ingredients
  for each row execute function public.fn_item_ingredients_linked_trg();

-- Cardápio completo: a opção traz o produto vinculado e só os insumos digitados
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

        -- 2026-10-02: horÃ¡rio de exibiÃ§Ã£o (20261002130000) â€” esta migraÃ§Ã£o ainda nÃ£o estava aplicada; nÃ£o perder o campo ao aplicÃ¡-la.

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

                'description', o.description,

                'linked_item_id', o.linked_item_id,
                -- só os insumos digitados na opção; os que vêm do produto vinculado (from_item_id) ficam de fora
                'ingredientes', coalesce((select jsonb_agg(jsonb_build_object('ingredient_id', oi.ingredient_id, 'production_recipe_id', oi.production_recipe_id, 'quantity', oi.quantity, 'unit', oi.unit) order by oi.sort_order, oi.created_at) from public.option_ingredients oi where oi.option_id = o.id and oi.from_item_id is null), '[]'::jsonb)

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
