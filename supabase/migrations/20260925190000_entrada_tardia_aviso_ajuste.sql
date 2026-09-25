-- Entrada tardia: o aviso "teve inventário depois" também vale para ajuste de inventário feito direto
-- no insumo (stock_movements.type = 'inventory_adjustment'), não só para sessão de Inventário confirmada.
-- Caso real (dono, 2026-09-25): Bacon Crocante recebido 22/09 20h02 e ajustado para 4,5 kg às 20h22 —
-- a tela não avisou e dar entrada contaria a caixa em dobro. Devolve também a data do ajuste/inventário.

create or replace function public.fn_item_unstocked_receipts(p_tenant uuid, p_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  f public.fin_item_classifications;
  v json;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant) then
    raise exception 'Sem acesso a esta loja';
  end if;
  select * into f from public.fin_item_classifications where tenant_id = p_tenant and id = p_id;
  if f.id is null then raise exception 'Item não encontrado'; end if;

  select coalesce(json_agg(x order by x.received_at desc), '[]'::json) into v
    from (
      select i.id as purchase_item_id, pu.id as purchase_id, pu.supplier, pu.invoice_number, pu.purchase_date,
             b.received_at, i.description, i.unit_label,
             coalesce(i.received_quantity, i.quantity) as quantidade,
             coalesce(i.received_total_price, i.total_price) as valor,
             -- Contagem depois do recebimento (Inventário confirmado OU ajuste de inventário no insumo):
             -- a contagem já acertou o estoque, dar entrada contaria em dobro
             (inv.em is not null) as inventario_depois,
             inv.em as inventario_em
        from public.fn_item_unstocked_base(p_tenant) b
        join public.fin_purchase_items i on i.id = b.purchase_item_id
        join public.fin_purchases pu on pu.id = b.purchase_id
        left join lateral (
          select min(z.t) as em from (
            select s.created_at as t from public.inventory_sessions s
             where f.ingredient_id is not null and s.tenant_id = p_tenant and s.status = 'confirmado' and s.created_at > b.received_at
               and exists (select 1 from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) e
                            where e->>'insumoId' = f.ingredient_id::text)
            union all
            select m.created_at from public.stock_movements m
             where f.ingredient_id is not null and m.ingredient_id = f.ingredient_id
               and m.type = 'inventory_adjustment' and m.created_at > b.received_at
          ) z
        ) inv on true
       where b.classification_id = f.id
    ) x;
  return v;
end $$;
revoke all on function public.fn_item_unstocked_receipts(uuid, uuid) from public, anon;
grant execute on function public.fn_item_unstocked_receipts(uuid, uuid) to authenticated;
