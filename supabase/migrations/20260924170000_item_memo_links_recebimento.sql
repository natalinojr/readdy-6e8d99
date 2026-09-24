-- Vínculo item → insumo pela Classificação de itens, para o RECEBIMENTO (2026-09-24).
-- Segunda fonte do _shared/vinculos-memorizados.ts (a primeira é fiscal_inbound_item_links por
-- CNPJ + código / EAN). Cobre fornecedor sem CNPJ cadastrado e item sem código, porque a
-- classificação é por supplier_key + item_key (as mesmas chaves de fn_item_supplier_key/fn_item_key).
-- Fator (units_per_package): o do vínculo feito na Classificação; sem ele, o da última compra
-- desse item já ligada ao mesmo insumo. Sem fator conhecido o item NÃO é ligado (fator errado
-- lançaria quantidade errada no estoque). Só service_role (chamada pelas Edges de recebimento).

create or replace function public.fn_item_memo_links(p_tenant uuid, p_purchase uuid)
returns table (purchase_item_id uuid, ingredient_id uuid, units_per_package numeric)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with its as (
    select i.id, public.fn_item_supplier_key(s.cnpj, pu.supplier) as sk, public.fn_item_key(i.supplier_code, i.description) as ik
      from public.fin_purchase_items i
      join public.fin_purchases pu on pu.id = i.purchase_id and pu.tenant_id = p_tenant
      left join public.fin_suppliers s on s.id = pu.supplier_id
     where i.purchase_id = p_purchase and i.tenant_id = p_tenant and i.ingredient_id is null
       and coalesce(i.description, '') not like 'Acréscimos da nota%'
  )
  select its.id, c.ingredient_id, coalesce(c.units_per_package, h.upp)
    from its
    join public.fin_item_classifications c
      on c.tenant_id = p_tenant and c.supplier_key = its.sk and c.item_key = its.ik and c.ingredient_id is not null
    join public.ingredients g on g.id = c.ingredient_id and g.tenant_id = p_tenant and g.deleted_at is null
    left join lateral (
      select nullif(x.units_per_package, 0) as upp
        from public.fin_purchase_items x
        join public.fin_purchases px on px.id = x.purchase_id
        left join public.fin_suppliers sx on sx.id = px.supplier_id
       where x.tenant_id = p_tenant and x.ingredient_id = c.ingredient_id and x.units_per_package is not null
         and public.fn_item_supplier_key(sx.cnpj, px.supplier) = its.sk
         and public.fn_item_key(x.supplier_code, x.description) = its.ik
       order by px.purchase_date desc, px.created_at desc
       limit 1
    ) h on true
   where coalesce(c.units_per_package, h.upp) is not null
$$;
revoke all on function public.fn_item_memo_links(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_item_memo_links(uuid, uuid) to service_role;
