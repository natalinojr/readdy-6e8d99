-- Vínculo item → insumo só quando uma pessoa confirmou (regra do dono, 2026-09-24).
-- O sistema não sugere insumo: o recebimento liga sozinho só o que é EXATAMENTE o mesmo item do mesmo
-- fornecedor já ligado na Classificação de itens (com a conversão) ou pela nota SEFAZ (CNPJ + código).
-- O resto fica fora do estoque até alguém ligar na Classificação de itens (entrada tardia).
--
-- Antes: o gatilho da compra copiava o insumo do item para a Classificação (sem conversão — a tela
-- mostrava "1 un = 1 g"), e fn_item_memo_links usava essa cópia + o fator da compra anterior como se
-- fosse vínculo confirmado — o palpite do assistente (nome parecido) se repetia em toda compra seguinte.
-- Na Classificação, units_per_package só é gravado por fn_item_link_ingredient (pessoa) — é a marca de
-- "confirmado".

-- 1) Compra não copia mais o insumo do item para a Classificação.
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
      new.unit_price, coalesce(p.purchase_date::timestamptz, now()), 'compra', new.purchase_id, null);
    if r.id is not null and new.ingredient_id is null and new.dre_category_id is null and r.classe = 'despesa' then
      new.dre_category_id := r.dre_category_id;
    end if;
    if r.id is not null and new.ingredient_id is null and new.merchandise_category_id is null
       and r.classe = 'cmv' and r.merchandise_category_id is not null then
      new.merchandise_category_id := r.merchandise_category_id;
    end if;
  exception when others then
    raise warning 'fn_item_registry_from_purchase_item: %', sqlerrm;
  end;
  return new;
end $function$;

-- 2) Nota SEFAZ: o vínculo CNPJ + código (confirmado na tela da nota) vai para a Classificação COM a conversão.
create or replace function public.fn_item_registry_ingest_doc(p_doc uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  d record; it jsonb; sk text; cnpj text; ing uuid; upp numeric; n int := 0; r public.fin_item_classifications; cat uuid;
  servico boolean;
begin
  select id, tenant_id, modelo, itens, emitente_cnpj, emitente_nome, emitted_at, status into d from public.fiscal_inbound_documents where id = p_doc;
  if d.id is null or coalesce(d.modelo, 55) not in (55, 10) or d.itens is null or jsonb_typeof(d.itens) <> 'array' then return 0; end if;
  servico := d.modelo = 10;
  if servico and coalesce(d.status, '') = 'ignored' then return 0; end if;
  sk := public.fn_item_supplier_key(d.emitente_cnpj, d.emitente_nome);
  cnpj := regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g');
  for it in select * from jsonb_array_elements(d.itens) loop
    ing := null; upp := null;
    if not servico then
      select l.ingredient_id, l.units_per_package into ing, upp from public.fiscal_inbound_item_links l
       where l.tenant_id = d.tenant_id and l.supplier_cnpj = cnpj and l.supplier_code = btrim(coalesce(it->>'codigo', '')) limit 1;
    end if;
    r := public.fn_item_registry_touch(d.tenant_id, sk, d.emitente_nome, public.fn_item_key(it->>'codigo', it->>'descricao'),
      it->>'codigo', it->>'ean', it->>'ncm', it->>'descricao', it->>'unidade',
      case when coalesce(it->>'valor_unitario', '') ~ '^-?[0-9.]+$' then (it->>'valor_unitario')::numeric end,
      coalesce(d.emitted_at, now()), case when servico then 'nfse' else 'nfe' end, d.id, ing);
    if r.id is not null and ing is not null and r.ingredient_id = ing and r.units_per_package is null then
      update public.fin_item_classifications set units_per_package = coalesce(upp, 1) where id = r.id;
    end if;
    if servico and r.id is not null then
      if r.classe is null or r.auto_classified then
        select a.dre_category_id into cat
          from public.fin_accounts_payable a
          join public.fiscal_inbound_documents x on x.id = a.reference_id and a.reference_type = 'nfe_entrada'
         where a.tenant_id = d.tenant_id and a.dre_category_id is not null and x.emitente_cnpj = d.emitente_cnpj
         order by a.created_at desc limit 1;
        update public.fin_item_classifications set
            is_service = true, classe = null, auto_classified = false,
            suggested_classe = 'despesa', suggested_dre_category_id = cat,
            suggestion_reason = case when cat is not null then 'nota de serviço · mesma categoria das contas anteriores' else 'nota de serviço: sempre despesa' end
         where id = r.id;
      elsif not r.is_service then
        update public.fin_item_classifications set is_service = true where id = r.id;
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$;

-- 3) Recebimento: só vínculo confirmado (com conversão gravada na Classificação); sem "fator da compra anterior".
create or replace function public.fn_item_memo_links(p_tenant uuid, p_purchase uuid)
 returns table(purchase_item_id uuid, ingredient_id uuid, units_per_package numeric)
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  with its as (
    select i.id, public.fn_item_supplier_key(s.cnpj, pu.supplier) as sk, public.fn_item_key(i.supplier_code, i.description) as ik
      from public.fin_purchase_items i
      join public.fin_purchases pu on pu.id = i.purchase_id and pu.tenant_id = p_tenant
      left join public.fin_suppliers s on s.id = pu.supplier_id
     where i.purchase_id = p_purchase and i.tenant_id = p_tenant and i.ingredient_id is null
       and coalesce(i.description, '') not like 'Acréscimos da nota%'
  )
  select its.id, c.ingredient_id, c.units_per_package
    from its
    join public.fin_item_classifications c
      on c.tenant_id = p_tenant and c.supplier_key = its.sk and c.item_key = its.ik
     and c.ingredient_id is not null and c.units_per_package > 0
    join public.ingredients g on g.id = c.ingredient_id and g.tenant_id = p_tenant and g.deleted_at is null
$function$;

-- 4) Limpeza: insumo copiado automaticamente (sem conversão) sai da Classificação — volta a "Sem insumo"
--    para a pessoa ligar. Exceção: o que tem vínculo SEFAZ confirmado ganha a conversão desse vínculo.
--    Compras e estoque já lançados não mudam. Cópia do que foi limpo em _bkp_item_vinculo_auto_20260924.
create table if not exists public._bkp_item_vinculo_auto_20260924 as
  select id, tenant_id, ingredient_id, suggestion_reason from public.fin_item_classifications
   where ingredient_id is not null and units_per_package is null;
alter table public._bkp_item_vinculo_auto_20260924 enable row level security;
revoke all on public._bkp_item_vinculo_auto_20260924 from anon, authenticated;

update public.fin_item_classifications c
   set units_per_package = l.units_per_package, updated_at = now()
  from public.fiscal_inbound_item_links l
 where c.ingredient_id is not null and c.units_per_package is null
   and l.tenant_id = c.tenant_id and l.supplier_cnpj = c.supplier_key and l.supplier_code = c.supplier_code
   and l.ingredient_id = c.ingredient_id;

update public.fin_item_classifications
   set ingredient_id = null,
       suggestion_reason = case when suggestion_reason = 'ligado a insumo do estoque' then null else suggestion_reason end,
       updated_at = now()
 where ingredient_id is not null and units_per_package is null;
