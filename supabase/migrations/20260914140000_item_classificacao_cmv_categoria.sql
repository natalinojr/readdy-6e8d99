-- CMV com categoria na Classificação de itens (2026-09-14).
-- O item de CMV ganha a categoria de MERCADORIA (fin_merchandise_categories — a mesma lista dos
-- insumos, desde 2026-08-26). A DRE já abre o CMV por essa categoria, lendo o item de compra
-- (fin_purchase_items.merchandise_category_id; senão a do insumo). Aqui:
--   1. fin_item_classifications.merchandise_category_id;
--   2. fn_item_classify ganha p_merchandise_category_id (opcional; sem ele o item mantém a categoria
--      que já tinha) e grava a categoria nos itens de compra já lançados;
--   3. o trigger dos itens de compra preenche a categoria de item novo (se vier sem e sem insumo).
-- Item ligado a insumo continua usando a categoria do insumo (não é tocado).

alter table public.fin_item_classifications
  add column if not exists merchandise_category_id uuid references public.fin_merchandise_categories(id) on delete set null;

-- Sem a versão de 4 parâmetros (duas versões deixariam a chamada por nome ambígua no PostgREST);
-- quem chama com 4 parâmetros cai nesta, com o 5º nulo.
drop function if exists public.fn_item_classify(uuid, uuid[], text, uuid);

create or replace function public.fn_item_classify(
  p_tenant uuid, p_ids uuid[], p_classe text,
  p_dre_category_id uuid default null, p_merchandise_category_id uuid default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare n_itens int := 0; n_lanc int := 0;
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
      -- CMV sem categoria escolhida mantém a que o item já tinha; despesa guarda a antiga (volta se virar CMV)
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

  return json_build_object('itens', n_itens, 'lancamentos_atualizados', n_lanc);
end $function$;

revoke all on function public.fn_item_classify(uuid, uuid[], text, uuid, uuid) from public, anon;
grant execute on function public.fn_item_classify(uuid, uuid[], text, uuid, uuid) to authenticated;

create or replace function public.fn_item_registry_from_purchase_item()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare p record; r public.fin_item_classifications;
begin
  begin
    if coalesce(new.description, '') ilike 'Acréscimos da nota%' then return new; end if;
    select pu.supplier, pu.purchase_date, s.cnpj into p
      from public.fin_purchases pu left join public.fin_suppliers s on s.id = pu.supplier_id where pu.id = new.purchase_id;
    r := public.fn_item_registry_touch(new.tenant_id, public.fn_item_supplier_key(p.cnpj, p.supplier), p.supplier,
      public.fn_item_key(new.supplier_code, new.description), new.supplier_code, new.ean, null, new.description, new.unit_label,
      new.unit_price, coalesce(p.purchase_date::timestamptz, now()), 'compra', new.purchase_id, new.ingredient_id);
    if r.id is not null and new.ingredient_id is null and new.dre_category_id is null and r.classe = 'despesa' then
      new.dre_category_id := r.dre_category_id;
    end if;
    -- CMV: categoria de mercadoria do cadastro, se o item vier sem (a escolhida na compra prevalece)
    if r.id is not null and new.ingredient_id is null and new.merchandise_category_id is null
       and r.classe = 'cmv' and r.merchandise_category_id is not null then
      new.merchandise_category_id := r.merchandise_category_id;
    end if;
  exception when others then
    raise warning 'fn_item_registry_from_purchase_item: %', sqlerrm;
  end;
  return new;
end $function$;
