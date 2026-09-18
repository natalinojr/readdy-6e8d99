-- Notas de serviço (NFS-e) na Classificação de itens (2026-09-18).
--
-- Pedido do dono: "vamos deixar a classificação toda na aba de classificação". Até aqui a aba
-- só recebia itens de NF-e (modelo 55) e de compras; serviço (sistema, contador, marketing,
-- locação de chopeira…) era classificado conta a conta — a Voxy chegou como "conta sem
-- categoria" e não existia na aba. Agora:
--   1. Itens de NFS-e (modelo 10) entram na base com is_service = true (sempre despesa).
--      Chave = fornecedor + código do serviço (cTribNac), então "Locação de chopeira 30 L" e
--      "60 L" do mesmo fornecedor são um item só.
--   2. Classificar o item na aba grava a categoria DRE nas contas a pagar das notas dele
--      (nota lançada como despesa: fin_accounts_payable com reference_type 'nfe_entrada').
--      Vale também para NF-e lançada como despesa. Item "principal" da nota = o de maior valor.
--   3. Conta nova de nota (qualquer caminho: tela, lançamento automático) sem categoria já
--      nasce com a do item classificado.
--   4. Conta de nota classificada fora da aba (chat, enquete, Contas a pagar) ensina o item,
--      se ele ainda estava pendente — os dois caminhos convergem.
--   5. Carga: todas as NFS-e não ignoradas. Item cujas contas já lançadas têm UMA categoria só
--      herda essa categoria (decisão que o dono já tinha tomado conta a conta).

alter table public.fin_item_classifications
  add column if not exists is_service boolean not null default false;

-- Item principal de uma nota (o de maior valor): é ele que classifica a conta a pagar da nota.
create or replace function public.fn_item_doc_principal(p_doc uuid, out tenant_id uuid, out supplier_key text, out item_key text)
language sql stable security definer set search_path = public, extensions as $$
  select d.tenant_id,
         public.fn_item_supplier_key(d.emitente_cnpj, d.emitente_nome),
         public.fn_item_key(it->>'codigo', it->>'descricao')
    from public.fiscal_inbound_documents d
    cross join lateral jsonb_array_elements(case when jsonb_typeof(d.itens) = 'array' then d.itens else '[]'::jsonb end) it
   where d.id = p_doc
   order by case when coalesce(it->>'valor_total', '') ~ '^-?[0-9.]+$' then (it->>'valor_total')::numeric else 0 end desc
   limit 1
$$;

-- Itens de uma nota → base. NF-e (55) como antes; NFS-e (10) entra como serviço.
create or replace function public.fn_item_registry_ingest_doc(p_doc uuid) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  d record; it jsonb; sk text; cnpj text; ing uuid; n int := 0; r public.fin_item_classifications; cat uuid;
  servico boolean;
begin
  select id, tenant_id, modelo, itens, emitente_cnpj, emitente_nome, emitted_at, status into d from public.fiscal_inbound_documents where id = p_doc;
  if d.id is null or coalesce(d.modelo, 55) not in (55, 10) or d.itens is null or jsonb_typeof(d.itens) <> 'array' then return 0; end if;
  servico := d.modelo = 10;
  if servico and coalesce(d.status, '') = 'ignored' then return 0; end if;
  sk := public.fn_item_supplier_key(d.emitente_cnpj, d.emitente_nome);
  cnpj := regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g');
  for it in select * from jsonb_array_elements(d.itens) loop
    ing := null;
    if not servico then
      select l.ingredient_id into ing from public.fiscal_inbound_item_links l
       where l.tenant_id = d.tenant_id and l.supplier_cnpj = cnpj and l.supplier_code = btrim(coalesce(it->>'codigo', '')) limit 1;
    end if;
    r := public.fn_item_registry_touch(d.tenant_id, sk, d.emitente_nome, public.fn_item_key(it->>'codigo', it->>'descricao'),
      it->>'codigo', it->>'ean', it->>'ncm', it->>'descricao', it->>'unidade',
      case when coalesce(it->>'valor_unitario', '') ~ '^-?[0-9.]+$' then (it->>'valor_unitario')::numeric end,
      coalesce(d.emitted_at, now()), case when servico then 'nfse' else 'nfe' end, d.id, ing);
    if servico and r.id is not null then
      -- Serviço é sempre despesa: a sugestão por NCM/descrição (que pode dar CMV) não vale aqui.
      -- Sugere a categoria das contas já lançadas desse fornecedor, se houver.
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
end $$;

