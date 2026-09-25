-- 2026-09-25 — Fecha acessos anônimos/abertos demais achados na checagem de RLS.
-- O fluxo público (/mesa-qr, delivery) passa pelas Edge Functions com service_role,
-- então não precisa ler nem gravar essas tabelas direto. Desfazer: _rollback_rls_publico_20260925.sql

-- Mesas: anônimo lia qr_token de todas as lojas e podia alterar qualquer mesa.
drop policy if exists anon_select_tables on public.tables;
drop policy if exists anon_select_tables_active on public.tables;
drop policy if exists anon_update_tables on public.tables;
drop policy if exists anon_update_tables_status on public.tables;

-- Sessões de mesa: anônimo lia nome do cliente + session_token e criava sessões falsas.
drop policy if exists anon_select_table_sessions on public.table_sessions;
drop policy if exists anon_select_table_sessions_open on public.table_sessions;
drop policy if exists anon_insert_table_sessions on public.table_sessions;

-- Participantes: anônimo lia nome, telefone e access_token de todas as mesas.
-- Fica só a leitura pelo próprio token (table_session_participants_select_by_token).
drop policy if exists anon_select_table_session_participants on public.table_session_participants;
drop policy if exists anon_insert_table_session_participants on public.table_session_participants;

-- "Bypass do service_role" estava no papel public: qualquer logado de qualquer loja gravava.
alter policy service_role_bypass_fin_merchandise_categories on public.fin_merchandise_categories to service_role;
alter policy "Service role can do all on addresses" on public.delivery_customer_addresses to service_role;

-- Clientes do delivery: políticas abertas (o grant já bloqueava; tira para não depender disso).
drop policy if exists anon_all_delivery_customer_addresses on public.delivery_customer_addresses;
drop policy if exists anon_fk_check_select on public.delivery_customers;
drop policy if exists anon_fk_check_select on public.delivery_neighborhoods;

-- Lojas: anônimo só vê o que as telas públicas usam (delivery e /mesa); CNPJ, e-mail etc. saem.
revoke select on public.tenants from anon;
grant select (id, name, slug, logo_url, is_active) on public.tenants to anon;
