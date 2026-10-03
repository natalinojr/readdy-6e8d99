-- Nota de serviço ignorada tira o item da Classificação de itens (2026-10-03).
--
-- Caso do dono (Paranaguá): mensalidade do iFood, Top Placement do iFood e taxa da Goomer
-- apareciam em "Classificar item" pedindo CMV × despesa. São taxas que a plataforma já desconta
-- do repasse (o repasse do iFood entra no razão como "Taxas iFood"), e as notas já estavam
-- IGNORADAS em Notas de entrada. O item ficou preso porque entrou na base quando a nota ainda
-- estava "new"; o ingest só pula NFS-e que JÁ chega ignorada (fn_item_registry_ingest_doc).
-- Classificar como despesa não lançava nada, mas a nota relançada depois herdaria a categoria.
--
-- Regra (vale para todas as lojas):
--   1. NFS-e passa a "ignored": sai da base o item de serviço AINDA PENDENTE (classe nula, sem
--      insumo) que não tem mais nenhuma NFS-e não ignorada. Item já classificado fica (é
--      aprendizado e não cobra nada).
--   2. NFS-e deixa de ser ignorada: o item volta pelo mesmo ingest de sempre.
--   3. Carga: apaga os pendentes que já estão nessa situação.
-- Todas as contagens ("N itens sem classificação" do Hoje/caixa/cron) são classe nula, então
-- não precisam mudar.

create or replace function public.fn_item_servico_sem_nota(p_tenant uuid, p_supplier_key text, p_item_keys text[])
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare n int := 0;
begin
  delete from public.fin_item_classifications f
   where f.tenant_id = p_tenant and f.supplier_key = p_supplier_key
     and (p_item_keys is null or f.item_key = any(p_item_keys))
     and f.is_service and f.classe is null and f.ingredient_id is null
     and not exists (
       select 1 from public.fiscal_inbound_documents d
        cross join lateral jsonb_array_elements(case when jsonb_typeof(d.itens) = 'array' then d.itens else '[]'::jsonb end) it
        where d.tenant_id = f.tenant_id and d.modelo = 10 and coalesce(d.status, '') <> 'ignored'
          and public.fn_item_supplier_key(d.emitente_cnpj, d.emitente_nome) = f.supplier_key
          and public.fn_item_key(it->>'codigo', it->>'descricao') = f.item_key);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.fn_item_servico_sem_nota(uuid, text, text[]) from public, anon, authenticated;

create or replace function public.fn_item_registry_doc_status() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    if coalesce(new.modelo, 55) <> 10 then return new; end if;
    if new.status = 'ignored' and old.status is distinct from 'ignored' then
      perform public.fn_item_servico_sem_nota(
        new.tenant_id, public.fn_item_supplier_key(new.emitente_cnpj, new.emitente_nome),
        array(select public.fn_item_key(it->>'codigo', it->>'descricao')
                from jsonb_array_elements(case when jsonb_typeof(new.itens) = 'array' then new.itens else '[]'::jsonb end) it));
    elsif old.status = 'ignored' and new.status is distinct from 'ignored' then
      perform public.fn_item_registry_ingest_doc(new.id);
    end if;
  exception when others then
    raise warning 'fn_item_registry_doc_status(%): %', new.id, sqlerrm; -- nunca impede ignorar/lançar a nota
  end;
  return new;
end $$;
revoke execute on function public.fn_item_registry_doc_status() from public, anon, authenticated;

drop trigger if exists trg_item_registry_doc_status on public.fiscal_inbound_documents;
create trigger trg_item_registry_doc_status after update of status on public.fiscal_inbound_documents
  for each row execute function public.fn_item_registry_doc_status();

-- Carga: pendentes de serviço que já não têm nota viva (em 03/10: 3 itens de Paranaguá).
do $$
declare f record;
begin
  for f in select distinct tenant_id, supplier_key from public.fin_item_classifications
            where is_service and classe is null and ingredient_id is null loop
    perform public.fn_item_servico_sem_nota(f.tenant_id, f.supplier_key, null);
  end loop;
end $$;
