-- Entrada tardia no estoque pela Classificação de itens (2026-09-24).
-- Item recebido sem insumo ligado não entra no estoque, e ligar o insumo depois
-- (fn_item_link_ingredient) só vale para as próximas entregas. Aqui:
--   fin_purchase_items.stock_skipped_at     o usuário decidiu que esse recebimento NÃO entra
--   fn_item_unstocked_summary(tenant)       por item da classificação: quantos recebimentos ficaram
--                                           fora do estoque (item de compra recebido, sem insumo,
--                                           não ignorado) e a data do último
--   fn_item_unstocked_receipts(tenant, id)  esses recebimentos, com aviso de inventário posterior
--                                           (a contagem já acertou o estoque depois daquela data)
--   fn_item_stock_late_entry(tenant, id, entrar[], ignorar[])
--       o usuário escolhe: os de "entrar" ganham a entrada no estoque (quantidade recebida × fator
--       do vínculo) e passam a ter o insumo no item da compra (não aparecem de novo); os de
--       "ignorar" ficam marcados como resolvidos sem mexer no estoque. Nada é escolhido sozinho.
-- Recebido = delivery_confirmed_at (ou stock_applied_at das compras de antes de 2026-09-11,
-- quando o estoque entrava na criação). Linhas "Acréscimos da nota" não são produto.

alter table public.fin_purchase_items add column if not exists stock_skipped_at timestamptz;

-- Recebimentos fora do estoque de uma loja, já casados com o item da classificação
create or replace function public.fn_item_unstocked_base(p_tenant uuid)
returns table (classification_id uuid, purchase_item_id uuid, purchase_id uuid, received_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select c.id, i.id, pu.id, coalesce(pu.delivery_confirmed_at, pu.stock_applied_at)
    from public.fin_purchase_items i
    join public.fin_purchases pu on pu.id = i.purchase_id and pu.tenant_id = p_tenant
    left join public.fin_suppliers s on s.id = pu.supplier_id
    join public.fin_item_classifications c
      on c.tenant_id = p_tenant
     and c.supplier_key = public.fn_item_supplier_key(s.cnpj, pu.supplier)
     and c.item_key = public.fn_item_key(i.supplier_code, i.description)
   where i.tenant_id = p_tenant
     and i.ingredient_id is null
     and i.stock_skipped_at is null
     and (pu.delivery_confirmed_at is not null or pu.stock_applied_at is not null)
     and coalesce(i.description, '') not like 'Acréscimos da nota%'
     and not coalesce(c.is_service, false)
     and c.classe is distinct from 'despesa'
$$;
revoke all on function public.fn_item_unstocked_base(uuid) from public, anon, authenticated;

create or replace function public.fn_item_unstocked_summary(p_tenant uuid)
returns table (classification_id uuid, receipts int, last_received_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select b.classification_id, count(*)::int, max(b.received_at)
    from public.fn_item_unstocked_base(p_tenant) b
   where exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant)
   group by b.classification_id
$$;
revoke all on function public.fn_item_unstocked_summary(uuid) from public, anon;
grant execute on function public.fn_item_unstocked_summary(uuid) to authenticated;

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
             -- Inventário confirmado depois do recebimento: a contagem já acertou o estoque do insumo
             (f.ingredient_id is not null and exists (
               select 1 from public.inventory_sessions s
                where s.tenant_id = p_tenant and s.status = 'confirmado' and s.created_at > b.received_at
                  and exists (select 1 from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) e
                               where e->>'insumoId' = f.ingredient_id::text)
             )) as inventario_depois
        from public.fn_item_unstocked_base(p_tenant) b
        join public.fin_purchase_items i on i.id = b.purchase_item_id
        join public.fin_purchases pu on pu.id = b.purchase_id
       where b.classification_id = f.id
    ) x;
  return v;
end $$;
revoke all on function public.fn_item_unstocked_receipts(uuid, uuid) from public, anon;
grant execute on function public.fn_item_unstocked_receipts(uuid, uuid) to authenticated;

create or replace function public.fn_item_stock_late_entry(p_tenant uuid, p_id uuid, p_entrar uuid[], p_ignorar uuid[])
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  f public.fin_item_classifications;
  v_upp numeric;
  it record;
  v_qtd numeric;
  n_in int := 0;
  n_skip int := 0;
  v_total numeric := 0;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant and ut.role::text in ('admin', 'manager')) then
    raise exception 'Apenas administradores podem dar entrada no estoque por aqui';
  end if;
  select * into f from public.fin_item_classifications where tenant_id = p_tenant and id = p_id for update;
  if f.id is null then raise exception 'Item não encontrado'; end if;
  if coalesce(array_length(p_entrar, 1), 0) > 0 and f.ingredient_id is null then
    raise exception 'Ligue o item a um insumo antes de dar entrada no estoque';
  end if;
  if coalesce(array_length(p_entrar, 1), 0) > 0 and not exists (
    select 1 from public.ingredients g where g.id = f.ingredient_id and g.tenant_id = p_tenant and g.deleted_at is null
  ) then
    raise exception 'O insumo ligado a este item foi excluído';
  end if;
  if exists (select 1 from unnest(coalesce(p_entrar, '{}')) a join unnest(coalesce(p_ignorar, '{}')) b on a = b) then
    raise exception 'Um recebimento não pode entrar e ser ignorado ao mesmo tempo';
  end if;
  v_upp := coalesce(nullif(f.units_per_package, 0), 1);

  -- Só o que ainda está pendente para ESTE item (a trava de linha evita entrada em dobro)
  for it in
    select i.id, i.quantity, i.received_quantity, i.total_price, i.freight_allocated, pu.supplier, pu.invoice_number, b.received_at
      from public.fn_item_unstocked_base(p_tenant) b
      join public.fin_purchase_items i on i.id = b.purchase_item_id
      join public.fin_purchases pu on pu.id = b.purchase_id
     where b.classification_id = f.id and i.id = any(coalesce(p_entrar, '{}'))
     for update of i
  loop
    v_qtd := coalesce(it.received_quantity, it.quantity, 0) * v_upp;
    if v_qtd > 0 then
      perform public.fn_add_stock_movement(
        p_tenant, f.ingredient_id, 'in', v_qtd, null,
        left(format('Compra (entrada tardia): %s - NF %s', coalesce(it.supplier, ''), coalesce(nullif(it.invoice_number, ''), 'S/N')), 250),
        format('recebido em %s; insumo ligado depois pela Classificação de itens; upp=%s',
               to_char(it.received_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), v_upp),
        null, auth.uid(), null);
      v_total := v_total + v_qtd;
    end if;
    update public.fin_purchase_items
       set ingredient_id = f.ingredient_id, units_per_package = v_upp,
           cost_per_base_unit = case when coalesce(quantity, 0) * v_upp > 0
             then (coalesce(total_price, 0) + coalesce(freight_allocated, 0)) / (quantity * v_upp) end
     where id = it.id;
    n_in := n_in + 1;
  end loop;

  update public.fin_purchase_items i
     set stock_skipped_at = now()
    from public.fn_item_unstocked_base(p_tenant) b
   where b.purchase_item_id = i.id and b.classification_id = f.id
     and i.id = any(coalesce(p_ignorar, '{}'));
  get diagnostics n_skip = row_count;

  return json_build_object('entraram', n_in, 'ignorados', n_skip, 'quantidade', v_total);
end $$;
revoke all on function public.fn_item_stock_late_entry(uuid, uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.fn_item_stock_late_entry(uuid, uuid, uuid[], uuid[]) to authenticated;
