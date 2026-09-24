-- Admin Master passa a aceitar o papel 'supervisor' ao vincular usuário a uma loja.
CREATE OR REPLACE FUNCTION public.fn_admin_set_user_tenant(p_user_id uuid, p_tenant_id uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.fn_assert_platform_admin();
  if p_role not in ('admin','manager','supervisor','cashier','waiter','kitchen','delivery_manager','tasks_only','financeiro') then
    raise exception 'papel inválido: %', p_role;
  end if;
  insert into public.user_tenants (user_id, tenant_id, role)
  values (p_user_id, p_tenant_id, p_role::user_role)
  on conflict (user_id, tenant_id) do update set role = excluded.role, updated_at = now();
end $function$;
