-- Ficha do iFood montada com itens do cardápio + insumos (dono, 2026-10-05: "no delivery tem umas coisas
-- diferentes da entrega no balcão" — embalagem, sachê, talher). Vale para o CUSTO (sobra e CMV do iFood,
-- src/lib/ifoodCusto.ts). Baixa de estoque: continua pela ligação simples (ifood_item_links); quando a ficha
-- tem exatamente 1 item do cardápio com quantidade 1, a ligação a esse item é mantida (o item baixa; os
-- insumos extras ainda não). Ficha com vários itens apaga a ligação (baixaria só uma parte).
-- Uma ficha por produto do iFood (nível + nome + grupo, mesma chave de ifood_item_links / fn_ifood_norm).

create table if not exists public.ifood_ficha_linhas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  level text not null check (level in ('item', 'complemento')),
  name_key text not null,
  group_key text not null default '',
  name text not null,
  group_name text,
  kind text not null check (kind in ('item', 'insumo')),
  menu_item_id uuid references public.menu_items(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  unit text,
  ordem int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check ((kind = 'item' and menu_item_id is not null and ingredient_id is null)
      or (kind = 'insumo' and ingredient_id is not null and menu_item_id is null))
);
create index if not exists ifood_ficha_linhas_chave on public.ifood_ficha_linhas (tenant_id, level, name_key, group_key);

alter table public.ifood_ficha_linhas enable row level security;
drop policy if exists ifood_ficha_linhas_select_membership on public.ifood_ficha_linhas;
create policy ifood_ficha_linhas_select_membership on public.ifood_ficha_linhas for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.ifood_ficha_linhas from anon, authenticated;
grant select on public.ifood_ficha_linhas to authenticated;
grant all on public.ifood_ficha_linhas to service_role;

-- Grava a ficha inteira (troca as linhas). p_linhas = [{kind:'item', menu_item_id, quantity} | {kind:'insumo', ingredient_id, quantity, unit}].
-- Lista vazia = apaga a ficha.
create or replace function public.fn_ifood_ficha_salvar(p_tenant uuid, p_level text, p_name text, p_group text, p_linhas jsonb)
returns int language plpgsql security definer set search_path = public
as $$
declare
  v_nk text := fn_ifood_norm(p_name);
  v_gk text := case when p_level = 'item' then '' else fn_ifood_norm(p_group) end;
  v_l jsonb;
  v_n int := 0;
  v_itens int;
  v_item uuid;
  v_qtd numeric;
begin
  if not exists (
    select 1 from user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and ut.role::text in ('admin', 'manager', 'gerente', 'financeiro')
  ) then raise exception 'Sem permissão para montar a ficha do iFood nesta loja.'; end if;
  if p_level not in ('item', 'complemento') then raise exception 'Nível inválido.'; end if;
  if v_nk = '' then raise exception 'Produto do iFood sem nome.'; end if;
  if jsonb_typeof(coalesce(p_linhas, '[]'::jsonb)) <> 'array' then raise exception 'Linhas inválidas.'; end if;

  delete from ifood_ficha_linhas where tenant_id = p_tenant and level = p_level and name_key = v_nk and group_key = v_gk;

  for v_l in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_qtd := nullif(v_l->>'quantity', '')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Informe a quantidade de todas as linhas.'; end if;
    if v_l->>'kind' = 'item' then
      if not exists (select 1 from menu_items where id = (v_l->>'menu_item_id')::uuid and tenant_id = p_tenant and deleted_at is null)
        then raise exception 'Item do cardápio não encontrado nesta loja.'; end if;
      insert into ifood_ficha_linhas (tenant_id, level, name_key, group_key, name, group_name, kind, menu_item_id, quantity, ordem, updated_by)
      values (p_tenant, p_level, v_nk, v_gk, btrim(p_name), nullif(btrim(coalesce(p_group, '')), ''), 'item', (v_l->>'menu_item_id')::uuid, v_qtd, v_n, auth.uid());
    elsif v_l->>'kind' = 'insumo' then
      if not exists (select 1 from ingredients where id = (v_l->>'ingredient_id')::uuid and tenant_id = p_tenant and deleted_at is null)
        then raise exception 'Insumo não encontrado nesta loja.'; end if;
      insert into ifood_ficha_linhas (tenant_id, level, name_key, group_key, name, group_name, kind, ingredient_id, quantity, unit, ordem, updated_by)
      values (p_tenant, p_level, v_nk, v_gk, btrim(p_name), nullif(btrim(coalesce(p_group, '')), ''), 'insumo', (v_l->>'ingredient_id')::uuid, v_qtd, nullif(v_l->>'unit', ''), v_n, auth.uid());
    else
      raise exception 'Linha inválida.';
    end if;
    v_n := v_n + 1;
  end loop;

  -- Baixa de estoque continua pela ligação simples: 1 item com quantidade 1 → liga a ele; vários itens → tira a ligação.
  if v_n > 0 then
    select count(*), min(menu_item_id::text)::uuid, min(quantity) into v_itens, v_item, v_qtd
      from ifood_ficha_linhas where tenant_id = p_tenant and level = p_level and name_key = v_nk and group_key = v_gk and kind = 'item';
    if v_itens = 1 and v_qtd = 1 then
      insert into ifood_item_links as l (tenant_id, level, name, name_key, group_name, group_key, target_kind, menu_item_id, updated_at, updated_by)
      values (p_tenant, p_level, btrim(p_name), v_nk, nullif(btrim(coalesce(p_group, '')), ''), v_gk, 'item', v_item, now(), auth.uid())
      on conflict (tenant_id, level, name_key, group_key) do update set
        target_kind = 'item', menu_item_id = excluded.menu_item_id, combo_id = null, option_id = null, updated_at = now(), updated_by = auth.uid();
    else
      delete from ifood_item_links where tenant_id = p_tenant and level = p_level and name_key = v_nk and group_key = v_gk;
    end if;
  end if;
  return v_n;
end $$;
revoke all on function public.fn_ifood_ficha_salvar(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.fn_ifood_ficha_salvar(uuid, text, text, text, jsonb) to authenticated;

-- Ligar simples (ou "Não usa estoque") troca a ficha montada: apaga as linhas da ficha do mesmo produto.
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
end $function$;
