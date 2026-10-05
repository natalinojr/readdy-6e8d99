-- Contagem: marcar um item "em dúvida" para decidir depois (2026-10-05, pedido do dono).
-- Quem conta não tem certeza do número de um insumo: marca, segue a contagem, e o item fica na fila
-- "Em dúvida" (Início › Contar e Inventário) até ser contado de novo. Contar o item (contagem passo a passo
-- ou contagem cheia, desde que a pessoa tenha mexido nele) tira a marca sozinho.

create table if not exists public.estoque_contagem_duvidas (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  nota text,
  marcado_por uuid,
  marcado_por_nome text,
  marcado_em timestamptz not null default now(),
  primary key (tenant_id, ingredient_id)
);
alter table public.estoque_contagem_duvidas enable row level security;
drop policy if exists estoque_contagem_duvidas_select on public.estoque_contagem_duvidas;
create policy estoque_contagem_duvidas_select on public.estoque_contagem_duvidas
  for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.estoque_contagem_duvidas to authenticated;
grant all on public.estoque_contagem_duvidas to service_role;

-- Marca (p_duvida = true) ou tira (false) a dúvida. Quem conta (estoque_inventario) ou configura o estoque.
create or replace function public.fn_estoque_duvida(p_tenant_id uuid, p_ingredient_id uuid, p_duvida boolean, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_nome text;
begin
  if not public.estoque_pode_configurar(p_tenant_id) then
    raise exception 'Só quem faz o inventário marca item em dúvida.' using errcode = '42501';
  end if;
  if not exists (select 1 from ingredients where id = p_ingredient_id and tenant_id = p_tenant_id and deleted_at is null) then
    raise exception 'Insumo não encontrado nesta loja.' using errcode = '42501';
  end if;
  if p_duvida then
    select name into v_nome from users where id = auth.uid();
    insert into estoque_contagem_duvidas (tenant_id, ingredient_id, nota, marcado_por, marcado_por_nome)
    values (p_tenant_id, p_ingredient_id, nullif(btrim(coalesce(p_nota, '')), ''), auth.uid(), v_nome)
    on conflict (tenant_id, ingredient_id) do update
      set nota = excluded.nota, marcado_por = excluded.marcado_por, marcado_por_nome = excluded.marcado_por_nome, marcado_em = now();
  else
    delete from estoque_contagem_duvidas where tenant_id = p_tenant_id and ingredient_id = p_ingredient_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.fn_estoque_duvida(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.fn_estoque_duvida(uuid, uuid, boolean, text) to authenticated, service_role;

create or replace function public.fn_estoque_duvidas(p_tenant_id uuid)
returns table(ingredient_id uuid, nota text, marcado_por_nome text, marcado_em timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._assert_tenant_access(p_tenant_id);
  return query
    select d.ingredient_id, d.nota, d.marcado_por_nome, d.marcado_em
      from estoque_contagem_duvidas d
      join ingredients i on i.id = d.ingredient_id and i.deleted_at is null
     where d.tenant_id = p_tenant_id
     order by d.marcado_em;
end;
$$;
revoke all on function public.fn_estoque_duvidas(uuid) from public, anon;
grant execute on function public.fn_estoque_duvidas(uuid) to authenticated, service_role;

-- Contar o insumo tira a dúvida. Na contagem cheia, o campo que ninguém mexeu (semMudanca) não conta como resposta.
do $$
declare
  v text;
  v_old constant text := E'    v_counted_items := v_counted_items + 1;\n';
  v_new constant text := E'    v_counted_items := v_counted_items + 1;\n    IF NOT COALESCE((v_item->>''semMudanca'')::boolean, false) THEN\n      DELETE FROM estoque_contagem_duvidas WHERE tenant_id = p_tenant_id AND ingredient_id = v_ing_id;\n    END IF;\n';
begin
  v := pg_get_functiondef('public.fn_confirm_inventory(uuid,uuid,text,jsonb,timestamptz)'::regprocedure);
  if position('estoque_contagem_duvidas' in v) > 0 then return; end if;
  if position(v_old in v) = 0 or length(v) - length(replace(v, v_old, '')) <> length(v_old) then
    raise exception 'fn_confirm_inventory mudou: revisar à mão';
  end if;
  execute replace(v, v_old, v_new);
end;
$$;
