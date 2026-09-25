-- Vínculo na Classificação de itens deixa o preço do insumo AUTOMÁTICO (dono, 2026-09-25).
-- Antes: vincular só valia para as próximas notas; as compras antigas do item (ingredient_id nulo)
-- não entravam no custo e o insumo ficava R$ 0,00 (Bacon Crocante, Barbacoa… da Indústria El Patron).
-- Agora o custo do insumo sai de:
--   • compras ligadas ao insumo (ingredient_id), com a conversão gravada no item; e
--   • compras antigas dos itens vinculados a ele na Classificação (mesmo fornecedor + código),
--     com a conversão do vínculo — SÓ para o custo: o estoque não muda (entrada tardia continua à parte).
-- Regra do valor: média dos últimos 3 meses (bonificação fora); sem compra em 3 meses, a última compra.
-- Vincular troca o preço Manual por automático (pedido do dono).

create or replace function public.fn_ingredient_cost_from_purchases(p_tenant uuid, p_ingredient uuid,
  out avg_price numeric, out n_purchases int, out last_price numeric, out last_date date)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with links as (
    select c.supplier_key, c.item_key, coalesce(nullif(c.units_per_package, 0), 1) as upp
      from public.fin_item_classifications c
     where c.tenant_id = p_tenant and c.ingredient_id = p_ingredient
  ), itens as (
    select fp.id as purchase_id, fp.purchase_date, fpi.quantity * coalesce(nullif(fpi.units_per_package, 0), 1) as qtd,
           coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0) as custo
      from public.fin_purchase_items fpi
      join public.fin_purchases fp on fp.id = fpi.purchase_id
     where fp.tenant_id = p_tenant and fpi.ingredient_id = p_ingredient and not coalesce(fp.is_bonus, false)
    union all
    select fp.id, fp.purchase_date, fpi.quantity * l.upp,
           coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0)
      from public.fin_purchase_items fpi
      join public.fin_purchases fp on fp.id = fpi.purchase_id
      left join public.fin_suppliers s on s.id = fp.supplier_id
      join links l on l.supplier_key = public.fn_item_supplier_key(s.cnpj, fp.supplier)
                  and l.item_key = public.fn_item_key(fpi.supplier_code, fpi.description)
     where fpi.tenant_id = p_tenant and fp.tenant_id = p_tenant and fpi.ingredient_id is null
       and not coalesce(fp.is_bonus, false)
       and coalesce(fpi.description, '') not like 'Acréscimos da nota%'
  ), validos as (
    select * from itens where qtd > 0 and custo > 0
  ), rec as (
    select * from validos where purchase_date >= (current_date - interval '3 months')
  ), ult as (
    select purchase_date, sum(custo) / sum(qtd) as p
      from validos where purchase_date = (select max(purchase_date) from validos)
     group by purchase_date
  )
  select case when exists (select 1 from rec) then (select sum(custo) / nullif(sum(qtd), 0) from rec)
              else (select p from ult) end,
         (select count(distinct purchase_id)::int from rec),
         (select p from ult),
         (select purchase_date from ult)
$$;
revoke all on function public.fn_ingredient_cost_from_purchases(uuid, uuid) from public, anon, authenticated;

-- Aplica o custo calculado no insumo (preço vira automático). Sem compra com valor, não mexe.
create or replace function public.fn_ingredient_apply_purchase_cost(p_tenant uuid, p_ingredient uuid)
returns numeric
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c record;
begin
  select * into c from public.fn_ingredient_cost_from_purchases(p_tenant, p_ingredient);
  if coalesce(c.avg_price, 0) <= 0 then return null; end if;
  update public.ingredients
     set unit_price = round(c.avg_price, 6),
         price_source = case when c.n_purchases > 1 then 'average' else 'purchase' end,
         last_purchase_price = round(c.last_price, 6),
         last_purchase_date = c.last_date,
         updated_at = now()
   where id = p_ingredient and tenant_id = p_tenant and deleted_at is null;
  return round(c.avg_price, 6);
end $$;
revoke all on function public.fn_ingredient_apply_purchase_cost(uuid, uuid) from public, anon, authenticated;

-- Nota nova (purchase-write / purchase-confirm-delivery): a média passa a contar também as compras
-- antigas dos itens vinculados. Com 1 compra só, continua o preço real desta compra.
create or replace function public.fn_update_ingredient_price_from_purchase(p_ingredient_id uuid, p_tenant_id uuid, p_purchase_unit_price numeric, p_purchase_date date)
 returns void
 language plpgsql
as $function$
declare
  c record;
  v_price numeric;
  v_source text;
