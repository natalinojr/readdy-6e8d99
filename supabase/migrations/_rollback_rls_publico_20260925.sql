-- DESFAZER rls_fechar_acesso_publico (2026-09-25): rodar só se o fluxo público quebrar.
drop policy if exists service_role_bypass_fin_merchandise_categories on public.fin_merchandise_categories;
drop policy if exists "Service role can do all on addresses" on public.delivery_customer_addresses;
grant select on public.tenants to anon;
create policy anon_select_tables on public.tables as PERMISSIVE for SELECT to anon using (true);
create policy anon_select_tables_active on public.tables as PERMISSIVE for SELECT to anon using ((is_active = true));
create policy anon_update_tables on public.tables as PERMISSIVE for UPDATE to anon using (true) with check (true);
create policy anon_update_tables_status on public.tables as PERMISSIVE for UPDATE to anon using ((is_active = true)) with check (true);
create policy anon_insert_table_sessions on public.table_sessions as PERMISSIVE for INSERT to anon with check (true);
create policy anon_select_table_sessions on public.table_sessions as PERMISSIVE for SELECT to anon using (true);
create policy anon_select_table_sessions_open on public.table_sessions as PERMISSIVE for SELECT to anon using ((status = 'open'::record_status));
create policy anon_insert_table_session_participants on public.table_session_participants as PERMISSIVE for INSERT to anon with check (true);
create policy anon_select_table_session_participants on public.table_session_participants as PERMISSIVE for SELECT to anon using (true);
create policy anon_fk_check_select on public.delivery_neighborhoods as PERMISSIVE for SELECT to anon using (true);
create policy anon_fk_check_select on public.delivery_customers as PERMISSIVE for SELECT to anon using (true);
create policy "Service role can do all on addresses" on public.delivery_customer_addresses as PERMISSIVE for ALL to public using (true) with check (true);
create policy anon_all_delivery_customer_addresses on public.delivery_customer_addresses as PERMISSIVE for ALL to anon using (true) with check (true);
create policy service_role_bypass_fin_merchandise_categories on public.fin_merchandise_categories as PERMISSIVE for ALL to public using (true) with check (true);
