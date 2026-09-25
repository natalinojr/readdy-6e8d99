-- Linha da Classificação de itens que só existia por causa de uma compra apagada (dono, 2026-09-25).
-- Caso: compra lida da foto (sem CNPJ/código) apagada quando a NF-e (XML) do mesmo pedido entrou; as
-- linhas "B&P Temperos · sem CNPJ" ficaram na tela, o molho foi vinculado na órfã e a linha verdadeira
-- (CNPJ + código 140) ficou sem vínculo → insumo sem preço e sem histórico. Regra para todas as lojas:
--   • item de compra apagado (compra excluída ou item removido na edição) → a linha da Classificação que
--     não tem mais nenhuma compra some;
--   • antes de sumir, o que a pessoa decidiu (insumo + conversão, classe/categoria) passa para a linha
--     gêmea do mesmo produto — mesmo fornecedor (nome), mesma descrição (sem o código entre parênteses),
--     mesma unidade — e só se houver UMA gêmea ainda sem essa decisão. Sem gêmea segura, a linha ligada fica.

create or replace function public.fn_item_unit_norm(p text)
returns text
language sql
immutable
as $$
  select case lower(btrim(regexp_replace(coalesce(p, ''), '\.$', '')))
    when '' then 'un' when 'unit' then 'un' when 'un' then 'un' when 'und' then 'un' when 'unid' then 'un'
    when 'unidade' then 'un' when 'pc' then 'un' when 'pç' then 'un' when 'peca' then 'un' when 'peça' then 'un'
    when 'kgs' then 'kg' when 'gr' then 'g' when 'lt' then 'l' when 'lts' then 'l'
    else lower(btrim(regexp_replace(coalesce(p, ''), '\.$', ''))) end
$$;

create or replace function public.fn_item_prune_orphans(p_tenant uuid, p_item_keys text[] default null)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  o public.fin_item_classifications;
  g public.fin_item_classifications;
  n_gemeas int;
  n int := 0;
begin
  for o in
    select c.* from public.fin_item_classifications c
     where c.tenant_id = p_tenant and c.last_source = 'compra'
       and (p_item_keys is null or c.item_key = any(p_item_keys))
       and not exists (
         select 1 from public.fin_purchase_items i
           join public.fin_purchases pu on pu.id = i.purchase_id
           left join public.fin_suppliers s on s.id = pu.supplier_id
          where i.tenant_id = p_tenant
            and public.fn_item_supplier_key(s.cnpj, pu.supplier) = c.supplier_key
            and public.fn_item_key(i.supplier_code, i.description) = c.item_key)
     for update
  loop
    if o.ingredient_id is not null or o.classe is not null then
      select count(*) into n_gemeas from public.fin_item_classifications x
       where x.tenant_id = p_tenant and x.id <> o.id
         and public.fn_item_desc_key(x.supplier_name) = public.fn_item_desc_key(o.supplier_name)
         and public.fn_item_desc_key(regexp_replace(x.description, '\s*\([^)]*\)\s*$', ''))
           = public.fn_item_desc_key(regexp_replace(o.description, '\s*\([^)]*\)\s*$', ''))
         and public.fn_item_unit_norm(x.unit_label) = public.fn_item_unit_norm(o.unit_label);
      if n_gemeas = 1 then
        select * into g from public.fin_item_classifications x
         where x.tenant_id = p_tenant and x.id <> o.id
           and public.fn_item_desc_key(x.supplier_name) = public.fn_item_desc_key(o.supplier_name)
           and public.fn_item_desc_key(regexp_replace(x.description, '\s*\([^)]*\)\s*$', ''))
             = public.fn_item_desc_key(regexp_replace(o.description, '\s*\([^)]*\)\s*$', ''))
           and public.fn_item_unit_norm(x.unit_label) = public.fn_item_unit_norm(o.unit_label)
         for update;
        if o.ingredient_id is not null and g.ingredient_id is null then
          update public.fin_item_classifications set
              ingredient_id = o.ingredient_id, units_per_package = o.units_per_package,
              classe = 'cmv', dre_category_id = null,
              merchandise_category_id = coalesce(o.merchandise_category_id, merchandise_category_id),
              suggested_classe = 'cmv', suggestion_reason = 'ligado a insumo do estoque', auto_classified = false,
              classified_by = o.classified_by, classified_at = coalesce(o.classified_at, now()), updated_at = now()
           where id = g.id;
          -- Mesma memória que o vínculo pela tela grava (fornecedor com CNPJ + código)
          if g.supplier_key ~ '^\d{14}$' and coalesce(btrim(g.supplier_code), '') <> '' then
            insert into public.fiscal_inbound_item_links
              (tenant_id, supplier_cnpj, supplier_code, ean, description, unit_label, ingredient_id, units_per_package, updated_by, updated_at)
            values (p_tenant, g.supplier_key, g.supplier_code, g.ean, left(g.description, 250), g.unit_label, o.ingredient_id,
                    o.units_per_package, o.classified_by, now())
            on conflict (tenant_id, supplier_cnpj, supplier_code) do nothing;
          end if;
          perform public.fn_ingredient_apply_purchase_cost(p_tenant, o.ingredient_id);
        elsif o.ingredient_id is null and g.classe is null and g.ingredient_id is null then
          update public.fin_item_classifications set
              classe = o.classe, dre_category_id = o.dre_category_id, merchandise_category_id = o.merchandise_category_id,
              is_service = o.is_service, auto_classified = o.auto_classified,
              classified_by = o.classified_by, classified_at = o.classified_at, updated_at = now()
           where id = g.id;
        elsif o.ingredient_id is not null and g.ingredient_id is distinct from o.ingredient_id then
          continue; -- gêmea já tem outra decisão: mantém a órfã para a pessoa ver
        end if;
      elsif o.ingredient_id is not null then
        continue; -- sem gêmea segura: não perde o vínculo
      end if;
    end if;
    delete from public.fin_item_classifications where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.fn_item_prune_orphans(uuid, text[]) from public, anon, authenticated;

-- Item de compra apagado (exclusão da compra em cascata ou edição): limpa as linhas que ficaram sem compra
create or replace function public.fn_purchase_items_prune_orphans()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r record;
begin
  for r in select d.tenant_id, array_agg(distinct public.fn_item_key(d.supplier_code, d.description)) as keys
             from old_rows d group by d.tenant_id loop
    begin
      perform public.fn_item_prune_orphans(r.tenant_id, r.keys);
    exception when others then
      raise warning 'fn_purchase_items_prune_orphans: %', sqlerrm; -- nunca impede apagar a compra
    end;
  end loop;
  return null;
end $$;
drop trigger if exists zz_purchase_items_prune_orphans on public.fin_purchase_items;
create trigger zz_purchase_items_prune_orphans after delete on public.fin_purchase_items
  referencing old table as old_rows for each statement execute function public.fn_purchase_items_prune_orphans();

-- Órfãs que já existem (todas as lojas)
select t.id, public.fn_item_prune_orphans(t.id) from public.tenants t;
