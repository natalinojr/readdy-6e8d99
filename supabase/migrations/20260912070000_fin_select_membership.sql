-- Leitura multi-loja no Financeiro (2026-09-12).
-- As policies de SELECT das tabelas fin_* usam get_user_tenant_id()/auth_tenant_id()
-- (= vínculo MAIS RECENTE do usuário) ou user_tenants LIMIT 1 sem ordem. Para quem
-- tem várias lojas, só UMA loja é legível: o dono (vínculos de platform owner com
-- created_at 2000-01-01) via Financeiro › Compras vazio na El Patron Paranaguá, com
-- 93 compras no banco. Mesmo padrão já usado em system_settings (2026-07-11): policy
-- PERMISSIVA de SELECT por vínculo real (auth_is_member_of). Não mexe em escrita.
-- Auditoria do front (107 consultas em fin_*): todas filtram por tenant_id ou id,
-- então nenhuma tela passa a misturar lojas. Tabelas de credenciais ficam de fora
-- (o front não as lê direto).
do $$
declare t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace and k.relrowsecurity
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name like 'fin\_%'
      and c.table_name not in ('fin_inter_config', 'fin_payment_provider_config', 'fin_stone_config')
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_membership', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.auth_is_member_of(tenant_id::uuid))', t || '_select_membership', t);
  end loop;
end $$;