begin
  select * into c from public.fn_ingredient_cost_from_purchases(p_tenant_id, p_ingredient_id);
  if coalesce(c.n_purchases, 0) <= 1 or coalesce(c.avg_price, 0) <= 0 then
    v_price := p_purchase_unit_price;
    v_source := 'purchase';
  else
    v_price := c.avg_price;
    v_source := 'average';
  end if;

  update ingredients
  set
    unit_price = coalesce(v_price, p_purchase_unit_price),
    price_source = v_source,
    last_purchase_price = p_purchase_unit_price,
    last_purchase_date = p_purchase_date,
    updated_at = now()
  where id = p_ingredient_id
    and tenant_id = p_tenant_id;
end;
$function$;

create or replace function public.fn_item_link_ingredient(p_tenant uuid, p_id uuid, p_ingredient_id uuid, p_units_per_package numeric default 1)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  f public.fin_item_classifications;
  ing record;
  v_upp numeric := coalesce(p_units_per_package, 1);
  v_memo boolean := false;
  v_tem_codigo boolean;
  n int := 0;
  n_lanc int := 0;
  n_conv int := 0;
  v_ajuste numeric := 0;
  v_ult_inv timestamptz;
  it record;
  v_old numeric;
  v_delta numeric;
  v_avg numeric;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant and ut.role::text in ('admin', 'manager')) then
    raise exception 'Apenas administradores podem vincular itens';
  end if;
  select * into f from public.fin_item_classifications where tenant_id = p_tenant and id = p_id;
  if f.id is null then raise exception 'Item não encontrado'; end if;
  v_tem_codigo := f.supplier_key ~ '^\d{14}$' and coalesce(btrim(f.supplier_code), '') <> '';

  if p_ingredient_id is null then
    update public.fin_item_classifications set
        ingredient_id = null, units_per_package = null, auto_classified = false,
        suggestion_reason = case when suggestion_reason = 'ligado a insumo do estoque' then null else suggestion_reason end,
        updated_at = now()
     where id = f.id;
    if v_tem_codigo then
      delete from public.fiscal_inbound_item_links
       where tenant_id = p_tenant and supplier_cnpj = f.supplier_key and supplier_code = f.supplier_code;
      get diagnostics n = row_count;
      v_memo := n > 0;
    end if;
    return json_build_object('vinculado', false, 'memorizado', v_memo, 'lancamentos_atualizados', 0);
  end if;

  if v_upp <= 0 then raise exception 'Informe quantas unidades do insumo vêm em cada unidade do item'; end if;
  select i.id, i.unit::text as unit, i.price_source, i.merchandise_category_id into ing
    from public.ingredients i where i.id = p_ingredient_id and i.tenant_id = p_tenant and i.deleted_at is null;
  if ing.id is null then raise exception 'Insumo não encontrado nesta loja'; end if;

  update public.fin_item_classifications set
      ingredient_id = ing.id, units_per_package = v_upp,
      classe = 'cmv', dre_category_id = null,
      merchandise_category_id = coalesce(ing.merchandise_category_id, merchandise_category_id),
      suggested_classe = 'cmv', suggestion_reason = 'ligado a insumo do estoque', auto_classified = false,
      classified_by = auth.uid(), classified_at = now(), updated_at = now()
   where id = f.id;

  if v_tem_codigo then
    insert into public.fiscal_inbound_item_links
      (tenant_id, supplier_cnpj, supplier_code, ean, description, unit_label, ingredient_id, units_per_package, updated_by, updated_at)
    values (p_tenant, f.supplier_key, f.supplier_code, f.ean, left(f.description, 250), f.unit_label, ing.id, v_upp, auth.uid(), now())
    on conflict (tenant_id, supplier_cnpj, supplier_code) do update set
      ingredient_id = excluded.ingredient_id, units_per_package = excluded.units_per_package,
      ean = coalesce(excluded.ean, fiscal_inbound_item_links.ean), description = excluded.description,
      unit_label = excluded.unit_label, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    v_memo := true;
  end if;

  with alvo as (
    select i.id as item_id
      from public.fin_purchase_items i
      join public.fin_purchases pu on pu.id = i.purchase_id
      left join public.fin_suppliers s on s.id = pu.supplier_id
     where i.tenant_id = p_tenant and i.ingredient_id is null
       and public.fn_item_supplier_key(s.cnpj, pu.supplier) = f.supplier_key
       and public.fn_item_key(i.supplier_code, i.description) = f.item_key
  )
  update public.fin_purchase_items i
     set dre_category_id = null,
         merchandise_category_id = coalesce(ing.merchandise_category_id, i.merchandise_category_id)
    from alvo a
   where i.id = a.item_id
     and (i.dre_category_id is not null
          or (ing.merchandise_category_id is not null and i.merchandise_category_id is distinct from ing.merchandise_category_id));
  get diagnostics n_lanc = row_count;

  -- Compras antigas deste item já ligadas ao insumo com outra conversão: refaz custo e estoque.
  select max(s.created_at) into v_ult_inv
    from public.inventory_sessions s
   where s.tenant_id = p_tenant and s.status = 'confirmado'
     and s.items @> jsonb_build_array(jsonb_build_object('ingredient_id', ing.id::text));

  for it in
    select i.id, i.quantity, i.received_quantity, i.total_price, i.freight_allocated, i.units_per_package, i.stock_skipped_at,
           pu.supplier, pu.invoice_number, pu.stock_applied_at, coalesce(pu.delivery_confirmed_at, pu.stock_applied_at) as recebido_em
      from public.fin_purchase_items i
      join public.fin_purchases pu on pu.id = i.purchase_id
      left join public.fin_suppliers s on s.id = pu.supplier_id
     where i.tenant_id = p_tenant and i.ingredient_id = ing.id
       and public.fn_item_supplier_key(s.cnpj, pu.supplier) = f.supplier_key
       and public.fn_item_key(i.supplier_code, i.description) = f.item_key
       and coalesce(nullif(i.units_per_package, 0), 1) <> v_upp
     for update of i
  loop
    v_old := coalesce(nullif(it.units_per_package, 0), 1);
    if it.stock_applied_at is not null and it.stock_skipped_at is null
       and (v_ult_inv is null or it.recebido_em > v_ult_inv) then
      v_delta := coalesce(it.received_quantity, it.quantity, 0) * (v_upp - v_old);
      if v_delta <> 0 then
        perform public.fn_add_stock_movement(
          p_tenant, ing.id, case when v_delta > 0 then 'in' else 'manual_out' end, abs(v_delta), ing.unit,
          left(format('Correção de conversão: %s - NF %s', coalesce(it.supplier, ''), coalesce(nullif(it.invoice_number, ''), 'S/N')), 250),
          format('1 %s passou de %s para %s %s (Classificação de itens)', coalesce(f.unit_label, 'un'), v_old, v_upp, ing.unit),
          null, auth.uid(), null);
        v_ajuste := v_ajuste + v_delta;
      end if;
    end if;
    update public.fin_purchase_items
       set units_per_package = v_upp,
           cost_per_base_unit = case when coalesce(quantity, 0) * v_upp > 0
             then (coalesce(total_price, 0) + coalesce(freight_allocated, 0)) / (quantity * v_upp) end
     where id = it.id;
    n_conv := n_conv + 1;
  end loop;

  -- Preço do insumo passa a ser automático: custo das notas (inclusive as antigas deste item,
  -- com a conversão do vínculo). O estoque não muda aqui.
  v_avg := public.fn_ingredient_apply_purchase_cost(p_tenant, ing.id);

  return json_build_object('vinculado', true, 'memorizado', v_memo, 'lancamentos_atualizados', n_lanc,
                           'compras_convertidas', n_conv, 'estoque_ajustado', v_ajuste, 'unidade', ing.unit,
                           'ultimo_inventario', v_ult_inv, 'preco', v_avg);
