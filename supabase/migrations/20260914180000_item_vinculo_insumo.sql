-- Vincular produto do fornecedor a insumo do estoque pela Classificação de itens (2026-09-14).
-- Antes o vínculo só era feito no recebimento da compra (purchase-confirm-delivery) ou nas Notas
-- de entrada (fiscal-inbound), que memorizam em fiscal_inbound_item_links (CNPJ + código do produto).
-- Aqui:
--   fin_item_classifications.units_per_package  quantas unidades do insumo vêm em 1 unidade do item
--   fn_item_link_options(tenant)                insumos da loja por VÍNCULO (a RLS de ingredients usa
--                                               auth_tenant_id = última loja e falha para admin multi-loja)
--   fn_item_link_ingredient(tenant, id, insumo, fator)
--       vincula (ou desvincula com insumo nulo): item vira CMV na categoria do insumo, memoriza em
--       fiscal_inbound_item_links quando há CNPJ e código (as próximas notas/recebimentos já vêm com o
--       insumo) e corrige a categoria das compras já lançadas na DRE. NÃO mexe no estoque de compras
--       antigas (o estoque só entra no recebimento).

alter table public.fin_item_classifications add column if not exists units_per_package numeric;
alter table public.fin_item_classifications drop constraint if exists fin_item_classifications_upp_chk;
alter table public.fin_item_classifications add constraint fin_item_classifications_upp_chk
  check (units_per_package is null or units_per_package > 0);

create or replace function public.fn_item_link_options(p_tenant uuid)
returns table (id uuid, name text, unit text, merchandise_category_id uuid, category text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.name, i.unit::text, i.merchandise_category_id, i.category
    from public.ingredients i
   where i.tenant_id = p_tenant and i.deleted_at is null
     and exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant)
   order by i.name
$$;
revoke all on function public.fn_item_link_options(uuid) from public, anon;
grant execute on function public.fn_item_link_options(uuid) to authenticated;

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
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant and ut.role::text in ('admin', 'manager')) then
    raise exception 'Apenas administradores podem vincular itens';
  end if;
  select * into f from public.fin_item_classifications where tenant_id = p_tenant and id = p_id;
  if f.id is null then raise exception 'Item não encontrado'; end if;
  -- Memória do recebimento/notas é por CNPJ + código do produto
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
  select i.id, i.merchandise_category_id into ing
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

  -- Compras já lançadas deste item: CMV na categoria do insumo (o estoque delas não muda)
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

  return json_build_object('vinculado', true, 'memorizado', v_memo, 'lancamentos_atualizados', n_lanc);
end $function$;
revoke all on function public.fn_item_link_ingredient(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.fn_item_link_ingredient(uuid, uuid, uuid, numeric) to authenticated;
