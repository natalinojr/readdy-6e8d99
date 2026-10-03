-- Acesso por pessoa (2026-10-03). Pedido do dono: em vez do cargo + grade de 81 permissões, a tela
-- pergunta "o que essa pessoa faz?" e cada loja tem a sua configuração para aquela pessoa.
--
-- Camadas (a de baixo vale até a de cima mudar):
--   1. padrão do cargo no código (usePermissoes › DEFAULT_PERMISSOES / _shared/permissoes-padrao.ts)
--   2. ajuste do cargo na loja (tabela permissions — Configurações › Permissões)
--   3. ajuste da PESSOA na loja (esta tabela) — allowed true acrescenta, false tira
--
-- Gravação só pela Edge acesso-pessoa (service_role), que confere quem pode dar o quê: o dono (admin)
-- tudo; o gerente só para quem está abaixo dele na loja, só o que ele mesmo tem e nunca dinheiro nem
-- cadastro de pessoas (lista KEYS_SO_DONO). Sair da loja apaga o ajuste (FK em user_tenants).
create table if not exists public.user_permissions (
  tenant_id uuid not null,
  user_id uuid not null,
  permission_key text not null,
  allowed boolean not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, permission_key),
  foreign key (user_id, tenant_id) references public.user_tenants (user_id, tenant_id) on delete cascade
);
create index if not exists user_permissions_user on public.user_permissions (user_id, tenant_id);

alter table public.user_permissions enable row level security;
-- Leitura: a própria pessoa (o app monta as permissões dela) e o admin/gerente da loja (tela de acesso).
-- Escrita: nenhuma policy — só a Edge com service_role grava.
drop policy if exists user_permissions_select on public.user_permissions;
create policy user_permissions_select on public.user_permissions for select to authenticated
  using (
    user_id = (select auth.uid())
    or tenant_id in (select ut.tenant_id from public.user_tenants ut
                      where ut.user_id = (select auth.uid()) and ut.role::text in ('admin', 'manager'))
  );
grant select on public.user_permissions to authenticated;
grant all on public.user_permissions to service_role;

-- O app relê as permissões na hora em que o ajuste muda (como já faz com permissions).
do $$ begin
  alter publication supabase_realtime add table public.user_permissions;
exception when duplicate_object then null; end $$;

comment on table public.user_permissions is 'Acesso por pessoa: ajuste de permissão de uma pessoa numa loja, por cima do padrão do cargo (tela Usuários › Acesso).';

-- Grava cargo + ajuste da pessoa numa loja de uma vez (tudo ou nada). Só a Edge acesso-pessoa chama
-- (service_role), DEPOIS de conferir quem pode dar o quê (_shared/acesso-pessoa.ts › conferirAcesso).
create or replace function public.fn_acesso_pessoa_gravar(p_tenant uuid, p_user uuid, p_role text, p_linhas jsonb, p_por uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_role is not null then
    update public.user_tenants set role = p_role::public.user_role where tenant_id = p_tenant and user_id = p_user;
  end if;
  if not exists (select 1 from public.user_tenants where tenant_id = p_tenant and user_id = p_user) then
    raise exception 'A pessoa não é desta loja.';
  end if;
  delete from public.user_permissions where tenant_id = p_tenant and user_id = p_user;
  insert into public.user_permissions (tenant_id, user_id, permission_key, allowed, updated_by)
  select p_tenant, p_user, x->>'permission_key', (x->>'allowed')::boolean, p_por
    from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) x;
end $$;
revoke all on function public.fn_acesso_pessoa_gravar(uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.fn_acesso_pessoa_gravar(uuid, uuid, text, jsonb, uuid) to service_role;

-- "Cadastra pessoas da equipe" agora pode ser dado ao gerente pela tela de acesso dele (só o dono dá):
-- o ajuste da pessoa vale por cima da matriz do cargo (sim ou não), como no app.
create or replace function public.fn_gerencia_usuarios(p_tenant_id uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from user_tenants ut
    where ut.user_id = auth.uid()
      and ut.tenant_id = p_tenant_id
      and (
        ut.role = 'admin'
        or (ut.role = 'manager' and coalesce(
              (select up.allowed from user_permissions up
                where up.tenant_id = p_tenant_id and up.user_id = auth.uid() and up.permission_key = 'usuarios_gerenciar'),
              exists (select 1 from permissions p
                       where p.tenant_id = p_tenant_id and p.role = 'manager'
                         and p.permission_key = 'usuarios_gerenciar' and p.allowed is true)))
      )
  );
$$;

-- Funções do banco que conferem uma permission_key pelo cargo passam a olhar antes o ajuste da pessoa
-- (sim ou não). Sem linha em user_permissions, o resultado é exatamente o de antes.
create or replace function public._acerto_motoboy_pode(p_tenant uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is null or exists (
    select 1 from user_tenants ut
     where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and (ut.role::text = 'admin'
            or coalesce(
                 (select up.allowed from user_permissions up
                   where up.tenant_id = p_tenant and up.user_id = auth.uid() and up.permission_key = 'fin_entregadores'),
                 ut.role::text in ('manager', 'financeiro')
                   and not exists (select 1 from permissions p
                                    where p.tenant_id = p_tenant and p.role::text = ut.role::text
                                      and p.permission_key = 'fin_entregadores' and p.allowed = false)))
  );
$$;

create or replace function public._beneficio_pode(p_tenant uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is null or exists (
    select 1 from user_tenants ut
     where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and (ut.role::text = 'admin'
            or coalesce(
                 (select up.allowed from user_permissions up
                   where up.tenant_id = p_tenant and up.user_id = auth.uid() and up.permission_key = 'fin_rh'),
                 ut.role::text in ('manager', 'financeiro')
                   and not exists (select 1 from permissions p
                                    where p.tenant_id = p_tenant and p.role::text = ut.role::text
                                      and p.permission_key = 'fin_rh' and p.allowed = false)))
  );
$$;

create or replace function public.estoque_pode_configurar(p_tenant uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.user_tenants ut
      left join public.permissions p
        on p.tenant_id = ut.tenant_id and p.role::text = ut.role::text and p.permission_key = 'estoque_inventario'
      left join public.user_permissions up
        on up.tenant_id = ut.tenant_id and up.user_id = ut.user_id and up.permission_key = 'estoque_inventario'
     where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and (ut.role::text = 'admin' or coalesce(up.allowed, p.allowed, ut.role::text = 'manager'))
  );
$$;

-- Lojas em que a pessoa lê o financeiro. Admin/gerente/financeiro/contabilidade continuam passando pelo
-- cargo. Os outros cargos: uma chave fin_* (ou das p_chaves) ligada pelo cargo OU pela pessoa, e que a
-- pessoa não tenha tirado.
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
          union
          select up.permission_key from public.user_permissions up
           where up.tenant_id = ut.tenant_id and up.user_id = ut.user_id and up.allowed
        ) x
        where (x.k like 'fin\_%' or x.k = any (p_chaves))
          and not exists (select 1 from public.user_permissions n
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
