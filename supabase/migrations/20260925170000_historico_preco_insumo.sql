-- Histórico de preço do insumo (Estoque › linha expandida e modal do insumo) (dono, 2026-09-25).
-- Antes vinha de purchase-write/list_purchase_prices: só compras LIGADAS (ingredient_id) e no preço da
-- embalagem da nota (R$ 240,75 a caixa), não por unidade do estoque. Agora usa a mesma base do preço
-- automático (fn_ingredient_cost_from_purchases): compras ligadas + compras antigas dos itens vinculados
-- na Classificação de itens, custo por unidade do estoque com frete, últimos 3 meses, sem bonificação.

create or replace function public.fn_ingredient_price_history(p_tenant uuid, p_ingredient uuid)
returns table (date date, price numeric, supplier text)
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
    select fp.purchase_date, fp.supplier, fpi.quantity * coalesce(nullif(fpi.units_per_package, 0), 1) as qtd,
           coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0) as custo
      from public.fin_purchase_items fpi
      join public.fin_purchases fp on fp.id = fpi.purchase_id
     where fp.tenant_id = p_tenant and fpi.ingredient_id = p_ingredient and not coalesce(fp.is_bonus, false)
    union all
    select fp.purchase_date, fp.supplier, fpi.quantity * l.upp,
           coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0)
      from public.fin_purchase_items fpi
      join public.fin_purchases fp on fp.id = fpi.purchase_id
      left join public.fin_suppliers s on s.id = fp.supplier_id
      join links l on l.supplier_key = public.fn_item_supplier_key(s.cnpj, fp.supplier)
                  and l.item_key = public.fn_item_key(fpi.supplier_code, fpi.description)
     where fpi.tenant_id = p_tenant and fp.tenant_id = p_tenant and fpi.ingredient_id is null
       and not coalesce(fp.is_bonus, false)
       and coalesce(fpi.description, '') not like 'Acréscimos da nota%'
  )
  select i.purchase_date, round(i.custo / i.qtd, 6), coalesce(i.supplier, '')
    from itens i
   where i.qtd > 0 and i.custo > 0
     and i.purchase_date >= (current_date - interval '3 months')
     and exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant)
   order by i.purchase_date, i.supplier
   limit 100
$$;
revoke all on function public.fn_ingredient_price_history(uuid, uuid) from public, anon;
grant execute on function public.fn_ingredient_price_history(uuid, uuid) to authenticated;
