-- Estoque › Início: "Pôr na lista" gravado (2026-10-03, dono: "cliquei em pôr na lista e sumiu").
-- Antes ficava só na tela de quem clicou e sumia ao recarregar. Agora vale para todos os aparelhos e sai
-- sozinho quando a mercadoria chega (entrada depois de posto na lista). fn_estoque_situacao devolve
-- `na_lista` por insumo, `totais.na_lista`, e "vai faltar" deixa de contar quem já está na lista.

create table if not exists public.estoque_lista_extras (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  primary key (tenant_id, ingredient_id)
);
alter table public.estoque_lista_extras enable row level security;
drop policy if exists estoque_lista_extras_select_membership on public.estoque_lista_extras;
create policy estoque_lista_extras_select_membership on public.estoque_lista_extras
  for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.estoque_lista_extras to authenticated;
grant all on public.estoque_lista_extras to service_role;

-- Põe (p_incluir = true) ou tira o insumo da lista de compras. Qualquer pessoa da loja.
create or replace function public.fn_estoque_lista_extra(p_tenant_id uuid, p_ingredient_id uuid, p_incluir boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.auth_is_member_of(p_tenant_id) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ingredients where id = p_ingredient_id and tenant_id = p_tenant_id and deleted_at is null) then
    raise exception 'Insumo não encontrado nesta loja.';
  end if;
  if coalesce(p_incluir, true) then
    insert into public.estoque_lista_extras (tenant_id, ingredient_id, criado_em, criado_por)
    values (p_tenant_id, p_ingredient_id, now(), auth.uid())
    on conflict (tenant_id, ingredient_id) do update set criado_em = now(), criado_por = auth.uid();
  else
    delete from public.estoque_lista_extras where tenant_id = p_tenant_id and ingredient_id = p_ingredient_id;
  end if;
end;
$$;
revoke all on function public.fn_estoque_lista_extra(uuid, uuid, boolean) from public, anon;
grant execute on function public.fn_estoque_lista_extra(uuid, uuid, boolean) to authenticated, service_role;

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
    -- saídas de uso (negativas) + volta de venda cancelada (entrada com order_id, positiva)
    select m.ingredient_id, -sum(m.signed_quantity) as q
      from public.stock_movements m
     where v_janela is not null
       and m.tenant_id = p_tenant_id
       and m.created_at > now() - interval '14 days'
       and (m.type in ('theoretical_out', 'loss')
            or (m.type = 'manual_out' and coalesce(m.reason, '') !~* '^(estorno|corre|ajuste de contagem)')
            or (m.type = 'in' and m.order_id is not null))
     group by m.ingredient_id
  ),
  -- Última chegada de mercadoria/produção (o "pedido mandado" antes dela já foi atendido).
  entrada as (
    select m.ingredient_id, max(m.created_at) as ultima
      from public.stock_movements m
     where m.tenant_id = p_tenant_id and m.type = 'in' and m.order_id is null
       and m.created_at > now() - interval '30 days'
       and coalesce(m.reason, '') !~* '^corre'
     group by m.ingredient_id
  ),
  -- Posto na lista à mão (Vai faltar › Pôr na lista).
  extra as (
    select x.ingredient_id, x.criado_em from public.estoque_lista_extras x where x.tenant_id = p_tenant_id
  ),
  -- Contagens confirmadas dos últimos 400 dias (planos olham no máx. o mês; o resto é só "última contagem").
  contagem as (
    select coalesce(it->>'ingredient_id', it->>'insumoId')::uuid as ingredient_id, max(s.created_at) as ultima
      from public.inventory_sessions s
      cross join lateral jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end) it
     where s.tenant_id = p_tenant_id and s.status = 'confirmado'
       and s.created_at > now() - interval '400 days'
       and coalesce(it->>'ingredient_id', it->>'insumoId') ~ '^[0-9a-f-]{36}$'
     group by 1
  ),
  base as (
    select i.*,
           coalesce(i.track_stock, true) as acompanha,
           case when v_janela is not null then greatest(coalesce(u.q, 0), 0) / v_janela end as consumo_dia,
           c.ultima,
           e.ultima as ultima_entrada,
           x.criado_em as na_lista_desde,
           fs.name as fs_nome, fs.phone as fs_fone,
           exists (select 1 from public.production_recipes r
                    where r.tenant_id = p_tenant_id and r.output_ingredient_id = i.id) as produzido
      from public.ingredients i
      left join uso u on u.ingredient_id = i.id
      left join contagem c on c.ingredient_id = i.id
      left join entrada e on e.ingredient_id = i.id
      left join extra x on x.ingredient_id = i.id
      left join public.fin_suppliers fs on fs.id = i.supplier_id
     where i.tenant_id = p_tenant_id and i.deleted_at is null
  ),
  calc as (
    select b.*,
           public.insumo_abaixo_minimo(b.acompanha, b.min_stock, b.current_stock) as abaixo,
           public.insumo_esgotado(b.acompanha, b.current_stock, b.is_depleted) as esgot,
           case when b.consumo_dia > 0 then greatest(b.current_stock, 0) / b.consumo_dia end as dias_rest,
           (b.na_lista_desde is not null and (b.ultima_entrada is null or b.ultima_entrada < b.na_lista_desde)) as na_lista
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
           'ultima_entrada', c.ultima_entrada,
           'abaixo_minimo', c.abaixo,
           'na_lista', c.na_lista,
           'esgotado', c.esgot,
           'vai_faltar', (c.acompanha and coalesce(c.consumo_dia, 0) > 0 and not c.abaixo and not c.na_lista and c.dias_rest <= v_dias_previsao)
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
               'vai_faltar', count(*) filter (where (x->>'vai_faltar')::boolean),
               'na_lista', count(*) filter (where (x->>'na_lista')::boolean and not (x->>'abaixo_minimo')::boolean)
             )
        from jsonb_array_elements(v_insumos) x)
  );
end;
$$;
revoke all on function public.fn_estoque_situacao(uuid) from public, anon;
grant execute on function public.fn_estoque_situacao(uuid) to authenticated, service_role;
