-- CMV do iFood (2026-09-25): o dono compõe cada produto/complemento vendido no iFood (relatório de
-- Cardápio → fin_ifood_menu_sales, identificado só pelo NOME) com insumos e quantidades; a tela
-- calcula o CMV teórico = quantidade vendida × custo atual dos insumos (custoLinhaFicha, com
-- conversão de unidade). É indicador gerencial: NÃO entra na DRE (lá o CMV é o de compras).
-- Nada é sugerido automaticamente: só entra o insumo que o usuário escolher (regra do dono 09-24).

create table if not exists public.fin_ifood_cmv_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('item', 'complemento')),
  name_key text not null,          -- nome normalizado (minúsculo, espaços simples) = chave do produto
  name text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (tenant_id, kind, name_key)
);

create table if not exists public.fin_ifood_cmv_linhas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cmv_item_id uuid not null references public.fin_ifood_cmv_items(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null check (unit in ('g', 'kg', 'ml', 'L', 'unit')),
  ordem int not null default 0
);
create index if not exists fin_ifood_cmv_linhas_item_idx on public.fin_ifood_cmv_linhas (cmv_item_id);

alter table public.fin_ifood_cmv_items enable row level security;
alter table public.fin_ifood_cmv_linhas enable row level security;
drop policy if exists fin_ifood_cmv_items_select_membership on public.fin_ifood_cmv_items;
create policy fin_ifood_cmv_items_select_membership on public.fin_ifood_cmv_items for select to authenticated using (public.auth_is_member_of(tenant_id));
drop policy if exists fin_ifood_cmv_linhas_select_membership on public.fin_ifood_cmv_linhas;
create policy fin_ifood_cmv_linhas_select_membership on public.fin_ifood_cmv_linhas for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.fin_ifood_cmv_items, public.fin_ifood_cmv_linhas from anon, authenticated;
grant select on public.fin_ifood_cmv_items, public.fin_ifood_cmv_linhas to authenticated;
grant all on public.fin_ifood_cmv_items, public.fin_ifood_cmv_linhas to service_role;

-- Grava (substitui) a composição de um produto. p_linhas = [{ingredient_id, quantity, unit}];
-- vazio = remove a composição. Só admin, gerente ou financeiro da loja.
create or replace function public.fn_ifood_cmv_salvar(p_tenant uuid, p_kind text, p_name text, p_linhas jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  v_id uuid;
  v_l jsonb;
  v_ordem int := 0;
begin
  if not exists (
    select 1 from public.user_tenants ut
    where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
      and ut.role::text in ('admin', 'manager', 'gerente', 'financeiro')
  ) then
    raise exception 'Sem permissão para alterar o CMV do iFood desta loja.';
  end if;
  if p_kind not in ('item', 'complemento') then raise exception 'Tipo inválido (item ou complemento).'; end if;
  if v_key = '' then raise exception 'Produto sem nome.'; end if;

  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    delete from public.fin_ifood_cmv_items where tenant_id = p_tenant and kind = p_kind and name_key = v_key;
    return null;
  end if;

  insert into public.fin_ifood_cmv_items (tenant_id, kind, name_key, name, updated_at, updated_by)
  values (p_tenant, p_kind, v_key, btrim(p_name), now(), auth.uid())
  on conflict (tenant_id, kind, name_key) do update set name = excluded.name, updated_at = now(), updated_by = auth.uid()
  returning id into v_id;

  delete from public.fin_ifood_cmv_linhas where cmv_item_id = v_id;
  for v_l in select * from jsonb_array_elements(p_linhas) loop
    if not exists (select 1 from public.ingredients i where i.id = (v_l->>'ingredient_id')::uuid and i.tenant_id = p_tenant) then
      raise exception 'Insumo não encontrado nesta loja.';
    end if;
    insert into public.fin_ifood_cmv_linhas (tenant_id, cmv_item_id, ingredient_id, quantity, unit, ordem)
    values (p_tenant, v_id, (v_l->>'ingredient_id')::uuid, (v_l->>'quantity')::numeric, coalesce(nullif(v_l->>'unit', ''), 'unit'), v_ordem);
    v_ordem := v_ordem + 1;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.fn_ifood_cmv_salvar(uuid, text, text, jsonb) from public, anon;
grant execute on function public.fn_ifood_cmv_salvar(uuid, text, text, jsonb) to authenticated, service_role;
