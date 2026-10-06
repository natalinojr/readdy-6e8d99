-- "Combo de escolhas" (dono, 06/10): produto do iFood que é só a casca de um combo — "Combo Burrito com Coca"
-- em que o cliente escolhe o burrito nos complementos. O produto não tem custo próprio; a comida é a soma do
-- que o cliente escolheu (cada complemento ligado ao item do cardápio). Diferente de "Não usa estoque": aqui
-- TODO complemento precisa de ficha, inclusive o que vem de graça (Coca grátis tem custo).
-- Funil: igual a sem_estoque no produto (linha sem item do cardápio); os complementos ligados viram linhas próprias.

alter table public.ifood_item_links drop constraint if exists ifood_item_links_target_kind_check;
alter table public.ifood_item_links add constraint ifood_item_links_target_kind_check
  check (target_kind = any (array['item', 'combo', 'option', 'sem_estoque', 'escolhas']));
alter table public.ifood_item_links drop constraint if exists ifood_item_links_check;
alter table public.ifood_item_links add constraint ifood_item_links_check check (
  ((target_kind = 'item') and (menu_item_id is not null) and (combo_id is null) and (option_id is null))
  or ((target_kind = 'combo') and (combo_id is not null) and (menu_item_id is null) and (option_id is null))
  or ((target_kind = 'option') and (option_id is not null) and (menu_item_id is null) and (combo_id is null))
  or ((target_kind in ('sem_estoque', 'escolhas')) and (menu_item_id is null) and (combo_id is null) and (option_id is null)));
alter table public.ifood_item_links drop constraint if exists ifood_item_links_escolhas_item;
alter table public.ifood_item_links add constraint ifood_item_links_escolhas_item check (target_kind <> 'escolhas' or level = 'item');

