-- fin_purchase_catalog nunca teve GRANT nenhum: nem o service_role da Edge Function
-- conseguia gravar (42501 "permission denied" em upsert_purchase_catalog) nem o front
-- conseguia ler. Por isso a tabela estava vazia e o catálogo aparecia sempre sem itens,
-- sem nenhum erro na tela.
grant select on public.fin_purchase_catalog to authenticated;
grant select, insert, update, delete on public.fin_purchase_catalog to service_role;

alter table public.fin_purchase_catalog enable row level security;

-- A policy antiga comparava tenant_id com uma subquery correlacionada à própria linha
-- (tenant_id = tenant_id), então não isolava loja nenhuma. Substituída pelo mesmo
-- padrão das outras fin_*: leitura pelas lojas do usuário, escrita só pela Edge
-- Function com service_role (o front apenas lê esta tabela).
drop policy if exists tenant_isolation_purchase_catalog on public.fin_purchase_catalog;

drop policy if exists fin_purchase_catalog_select_auth on public.fin_purchase_catalog;
create policy fin_purchase_catalog_select_auth on public.fin_purchase_catalog
  for select to authenticated
  using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()));

drop policy if exists deny_direct_write_fin_purchase_catalog on public.fin_purchase_catalog;
create policy deny_direct_write_fin_purchase_catalog on public.fin_purchase_catalog
  for all to authenticated using (false) with check (false);

drop policy if exists service_role_bypass_fin_purchase_catalog on public.fin_purchase_catalog;
create policy service_role_bypass_fin_purchase_catalog on public.fin_purchase_catalog
  for all to service_role using (true) with check (true);
