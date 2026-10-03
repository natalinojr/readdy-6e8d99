-- user_tenants: escrita direta pela API fechada (2026-10-03).
-- A policy permissiva user_tenants_update deixava admin E GERENTE darem UPDATE direto (PostgREST)
-- nos vínculos da loja ativa sem olhar o papel novo — o gerente se promovia a admin (testado com
-- qa.gerente numa transação desfeita). user_tenants_insert deixava criar vínculo com qualquer papel.
-- A deny_direct_write_user_tenants existia, mas PERMISSIVE com USING false não nega nada (só soma).
-- Toda escrita legítima já passa por função SECURITY DEFINER (fn_update_user,
-- fn_grant/revoke_tenant_access, fn_admin_*, bootstrap/setup, gatilho do dono da plataforma) ou por
-- edge com service role (user-write, kiosk-auth, setup-tenant); o front não grava a tabela direto.
-- Leitura não muda.

drop policy if exists user_tenants_insert on public.user_tenants;
drop policy if exists user_tenants_update on public.user_tenants;
drop policy if exists user_tenants_delete on public.user_tenants;
drop policy if exists deny_direct_write_user_tenants on public.user_tenants;

create policy deny_direct_insert_user_tenants on public.user_tenants
  as restrictive for insert to authenticated, anon
  with check (false);

create policy deny_direct_update_user_tenants on public.user_tenants
  as restrictive for update to authenticated, anon
  using (false) with check (false);

create policy deny_direct_delete_user_tenants on public.user_tenants
  as restrictive for delete to authenticated, anon
  using (false);