create or replace function public.fn_ifood_vinculo_salvar(p_tenant uuid, p_level text, p_name text, p_group text, p_ifood_id text, p_external_code text, p_kind text, p_target uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_nk text := fn_ifood_norm(p_name);
  v_gk text := case when p_level = 'item' then '' else fn_ifood_norm(p_group) end;
  v_id uuid;
begin
  if not exists (
    select 1 from user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and ut.role::text in ('admin', 'manager', 'gerente', 'financeiro')
  ) then raise exception 'Sem permissão para vincular itens do iFood nesta loja.'; end if;
  if p_level not in ('item', 'complemento') then raise exception 'Nível inválido.'; end if;
  if v_nk = '' then raise exception 'Produto do iFood sem nome.'; end if;

  delete from ifood_ficha_linhas where tenant_id = p_tenant and level = p_level and name_key = v_nk and group_key = v_gk;

  if p_kind is null or p_kind = 'remover' then
    delete from ifood_item_links where tenant_id = p_tenant and level = p_level and name_key = v_nk and group_key = v_gk;
    return null;
  end if;
  if p_kind not in ('item', 'combo', 'option', 'sem_estoque', 'escolhas') then raise exception 'Tipo de vínculo inválido.'; end if;
  if p_kind = 'escolhas' and p_level <> 'item' then raise exception 'Combo de escolhas é só para produto do iFood.'; end if;
  if p_kind = 'option' and p_level = 'item' then raise exception 'Produto do iFood só liga a item ou combo do cardápio.'; end if;
  if p_kind not in ('sem_estoque', 'escolhas') and p_target is null then raise exception 'Escolha o item do cardápio.'; end if;
  if p_kind = 'item' and not exists (select 1 from menu_items where id = p_target and tenant_id = p_tenant and deleted_at is null)
     or p_kind = 'combo' and not exists (select 1 from combos where id = p_target and tenant_id = p_tenant and deleted_at is null)
     or p_kind = 'option' and not exists (select 1 from options where id = p_target and tenant_id = p_tenant and deleted_at is null)
  then raise exception 'Item do cardápio não encontrado nesta loja.'; end if;

  insert into ifood_item_links as l (tenant_id, level, name, name_key, group_name, group_key, ifood_id, external_code,
                                     target_kind, menu_item_id, combo_id, option_id, updated_at, updated_by)
  values (p_tenant, p_level, btrim(p_name), v_nk, nullif(btrim(coalesce(p_group, '')), ''), v_gk,
          nullif(btrim(coalesce(p_ifood_id, '')), ''), nullif(btrim(coalesce(p_external_code, '')), ''), p_kind,
          case when p_kind = 'item' then p_target end, case when p_kind = 'combo' then p_target end,
          case when p_kind = 'option' then p_target end, now(), auth.uid())
  on conflict (tenant_id, level, name_key, group_key) do update set
    name = excluded.name, group_name = excluded.group_name,
    ifood_id = coalesce(excluded.ifood_id, l.ifood_id), external_code = coalesce(excluded.external_code, l.external_code),
    target_kind = excluded.target_kind, menu_item_id = excluded.menu_item_id, combo_id = excluded.combo_id,
    option_id = excluded.option_id, updated_at = now(), updated_by = auth.uid()
  returning id into v_id;
  return v_id;
end $function$;

create or replace function public.fn_ifood_itens_vendidos(p_tenant uuid, p_dias integer default 90)
 returns table(level text, name text, group_name text, ifood_id text, external_code text, vendidos numeric, ultimo timestamp with time zone, link_id uuid, target_kind text, target_id uuid, target_nome text, target_inativo boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.auth_is_member_of(p_tenant) then raise exception 'Sem acesso a esta loja.'; end if;
  return query
  with ped as (
    -- pela hora do pedido (ordered_at); pedidos antigos relidos entram com created_at recente
    select o.id, coalesce(o.ordered_at, o.created_at) created_at from ifood_orders o
    where o.tenant_id = p_tenant and o.status <> 'cancelled'
      and coalesce(o.ordered_at, o.created_at) >= now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 730)))
  ),
  base as (
    select 'item'::text lv, i.name nm, null::text grp, i.catalog_item_id iid, i.external_code ext, i.quantity::numeric q, p.created_at quando
      from ifood_order_items i join ped p on p.id = i.order_row_id where i.tenant_id = p_tenant
    union all
    select 'complemento', o->>'name', o->>'groupName', o->>'id', o->>'externalCode',
           i.quantity * coalesce((o->>'quantity')::numeric, 1), p.created_at
      from ifood_order_items i join ped p on p.id = i.order_row_id
      cross join lateral jsonb_array_elements(coalesce(i.options, '[]'::jsonb)) o
     where i.tenant_id = p_tenant
    union all
    select 'complemento', c->>'name', c->>'groupName', c->>'id', c->>'externalCode',
           i.quantity * coalesce((o->>'quantity')::numeric, 1) * coalesce((c->>'quantity')::numeric, 1), p.created_at
      from ifood_order_items i join ped p on p.id = i.order_row_id
      cross join lateral jsonb_array_elements(coalesce(i.options, '[]'::jsonb)) o
      cross join lateral jsonb_array_elements(coalesce(o->'customizations', '[]'::jsonb)) c
     where i.tenant_id = p_tenant
  ),
  agg as (
    select b.lv, fn_ifood_norm(b.nm) nk, case when b.lv = 'item' then '' else fn_ifood_norm(b.grp) end gk,
           (array_agg(b.nm order by b.quando desc))[1] nm, (array_agg(b.grp order by b.quando desc))[1] grp,
           (array_agg(b.iid order by b.quando desc))[1] iid, (array_agg(b.ext order by b.quando desc))[1] ext,
           sum(b.q) q, max(b.quando) quando
      from base b where coalesce(b.nm, '') <> ''
     group by 1, 2, 3
  ),
  todos as (
    select a.lv, a.nk, a.gk, a.nm, a.grp, a.iid, a.ext, a.q, a.quando from agg a
    union all
    select l.level, l.name_key, l.group_key, l.name, l.group_name, l.ifood_id, l.external_code, 0::numeric, null::timestamptz
      from ifood_item_links l
     where l.tenant_id = p_tenant
       and not exists (select 1 from agg a where a.lv = l.level and a.nk = l.name_key and a.gk = l.group_key)
  )
  select t.lv, t.nm, t.grp, t.iid, t.ext, t.q, t.quando, l.id, l.target_kind,
         coalesce(l.menu_item_id, l.combo_id, l.option_id),
         case l.target_kind
           when 'item' then mi.name
           when 'combo' then cb.name
           when 'option' then op.name || coalesce(' (' || og.name || coalesce(' · ' || gi.name, '') || ')', '')
           when 'sem_estoque' then 'Não usa estoque'
           when 'escolhas' then 'Combo de escolhas (custo pelos complementos)'
         end,
         coalesce(mi.deleted_at is not null, false) or coalesce(cb.deleted_at is not null, false) or coalesce(op.deleted_at is not null, false)
    from todos t
    left join ifood_item_links l on l.tenant_id = p_tenant and l.level = t.lv and l.name_key = t.nk and l.group_key = t.gk
    left join menu_items mi on mi.id = l.menu_item_id
    left join combos cb on cb.id = l.combo_id
    left join options op on op.id = l.option_id
    left join option_groups og on og.id = op.group_id
    left join menu_items gi on gi.id = og.item_id
   order by t.lv desc, (l.id is null) desc, t.q desc, t.nm;
end $function$;
