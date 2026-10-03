-- Gerente segue a matriz em /usuarios (decisão do dono, 2026-10-03).
-- Antes: a lista e a edição eram só do Admin (fn_is_tenant_admin), mas o gerente abria a tela
-- pela URL e criava/apagava/trocava senha e PIN pela edge user-write sem olhar a matriz.
-- Agora a regra é a mesma na edge e aqui: o gerente gerencia usuários da loja só onde o Admin
-- marcou "Gerenciar usuários" para o Gerente (permissions: role manager, usuarios_gerenciar),
-- e só mexe em quem está abaixo dele (nem Admin, nem Gerente) em TODAS as lojas do alvo —
-- nome, ativo e matrícula são globais (tabela users).

create or replace function public.fn_gerencia_usuarios(p_tenant_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from user_tenants ut
    where ut.user_id = auth.uid()
      and ut.tenant_id = p_tenant_id
      and (
        ut.role = 'admin'
        or (ut.role = 'manager' and exists (
          select 1 from permissions p
          where p.tenant_id = p_tenant_id
            and p.role = 'manager'
            and p.permission_key = 'usuarios_gerenciar'
            and p.allowed is true
        ))
      )
  );
$$;

-- Em cada loja do alvo, quem chama precisa ser Admin, ou Gerente com a permissão e alvo abaixo
-- de Gerente. Dono da plataforma passa (como antes).
create or replace function public.fn_pode_alterar_usuario(p_user_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select public.is_platform_owner(auth.uid()) or (
    exists (select 1 from user_tenants where user_id = p_user_id)
    and not exists (
      select 1 from user_tenants t
      where t.user_id = p_user_id
        and not exists (
          select 1 from user_tenants c
          where c.user_id = auth.uid()
            and c.tenant_id = t.tenant_id
            and (
              c.role = 'admin'
              or (c.role = 'manager'
                  and t.role not in ('admin', 'manager')
                  and public.fn_gerencia_usuarios(t.tenant_id))
            )
        )
    )
  );
$$;

revoke all on function public.fn_gerencia_usuarios(uuid) from public, anon, authenticated;
revoke all on function public.fn_pode_alterar_usuario(uuid) from public, anon, authenticated;

create or replace function public.fn_get_users_list(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  if not fn_gerencia_usuarios(p_tenant_id) then
    raise exception 'Apenas o administrador da loja (ou gerente com "Gerenciar usuários") pode listar usuarios';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'nome', u.name,
      'email', u.email,
      'matricula', coalesce(u.badge_number, ''),
      'perfil', ut.role::text,
      'loja', t.name,
      'ativo', u.is_active,
      'modoTreino', coalesce(ut.training_mode, false),
      'ultimoAcesso', u.last_access_at,
      'diasDesdeAcesso', case
        when u.last_access_at is null then null
        else floor(extract(epoch from (now() - u.last_access_at)) / 86400)::int
      end,
      'kioskOnline', coalesce(u.kiosk_online, false),
      'criadoEm', u.created_at
    )
    order by u.created_at asc
  )
  into v_result
  from user_tenants ut
  join users u on u.id = ut.user_id
  join tenants t on t.id = ut.tenant_id
  where ut.tenant_id = p_tenant_id
    and not public.is_platform_owner(ut.user_id);
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.fn_update_user(p_user_id uuid, p_tenant_id uuid, p_nome text, p_role text, p_training_mode boolean, p_is_active boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not fn_gerencia_usuarios(p_tenant_id) then
    raise exception 'Apenas o administrador da loja (ou gerente com "Gerenciar usuários") pode editar usuarios';
  end if;

  if not exists (select 1 from user_tenants where user_id = p_user_id and tenant_id = p_tenant_id) then
    raise exception 'Usuario nao pertence a esta loja';
  end if;

  if public.is_platform_owner(p_user_id) and p_user_id is distinct from auth.uid() then
    raise exception 'Sem permissao: este usuario so pode ser alterado por ele mesmo';
  end if;

  if not public.fn_pode_alterar_usuario(p_user_id) then
    raise exception 'Sem permissao: usuario e Admin/Gerente ou pertence a loja onde voce nao pode altera-lo';
  end if;

  -- Gerente só dá papéis abaixo do seu.
  if not fn_is_tenant_admin(p_tenant_id) and not public.is_platform_owner(auth.uid())
     and p_role in ('admin', 'manager') then
    raise exception 'Sem permissao: gerente nao define perfil Admin ou Gerente';
  end if;

  update users
  set name = p_nome,
      is_active = p_is_active
  where id = p_user_id;

  update user_tenants
  set role = p_role::user_role,
      training_mode = p_training_mode
  where user_id = p_user_id and tenant_id = p_tenant_id;

  return true;
end;
$$;

create or replace function public.fn_toggle_user_active(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_new_state boolean;
begin
  if not exists (
    select 1 from user_tenants target
    where target.user_id = p_user_id
      and fn_gerencia_usuarios(target.tenant_id)
  ) then
    raise exception 'Sem permissao para alterar este usuario';
  end if;

  if public.is_platform_owner(p_user_id) and p_user_id is distinct from auth.uid() then
    raise exception 'Sem permissao: este usuario so pode ser alterado por ele mesmo';
  end if;

  if not public.fn_pode_alterar_usuario(p_user_id) then
    raise exception 'Sem permissao: usuario e Admin/Gerente ou pertence a loja onde voce nao pode altera-lo';
  end if;

  update users
  set is_active = not is_active
  where id = p_user_id
  returning is_active into v_new_state;
  return v_new_state;
end;
$$;

create or replace function public.fn_set_user_badge(p_user_id uuid, p_tenant_id uuid, p_badge text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_badge text := btrim(coalesce(p_badge, ''));
begin
  if not fn_gerencia_usuarios(p_tenant_id) then
    raise exception 'Apenas o administrador da loja (ou gerente com "Gerenciar usuários") pode editar usuarios';
  end if;

  if not exists (select 1 from user_tenants where user_id = p_user_id and tenant_id = p_tenant_id) then
    raise exception 'Usuario nao pertence a esta loja';
  end if;

  if public.is_platform_owner(p_user_id) and p_user_id is distinct from auth.uid() then
    raise exception 'Sem permissao: este usuario so pode ser alterado por ele mesmo';
  end if;

  if not public.fn_pode_alterar_usuario(p_user_id) then
    raise exception 'Sem permissao: usuario e Admin/Gerente ou pertence a loja onde voce nao pode altera-lo';
  end if;

  if v_badge !~ '^[0-9]{1,10}$' then
    raise exception 'Matrícula deve ter de 1 a 10 dígitos';
  end if;

  if exists (select 1 from users where badge_number = v_badge and id <> p_user_id) then
    raise exception 'Matrícula % já está em uso por outro usuário', v_badge;
  end if;

  update users set badge_number = v_badge where id = p_user_id;
  return true;
exception when unique_violation then
  raise exception 'Matrícula % já está em uso por outro usuário', v_badge;
end;
$$;
