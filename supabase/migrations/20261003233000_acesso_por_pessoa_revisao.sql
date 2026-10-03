-- Acesso por pessoa — correções da revisão (2026-10-03).
--
-- 1. fn_acesso_pessoa_gravar confere que o cargo ainda é o que a Edge conferiu (p_role_atual): sem
--    isso, uma troca de cargo no meio (outra tela, outra pessoa) era sobrescrita.
-- 2. O supervisor (manager) com "Cadastra pessoas" só mexe em quem está abaixo dele de verdade
--    (Líder, Caixa, Garçom, Cozinha, Gestor de Entregas, Totem) e só dá esses cargos. Antes ele podia
--    pôr alguém em Financeiro/Contabilidade (só recusava admin/manager) — dinheiro por um caminho que
--    a regra do dono não permite. Mesma lista da Edge user-write e de _shared/acesso-pessoa.ts.
-- 3. Trocar o cargo pelo "Editar" apaga o ajuste da pessoa naquela loja (foi calculado contra o cargo
--    antigo e passaria a valer por cima do novo).
-- 4. Financeiro por ajuste da pessoa: o ajuste só TIRA de quem já é do financeiro pelo cargo (gerente,
--    financeiro) — não dá a outro cargo. Em auth_lojas_financeiro, linha "sim" da pessoa só conta para
--    as chaves extras pedidas (ex.: gestao_pedidos), nunca para fin_*.
-- 5. user_permissions sai do realtime: apagar linha manda a chave para qualquer assinante (DELETE não
--    passa pela RLS). O app relê ao voltar para a tela.

drop function if exists public.fn_acesso_pessoa_gravar(uuid, uuid, text, jsonb, uuid);
create or replace function public.fn_acesso_pessoa_gravar(p_tenant uuid, p_user uuid, p_role_atual text, p_role text, p_linhas jsonb, p_por uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.user_tenants
   where tenant_id = p_tenant and user_id = p_user and role::text = p_role_atual
   for update;
  if not found then
    raise exception 'O cargo desta pessoa mudou enquanto você editava. Abra de novo e confira.';
  end if;
  if p_role is not null then
    update public.user_tenants set role = p_role::public.user_role where tenant_id = p_tenant and user_id = p_user;
  end if;
  delete from public.user_permissions where tenant_id = p_tenant and user_id = p_user;
  insert into public.user_permissions (tenant_id, user_id, permission_key, allowed, updated_by)
  select p_tenant, p_user, x->>'permission_key', (x->>'allowed')::boolean, p_por
    from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) x;
end $$;
revoke all on function public.fn_acesso_pessoa_gravar(uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.fn_acesso_pessoa_gravar(uuid, uuid, text, text, jsonb, uuid) to service_role;

-- 2. Quem o supervisor pode alterar: alvo abaixo dele em TODAS as lojas que dividem.
create or replace function public.fn_pode_alterar_usuario(p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
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
                  and t.role::text in ('supervisor', 'cashier', 'waiter', 'kitchen', 'delivery_manager', 'tablet')
                  and public.fn_gerencia_usuarios(t.tenant_id))
            )
        )
    )
  );
$$;

create or replace function public.fn_update_user(p_user_id uuid, p_tenant_id uuid, p_nome text, p_role text, p_training_mode boolean, p_is_active boolean)
returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare v_role_antes text;
begin
  if not fn_gerencia_usuarios(p_tenant_id) then
    raise exception 'Apenas o administrador da loja (ou supervisor com "Gerenciar usuários") pode editar usuarios';
  end if;

  select role::text into v_role_antes from user_tenants where user_id = p_user_id and tenant_id = p_tenant_id;
  if v_role_antes is null then
    raise exception 'Usuario nao pertence a esta loja';
  end if;

  if public.is_platform_owner(p_user_id) and p_user_id is distinct from auth.uid() then
    raise exception 'Sem permissao: este usuario so pode ser alterado por ele mesmo';
  end if;

  if not public.fn_pode_alterar_usuario(p_user_id) then
    raise exception 'Sem permissao: usuario e Admin/Supervisor ou pertence a loja onde voce nao pode altera-lo';
  end if;

  -- Supervisor só dá os cargos de baixo (nunca Admin, Supervisor, Financeiro, Contabilidade nem Tarefas).
  if not fn_is_tenant_admin(p_tenant_id) and not public.is_platform_owner(auth.uid())
     and p_role not in ('supervisor', 'cashier', 'waiter', 'kitchen', 'delivery_manager', 'tablet') then
    raise exception 'Sem permissao: o supervisor so define Lider, Caixa, Garcom, Cozinha, Gestor de Entregas ou Totem';
  end if;

  update users
  set name = p_nome,
      is_active = p_is_active
  where id = p_user_id;

  update user_tenants
  set role = p_role::user_role,
      training_mode = p_training_mode
  where user_id = p_user_id and tenant_id = p_tenant_id;

  -- 3. Cargo mudou: o ajuste da pessoa nesta loja era contra o cargo antigo.
  if v_role_antes is distinct from p_role then
    delete from public.user_permissions where user_id = p_user_id and tenant_id = p_tenant_id;
  end if;

  return true;
