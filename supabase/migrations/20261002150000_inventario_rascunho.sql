-- Rascunho da contagem de inventário no banco: começa num celular e continua em outro.
-- Uma linha por insumo já mexido, para duas pessoas contarem categorias diferentes ao mesmo
-- tempo sem uma sobrescrever a outra. Acesso só pelas funções abaixo (membro da loja).

create table if not exists public.inventory_count_drafts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  valor text not null default '',          -- como foi digitado, na unidade de CONTAGEM
  fator numeric not null default 1,        -- fator de contagem quando foi digitado
  conferido boolean not null default false,
  updated_by uuid,
  updated_by_nome text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, ingredient_id)
);

alter table public.inventory_count_drafts enable row level security;
revoke all on public.inventory_count_drafts from anon, authenticated;
grant select, insert, update, delete on public.inventory_count_drafts to service_role;

create or replace function public.inventario_rascunho_ler(p_tenant_id uuid)
returns table (ingredient_id uuid, valor text, fator numeric, conferido boolean, updated_by_nome text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.auth_is_member_of(p_tenant_id) then
    raise exception 'sem acesso a esta loja';
  end if;
  return query
    select d.ingredient_id, d.valor, d.fator, d.conferido, d.updated_by_nome, d.updated_at
    from public.inventory_count_drafts d
    where d.tenant_id = p_tenant_id;
end $$;

-- p_itens: [{ "insumo_id": uuid, "valor": text, "fator": number, "conferido": bool }]
create or replace function public.inventario_rascunho_salvar(p_tenant_id uuid, p_itens jsonb, p_operador text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.auth_is_member_of(p_tenant_id) then
    raise exception 'sem acesso a esta loja';
  end if;
  insert into public.inventory_count_drafts as d
    (tenant_id, ingredient_id, valor, fator, conferido, updated_by, updated_by_nome, updated_at)
  select p_tenant_id, (x->>'insumo_id')::uuid, coalesce(x->>'valor', ''),
         coalesce(nullif(x->>'fator', '')::numeric, 1), coalesce((x->>'conferido')::boolean, false),
         auth.uid(), p_operador, now()
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x
  join public.ingredients i on i.id = (x->>'insumo_id')::uuid and i.tenant_id = p_tenant_id
  on conflict (tenant_id, ingredient_id) do update
    set valor = excluded.valor, fator = excluded.fator, conferido = excluded.conferido,
        updated_by = excluded.updated_by, updated_by_nome = excluded.updated_by_nome, updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.inventario_rascunho_apagar(p_tenant_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.auth_is_member_of(p_tenant_id) then
    raise exception 'sem acesso a esta loja';
  end if;
  delete from public.inventory_count_drafts where tenant_id = p_tenant_id;
end $$;

revoke all on function public.inventario_rascunho_ler(uuid) from public, anon;
revoke all on function public.inventario_rascunho_salvar(uuid, jsonb, text) from public, anon;
revoke all on function public.inventario_rascunho_apagar(uuid) from public, anon;
grant execute on function public.inventario_rascunho_ler(uuid) to authenticated;
grant execute on function public.inventario_rascunho_salvar(uuid, jsonb, text) to authenticated;
grant execute on function public.inventario_rascunho_apagar(uuid) to authenticated;
