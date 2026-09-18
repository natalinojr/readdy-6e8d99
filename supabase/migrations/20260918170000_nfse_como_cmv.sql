-- NFS-e de fornecedor de PRODUTO → CMV (2026-09-18).
--
-- Caso do dono: fornecedor que entrega mercadoria mas emite nota de serviço. Até aqui NFS-e só
-- podia virar despesa (fiscal-inbound recusava import_purchase de modelo 10 e a aba recusava CMV
-- para item de serviço). Agora a Classificação de itens decide:
--   • item de serviço classificado como CMV → a nota entra como COMPRA (Compras, CMV da DRE);
--   • despesa → conta a pagar com a categoria (como antes);
--   • pendente → segue o último lançamento do fornecedor.
-- fn_item_doc_classe é o que a edge fiscal-inbound e a tela Notas de entrada consultam.

-- Classe do item principal de uma nota (null = pendente/sem item). Service role ou membro da loja.
create or replace function public.fn_item_doc_classe(p_doc uuid) returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare p record; c text;
begin
  select * into p from public.fn_item_doc_principal(p_doc);
  if p.item_key is null then return null; end if;
  if auth.uid() is not null and not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p.tenant_id) then
    return null;
  end if;
  select f.classe into c from public.fin_item_classifications f
   where f.tenant_id = p.tenant_id and f.supplier_key = p.supplier_key and f.item_key = p.item_key;
  return c;
end $$;
revoke all on function public.fn_item_doc_classe(uuid) from public, anon;
grant execute on function public.fn_item_doc_classe(uuid) to authenticated, service_role;

-- Serviço pode ser CMV: sai a trava de fn_item_classify (resto igual à 20260918150000).
create or replace function public.fn_item_classify(
  p_tenant uuid, p_ids uuid[], p_classe text,
  p_dre_category_id uuid default null, p_merchandise_category_id uuid default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare n_itens int := 0; n_lanc int := 0; n_contas int := 0; n_desp int := 0;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant and ut.role::text in ('admin', 'manager')) then
    raise exception 'Apenas administradores podem classificar itens';
  end if;
  if p_classe is not null and p_classe not in ('cmv', 'despesa') then raise exception 'Classificação inválida'; end if;
  if p_classe = 'despesa' then
    if p_dre_category_id is null then raise exception 'Escolha a categoria da despesa'; end if;
    if not exists (select 1 from public.fin_dre_categories c where c.id = p_dre_category_id and c.tenant_id = p_tenant and c.deleted_at is null
                   and c.group_type not in ('revenue', 'tax', 'cost')) then
      raise exception 'Categoria inválida para despesa';
    end if;
  end if;
  if p_merchandise_category_id is not null then
    if p_classe is distinct from 'cmv' then raise exception 'Categoria de mercadoria só vale para CMV'; end if;
    if not exists (select 1 from public.fin_merchandise_categories m where m.id = p_merchandise_category_id and m.tenant_id = p_tenant) then
      raise exception 'Categoria de mercadoria inválida';
    end if;
  end if;

  update public.fin_item_classifications set
      classe = p_classe,
      dre_category_id = case when p_classe = 'despesa' then p_dre_category_id end,
      merchandise_category_id = case when p_classe = 'cmv' then coalesce(p_merchandise_category_id, merchandise_category_id) else merchandise_category_id end,
      auto_classified = false,
      classified_by = case when p_classe is null then null else auth.uid() end,
      classified_at = case when p_classe is null then null else now() end,
      updated_at = now()
   where tenant_id = p_tenant and id = any(p_ids);
  get diagnostics n_itens = row_count;

  with alvo as (
    select i.id as item_id,
           case when f.classe = 'despesa' then f.dre_category_id end as nova,
           case when f.classe = 'cmv' then f.merchandise_category_id end as merc
      from public.fin_item_classifications f
      join public.fin_purchase_items i on i.tenant_id = f.tenant_id and i.ingredient_id is null
      join public.fin_purchases pu on pu.id = i.purchase_id
      left join public.fin_suppliers s on s.id = pu.supplier_id
     where f.tenant_id = p_tenant and f.id = any(p_ids)
       and public.fn_item_supplier_key(s.cnpj, pu.supplier) = f.supplier_key
       and public.fn_item_key(i.supplier_code, i.description) = f.item_key
  )
  update public.fin_purchase_items i
     set dre_category_id = a.nova,
         merchandise_category_id = coalesce(a.merc, i.merchandise_category_id)
    from alvo a
   where i.id = a.item_id
     and (i.dre_category_id is distinct from a.nova or (a.merc is not null and i.merchandise_category_id is distinct from a.merc));
  get diagnostics n_lanc = row_count;

  n_contas := public.fn_item_apply_to_bills(p_tenant, p_ids);

  -- CMV em item de nota que já foi lançada como DESPESA: não muda sozinho (a conta pode estar
  -- paga/conciliada) — a tela avisa quantas são, para relançar como compra se quiser.
  if p_classe = 'cmv' then
    select count(distinct d.id) into n_desp
      from public.fiscal_inbound_documents d
      cross join lateral public.fn_item_doc_principal(d.id) p
      join public.fin_item_classifications f on f.tenant_id = d.tenant_id and f.supplier_key = p.supplier_key and f.item_key = p.item_key
     where d.tenant_id = p_tenant and d.status = 'imported' and d.import_type = 'bill' and f.id = any(p_ids);
  end if;

  return json_build_object('itens', n_itens, 'lancamentos_atualizados', n_lanc + n_contas, 'contas_atualizadas', n_contas,
                           'notas_como_despesa', n_desp);
end $function$;

revoke all on function public.fn_item_classify(uuid, uuid[], text, uuid, uuid) from public, anon;
grant execute on function public.fn_item_classify(uuid, uuid[], text, uuid, uuid) to authenticated;