end;
$$;

-- 4. Financeiro por ajuste da pessoa só tira (de quem já é do financeiro pelo cargo).
create or replace function public._acerto_motoboy_pode(p_tenant uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is null or exists (
    select 1 from user_tenants ut
     where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and (ut.role::text = 'admin'
            or (ut.role::text in ('manager', 'financeiro')
                and coalesce(
                  (select up.allowed from user_permissions up
                    where up.tenant_id = p_tenant and up.user_id = auth.uid() and up.permission_key = 'fin_entregadores'),
                  not exists (select 1 from permissions p
                               where p.tenant_id = p_tenant and p.role::text = ut.role::text
                                 and p.permission_key = 'fin_entregadores' and p.allowed = false))))
  );
$$;

create or replace function public._beneficio_pode(p_tenant uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is null or exists (
    select 1 from user_tenants ut
     where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and (ut.role::text = 'admin'
            or (ut.role::text in ('manager', 'financeiro')
                and coalesce(
                  (select up.allowed from user_permissions up
                    where up.tenant_id = p_tenant and up.user_id = auth.uid() and up.permission_key = 'fin_rh'),
                  not exists (select 1 from permissions p
                               where p.tenant_id = p_tenant and p.role::text = ut.role::text
                                 and p.permission_key = 'fin_rh' and p.allowed = false))))
  );
$$;

create or replace function public.auth_lojas_financeiro(p_chaves text[] default '{}'::text[])
returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  select ut.tenant_id
  from public.user_tenants ut
  where ut.user_id = auth.uid()
    and (
      ut.role in ('admin', 'manager', 'financeiro', 'accountant')
      or exists (
        select 1 from (
          select p.permission_key as k from public.permissions p
           where p.tenant_id = ut.tenant_id and p.role = ut.role and p.allowed
            and (p.permission_key like 'fin\_%' or p.permission_key = any (p_chaves))
          union
          -- a pessoa só ganha por ajuste as chaves extras pedidas (ex.: gestao_pedidos), nunca fin_*
          select up.permission_key from public.user_permissions up
           where up.tenant_id = ut.tenant_id and up.user_id = ut.user_id and up.allowed
             and up.permission_key = any (p_chaves) and up.permission_key not like 'fin\_%'
        ) x
        where not exists (select 1 from public.user_permissions n
                           where n.tenant_id = ut.tenant_id and n.user_id = ut.user_id
                             and n.permission_key = x.k and not n.allowed)
      )
      or (
        ut.role = 'supervisor' and 'gestao_pedidos' = any (p_chaves)
        and not exists (
          select 1 from public.permissions p
          where p.tenant_id = ut.tenant_id and p.role = ut.role
            and p.permission_key = 'gestao_pedidos' and not p.allowed
        )
        and not exists (
          select 1 from public.user_permissions n
          where n.tenant_id = ut.tenant_id and n.user_id = ut.user_id
            and n.permission_key = 'gestao_pedidos' and not n.allowed
        )
      )
    )
$$;

-- 5. Fora do realtime.
do $$ begin
  alter publication supabase_realtime drop table public.user_permissions;
exception when undefined_object then null; end $$;
