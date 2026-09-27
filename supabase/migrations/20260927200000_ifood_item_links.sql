-- Vínculo produto do iFood → cardápio do ERPOS (2026-09-27, etapa 1 de IFOOD-PEDIDOS-FUNIL.md).
-- Cada produto vendido no iFood (nível 'item') e cada complemento/customização (nível 'complemento', 2º e 3º nível do
-- iFood) é ligado À MÃO a um item, combo ou opção do cardápio — ou marcado "não usa estoque". Nada é sugerido pelo
-- sistema (regra do dono 09-24: só vínculo confirmado liga). É a base da baixa de estoque/CMV dos pedidos do iFood.
--
-- Identidade do produto do iFood: nome normalizado (+ grupo, no complemento). O id do catálogo e o código externo
-- também são guardados para casar primeiro por eles — na loja de TESTE o gerador de pedidos sorteia id e código a cada
-- pedido (visto 2026-09-27), então o nome é a chave que sempre existe.

create table if not exists public.ifood_item_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  level text not null check (level in ('item', 'complemento')),
  name text not null,
  name_key text not null,
  group_name text,
  group_key text not null default '',
  ifood_id text,
  external_code text,
  target_kind text not null check (target_kind in ('item', 'combo', 'option', 'sem_estoque')),
  menu_item_id uuid references public.menu_items(id) on delete cascade,
  combo_id uuid references public.combos(id) on delete cascade,
  option_id uuid references public.options(id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (tenant_id, level, name_key, group_key),
  check (
    (target_kind = 'item' and menu_item_id is not null and combo_id is null and option_id is null) or
    (target_kind = 'combo' and combo_id is not null and menu_item_id is null and option_id is null) or
    (target_kind = 'option' and option_id is not null and menu_item_id is null and combo_id is null) or
    (target_kind = 'sem_estoque' and menu_item_id is null and combo_id is null and option_id is null)
  ),
  check (level = 'complemento' or target_kind <> 'option')
);
create index if not exists ifood_item_links_ext_idx on public.ifood_item_links (tenant_id, external_code) where external_code is not null;
create index if not exists ifood_item_links_ifood_id_idx on public.ifood_item_links (tenant_id, ifood_id) where ifood_id is not null;

alter table public.ifood_item_links enable row level security;
drop policy if exists ifood_item_links_select_membership on public.ifood_item_links;
create policy ifood_item_links_select_membership on public.ifood_item_links for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.ifood_item_links from anon, authenticated;
grant select on public.ifood_item_links to authenticated;
grant all on public.ifood_item_links to service_role;

create or replace function public.fn_ifood_norm(p text)
returns text language sql immutable as $$ select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) $$;

-- Produtos e complementos do iFood vendidos nos últimos p_dias (pedidos não cancelados), com o vínculo atual.
-- Inclui vínculos já feitos mesmo sem venda no período.
create or replace function public.fn_ifood_itens_vendidos(p_tenant uuid, p_dias int default 90)
returns table (
  level text, name text, group_name text, ifood_id text, external_code text, vendidos numeric, ultimo timestamptz,
  link_id uuid, target_kind text, target_id uuid, target_nome text, target_inativo boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.auth_is_member_of(p_tenant) then raise exception 'Sem acesso a esta loja.'; end if;
  return query
  with ped as (
    select o.id, o.created_at from ifood_orders o
    where o.tenant_id = p_tenant and o.status <> 'cancelled'
      and o.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 730)))
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
end $$;

-- Alvos possíveis do cardápio (itens, combos e opções ativos) para a tela de vínculo.
create or replace function public.fn_ifood_vinculo_alvos(p_tenant uuid)
returns table (kind text, id uuid, nome text, detalhe text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.auth_is_member_of(p_tenant) then raise exception 'Sem acesso a esta loja.'; end if;
  return query
  select 'item'::text, mi.id, mi.name, null::text from menu_items mi where mi.tenant_id = p_tenant and mi.deleted_at is null
  union all
  select 'combo', cb.id, cb.name, null from combos cb where cb.tenant_id = p_tenant and cb.deleted_at is null
  union all
  select 'option', op.id, op.name, og.name || coalesce(' · ' || gi.name, '')
    from options op join option_groups og on og.id = op.group_id and og.deleted_at is null
    left join menu_items gi on gi.id = og.item_id
   where op.tenant_id = p_tenant and op.deleted_at is null
  order by 1, 3;
end $$;

-- Grava (ou remove, com p_kind null/'remover') o vínculo de um produto do iFood. Só admin, gerente ou financeiro.
create or replace function public.fn_ifood_vinculo_salvar(
  p_tenant uuid, p_level text, p_name text, p_group text, p_ifood_id text, p_external_code text, p_kind text, p_target uuid
) returns uuid
language plpgsql security definer set search_path = public
as $$
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

  if p_kind is null or p_kind = 'remover' then
    delete from ifood_item_links where tenant_id = p_tenant and level = p_level and name_key = v_nk and group_key = v_gk;
    return null;
  end if;
  if p_kind not in ('item', 'combo', 'option', 'sem_estoque') then raise exception 'Tipo de vínculo inválido.'; end if;
  if p_kind = 'option' and p_level = 'item' then raise exception 'Produto do iFood só liga a item ou combo do cardápio.'; end if;
  if p_kind <> 'sem_estoque' and p_target is null then raise exception 'Escolha o item do cardápio.'; end if;
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
end $$;

revoke all on function public.fn_ifood_itens_vendidos(uuid, int), public.fn_ifood_vinculo_alvos(uuid),
  public.fn_ifood_vinculo_salvar(uuid, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.fn_ifood_itens_vendidos(uuid, int), public.fn_ifood_vinculo_alvos(uuid),
  public.fn_ifood_vinculo_salvar(uuid, text, text, text, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.fn_ifood_norm(text) to authenticated, service_role;
