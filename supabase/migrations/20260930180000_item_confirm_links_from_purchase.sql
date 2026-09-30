-- Vínculo item → insumo feito por uma pessoa no "Lançar a partir deste pagamento" (Conciliação) ou no
-- "Detalhar itens" da compra vira vínculo CONFIRMADO da Classificação de itens (2026-09-30, pedido do dono:
-- "puxar automático os insumos conforme histórico"). Na próxima nota do mesmo fornecedor, o mesmo item já
-- vem ligado e com a conversão (fn_item_confirmed_links_for_receipt / fn_item_memo_links).
-- Regra de 2026-09-24 mantida: nada é sugerido por nome parecido — só grava o que a pessoa escolheu, para o
-- MESMO item (supplier_key + item_key) do MESMO fornecedor, e só com conversão (units_per_package > 0).
-- Mesma permissão da Classificação (admin/manager); sem ela, não faz nada (é conveniência, não bloqueia).
-- Chamada pela tela (auth.uid()) ou pela Edge conciliacao-pagamentos com service_role + p_user.
create or replace function public.fn_item_confirm_links_from_purchase(p_tenant uuid, p_purchase uuid, p_user uuid default null)
returns int
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_user uuid := auth.uid();
  n int := 0;
begin
  if v_user is null and coalesce(current_setting('request.jwt.claim.role', true), auth.role()) = 'service_role' then
    v_user := p_user;
  end if;
  if v_user is null or not exists (
    select 1 from public.user_tenants ut
     where ut.user_id = v_user and ut.tenant_id = p_tenant and ut.role::text in ('admin', 'manager')
  ) then
    return 0;
  end if;

  with its as (
    select distinct on (sk, ik) sk, ik, ingredient_id, upp
      from (
        select public.fn_item_supplier_key(s.cnpj, pu.supplier) as sk,
               public.fn_item_key(i.supplier_code, i.description) as ik,
               i.ingredient_id, i.units_per_package as upp, i.id as item_id
          from public.fin_purchase_items i
          join public.fin_purchases pu on pu.id = i.purchase_id and pu.tenant_id = p_tenant
          left join public.fin_suppliers s on s.id = pu.supplier_id
          join public.ingredients g on g.id = i.ingredient_id and g.tenant_id = p_tenant and g.deleted_at is null
         where i.purchase_id = p_purchase and i.tenant_id = p_tenant
           and i.ingredient_id is not null and coalesce(i.units_per_package, 0) > 0
           and coalesce(i.description, '') not like 'Acréscimos da nota%'
      ) x
     order by sk, ik, item_id
  )
  update public.fin_item_classifications c set
      ingredient_id = its.ingredient_id, units_per_package = its.upp,
      classe = 'cmv', dre_category_id = null,
      suggested_classe = 'cmv', suggestion_reason = 'ligado a insumo do estoque', auto_classified = false,
      classified_by = v_user, classified_at = now(), updated_at = now()
    from its
   where c.tenant_id = p_tenant and c.supplier_key = its.sk and c.item_key = its.ik
     and (c.ingredient_id is distinct from its.ingredient_id or c.units_per_package is distinct from its.upp);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.fn_item_confirm_links_from_purchase(uuid, uuid, uuid) from public, anon;
grant execute on function public.fn_item_confirm_links_from_purchase(uuid, uuid, uuid) to authenticated, service_role;
