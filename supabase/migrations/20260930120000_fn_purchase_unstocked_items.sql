-- Trilha › "Acertar estoque": itens de UMA compra recebida que ficaram fora do estoque,
-- para escolher ali mesmo (no cartão) se entram ou não. Mesma base da Classificação de itens
-- (fn_item_unstocked_base) e mesma regra de "contagem depois" de fn_item_unstocked_receipts;
-- a gravação continua em fn_item_stock_late_entry (por item da classificação).
create or replace function public.fn_purchase_unstocked_items(p_tenant uuid, p_purchase uuid)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v json;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant) then
    raise exception 'Sem acesso a esta loja';
  end if;

  select coalesce(json_agg(x order by x.description), '[]'::json) into v
    from (
      select i.id as purchase_item_id, c.id as classification_id, b.received_at,
             i.description, i.unit_label,
             coalesce(i.received_quantity, i.quantity) as quantidade,
             coalesce(i.received_total_price, i.total_price) as valor,
             coalesce(nullif(c.units_per_package, 0), 1) as upp,
             g.name as insumo, g.unit as insumo_unit,
             (inv.em is not null) as inventario_depois,
             inv.em as inventario_em
        from public.fn_item_unstocked_base(p_tenant) b
        join public.fin_purchase_items i on i.id = b.purchase_item_id
        join public.fin_item_classifications c on c.id = b.classification_id
        join public.ingredients g on g.id = c.ingredient_id and g.tenant_id = p_tenant and g.deleted_at is null
        left join lateral (
          select min(z.t) as em from (
            select s.created_at as t from public.inventory_sessions s
             where s.tenant_id = p_tenant and s.status = 'confirmado' and s.created_at > b.received_at
               and exists (select 1 from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) e
                            where coalesce(e->>'insumoId', e->>'ingredient_id') = c.ingredient_id::text)
            union all
            select m.created_at from public.stock_movements m
             where m.tenant_id = p_tenant and m.ingredient_id = c.ingredient_id
               and m.type = 'inventory_adjustment' and m.created_at > b.received_at
          ) z
        ) inv on true
       where b.purchase_id = p_purchase
         and c.units_per_package > 0
    ) x;
  return v;
end $$;

revoke all on function public.fn_purchase_unstocked_items(uuid, uuid) from public, anon;
grant execute on function public.fn_purchase_unstocked_items(uuid, uuid) to authenticated;
