-- Entrada tardia no estoque (Classificação de itens) com a data do RECEBIMENTO, não a do clique (dono, 2026-09-29).
-- Mesma regra do recebimento normal (purchase-confirm-delivery): entrada não atravessa contagem. Se houve contagem
-- do insumo entre o recebimento e agora, a contagem já acertou o saldo daquela hora → a entrada fica em agora
-- (a janela já avisa "Dar entrada agora conta em dobro"). O movimento fica ligado à compra (purchase_id), então
-- "Alterar data" e excluir a compra levam a entrada junto.

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
  v_mov jsonb;
  v_contado boolean;
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
    select i.id, i.quantity, i.received_quantity, i.total_price, i.freight_allocated, pu.supplier, pu.invoice_number,
           b.purchase_id, b.received_at
      from public.fn_item_unstocked_base(p_tenant) b
      join public.fin_purchase_items i on i.id = b.purchase_item_id
      join public.fin_purchases pu on pu.id = b.purchase_id
     where b.classification_id = f.id and i.id = any(coalesce(p_entrar, '{}'))
     for update of i
  loop
    v_qtd := coalesce(it.received_quantity, it.quantity, 0) * v_upp;
    if v_qtd > 0 then
      v_mov := public.fn_add_stock_movement(
        p_tenant, f.ingredient_id, 'in', v_qtd, null,
        left(format('Compra (entrada tardia): %s - NF %s', coalesce(it.supplier, ''), coalesce(nullif(it.invoice_number, ''), 'S/N')), 250),
        format('recebido em %s; insumo ligado depois pela Classificação de itens; upp=%s',
               to_char(it.received_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), v_upp),
        null, auth.uid(), null);
      -- Contagem do insumo entre o recebimento e agora (sessão confirmada ou ajuste de inventário)
      v_contado := it.received_at < now() and (
        exists (
          select 1 from public.inventory_sessions s
           where s.tenant_id = p_tenant and s.status = 'confirmado'
             and s.created_at > it.received_at and s.created_at < now()
             and exists (select 1 from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) e
                          where coalesce(e->>'insumoId', e->>'ingredient_id') = f.ingredient_id::text))
        or exists (
          select 1 from public.stock_movements a
           where a.tenant_id = p_tenant and a.ingredient_id = f.ingredient_id and a.type = 'inventory_adjustment'
             and a.created_at > it.received_at and a.created_at < now()));
      update public.stock_movements
         set purchase_id = it.purchase_id,
             created_at = case when v_contado then created_at else it.received_at end
       where id = (v_mov->>'movement_id')::uuid and tenant_id = p_tenant;
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

-- Entradas tardias já gravadas com a hora do clique: vão para a data do recebimento e ficam ligadas à compra
-- (só a compra com o mesmo número de nota que tem o item ligado ao insumo, e sem contagem no meio).
with m as (
  select sm.id, sm.tenant_id, sm.ingredient_id, sm.created_at, substring(sm.reason from 'NF (.*)$') as nf
    from public.stock_movements sm
   where sm.reason like 'Compra (entrada tardia)%' and sm.purchase_id is null and sm.type = 'in'
), alvo as (
  select m.id, min(pu.id::text)::uuid as purchase_id, min(coalesce(pu.delivery_confirmed_at, pu.stock_applied_at)) as rec
    from m
    join public.fin_purchases pu on pu.tenant_id = m.tenant_id and pu.invoice_number = m.nf
    join public.fin_purchase_items i on i.purchase_id = pu.id and i.ingredient_id = m.ingredient_id
   group by m.id
  having count(distinct pu.id) = 1
)
update public.stock_movements sm
   set purchase_id = a.purchase_id,
       created_at = case
         when a.rec is null or a.rec >= sm.created_at then sm.created_at
         when exists (select 1 from public.stock_movements x
                       where x.tenant_id = sm.tenant_id and x.ingredient_id = sm.ingredient_id
                         and x.type = 'inventory_adjustment' and x.created_at > a.rec and x.created_at < sm.created_at)
           or exists (select 1 from public.inventory_sessions s
                       where s.tenant_id = sm.tenant_id and s.status = 'confirmado'
                         and s.created_at > a.rec and s.created_at < sm.created_at
                         and exists (select 1 from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) e
                                      where coalesce(e->>'insumoId', e->>'ingredient_id') = sm.ingredient_id::text))
           then sm.created_at
         else a.rec end
  from alvo a
 where a.id = sm.id;
