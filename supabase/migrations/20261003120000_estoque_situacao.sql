-- Estoque: UMA regra para cada conceito (2026-10-03).
--
-- Em 02/10, na El Patron Paranaguá, "estoque baixo" tinha 6 números ao mesmo tempo (Dashboard 44,
-- pendência 22, topo do Estoque 16/15/18/18): cada tela tinha a sua conta (uma contava insumo
-- excluído, outra os sem aviso, outra "metade do mínimo", outra "mínimo ÷ 7" como se fosse o uso).
-- Daqui em diante todas leem estas regras:
--
--   abaixo do mínimo = acompanha (track_stock) E mínimo > 0 E estoque <= mínimo
--   esgotado         = acompanha E (estoque <= 0 OU marcado como esgotado)
--   vai faltar       = acompanha E uso/dia > 0 E NÃO abaixo do mínimo E estoque ÷ uso/dia <= dias_previsao
--
-- Uso/dia = saídas de uso (venda pela ficha, perda, saída manual que não é estorno/correção) dos
-- últimos 14 dias ÷ dias com histórico (desde a 1ª saída de uso da loja, no máx. 14; menos de 3 dias
-- de histórico = sem previsão). O espelho em TypeScript é src/lib/estoqueRegras.ts.
--
-- Também: config da loja (quanto pedir = dias de uso, padrão 60; horizonte do "vai faltar", padrão 7),
-- planos de contagem (geral mensal, semanal dos estratégicos...) e a marca de "pedido mandado".

-- ── 1) Regras ───────────────────────────────────────────────────────────────
create or replace function public.insumo_abaixo_minimo(p_acompanha boolean, p_minimo numeric, p_estoque numeric)
returns boolean language sql immutable parallel safe as $$
  select coalesce(p_acompanha, true) and coalesce(p_minimo, 0) > 0 and coalesce(p_estoque, 0) <= p_minimo
$$;

create or replace function public.insumo_esgotado(p_acompanha boolean, p_estoque numeric, p_marcado boolean)
returns boolean language sql immutable parallel safe as $$
  select coalesce(p_acompanha, true) and (coalesce(p_estoque, 0) <= 0 or coalesce(p_marcado, false))
$$;

grant execute on function public.insumo_abaixo_minimo(boolean, numeric, numeric) to authenticated, service_role;
grant execute on function public.insumo_esgotado(boolean, numeric, boolean) to authenticated, service_role;

-- Quem pode configurar o estoque da loja (quanto pedir, planos de contagem): admin sempre; os demais
-- pela chave estoque_inventario da matriz de permissões, e sem linha na matriz, só o gerente
-- (mesmo padrão de DEFAULT_PERMISSOES em src/hooks/usePermissoes.ts).
create or replace function public.estoque_pode_configurar(p_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.user_tenants ut
      left join public.permissions p
        on p.tenant_id = ut.tenant_id and p.role::text = ut.role::text and p.permission_key = 'estoque_inventario'
     where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and (ut.role::text = 'admin' or coalesce(p.allowed, ut.role::text = 'manager'))
  );
$$;
revoke all on function public.estoque_pode_configurar(uuid) from public, anon;
grant execute on function public.estoque_pode_configurar(uuid) to authenticated, service_role;

-- ── 2) Config da loja ───────────────────────────────────────────────────────
create table if not exists public.estoque_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  dias_compra int not null default 60 check (dias_compra between 1 and 365),
  dias_previsao int not null default 7 check (dias_previsao between 1 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.estoque_config enable row level security;
drop policy if exists estoque_config_select_membership on public.estoque_config;
create policy estoque_config_select_membership on public.estoque_config
  for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.estoque_config to authenticated;
grant all on public.estoque_config to service_role;

-- ── 3) Planos de contagem ───────────────────────────────────────────────────
-- frequencia: diaria | semanal (dia_semana 0 = domingo) | mensal (dia_mes 1..28; 0 = último dia).
-- todos = todos os insumos que entram na contagem (count_inventory); senão, a lista em itens.
create table if not exists public.inventory_count_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 60),
  frequencia text not null check (frequencia in ('diaria', 'semanal', 'mensal')),
  dia_semana smallint check (dia_semana between 0 and 6),
  dia_mes smallint check (dia_mes between 0 and 28),
  todos boolean not null default false,
  itens uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint inventory_count_plans_dia_semana check (frequencia <> 'semanal' or dia_semana is not null),
  constraint inventory_count_plans_dia_mes check (frequencia <> 'mensal' or dia_mes is not null)
);
create index if not exists inventory_count_plans_tenant_idx on public.inventory_count_plans (tenant_id);
alter table public.inventory_count_plans enable row level security;
drop policy if exists inventory_count_plans_select_membership on public.inventory_count_plans;
create policy inventory_count_plans_select_membership on public.inventory_count_plans
  for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.inventory_count_plans to authenticated;
