-- ═══════════════════════════════════════════════════════════════════════════
-- Admin Master: acesso por usuário a módulos sem loja (Tarefas, Contratação)
-- + gestão de vínculos usuário × loja × papel.
-- Aplicado direto via mcp__supabase__apply_migration (db push falha neste repo).
-- Este arquivo é o registro/fonte de verdade do que já está no ar.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.user_module_access (
  user_id uuid not null references public.users(id) on delete cascade,
  module text not null check (module in ('tarefas','contratacao')),
  granted_at timestamptz not null default now(),
  primary key (user_id, module)
);
alter table public.user_module_access enable row level security;
drop policy if exists user_module_access_self_select on public.user_module_access;
create policy user_module_access_self_select on public.user_module_access for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.user_module_access to authenticated;
grant all on public.user_module_access to service_role;

-- Backfill: quem hoje vê Tarefas (papel admin/gerente/tarefas em alguma loja) continua vendo.
insert into public.user_module_access (user_id, module)
select distinct ut.user_id, 'tarefas' from public.user_tenants ut
where ut.role in ('admin','manager','tasks_only')
on conflict do nothing;
insert into public.user_module_access (user_id, module)
select u.id, 'contratacao' from public.users u where lower(u.email) = 'natalinojr.engel@gmail.com'
on conflict do nothing;

-- Contratação: dono OU usuário liberado no Admin Master (RLS de hiring_* e bucket curriculos).
create or replace function public.is_hiring_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'natalinojr.engel@gmail.com', false)
      or exists (select 1 from public.user_module_access
                 where user_id = auth.uid() and module = 'contratacao');
$$;

-- Módulos do usuário logado. Dono vê tudo; papel "tarefas" sempre tem Tarefas
-- (senão o hard-lock da RotaProtegida entraria em loop).
create or replace function public.fn_my_modules()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select case
    when lower(coalesce(auth.jwt() ->> 'email','')) = 'natalinojr.engel@gmail.com'
      then array['tarefas','contratacao']
    else array(
      select module from public.user_module_access where user_id = auth.uid()
      union
      select 'tarefas' from public.user_tenants where user_id = auth.uid() and role = 'tasks_only'
    )
  end;
$$;
grant execute on function public.fn_my_modules() to authenticated;

create or replace function public.fn_admin_list_users_v4()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.fn_assert_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'name', u.name, 'nickname', u.nickname,
      'created_at', u.created_at, 'last_sign_in_at', au.last_sign_in_at,
      'is_active', u.is_active,
      'memberships', coalesce((
        select jsonb_agg(jsonb_build_object('tenant_id', t.id, 'tenant_name', t.name, 'role', ut.role) order by t.name)
        from public.user_tenants ut join public.tenants t on t.id = ut.tenant_id
        where ut.user_id = u.id), '[]'::jsonb),
      'modules', coalesce((
        select jsonb_agg(m.module order by m.module) from public.user_module_access m where m.user_id = u.id), '[]'::jsonb)
    ) order by u.created_at desc)
    from public.users u left join auth.users au on au.id = u.id
    where u.deleted_at is null), '[]'::jsonb);
end $$;

create or replace function public.fn_admin_set_user_tenant(p_user_id uuid, p_tenant_id uuid, p_role text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.fn_assert_platform_admin();
  if p_role not in ('admin','manager','cashier','waiter','kitchen','delivery_manager','tasks_only') then
    raise exception 'papel inválido: %', p_role;
  end if;
  insert into public.user_tenants (user_id, tenant_id, role)
  values (p_user_id, p_tenant_id, p_role::user_role)
  on conflict (user_id, tenant_id) do update set role = excluded.role, updated_at = now();
end $$;

create or replace function public.fn_admin_remove_user_tenant(p_user_id uuid, p_tenant_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.fn_assert_platform_admin();
  delete from public.user_tenants where user_id = p_user_id and tenant_id = p_tenant_id;
end $$;

create or replace function public.fn_admin_set_module_access(p_user_id uuid, p_module text, p_enabled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.fn_assert_platform_admin();
  if p_module not in ('tarefas','contratacao') then raise exception 'módulo inválido: %', p_module; end if;
  if p_enabled then
    insert into public.user_module_access (user_id, module) values (p_user_id, p_module) on conflict do nothing;
  else
    delete from public.user_module_access where user_id = p_user_id and module = p_module;
  end if;
end $$;

revoke all on function public.fn_admin_list_users_v4() from public, anon;
revoke all on function public.fn_admin_set_user_tenant(uuid, uuid, text) from public, anon;
revoke all on function public.fn_admin_remove_user_tenant(uuid, uuid) from public, anon;
revoke all on function public.fn_admin_set_module_access(uuid, text, boolean) from public, anon;
grant execute on function public.fn_admin_list_users_v4() to authenticated;
grant execute on function public.fn_admin_set_user_tenant(uuid, uuid, text) to authenticated;
grant execute on function public.fn_admin_remove_user_tenant(uuid, uuid) to authenticated;
grant execute on function public.fn_admin_set_module_access(uuid, text, boolean) to authenticated;
