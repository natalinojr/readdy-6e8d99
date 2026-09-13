-- Base de classificação de itens de compra (2026-09-12) — Financeiro › Classificação de Itens.
--
-- Problema (dono): classificar pelo total pago ao CNPJ não serve — a mesma nota traz bebida (CMV)
-- e produto de limpeza (despesa). A classificação mora no ITEM (fornecedor + código do produto;
-- sem código, descrição normalizada), nunca no pagamento.
--
--  • fin_item_classifications: um registro por item de fornecedor, com classe 'cmv' | 'despesa'
--    (null = pendente), categoria DRE (obrigatória em despesa), insumo ligado, sugestão por NCM.
--  • Nota de entrada (NF-e) chega com itens → trigger registra os itens (novo = pendente).
--  • Item de compra gravado por QUALQUER caminho (nota, tela, assistente, cupom) → trigger
--    registra e aplica a classificação: despesa → fin_purchase_items.dre_category_id (a DRE tira
--    do CMV — src/lib/comprasDRE.ts). Item ligado a insumo é sempre CMV.
--  • fn_item_classify: classifica em lote pela tela e reaplica nas compras JÁ lançadas.
--  • Sugestão: ligado a insumo / alimento-bebida (NCM 01-24) / embalagem → CMV automático
--    (auto_classified, "a conferir"); limpeza e papelaria só sugerem (despesa precisa de categoria).
--    Embalagem de delivery é CMV (decisão do dono, 2026-09-12).
-- Aplicada via MCP.