-- Grava a categoria dos itens (despesa) nas contas a pagar das notas lançadas como despesa.
create or replace function public.fn_item_apply_to_bills(p_tenant uuid, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare n int := 0;
begin
  with alvo as (
    select a.id as bill_id, f.dre_category_id as nova
      from public.fin_accounts_payable a
      join public.fiscal_inbound_documents d on d.id = a.reference_id and d.tenant_id = a.tenant_id
      cross join lateral public.fn_item_doc_principal(d.id) p
      join public.fin_item_classifications f on f.tenant_id = a.tenant_id and f.supplier_key = p.supplier_key and f.item_key = p.item_key
     where a.tenant_id = p_tenant and a.reference_type = 'nfe_entrada' and a.status <> 'cancelled'
       and f.id = any(p_ids) and f.classe = 'despesa' and f.dre_category_id is not null
  )
  update public.fin_accounts_payable a set dre_category_id = alvo.nova
    from alvo where a.id = alvo.bill_id and a.dre_category_id is distinct from alvo.nova;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.fn_item_classify(
  p_tenant uuid, p_ids uuid[], p_classe text,
  p_dre_category_id uuid default null, p_merchandise_category_id uuid default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare n_itens int := 0; n_lanc int := 0; n_contas int := 0;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant and ut.role::text in ('admin', 'manager')) then
    raise exception 'Apenas administradores podem classificar itens';
  end if;
  if p_classe is not null and p_classe not in ('cmv', 'despesa') then raise exception 'Classificação inválida'; end if;
  if p_classe = 'cmv' and exists (select 1 from public.fin_item_classifications f where f.tenant_id = p_tenant and f.id = any(p_ids) and f.is_service) then
    raise exception 'Serviço é sempre despesa: tire as notas de serviço da seleção para marcar como CMV';
  end if;
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

  -- Notas lançadas como despesa (serviço ou NF-e): a conta a pagar recebe a categoria
  n_contas := public.fn_item_apply_to_bills(p_tenant, p_ids);

  return json_build_object('itens', n_itens, 'lancamentos_atualizados', n_lanc + n_contas, 'contas_atualizadas', n_contas);
end $function$;

revoke all on function public.fn_item_classify(uuid, uuid[], text, uuid, uuid) from public, anon;
grant execute on function public.fn_item_classify(uuid, uuid[], text, uuid, uuid) to authenticated;

-- Conta de nota: nasce com a categoria do item (se veio sem) e, classificada por fora, ensina o item.
create or replace function public.fn_item_bill_sync() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare p record; f public.fin_item_classifications;
begin
  begin
    if new.reference_type is distinct from 'nfe_entrada' or new.reference_id is null then return new; end if;
    select * into p from public.fn_item_doc_principal(new.reference_id);
    if p.item_key is null or p.tenant_id is distinct from new.tenant_id then return new; end if;
    select * into f from public.fin_item_classifications x
     where x.tenant_id = new.tenant_id and x.supplier_key = p.supplier_key and x.item_key = p.item_key;
    if f.id is null then return new; end if;

    if tg_op = 'INSERT' then
      if new.dre_category_id is null and f.classe = 'despesa' then new.dre_category_id := f.dre_category_id; end if;
    elsif new.dre_category_id is not null and new.dre_category_id is distinct from old.dre_category_id and f.classe is null
          and exists (select 1 from public.fin_dre_categories c where c.id = new.dre_category_id and c.group_type not in ('revenue', 'tax', 'cost')) then
      update public.fin_item_classifications set
          classe = 'despesa', dre_category_id = new.dre_category_id, auto_classified = false,
          classified_by = auth.uid(), classified_at = now(), updated_at = now()
       where id = f.id;
    end if;
  exception when others then
    raise warning 'fn_item_bill_sync: %', sqlerrm; -- nunca impede lançar ou classificar a conta
  end;
  return new;
end $$;
drop trigger if exists trg_item_bill_sync_ins on public.fin_accounts_payable;
create trigger trg_item_bill_sync_ins before insert on public.fin_accounts_payable
  for each row execute function public.fn_item_bill_sync();
drop trigger if exists trg_item_bill_sync_upd on public.fin_accounts_payable;
create trigger trg_item_bill_sync_upd before update of dre_category_id on public.fin_accounts_payable
  for each row execute function public.fn_item_bill_sync();

revoke execute on function public.fn_item_doc_principal(uuid) from public, anon, authenticated;
revoke execute on function public.fn_item_apply_to_bills(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.fn_item_registry_ingest_doc(uuid) from public, anon, authenticated;

-- Carga: NFS-e já recebidas; depois, item com UMA categoria nas contas já lançadas herda ela.
do $$
declare d record; f record;
begin
  for d in select id from public.fiscal_inbound_documents where modelo = 10 order by emitted_at nulls first loop
    perform public.fn_item_registry_ingest_doc(d.id);
  end loop;
  for f in
    select x.id, x.tenant_id, min(a.dre_category_id::text)::uuid as cat
      from public.fin_item_classifications x
      join public.fiscal_inbound_documents doc on doc.tenant_id = x.tenant_id and doc.modelo = 10
      cross join lateral public.fn_item_doc_principal(doc.id) p
      join public.fin_accounts_payable a on a.reference_id = doc.id and a.reference_type = 'nfe_entrada' and a.status <> 'cancelled'
      join public.fin_dre_categories c on c.id = a.dre_category_id and c.group_type not in ('revenue', 'tax', 'cost')
     where x.is_service and x.classe is null and p.supplier_key = x.supplier_key and p.item_key = x.item_key
     group by x.id, x.tenant_id
    having count(distinct a.dre_category_id) = 1
  loop
    update public.fin_item_classifications set classe = 'despesa', dre_category_id = f.cat, auto_classified = false,
        classified_at = now(), suggestion_reason = 'mesma categoria das contas já lançadas', updated_at = now()
     where id = f.id;
    perform public.fn_item_apply_to_bills(f.tenant_id, array[f.id]);
  end loop;
end $$;