grant all on public.inventory_count_plans to service_role;

-- ── 4) Pedidos mandados ─────────────────────────────────────────────────────
-- Marca "pedido mandado" para todos os aparelhos (ninguém manda duas vezes). fornecedor = chave do
-- grupo da lista: supplier_id, nome do fornecedor sem cadastro, '__fab' (produzir) ou '__sem'.
create table if not exists public.estoque_pedidos_enviados (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fornecedor text not null,
  fornecedor_nome text,
  itens jsonb not null default '[]'::jsonb,
  enviado_em timestamptz not null default now(),
  enviado_por uuid,
  enviado_por_nome text,
  desfeito_em timestamptz
);
create index if not exists estoque_pedidos_enviados_tenant_idx on public.estoque_pedidos_enviados (tenant_id, enviado_em desc);
alter table public.estoque_pedidos_enviados enable row level security;
drop policy if exists estoque_pedidos_enviados_select_membership on public.estoque_pedidos_enviados;
create policy estoque_pedidos_enviados_select_membership on public.estoque_pedidos_enviados
  for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.estoque_pedidos_enviados to authenticated;
grant all on public.estoque_pedidos_enviados to service_role;

-- ── 5) Escritas (só por RPC) ────────────────────────────────────────────────
create or replace function public.fn_estoque_salvar_config(p_tenant_id uuid, p_dias_compra int, p_dias_previsao int)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.estoque_pode_configurar(p_tenant_id) then
    raise exception 'Sem permissão para configurar o estoque desta loja.' using errcode = '42501';
  end if;
  insert into public.estoque_config (tenant_id, dias_compra, dias_previsao, updated_at, updated_by)
  values (p_tenant_id, p_dias_compra, p_dias_previsao, now(), auth.uid())
  on conflict (tenant_id) do update set
    dias_compra = excluded.dias_compra, dias_previsao = excluded.dias_previsao,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$$;

