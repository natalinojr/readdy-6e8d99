-- Cardápio: "Acabou hoje" + leitura da lista de itens (dono, 2026-10-06).
--
-- 1) menu_items.pausado_ate / pausado_motivo: o item fica fora de TODAS as telas de venda até essa hora e volta
--    sozinho (pausado_ate <= now() = vendendo de novo; ninguém precisa limpar). Quem grava é só o menu-write
--    (ação bulk_update_items, pausar=true|false), com pausado_ate = a próxima 05:00 de Brasília
--    (_shared/cardapio-pausa.ts). Independe do Ativo: desativar continua sendo o "some até eu ligar de novo".
--    Quem esconde: CardapioContext (PDV caixa/garçom/delivery, totem; itemPausado), mesa-write get_cardapio
--    e delivery-write get_delivery_config (mesa QR, QR universal, link do delivery, atendente do WhatsApp) e os
--    pedidos públicos (mesa-write/delivery-write recusam item pausado como indisponível).
-- 2) fn_get_full_menu devolve os dois campos (corpo = o de 20261006100000_opcao_vinculada_a_produto, conferido
--    com o do ar em 06/10; só entram as duas linhas marcadas "acabou hoje").
-- 3) fn_cardapio_resumo_itens: uma leitura agregada para a lista do Cardápio — quantas vezes cada item vendeu
--    nos últimos N dias (mesma regra de venda do fn_get_cmv_report: pago, não cancelado, sem treino/rascunho,
--    item não cancelado) e se tem ficha técnica (item_ingredients). Nada de custo ou margem.

alter table public.menu_items add column if not exists pausado_ate timestamptz;
alter table public.menu_items add column if not exists pausado_motivo text;
create index if not exists menu_items_pausado_idx on public.menu_items (tenant_id, pausado_ate) where pausado_ate is not null;

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
        -- acabou hoje (20261006310000)
        'pausado_ate', mi.pausado_ate, 'pausado_motivo', mi.pausado_motivo,

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

create or replace function public.fn_cardapio_resumo_itens(p_tenant_id uuid, p_dias integer default 14)
returns table (item_id uuid, vendidos numeric, tem_ficha boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assert_tenant_access(p_tenant_id);
  return query
  with v as (
    select oi.item_id as id, sum(coalesce(oi.quantity, 1))::numeric as q
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.tenant_id = p_tenant_id
       and o.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_dias, 14), 90)))
       and o.is_paid = true and o.status <> 'cancelled'
       and not coalesce(o.is_training, false) and not coalesce(o.is_draft, false)
       and (oi.status is null or oi.status <> 'cancelled')
       and oi.item_id is not null
     group by oi.item_id
  )
  select mi.id,
         coalesce(v.q, 0),
         exists (select 1 from public.item_ingredients ii where ii.item_id = mi.id and ii.tenant_id = p_tenant_id)
    from public.menu_items mi
    left join v on v.id = mi.id
   where mi.tenant_id = p_tenant_id and mi.deleted_at is null;
end $$;

revoke all on function public.fn_cardapio_resumo_itens(uuid, integer) from public, anon;
grant execute on function public.fn_cardapio_resumo_itens(uuid, integer) to authenticated, service_role;