end $function$;

-- Dado errado (Paranaguá): batata Simplot vem em KG na nota, mas o vínculo dizia 1 KG = 15 kg
-- (a próxima nota entraria 225 kg em vez de 15). Nota em kg para insumo em kg = 1.
update public.fin_item_classifications c set units_per_package = 1, updated_at = now()
  from public.ingredients g
 where g.id = c.ingredient_id and c.item_key = 'c:65824' and lower(coalesce(c.unit_label, '')) = 'kg'
   and g.unit::text = 'kg' and c.units_per_package = 15;
update public.fiscal_inbound_item_links l set units_per_package = 1, updated_at = now()
  from public.ingredients g
 where g.id = l.ingredient_id and l.supplier_code = '65824' and lower(coalesce(l.unit_label, '')) = 'kg'
   and g.unit::text = 'kg' and l.units_per_package = 15;

-- Insumos já vinculados na Classificação: preço automático pelas notas agora (36 estavam R$ 0,00).
-- Cópia do valor antigo em _bkp_preco_insumo_20260925.
create table if not exists public._bkp_preco_insumo_20260925 (
  ingredient_id uuid primary key, tenant_id uuid, unit_price numeric, price_source text,
  last_purchase_price numeric, last_purchase_date date);
alter table public._bkp_preco_insumo_20260925 enable row level security;
revoke all on public._bkp_preco_insumo_20260925 from anon, authenticated;

insert into public._bkp_preco_insumo_20260925
select g.id, g.tenant_id, g.unit_price, g.price_source, g.last_purchase_price, g.last_purchase_date
  from public.ingredients g
 where g.deleted_at is null
   and exists (select 1 from public.fin_item_classifications c where c.ingredient_id = g.id and c.tenant_id = g.tenant_id)
on conflict (ingredient_id) do nothing;

select public.fn_ingredient_apply_purchase_cost(b.tenant_id, b.ingredient_id)
  from public._bkp_preco_insumo_20260925 b;
