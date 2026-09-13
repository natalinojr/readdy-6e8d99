-- Ajustes da base de classificação de itens (2026-09-12), depois da 1ª carga:
--  • chave do item: compra antiga vinda de NF-e guarda o código só na descrição ("MOLHO X (500039)")
--    → extrai o código dos parênteses para casar com o item da nota (antes virava item duplicado);
--  • sugestões: guardanapo/canudo = descartável de atendimento → CMV (embalagem é CMV, decisão do
--    dono); gelo, sal/ketchup sachê, carvão → CMV; limpador/luva/pano → Limpeza; bobina térmica,
--    fita, resma → Papelaria;
--  • refaz a carga (só apaga linhas que ninguém classificou à mão: classified_by is null).

create or replace function public.fn_item_key(p_code text, p_desc text) returns text
language sql stable set search_path = public, extensions as $$
  select case
    when nullif(btrim(coalesce(p_code, '')), '') is not null then 'c:' || btrim(p_code)
    when coalesce(p_desc, '') ~ '\(\s*[A-Za-z0-9.\-]*[0-9][A-Za-z0-9.\-]*\s*\)\s*$'
      then 'c:' || btrim(substring(p_desc from '\(\s*([A-Za-z0-9.\-]*[0-9][A-Za-z0-9.\-]*)\s*\)\s*$'))
    else 'd:' || coalesce(public.fn_item_desc_key(p_desc), '') end
$$;

create or replace function public.fn_item_suggest(p_ncm text, p_desc text, p_has_ingredient boolean,
  out classe text, out categoria text, out motivo text, out auto boolean)
language plpgsql stable set search_path = public, extensions as $$
declare
  n text := regexp_replace(coalesce(p_ncm, ''), '\D', '', 'g');
  d text := coalesce(public.fn_item_desc_key(p_desc), '');
  ncm_txt text := case when n <> '' and n <> '00000000' then ' (NCM ' || n || ')' else '' end;
begin
  auto := false;
  if p_has_ingredient then classe := 'cmv'; motivo := 'ligado a insumo do estoque'; auto := true; return; end if;
  -- Descartável de atendimento/delivery vem antes da limpeza: guardanapo é NCM 4818 (papel), mas é CMV.
  if d ~ '(^| )(embalagem|embalagens|pote|potes|sacola|sacolas|marmita|marmitex|copo|copos|tampa|tampas|canudo|canudos|guardanapo|guardanapos)( |$)'
     or n ~ '^(3923|3924|4819|4823|7612|7615)' and d !~ '(^| )lixo( |$)' then
    classe := 'cmv'; motivo := 'embalagem/descartável de atendimento' || ncm_txt; auto := true; return;
  end if;
  if n ~ '^(34|3808|9603|4818|2207)'
     or d ~ '(^| )(detergente|desinfetante|sabao|sabonete|alcool|sanitaria|cloro|esponja|vassoura|rodo|limpa|limpador|lixo|higienico|multiuso|desengordurante|luva|luvas|pano|panos|flanela)( |$)' then
    classe := 'despesa'; categoria := 'limpeza'; motivo := 'produto de limpeza/higiene' || ncm_txt; return;
  end if;
  if n ~ '^(4820|9608|9609|4817|4802)' or d ~ '(^| )(bobina termica|bobina ecf|fita durex|fita adesiva|resma|caneta|grampo)( |$)' or d ~ 'bobina (de )?papel termic' then
    classe := 'despesa'; categoria := 'papelaria'; motivo := 'papelaria/escritório' || ncm_txt; return;
  end if;
  if n ~ '^(0[1-9]|1[0-9]|2[0-4]|2501)' or d ~ '(^| )(gelo|sal|sache|ketchup|maionese|mostarda|carvao)( |$)' then
    classe := 'cmv'; motivo := 'alimento/bebida' || ncm_txt; auto := true; return;
  end if;
end $$;

-- Refaz a carga com as regras novas (preserva o que foi classificado por alguém).
delete from public.fin_item_classifications where classified_by is null;
do $$
declare d record; i record;
begin
  for d in select id from public.fiscal_inbound_documents where modelo = 55 order by emitted_at nulls first loop
    perform public.fn_item_registry_ingest_doc(d.id);
  end loop;
  for i in
    select it.*, pu.supplier, pu.purchase_date, s.cnpj
      from public.fin_purchase_items it
      join public.fin_purchases pu on pu.id = it.purchase_id
      left join public.fin_suppliers s on s.id = pu.supplier_id
     where coalesce(it.description, '') not ilike 'Acréscimos da nota%'
     order by pu.purchase_date nulls first
  loop
    perform public.fn_item_registry_touch(i.tenant_id, public.fn_item_supplier_key(i.cnpj, i.supplier), i.supplier,
      public.fn_item_key(i.supplier_code, i.description), i.supplier_code, i.ean, null, i.description, i.unit_label,
      i.unit_price, coalesce(i.purchase_date::timestamptz, now()), 'compra', i.purchase_id, i.ingredient_id);
  end loop;
end $$;