create or replace function public.fn_estoque_salvar_plano(
  p_tenant_id uuid, p_id uuid, p_nome text, p_frequencia text,
  p_dia_semana smallint, p_dia_mes smallint, p_todos boolean, p_itens uuid[]
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
  v_itens uuid[];
begin
  if not public.estoque_pode_configurar(p_tenant_id) then
    raise exception 'Sem permissão para configurar as contagens desta loja.' using errcode = '42501';
  end if;
  -- Só insumos desta loja (e não excluídos) entram na lista.
  select coalesce(array_agg(i.id order by i.name), '{}') into v_itens
    from public.ingredients i
   where i.tenant_id = p_tenant_id and i.deleted_at is null and i.id = any(coalesce(p_itens, '{}'));
  if not coalesce(p_todos, false) and cardinality(v_itens) = 0 then
    raise exception 'Escolha pelo menos um insumo para esta contagem.';
  end if;
  if p_id is null then
    insert into public.inventory_count_plans (tenant_id, nome, frequencia, dia_semana, dia_mes, todos, itens, created_by)
    values (p_tenant_id, btrim(p_nome), p_frequencia,
            case when p_frequencia = 'semanal' then p_dia_semana end,
            case when p_frequencia = 'mensal' then p_dia_mes end,
            coalesce(p_todos, false), case when coalesce(p_todos, false) then '{}' else v_itens end, auth.uid())
    returning id into v_id;
  else
    update public.inventory_count_plans set
      nome = btrim(p_nome), frequencia = p_frequencia,
      dia_semana = case when p_frequencia = 'semanal' then p_dia_semana end,
      dia_mes = case when p_frequencia = 'mensal' then p_dia_mes end,
      todos = coalesce(p_todos, false),
      itens = case when coalesce(p_todos, false) then '{}' else v_itens end,
      updated_at = now()
     where id = p_id and tenant_id = p_tenant_id
    returning id into v_id;
    if v_id is null then raise exception 'Contagem não encontrada nesta loja.'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.fn_estoque_apagar_plano(p_tenant_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.estoque_pode_configurar(p_tenant_id) then
    raise exception 'Sem permissão para configurar as contagens desta loja.' using errcode = '42501';
  end if;
  delete from public.inventory_count_plans where id = p_id and tenant_id = p_tenant_id;
end;
$$;

-- Qualquer pessoa da loja manda o pedido (a supervisão no dia a dia).
create or replace function public.fn_estoque_registrar_pedido(p_tenant_id uuid, p_fornecedor text, p_fornecedor_nome text, p_itens jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not public.auth_is_member_of(p_tenant_id) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;
  insert into public.estoque_pedidos_enviados (tenant_id, fornecedor, fornecedor_nome, itens, enviado_por, enviado_por_nome)
  values (p_tenant_id, p_fornecedor, p_fornecedor_nome, coalesce(p_itens, '[]'::jsonb), auth.uid(),
          (select u.name from public.users u where u.id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fn_estoque_desfazer_pedido(p_tenant_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.auth_is_member_of(p_tenant_id) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;
  update public.estoque_pedidos_enviados set desfeito_em = now()
   where id = p_id and tenant_id = p_tenant_id and desfeito_em is null;
end;
$$;

revoke all on function public.fn_estoque_salvar_config(uuid, int, int) from public, anon;
revoke all on function public.fn_estoque_salvar_plano(uuid, uuid, text, text, smallint, smallint, boolean, uuid[]) from public, anon;
revoke all on function public.fn_estoque_apagar_plano(uuid, uuid) from public, anon;
revoke all on function public.fn_estoque_registrar_pedido(uuid, text, text, jsonb) from public, anon;
revoke all on function public.fn_estoque_desfazer_pedido(uuid, uuid) from public, anon;
grant execute on function public.fn_estoque_salvar_config(uuid, int, int) to authenticated, service_role;
grant execute on function public.fn_estoque_salvar_plano(uuid, uuid, text, text, smallint, smallint, boolean, uuid[]) to authenticated, service_role;
grant execute on function public.fn_estoque_apagar_plano(uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_estoque_registrar_pedido(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.fn_estoque_desfazer_pedido(uuid, uuid) to authenticated, service_role;

-- ── 6) Leitura única: a situação do estoque da loja ─────────────────────────
-- Uma linha por insumo não excluído (com as regras já calculadas), os planos de contagem, os pedidos
-- mandados nos últimos 7 dias e os totais. É o que o Início do Estoque, o Dashboard e a tela Hoje leem.
create or replace function public.fn_estoque_situacao(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_dias_compra int := 60;
  v_dias_previsao int := 7;
  v_primeira timestamptz;
  v_janela numeric;
  v_insumos jsonb;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not (auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') or public.auth_is_member_of(p_tenant_id)) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;

  select c.dias_compra, c.dias_previsao into v_dias_compra, v_dias_previsao
    from public.estoque_config c where c.tenant_id = p_tenant_id;
  v_dias_compra := coalesce(v_dias_compra, 60);
  v_dias_previsao := coalesce(v_dias_previsao, 7);

  -- Dias de histórico de uso: desde a 1ª saída de uso da loja, no máximo 14.
  select min(m.created_at) into v_primeira
    from public.stock_movements m
   where m.tenant_id = p_tenant_id
     and (m.type in ('theoretical_out', 'loss')
          or (m.type = 'manual_out' and coalesce(m.reason, '') !~* '^(estorno|corre|ajuste de contagem)'));
  v_janela := least(14, extract(epoch from (now() - v_primeira)) / 86400.0);
  if v_janela is null or v_janela < 3 then v_janela := null; end if;

  with uso as (
    select m.ingredient_id, -sum(m.signed_quantity) as q
      from public.stock_movements m
     where v_janela is not null
       and m.tenant_id = p_tenant_id
       and m.created_at > now() - interval '14 days'
       and (m.type in ('theoretical_out', 'loss')
            or (m.type = 'manual_out' and coalesce(m.reason, '') !~* '^(estorno|corre|ajuste de contagem)'))
     group by m.ingredient_id
  ),
  contagem as (
    select coalesce(it->>'ingredient_id', it->>'insumoId')::uuid as ingredient_id, max(s.created_at) as ultima
      from public.inventory_sessions s, jsonb_array_elements(s.items) it
     where s.tenant_id = p_tenant_id and s.status = 'confirmado'
       and coalesce(it->>'ingredient_id', it->>'insumoId') ~ '^[0-9a-f-]{36}$'
     group by 1
  ),
  base as (
    select i.*,
           coalesce(i.track_stock, true) as acompanha,
           case when v_janela is not null then greatest(coalesce(u.q, 0), 0) / v_janela end as consumo_dia,
           c.ultima,
           fs.name as fs_nome, fs.phone as fs_fone,
           exists (select 1 from public.production_recipes r
                    where r.tenant_id = p_tenant_id and r.output_ingredient_id = i.id) as produzido
      from public.ingredients i
      left join uso u on u.ingredient_id = i.id
      left join contagem c on c.ingredient_id = i.id
      left join public.fin_suppliers fs on fs.id = i.supplier_id
     where i.tenant_id = p_tenant_id and i.deleted_at is null
  ),
  calc as (
    select b.*,
           public.insumo_abaixo_minimo(b.acompanha, b.min_stock, b.current_stock) as abaixo,
           public.insumo_esgotado(b.acompanha, b.current_stock, b.is_depleted) as esgot,
           case when b.consumo_dia > 0 then greatest(b.current_stock, 0) / b.consumo_dia end as dias_rest
      from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'nome', c.name,
           'unidade', c.unit::text,
           'categoria', nullif(c.category, ''),
           'fornecedor_id', c.supplier_id,
           'fornecedor', coalesce(nullif(c.fs_nome, ''), nullif(c.supplier, '')),
           'fornecedor_fone', nullif(regexp_replace(coalesce(c.fs_fone, ''), '\D', '', 'g'), ''),
           'produzido', c.produzido,
           'estoque', c.current_stock,
           'minimo', coalesce(c.min_stock, 0),
           'marcado_esgotado', coalesce(c.is_depleted, false),
           'acompanha', c.acompanha,
           'conta_inventario', coalesce(c.count_inventory, true),
           'unidade_contagem', c.count_unit,
           'fator_contagem', c.count_factor,
           'preco', coalesce(nullif(c.unit_price, 0), c.last_purchase_price, 0),
           'unidade_compra', nullif(c.purchase_unit, ''),
           'fator_compra', coalesce(c.purchase_factor, 1),
           'consumo_dia', round(c.consumo_dia, 6),
           'dias_restantes', round(c.dias_rest, 2),
           'ultima_contagem', c.ultima,
           'abaixo_minimo', c.abaixo,
           'esgotado', c.esgot,
           'vai_faltar', (c.acompanha and coalesce(c.consumo_dia, 0) > 0 and not c.abaixo and c.dias_rest <= v_dias_previsao)
         ) order by c.name), '[]'::jsonb)
    into v_insumos
    from calc c;

  return jsonb_build_object(
    'hoje', v_hoje,
    'config', jsonb_build_object(
      'dias_compra', v_dias_compra,
      'dias_previsao', v_dias_previsao,
      'pode_configurar', public.estoque_pode_configurar(p_tenant_id)
    ),
    'janela_dias', round(v_janela, 1),
    'insumos', v_insumos,
    'planos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'frequencia', p.frequencia, 'dia_semana', p.dia_semana,
               'dia_mes', p.dia_mes, 'todos', p.todos, 'itens', to_jsonb(p.itens), 'created_at', p.created_at
             ) order by p.created_at)
        from public.inventory_count_plans p where p.tenant_id = p_tenant_id), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'fornecedor', e.fornecedor, 'fornecedor_nome', e.fornecedor_nome, 'itens', e.itens,
               'enviado_em', e.enviado_em, 'enviado_por_nome', e.enviado_por_nome
             ) order by e.enviado_em desc)
        from public.estoque_pedidos_enviados e
       where e.tenant_id = p_tenant_id and e.desfeito_em is null and e.enviado_em > now() - interval '7 days'), '[]'::jsonb),
    'totais', (
      select jsonb_build_object(
               'abaixo_minimo', count(*) filter (where (x->>'abaixo_minimo')::boolean),
               'esgotados', count(*) filter (where (x->>'esgotado')::boolean),
               'zerados_abaixo', count(*) filter (where (x->>'abaixo_minimo')::boolean and (x->>'esgotado')::boolean),
               'vai_faltar', count(*) filter (where (x->>'vai_faltar')::boolean)
             )
        from jsonb_array_elements(v_insumos) x)
  );
end;
$$;
revoke all on function public.fn_estoque_situacao(uuid) from public, anon;
grant execute on function public.fn_estoque_situacao(uuid) to authenticated, service_role;
