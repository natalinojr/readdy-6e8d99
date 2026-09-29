-- Leitura do cupom mostra o vínculo que uma pessoa já confirmou na Classificação de itens (dono, 2026-09-29).
-- Antes: purchase-receipt-scan nunca devolvia insumo (regra de 09-24), então "Conferir o que chegou" mostrava
-- "Não entra no estoque" / "0 entram no estoque" para itens já ligados — só ao salvar o fn_item_memo_links
-- ligava. Aqui é a MESMA regra do salvamento: exatamente o mesmo item (item_key) do mesmo fornecedor
-- (supplier_key), com conversão confirmada (units_per_package) e insumo ativo. Nada de nome parecido.
-- Fornecedor: o cupom traz CNPJ, mas a Classificação pode estar na chave do nome ('n:...') quando o
-- cadastro do fornecedor não tem CNPJ (é a chave que a compra salva usa) — valem as duas chaves do
-- mesmo fornecedor, CNPJ primeiro.

create or replace function public.fn_item_confirmed_links_for_receipt(
  p_tenant uuid, p_cnpj text, p_name text, p_items jsonb
)
 returns table(idx int, ingredient_id uuid, units_per_package numeric)
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  with keys as (
    select k, ord from (
      select public.fn_item_supplier_key(p_cnpj, null) as k, 1 as ord
       where length(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')) >= 11
      union all
      select public.fn_item_supplier_key(s.cnpj, s.name), 2
        from public.fin_suppliers s
       where s.tenant_id = p_tenant and length(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')) >= 11
         and regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g') = regexp_replace(p_cnpj, '\D', '', 'g')
      union all
      select public.fn_item_supplier_key(null, p_name), 3 where nullif(btrim(coalesce(p_name, '')), '') is not null
    ) x where k is not null and k <> 'n:'
  ),
  its as (
    select (e.ord - 1)::int as idx,
           public.fn_item_key(nullif(btrim(e.v->>'code'), ''), e.v->>'description') as ik_code,
           public.fn_item_key(null, e.v->>'description') as ik_desc
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(v, ord)
  )
  select distinct on (its.idx) its.idx, c.ingredient_id, c.units_per_package
    from its
    join public.fin_item_classifications c
      on c.tenant_id = p_tenant and c.item_key in (its.ik_code, its.ik_desc)
     and c.ingredient_id is not null and c.units_per_package > 0
    join keys on keys.k = c.supplier_key
    join public.ingredients g on g.id = c.ingredient_id and g.tenant_id = p_tenant and g.deleted_at is null
   order by its.idx, keys.ord, (c.item_key = its.ik_code) desc, c.classified_at desc nulls last
$function$;

revoke all on function public.fn_item_confirmed_links_for_receipt(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_item_confirmed_links_for_receipt(uuid, text, text, jsonb) to service_role;
