-- Código do produto que é CFOP não identifica o item (dono, 2026-09-25).
-- A Lapeana Morangos (CNPJ 45078729000119) manda "CFOP5102" no código de TODOS os produtos da NF-e.
-- fn_item_key usava o código → Maracujá, Morango, Abacaxi c/ Hortelã e Abacaxi Congelado viraram um
-- item só na Classificação; o vínculo "Abacaxi Congelado" (1 Kg = 10 un) puxava o custo dos quatro
-- (R$ 4,50 em 08/08 era o maracujá) e ficou memorizado por código — a próxima nota ligaria os quatro
-- produtos ao mesmo insumo, com estoque.
-- Agora código que começa com CFOP é ignorado: o item é identificado pela descrição (sem o "(CFOP5102)").

create or replace function public.fn_item_key(p_code text, p_desc text)
 returns text
 language sql
 stable
 set search_path to 'public', 'extensions'
as $function$
  select case
    when nullif(btrim(coalesce(p_code, '')), '') is not null and btrim(p_code) !~* '^cfop' then 'c:' || btrim(p_code)
    when coalesce(p_desc, '') ~ '\(\s*[A-Za-z0-9.\-]*[0-9][A-Za-z0-9.\-]*\s*\)\s*$'
         and substring(p_desc from '\(\s*([A-Za-z0-9.\-]*[0-9][A-Za-z0-9.\-]*)\s*\)\s*$') !~* '^cfop'
      then 'c:' || btrim(substring(p_desc from '\(\s*([A-Za-z0-9.\-]*[0-9][A-Za-z0-9.\-]*)\s*\)\s*$'))
    else 'd:' || coalesce(public.fn_item_desc_key(regexp_replace(coalesce(p_desc, ''), '\s*\(\s*cfop[0-9]*\s*\)\s*$', '', 'i')), '') end
$function$;

-- Vínculo memorizado por código CFOP nunca vale (quem grava: fn_item_link_ingredient, purchase-confirm-delivery…)
create or replace function public.fn_inbound_link_skip_cfop()
returns trigger
language plpgsql
as $$
begin
  if btrim(coalesce(new.supplier_code, '')) ~* '^cfop' then return null; end if;
  return new;
end $$;
drop trigger if exists trg_inbound_link_skip_cfop on public.fiscal_inbound_item_links;
create trigger trg_inbound_link_skip_cfop before insert or update on public.fiscal_inbound_item_links
  for each row execute function public.fn_inbound_link_skip_cfop();

delete from public.fiscal_inbound_item_links where btrim(coalesce(supplier_code, '')) ~* '^cfop';

-- Linhas da Classificação que estavam na chave do CFOP: passam para a chave da própria descrição
-- (o vínculo de "Abacaxi Congelado" na Paranaguá continua, agora só com o abacaxi congelado).
update public.fin_item_classifications c
   set item_key = public.fn_item_key(null, c.description), supplier_code = null, updated_at = now()
 where c.item_key ~* '^c:cfop'
   and not exists (select 1 from public.fin_item_classifications o
                    where o.tenant_id = c.tenant_id and o.supplier_key = c.supplier_key
                      and o.item_key = public.fn_item_key(null, c.description));

-- Os outros produtos (antes escondidos na mesma linha) ganham a linha deles, sem classificação
select public.fn_item_registry_touch(i.tenant_id, public.fn_item_supplier_key(s.cnpj, pu.supplier), pu.supplier,
         public.fn_item_key(i.supplier_code, i.description), null, i.ean, null, i.description, i.unit_label,
         i.unit_price, coalesce(pu.purchase_date::timestamptz, now()), 'compra', i.purchase_id, null)
  from public.fin_purchase_items i
  join public.fin_purchases pu on pu.id = i.purchase_id
  left join public.fin_suppliers s on s.id = pu.supplier_id
 where btrim(coalesce(i.supplier_code, '')) ~* '^cfop'
 order by pu.purchase_date, i.id;

-- Preço dos insumos que estavam ligados a essas linhas: refaz só com as compras certas
select public.fn_ingredient_apply_purchase_cost(c.tenant_id, c.ingredient_id)
  from public.fin_item_classifications c
 where c.ingredient_id is not null and c.supplier_key in (
   select distinct public.fn_item_supplier_key(s.cnpj, pu.supplier)
     from public.fin_purchase_items i
     join public.fin_purchases pu on pu.id = i.purchase_id
     left join public.fin_suppliers s on s.id = pu.supplier_id
    where btrim(coalesce(i.supplier_code, '')) ~* '^cfop');
