-- DRE › detalhe da linha › Editar categoria de um ITEM de compra (pedido do dono, 2026-10-05).
-- A classificação mora no item do fornecedor (fin_item_classifications), então trocar pelo DRE
-- reclassifica o item inteiro via fn_item_classify: corrige as compras já lançadas do mesmo item e
-- vale para as próximas notas. Item ligado ao estoque é sempre CMV (só troca a categoria de mercadoria).
-- Sem registro de classificação (compra antiga), grava só neste item.
create or replace function public.fn_dre_reclassificar_item_compra(
  p_tenant uuid, p_item uuid, p_classe text,
  p_dre_category_id uuid default null, p_merchandise_category_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_item record;
  v_class uuid;
  r json;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant and ut.role::text in ('admin', 'manager')) then
    raise exception 'Apenas administradores podem mudar a categoria';
  end if;
  if p_classe not in ('cmv', 'despesa') then raise exception 'Classificação inválida'; end if;

  select i.id, i.ingredient_id, i.supplier_code, i.description, pu.supplier, s.cnpj
    into v_item
    from public.fin_purchase_items i
    join public.fin_purchases pu on pu.id = i.purchase_id
    left join public.fin_suppliers s on s.id = pu.supplier_id
   where i.id = p_item and i.tenant_id = p_tenant;
  if not found then raise exception 'Item não encontrado nesta loja'; end if;

  if v_item.ingredient_id is not null and p_classe = 'despesa' then
    raise exception 'Item ligado ao estoque é sempre CMV. Desfaça o vínculo com o insumo na Classificação de itens.';
  end if;

  select f.id into v_class
    from public.fin_item_classifications f
   where f.tenant_id = p_tenant
     and f.supplier_key = public.fn_item_supplier_key(v_item.cnpj, v_item.supplier)
     and f.item_key = public.fn_item_key(v_item.supplier_code, v_item.description)
   limit 1;

  if v_class is not null and v_item.ingredient_id is null then
    r := public.fn_item_classify(p_tenant, array[v_class], p_classe, p_dre_category_id, p_merchandise_category_id);
    return (jsonb_build_object('modo', 'item_fornecedor') || r::jsonb)::json;
  end if;

  -- Só este lançamento (item ligado ao estoque ou sem registro de classificação): mesmas validações.
  if p_classe = 'despesa' then
    if p_dre_category_id is null then raise exception 'Escolha a categoria da despesa'; end if;
    if not exists (select 1 from public.fin_dre_categories c where c.id = p_dre_category_id and c.tenant_id = p_tenant and c.deleted_at is null
                   and c.group_type not in ('revenue', 'tax', 'cost')) then
      raise exception 'Categoria inválida para despesa';
    end if;
  end if;
  if p_merchandise_category_id is not null and not exists (
      select 1 from public.fin_merchandise_categories m where m.id = p_merchandise_category_id and m.tenant_id = p_tenant) then
    raise exception 'Categoria de mercadoria inválida';
  end if;

  update public.fin_purchase_items i
     set dre_category_id = case when p_classe = 'despesa' then p_dre_category_id end,
         merchandise_category_id = case when p_classe = 'cmv' then coalesce(p_merchandise_category_id, i.merchandise_category_id) else i.merchandise_category_id end
   where i.id = p_item and i.tenant_id = p_tenant;

  return json_build_object('modo', 'so_este', 'itens', 1, 'lancamentos_atualizados', 1, 'contas_atualizadas', 0);
end $$;

revoke all on function public.fn_dre_reclassificar_item_compra(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.fn_dre_reclassificar_item_compra(uuid, uuid, text, uuid, uuid) to authenticated;
