-- Estoque › layout novo (2026-10-04, protótipo docs/prototipos/estoque-abas-proposta.html aprovado pelo dono).
-- Leituras e escritas pequenas que as telas novas usam. Nenhuma regra de estoque muda aqui.
--
-- 1) fn_get_stock_movements devolve também signed_quantity (ajuste de contagem aparece com + ou − de verdade).
-- 2) fn_estoque_mov_resumo: números da aba Movimentações pelo período inteiro (antes somava só as 500 linhas
--    carregadas) + baixas de venda agrupadas por dia (uma linha por dia na lista).
-- 3) fn_estoque_entrou_saiu: quanto entrou e saiu de cada insumo depois de um horário (Estoque teórico:
--    "contado na última contagem × hoje").
-- 4) fn_estoque_ficha_insumo: pratos que usam o insumo + últimas movimentações (Ficha do insumo).
-- 5) fn_estoque_fornecedores / fn_estoque_arrumar_insumo: "Quem vende?", mínimo e preço pelo Estoque, para quem
--    configura o estoque (estoque_pode_configurar), sem abrir fin_suppliers (RESTRICTIVE só Financeiro).
-- 6) fn_estoque_fornecedor_fone: "Pôr WhatsApp" do fornecedor (só admin e Supervisor/gerente).

