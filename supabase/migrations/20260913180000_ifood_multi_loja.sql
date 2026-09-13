-- Mais de uma loja iFood no mesmo tenant (Paranaguá tem duas): a importação passa a ser
-- por loja + competência. Antes o unique (tenant_id, competence) fazia o relatório da
-- segunda loja SUBSTITUIR o da primeira. merchant_id = coluna loja_id (uuid) do relatório.
alter table public.fin_ifood_imports add column if not exists merchant_id text not null default '';
alter table public.fin_ifood_imports add column if not exists merchant_short text;
alter table public.fin_ifood_entries add column if not exists merchant_id text;
alter table public.fin_ifood_entries add column if not exists merchant_short text;

update public.fin_ifood_entries
   set merchant_id = coalesce(raw->>'loja_id', raw->>'loja_id_curto'),
       merchant_short = raw->>'loja_id_curto'
 where merchant_id is null;

update public.fin_ifood_imports i
   set merchant_id = coalesce((select e.merchant_id from public.fin_ifood_entries e where e.import_id = i.id and e.merchant_id is not null limit 1), ''),
       merchant_short = (select e.merchant_short from public.fin_ifood_entries e where e.import_id = i.id and e.merchant_short is not null limit 1)
 where i.merchant_id = '';

alter table public.fin_ifood_imports drop constraint if exists fin_ifood_imports_tenant_id_competence_key;
alter table public.fin_ifood_imports drop constraint if exists fin_ifood_imports_tenant_merchant_comp_key;
alter table public.fin_ifood_imports add constraint fin_ifood_imports_tenant_merchant_comp_key unique (tenant_id, merchant_id, competence);
create index if not exists idx_ifood_entries_tenant_comp on public.fin_ifood_entries (tenant_id, competence, merchant_id);