create or replace function public.fn_item_desc_key(t text) returns text
language sql stable set search_path = public, extensions as $$
  select nullif(btrim(regexp_replace(lower(extensions.unaccent(regexp_replace(coalesce(t, ''), '\s*\([^()]*\)\s*$', ''))), '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- Fornecedor: CNPJ/CPF só números; sem documento, 'n:' + nome normalizado.
create or replace function public.fn_item_supplier_key(p_cnpj text, p_name text) returns text
language sql stable set search_path = public, extensions as $$
  select case when length(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')) >= 11 then regexp_replace(p_cnpj, '\D', '', 'g')
              else 'n:' || coalesce(public.fn_item_desc_key(p_name), '') end
$$;

-- Item: 'c:' + código do produto no fornecedor (cProd); sem código, 'd:' + descrição normalizada.
create or replace function public.fn_item_key(p_code text, p_desc text) returns text
language sql stable set search_path = public, extensions as $$
  select case when nullif(btrim(coalesce(p_code, '')), '') is not null then 'c:' || btrim(p_code)
              else 'd:' || coalesce(public.fn_item_desc_key(p_desc), '') end
$$;

create table if not exists public.fin_item_classifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_key text not null,
  supplier_name text,
  item_key text not null,
  supplier_code text,
  ean text,
  ncm text,
  description text not null default '',
  unit_label text,
  classe text check (classe in ('cmv', 'despesa')),
  dre_category_id uuid references public.fin_dre_categories(id) on delete set null,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  suggested_classe text check (suggested_classe in ('cmv', 'despesa')),
  suggested_dre_category_id uuid references public.fin_dre_categories(id) on delete set null,
  suggestion_reason text,
  auto_classified boolean not null default false,
  classified_by uuid,
  classified_at timestamptz,
  last_unit_price numeric,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_source text,
  last_ref_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, supplier_key, item_key)
);
create index if not exists fin_item_classifications_pend_idx on public.fin_item_classifications (tenant_id, classe);
comment on table public.fin_item_classifications is 'Base de classificação dos itens comprados (fornecedor + código/descrição → CMV ou despesa com categoria DRE). Alimentada por trigger nas notas de entrada e nos itens de compra; classificação pela tela Financeiro › Classificação de Itens (fn_item_classify).';

-- Sugestão pela natureza do item. auto = pode classificar sozinho (sempre CMV, que já é o padrão da DRE).
create or replace function public.fn_item_suggest(p_ncm text, p_desc text, p_has_ingredient boolean,
  out classe text, out categoria text, out motivo text, out auto boolean)
language plpgsql stable set search_path = public, extensions as $$
declare
  n text := regexp_replace(coalesce(p_ncm, ''), '\D', '', 'g');
  d text := coalesce(public.fn_item_desc_key(p_desc), '');
begin
  auto := false;
  if p_has_ingredient then classe := 'cmv'; motivo := 'ligado a insumo do estoque'; auto := true; return; end if;
  if n ~ '^(34|3808|9603|4818|2207)' or d ~ '(^| )(detergente|desinfetante|sabao|sabonete|alcool|sanitaria|cloro|esponja|vassoura|rodo|limpa|lixo|higienico|toalha de papel|papel toalha|multiuso|desengordurante)( |$)' then
    classe := 'despesa'; categoria := 'limpeza'; motivo := 'produto de limpeza/higiene' || case when n <> '' then ' (NCM ' || n || ')' else '' end; return;
  end if;
  if n ~ '^(4820|9608|9609|4817)' then classe := 'despesa'; categoria := 'papelaria'; motivo := 'papelaria (NCM ' || n || ')'; return; end if;
  if n ~ '^(3923|3924|4819|4823|7612|7615)' or d ~ '(^| )(embalagem|pote|sacola|marmita|marmitex|copo|tampa|canudo|guardanapo)( |$)' then
    classe := 'cmv'; motivo := 'embalagem/descartável de delivery' || case when n <> '' then ' (NCM ' || n || ')' else '' end; auto := true; return;
  end if;
  if n ~ '^(0[1-9]|1[0-9]|2[0-4])' then classe := 'cmv'; motivo := 'alimento/bebida (NCM ' || n || ')'; auto := true; return; end if;
end $$;

-- Registra/atualiza um item e recalcula a sugestão enquanto ele não foi classificado por alguém.
create or replace function public.fn_item_registry_touch(
  p_tenant uuid, p_supplier_key text, p_supplier_name text, p_item_key text, p_code text, p_ean text, p_ncm text,
  p_desc text, p_unit text, p_price numeric, p_seen_at timestamptz, p_source text, p_ref uuid, p_ingredient uuid)
returns public.fin_item_classifications
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.fin_item_classifications;
  s record;
  cat uuid;
  seen timestamptz := coalesce(p_seen_at, now());
  ean text := case when length(regexp_replace(coalesce(p_ean, ''), '\D', '', 'g')) >= 8 then regexp_replace(p_ean, '\D', '', 'g') end;
begin
  if p_tenant is null or p_item_key is null or p_item_key in ('c:', 'd:') or p_supplier_key is null or p_supplier_key = 'n:' then return null; end if;
  insert into public.fin_item_classifications as f (tenant_id, supplier_key, supplier_name, item_key, supplier_code, ean, ncm, description,
      unit_label, ingredient_id, last_unit_price, first_seen_at, last_seen_at, last_source, last_ref_id)
  values (p_tenant, p_supplier_key, nullif(btrim(coalesce(p_supplier_name, '')), ''), p_item_key, nullif(btrim(coalesce(p_code, '')), ''), ean,
      nullif(regexp_replace(coalesce(p_ncm, ''), '\D', '', 'g'), ''), left(btrim(coalesce(p_desc, '')), 250), p_unit, p_ingredient,
      p_price, seen, seen, p_source, p_ref)
  on conflict (tenant_id, supplier_key, item_key) do update set
      supplier_name = coalesce(excluded.supplier_name, f.supplier_name),
      ean = coalesce(f.ean, excluded.ean),
      ncm = coalesce(f.ncm, excluded.ncm),
      ingredient_id = coalesce(excluded.ingredient_id, f.ingredient_id),
      unit_label = coalesce(excluded.unit_label, f.unit_label),
      description = case when excluded.last_seen_at >= coalesce(f.last_seen_at, '-infinity'::timestamptz) and excluded.description <> '' then excluded.description else f.description end,
      last_unit_price = case when excluded.last_seen_at >= coalesce(f.last_seen_at, '-infinity'::timestamptz) and excluded.last_unit_price is not null then excluded.last_unit_price else f.last_unit_price end,
      last_source = case when excluded.last_seen_at >= coalesce(f.last_seen_at, '-infinity'::timestamptz) then excluded.last_source else f.last_source end,
      last_ref_id = case when excluded.last_seen_at >= coalesce(f.last_seen_at, '-infinity'::timestamptz) then excluded.last_ref_id else f.last_ref_id end,
      first_seen_at = least(coalesce(f.first_seen_at, excluded.first_seen_at), excluded.first_seen_at),
      last_seen_at = greatest(coalesce(f.last_seen_at, excluded.last_seen_at), excluded.last_seen_at),
      updated_at = now()
  returning * into r;

  if r.classe is null or r.auto_classified then
    select * into s from public.fn_item_suggest(r.ncm, r.description, r.ingredient_id is not null);
    cat := null;
    if s.categoria is not null then
      select c.id into cat from public.fin_dre_categories c
       where c.tenant_id = p_tenant and c.deleted_at is null and c.is_active and c.group_type not in ('revenue', 'tax', 'cost')
         and lower(extensions.unaccent(c.name)) like s.categoria || '%'
       order by c.sort_order nulls last limit 1;
    end if;
    update public.fin_item_classifications set
        suggested_classe = s.classe, suggested_dre_category_id = cat, suggestion_reason = s.motivo,
        classe = case when s.auto then s.classe when auto_classified then null else classe end,
        auto_classified = coalesce(s.auto, false)
     where id = r.id returning * into r;
  end if;
  return r;
end $$;

-- Itens de uma NF-e (modelo 55) → base.
create or replace function public.fn_item_registry_ingest_doc(p_doc uuid) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  d record; it jsonb; sk text; cnpj text; ing uuid; n int := 0;
begin
  select id, tenant_id, modelo, itens, emitente_cnpj, emitente_nome, emitted_at into d from public.fiscal_inbound_documents where id = p_doc;
  if d.id is null or coalesce(d.modelo, 55) <> 55 or d.itens is null or jsonb_typeof(d.itens) <> 'array' then return 0; end if;
  sk := public.fn_item_supplier_key(d.emitente_cnpj, d.emitente_nome);
  cnpj := regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g');
  for it in select * from jsonb_array_elements(d.itens) loop
    ing := null;
    select l.ingredient_id into ing from public.fiscal_inbound_item_links l
     where l.tenant_id = d.tenant_id and l.supplier_cnpj = cnpj and l.supplier_code = btrim(coalesce(it->>'codigo', '')) limit 1;
    perform public.fn_item_registry_touch(d.tenant_id, sk, d.emitente_nome, public.fn_item_key(it->>'codigo', it->>'descricao'),
      it->>'codigo', it->>'ean', it->>'ncm', it->>'descricao', it->>'unidade',
      case when coalesce(it->>'valor_unitario', '') ~ '^-?[0-9.]+$' then (it->>'valor_unitario')::numeric end,
      coalesce(d.emitted_at, now()), 'nfe', d.id, ing);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.fn_item_registry_from_doc() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    perform public.fn_item_registry_ingest_doc(new.id);
  exception when others then
    raise warning 'fn_item_registry_from_doc(%): %', new.id, sqlerrm; -- nunca derruba a sincronização das notas
  end;
  return new;
end $$;
drop trigger if exists trg_item_registry_from_doc on public.fiscal_inbound_documents;
create trigger trg_item_registry_from_doc after insert or update of itens on public.fiscal_inbound_documents
  for each row execute function public.fn_item_registry_from_doc();

-- Item de compra (qualquer caminho) → base + classificação aplicada.
create or replace function public.fn_item_registry_from_purchase_item() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare p record; r public.fin_item_classifications;
begin
  begin
    if coalesce(new.description, '') ilike 'Acréscimos da nota%' then return new; end if;
    select pu.supplier, pu.purchase_date, s.cnpj into p
      from public.fin_purchases pu left join public.fin_suppliers s on s.id = pu.supplier_id where pu.id = new.purchase_id;
    r := public.fn_item_registry_touch(new.tenant_id, public.fn_item_supplier_key(p.cnpj, p.supplier), p.supplier,
      public.fn_item_key(new.supplier_code, new.description), new.supplier_code, new.ean, null, new.description, new.unit_label,
      new.unit_price, coalesce(p.purchase_date::timestamptz, now()), 'compra', new.purchase_id, new.ingredient_id);
    -- Item de estoque é sempre CMV; os demais seguem a base.
    if r.id is not null and new.ingredient_id is null and new.dre_category_id is null and r.classe = 'despesa' then
      new.dre_category_id := r.dre_category_id;
    end if;
  exception when others then
    raise warning 'fn_item_registry_from_purchase_item: %', sqlerrm; -- nunca impede lançar a compra
  end;
  return new;
end $$;
drop trigger if exists trg_item_registry_from_purchase_item on public.fin_purchase_items;
create trigger trg_item_registry_from_purchase_item before insert on public.fin_purchase_items
  for each row execute function public.fn_item_registry_from_purchase_item();

-- Classificação pela tela (admin). p_classe null = volta a pendente. Reaplica nas compras já lançadas.
create or replace function public.fn_item_classify(p_tenant uuid, p_ids uuid[], p_classe text, p_dre_category_id uuid default null)
returns json
language plpgsql security definer set search_path = public, extensions as $$
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

  update public.fin_item_classifications set
      classe = p_classe,
      dre_category_id = case when p_classe = 'despesa' then p_dre_category_id end,
      auto_classified = false,
      classified_by = case when p_classe is null then null else auth.uid() end,
      classified_at = case when p_classe is null then null else now() end,
      updated_at = now()
   where tenant_id = p_tenant and id = any(p_ids);
  get diagnostics n_itens = row_count;

  with alvo as (
    select i.id as item_id, case when f.classe = 'despesa' then f.dre_category_id end as nova
      from public.fin_item_classifications f
      join public.fin_purchase_items i on i.tenant_id = f.tenant_id and i.ingredient_id is null
      join public.fin_purchases pu on pu.id = i.purchase_id
      left join public.fin_suppliers s on s.id = pu.supplier_id
     where f.tenant_id = p_tenant and f.id = any(p_ids)
       and public.fn_item_supplier_key(s.cnpj, pu.supplier) = f.supplier_key
       and public.fn_item_key(i.supplier_code, i.description) = f.item_key
  )
  update public.fin_purchase_items i set dre_category_id = a.nova
    from alvo a where i.id = a.item_id and i.dre_category_id is distinct from a.nova;
  get diagnostics n_lanc = row_count;

  return json_build_object('itens', n_itens, 'lancamentos_atualizados', n_lanc);
end $$;

-- Acesso: leitura para membros da loja; escrita só pelas funções acima.
alter table public.fin_item_classifications enable row level security;
drop policy if exists fin_item_classifications_select on public.fin_item_classifications;
create policy fin_item_classifications_select on public.fin_item_classifications for select to authenticated
  using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()));
revoke all on public.fin_item_classifications from anon, authenticated;
grant select on public.fin_item_classifications to authenticated;
grant all on public.fin_item_classifications to service_role;
revoke execute on function public.fn_item_registry_touch(uuid, text, text, text, text, text, text, text, text, numeric, timestamptz, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.fn_item_registry_ingest_doc(uuid) from public, anon, authenticated;
revoke execute on function public.fn_item_classify(uuid, uuid[], text, uuid) from public, anon;
grant execute on function public.fn_item_classify(uuid, uuid[], text, uuid) to authenticated;

-- Carga inicial: notas já recebidas, depois os itens de compra já lançados (trazem o insumo ligado).
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

-- O assistente (asst_reader) enxerga a tabela nova já
do $$ begin perform public.fn_asst_reader_refresh(); exception when others then null; end $$;