-- ── 1) Movimentações com sinal ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_stock_movements(p_tenant_id uuid, p_limit integer DEFAULT 500, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ingredient_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_types text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  q text := nullif(extensions.unaccent(lower(btrim(coalesce(p_search, '')))), '');
begin
  perform public._assert_tenant_access(p_tenant_id);
  return (
    select coalesce(json_agg(row_to_json(t)), '[]'::json)
    from (
      select sm.id,
             sm.ingredient_id,
             i.name as ingredient_name,
             coalesce(sm.unit, i.unit::text) as ingredient_unit,
             sm.type::text,
             sm.quantity,
             sm.signed_quantity,
             sm.reason,
             sm.notes,
             sm.order_id,
             o.number as order_number,
             case
               when sm.reason like 'item_sale:%' then (
                 select oi.item_name from order_items oi
                  where oi.order_id = sm.order_id and oi.item_id = split_part(sm.reason, ':', 2)::uuid limit 1)
               when sm.reason like 'combo_sale:%' then (
                 select oi.item_name from order_items oi
                  where oi.order_id = sm.order_id and oi.combo_id = split_part(sm.reason, ':', 2)::uuid limit 1)
               else null
             end as sold_item_name,
             sm.operator_id,
             u.name as operator_name,
             sm.created_at
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
      left join users u on u.id = sm.operator_id
      left join orders o on o.id = sm.order_id
      where sm.tenant_id = p_tenant_id
        and (p_ingredient_id is null or sm.ingredient_id = p_ingredient_id)
        and (p_date_from is null or sm.created_at >= p_date_from)
        and (p_date_to is null or sm.created_at <= p_date_to)
        and (p_types is null or sm.type::text = any(p_types))
        and (q is null or extensions.unaccent(lower(
              coalesce(i.name, '') || ' ' || coalesce(sm.reason, '') || ' ' || coalesce(sm.notes, '') || ' ' || coalesce(u.name, '')
            )) like '%' || q || '%')
      order by sm.created_at desc
      limit p_limit
    ) t
  );
end;
$function$;

-- ── 2) Resumo das movimentações do período ───────────────────────────────────
create or replace function public.fn_estoque_mov_resumo(p_tenant_id uuid, p_de timestamptz default null, p_ate timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v jsonb;
  v_dias jsonb;
begin
  perform public._assert_tenant_access(p_tenant_id);

  with m as (
    select sm.type::text as tipo, sm.quantity, sm.signed_quantity, coalesce(sm.reason, '') as motivo, sm.order_id,
           sm.production_batch_id, sm.created_at,
           coalesce(nullif(i.unit_price, 0), i.last_purchase_price, 0) as preco
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
     where sm.tenant_id = p_tenant_id
       and (p_de is null or sm.created_at >= p_de)
       and (p_ate is null or sm.created_at <= p_ate)
  )
  select jsonb_build_object(
    -- mercadoria que entrou (compra, entrada manual); sem volta de venda cancelada, produção e estorno
    'entradas', count(*) filter (where tipo = 'in' and order_id is null and production_batch_id is null
                                   and motivo !~* '^(estorno|entrada \(produ)'),
    'entradas_custo', round(coalesce(sum(quantity * preco) filter (where tipo = 'in' and order_id is null
                                   and production_batch_id is null and motivo !~* '^(estorno|entrada \(produ)'), 0), 2),
    'vendas', count(*) filter (where tipo = 'theoretical_out'),
    'vendas_custo', round(coalesce(sum(quantity * preco) filter (where tipo = 'theoretical_out'), 0), 2),
    'saidas', count(*) filter (where tipo = 'manual_out' and production_batch_id is null and motivo !~* '^(estorno|sa[ií]da \(produ)'),
    'perdas', count(*) filter (where tipo = 'loss' and coalesce(signed_quantity, -1) <> 0),
    'perdas_custo', round(coalesce(sum(quantity * preco) filter (where tipo = 'loss' and coalesce(signed_quantity, -1) <> 0), 0), 2),
    'producoes', count(distinct production_batch_id) filter (where production_batch_id is not null),
    'ajustes_contagem', count(*) filter (where tipo = 'inventory_adjustment')
  ) into v from m;

  -- Baixas de venda por dia (Brasília): uma linha por dia na lista.
  select coalesce(jsonb_agg(d order by d->>'dia' desc), '[]'::jsonb) into v_dias from (
    select jsonb_build_object(
             'dia', (sm.created_at at time zone 'America/Sao_Paulo')::date,
             'linhas', count(*),
             'pedidos', count(distinct sm.order_id),
             'custo', round(sum(sm.quantity * coalesce(nullif(i.unit_price, 0), i.last_purchase_price, 0)), 2)
           ) as d
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
     where sm.tenant_id = p_tenant_id and sm.type = 'theoretical_out'
       and (p_de is null or sm.created_at >= p_de)
       and (p_ate is null or sm.created_at <= p_ate)
     group by (sm.created_at at time zone 'America/Sao_Paulo')::date
  ) z;

  return v || jsonb_build_object('vendas_por_dia', v_dias);
end;
$$;
revoke all on function public.fn_estoque_mov_resumo(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_estoque_mov_resumo(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ── 3) Entrou / saiu depois de um horário ────────────────────────────────────
create or replace function public.fn_estoque_entrou_saiu(p_tenant_id uuid, p_desde timestamptz)
returns table(ingredient_id uuid, entrou numeric, saiu numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._assert_tenant_access(p_tenant_id);
  return query
    select sm.ingredient_id,
           coalesce(sum(sm.signed_quantity) filter (where sm.signed_quantity > 0), 0),
           coalesce(-sum(sm.signed_quantity) filter (where sm.signed_quantity < 0), 0)
      from stock_movements sm
     where sm.tenant_id = p_tenant_id and sm.created_at > p_desde
     group by sm.ingredient_id;
end;
$$;
revoke all on function public.fn_estoque_entrou_saiu(uuid, timestamptz) from public, anon;
grant execute on function public.fn_estoque_entrou_saiu(uuid, timestamptz) to authenticated, service_role;

-- ── 4) Ficha do insumo ───────────────────────────────────────────────────────
create or replace function public.fn_estoque_ficha_insumo(p_tenant_id uuid, p_ingredient_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._assert_tenant_access(p_tenant_id);
  if not exists (select 1 from ingredients where id = p_ingredient_id and tenant_id = p_tenant_id) then
    raise exception 'Insumo não encontrado nesta loja.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pratos', coalesce((
      select jsonb_agg(jsonb_build_object('id', mi.id, 'nome', mi.name) order by mi.name)
        from (select distinct ii.item_id from item_ingredients ii
               where ii.tenant_id = p_tenant_id and ii.ingredient_id = p_ingredient_id) x
        join menu_items mi on mi.id = x.item_id and mi.deleted_at is null
    ), '[]'::jsonb),
    'movimentos', coalesce((
      select jsonb_agg(m order by m->>'created_at' desc) from (
        select jsonb_build_object(
                 'id', sm.id, 'tipo', sm.type::text, 'quantidade', sm.quantity, 'sinal', sm.signed_quantity,
                 'motivo', sm.reason, 'created_at', sm.created_at, 'operador', u.name, 'pedido', o.number,
                 'prato', case when sm.reason like 'item_sale:%' then (
                            select oi.item_name from order_items oi
                             where oi.order_id = sm.order_id and oi.item_id = split_part(sm.reason, ':', 2)::uuid limit 1)
                          end
               ) as m
          from stock_movements sm
          left join users u on u.id = sm.operator_id
          left join orders o on o.id = sm.order_id
         where sm.tenant_id = p_tenant_id and sm.ingredient_id = p_ingredient_id
         order by sm.created_at desc
         limit 8
      ) z
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.fn_estoque_ficha_insumo(uuid, uuid) from public, anon;
grant execute on function public.fn_estoque_ficha_insumo(uuid, uuid) to authenticated, service_role;

-- ── 5) Fornecedores e "arrumar" o insumo ─────────────────────────────────────
create or replace function public.fn_estoque_fornecedores(p_tenant_id uuid)
returns table(id uuid, nome text, fone text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.estoque_pode_configurar(p_tenant_id) then
    raise exception 'Só quem configura o estoque escolhe o fornecedor.' using errcode = '42501';
  end if;
  return query
    select s.id, s.name, nullif(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), '')
      from fin_suppliers s
     where s.tenant_id = p_tenant_id and s.deleted_at is null and coalesce(s.is_active, true)
     order by s.name;
end;
$$;
revoke all on function public.fn_estoque_fornecedores(uuid) from public, anon;
grant execute on function public.fn_estoque_fornecedores(uuid) to authenticated, service_role;

-- Muda só o que vier preenchido (null = mantém). Não mexe no estoque atual (ao contrário do
-- upsert_ingredient, que regrava a linha inteira).
create or replace function public.fn_estoque_arrumar_insumo(
  p_tenant_id uuid, p_ingredient_id uuid,
  p_supplier_id uuid default null, p_min_stock numeric default null, p_unit_price numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_nome text;
begin
  if not public.estoque_pode_configurar(p_tenant_id) then
    raise exception 'Só quem configura o estoque pode mudar fornecedor, mínimo e preço.' using errcode = '42501';
  end if;
  if not exists (select 1 from ingredients where id = p_ingredient_id and tenant_id = p_tenant_id and deleted_at is null) then
    raise exception 'Insumo não encontrado nesta loja.' using errcode = '42501';
  end if;
  if p_min_stock is not null and p_min_stock < 0 then
    raise exception 'O mínimo não pode ser negativo.';
  end if;
  if p_unit_price is not null and p_unit_price < 0 then
    raise exception 'O preço não pode ser negativo.';
  end if;
  if p_supplier_id is not null then
    select name into v_nome from fin_suppliers where id = p_supplier_id and tenant_id = p_tenant_id and deleted_at is null;
    if v_nome is null then
      raise exception 'Fornecedor não encontrado nesta loja.' using errcode = '42501';
    end if;
  end if;

  update ingredients
     set supplier_id = coalesce(p_supplier_id, supplier_id),
         supplier = case when p_supplier_id is not null then v_nome else supplier end,
         min_stock = coalesce(p_min_stock, min_stock),
         unit_price = coalesce(p_unit_price, unit_price),
         price_source = case when p_unit_price is not null then 'manual' else price_source end,
         updated_at = now()
   where id = p_ingredient_id and tenant_id = p_tenant_id;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.fn_estoque_arrumar_insumo(uuid, uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.fn_estoque_arrumar_insumo(uuid, uuid, uuid, numeric, numeric) to authenticated, service_role;

-- ── 6) WhatsApp do fornecedor ────────────────────────────────────────────────
create or replace function public.fn_estoque_fornecedor_fone(p_tenant_id uuid, p_supplier_id uuid, p_fone text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_fone text := regexp_replace(coalesce(p_fone, ''), '\D', '', 'g');
begin
  if not exists (select 1 from user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant_id
                   and ut.role::text in ('admin', 'manager')) then
    raise exception 'Só o dono ou o Supervisor muda o WhatsApp do fornecedor.' using errcode = '42501';
  end if;
  if length(v_fone) < 10 or length(v_fone) > 13 then
    raise exception 'Número inválido: use DDD + número (ex.: 41 99999-9999).';
  end if;
  update fin_suppliers set phone = v_fone, updated_at = now()
   where id = p_supplier_id and tenant_id = p_tenant_id and deleted_at is null;
  if not found then
    raise exception 'Fornecedor não encontrado nesta loja.' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'fone', v_fone);
end;
$$;
revoke all on function public.fn_estoque_fornecedor_fone(uuid, uuid, text) from public, anon;
grant execute on function public.fn_estoque_fornecedor_fone(uuid, uuid, text) to authenticated, service_role;
