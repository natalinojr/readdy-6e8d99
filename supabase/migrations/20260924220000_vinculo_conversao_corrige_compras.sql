-- Conversão do vínculo vale para as compras antigas do mesmo item (dono, 2026-09-24).
-- Salvar/corrigir "1 un = 300 g" na Classificação de itens refaz as compras já lançadas desse
-- fornecedor + item que estão ligadas ao mesmo insumo com outra conversão:
--  • custo por unidade do estoque (cost_per_base_unit) e units_per_package do item;
--  • estoque: entra/sai a diferença, só nas compras recebidas DEPOIS do último inventário confirmado
--    que contou o insumo (antes disso a contagem já acertou o saldo);
--  • custo médio do insumo (mesma conta de fn_update_ingredient_price_from_purchase), salvo preço manual.

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

  if n_conv > 0 and coalesce(ing.price_source, '') <> 'manual' then
    select sum(coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0))
             / nullif(sum(fpi.quantity * coalesce(nullif(fpi.units_per_package, 0), 1)), 0)
      into v_avg
      from public.fin_purchase_items fpi
      join public.fin_purchases fp on fp.id = fpi.purchase_id
     where fpi.ingredient_id = ing.id and fp.tenant_id = p_tenant
       and not coalesce(fp.is_bonus, false)
       and fp.purchase_date >= (current_date - interval '3 months');
    if v_avg > 0 then
      update public.ingredients set unit_price = v_avg, updated_at = now() where id = ing.id and tenant_id = p_tenant;
    end if;
  end if;

  return json_build_object('vinculado', true, 'memorizado', v_memo, 'lancamentos_atualizados', n_lanc,
                           'compras_convertidas', n_conv, 'estoque_ajustado', v_ajuste, 'unidade', ing.unit,
                           'ultimo_inventario', v_ult_inv);
end $function$;
