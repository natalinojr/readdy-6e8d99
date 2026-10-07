-- Notas de Serviço: acesso por CNPJ com permissões por pessoa (pedido do dono, 2026-10-07).
-- - Ser membro de uma empresa emitente já libera o módulo (o admin do CNPJ convida sem depender do Admin Master).
-- - Cada membro tem o que pode fazer: emitir, cancelar, tomadores, serviços, empresa/certificado e usuários.
--   Ver as notas da empresa vale para todo membro.
-- - Só o dono cria CNPJ novo (regra na Edge nfse-write).
-- A coluna `papel` fica só por compatibilidade (a Edge grava 'admin' quando pode_usuarios).

alter table public.nfse_empresa_membros
  add column if not exists pode_emitir boolean not null default true,
  add column if not exists pode_cancelar boolean not null default false,
  add column if not exists pode_tomadores boolean not null default true,
  add column if not exists pode_servicos boolean not null default false,
  add column if not exists pode_empresa boolean not null default false,
  add column if not exists pode_usuarios boolean not null default false;

-- Quem era administrador ganha tudo; emissor fica com emitir + tomadores (o que já fazia).
update public.nfse_empresa_membros
   set pode_emitir = true, pode_cancelar = true, pode_tomadores = true,
       pode_servicos = true, pode_empresa = true, pode_usuarios = true
 where papel = 'admin';

-- Membro de qualquer empresa tem o módulo.
create or replace function public.fn_nfse_has_module()
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'natalinojr.engel@gmail.com', false)
      or exists (select 1 from public.user_module_access where user_id = auth.uid() and module = 'nfse')
      or exists (select 1 from public.nfse_empresa_membros where user_id = auth.uid());
$$;

create or replace function public.fn_my_modules()
 returns text[] language sql stable security definer set search_path to 'public'
as $$
  select case
    when lower(coalesce(auth.jwt() ->> 'email','')) = 'natalinojr.engel@gmail.com'
      then array['tarefas','contratacao','nfse']
    else array(
      select module from public.user_module_access where user_id = auth.uid()
      union
      select 'tarefas' from public.user_tenants where user_id = auth.uid() and role = 'tasks_only'
      union
      select 'nfse' where exists (select 1 from public.nfse_empresa_membros where user_id = auth.uid())
    )
  end;
$$;

-- p_admin = pode administrar usuários (mantém a assinatura antiga).
create or replace function public.fn_nfse_membro(p_empresa uuid, p_admin boolean default false)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.nfse_empresa_membros m
    where m.empresa_id = p_empresa and m.user_id = auth.uid()
      and (not p_admin or m.pode_usuarios));
$$;

create or replace function public.fn_nfse_pode(p_empresa uuid, p_acao text)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce((
    select case p_acao
      when 'emitir' then m.pode_emitir
      when 'cancelar' then m.pode_cancelar
      when 'tomadores' then m.pode_tomadores
      when 'servicos' then m.pode_servicos
      when 'empresa' then m.pode_empresa
      when 'usuarios' then m.pode_usuarios
      else false end
    from public.nfse_empresa_membros m
    where m.empresa_id = p_empresa and m.user_id = auth.uid()), false);
$$;
revoke all on function public.fn_nfse_pode(uuid, text) from public, anon;
grant execute on function public.fn_nfse_pode(uuid, text) to authenticated;

-- Tomadores: todo membro vê; cadastrar vale para quem emite (cadastro na hora de emitir) ou cuida de tomadores;
-- editar/excluir só quem cuida de tomadores.
drop policy if exists nfse_tomadores_all on public.nfse_tomadores;
drop policy if exists nfse_tomadores_sel on public.nfse_tomadores;
drop policy if exists nfse_tomadores_ins on public.nfse_tomadores;
drop policy if exists nfse_tomadores_upd on public.nfse_tomadores;
drop policy if exists nfse_tomadores_del on public.nfse_tomadores;
create policy nfse_tomadores_sel on public.nfse_tomadores for select to authenticated
  using (public.fn_nfse_membro(empresa_id));
create policy nfse_tomadores_ins on public.nfse_tomadores for insert to authenticated
  with check (public.fn_nfse_pode(empresa_id, 'tomadores') or public.fn_nfse_pode(empresa_id, 'emitir'));
create policy nfse_tomadores_upd on public.nfse_tomadores for update to authenticated
  using (public.fn_nfse_pode(empresa_id, 'tomadores')) with check (public.fn_nfse_pode(empresa_id, 'tomadores'));
create policy nfse_tomadores_del on public.nfse_tomadores for delete to authenticated
  using (public.fn_nfse_pode(empresa_id, 'tomadores'));

drop policy if exists nfse_servicos_all on public.nfse_servicos;
drop policy if exists nfse_servicos_sel on public.nfse_servicos;
drop policy if exists nfse_servicos_ins on public.nfse_servicos;
drop policy if exists nfse_servicos_upd on public.nfse_servicos;
drop policy if exists nfse_servicos_del on public.nfse_servicos;
create policy nfse_servicos_sel on public.nfse_servicos for select to authenticated
  using (public.fn_nfse_membro(empresa_id));
create policy nfse_servicos_ins on public.nfse_servicos for insert to authenticated
  with check (public.fn_nfse_pode(empresa_id, 'servicos'));
create policy nfse_servicos_upd on public.nfse_servicos for update to authenticated
  using (public.fn_nfse_pode(empresa_id, 'servicos')) with check (public.fn_nfse_pode(empresa_id, 'servicos'));
create policy nfse_servicos_del on public.nfse_servicos for delete to authenticated
  using (public.fn_nfse_pode(empresa_id, 'servicos'));

-- Lista de membros com nome/e-mail, permissões e se o convite ainda não foi aceito.
drop function if exists public.fn_nfse_membros(uuid);
create function public.fn_nfse_membros(p_empresa uuid)
 returns table (user_id uuid, nome text, email text, eu boolean, pendente boolean,
                pode_emitir boolean, pode_cancelar boolean, pode_tomadores boolean,
                pode_servicos boolean, pode_empresa boolean, pode_usuarios boolean)
 language sql stable security definer set search_path to 'public', 'auth'
as $$
  select m.user_id, u.name, coalesce(u.email, au.email), m.user_id = auth.uid(),
         au.last_sign_in_at is null,
         m.pode_emitir, m.pode_cancelar, m.pode_tomadores, m.pode_servicos, m.pode_empresa, m.pode_usuarios
  from public.nfse_empresa_membros m
  left join public.users u on u.id = m.user_id
  left join auth.users au on au.id = m.user_id
  where m.empresa_id = p_empresa and public.fn_nfse_membro(p_empresa)
  order by m.pode_usuarios desc, u.name;
$$;
revoke all on function public.fn_nfse_membros(uuid) from public, anon;
grant execute on function public.fn_nfse_membros(uuid) to authenticated;

-- Conta no Auth por e-mail ou id (só a Edge). Link de primeiro acesso só sai para conta criada pelo convite
-- deste módulo (convite_nfse no metadata) e ainda sem senha: nunca para conta de outra pessoa.
drop function if exists public.fn_nfse_conta_auth(text, uuid);
create function public.fn_nfse_conta_auth(p_email text default null, p_user uuid default null)
 returns table (id uuid, email text, sem_senha boolean, convite_nfse boolean)
 language sql stable security definer set search_path to 'auth', 'public'
as $$
  select u.id, u.email::text, coalesce(u.encrypted_password, '') = '',
         coalesce((u.raw_user_meta_data ->> 'convite_nfse')::boolean, false)
  from auth.users u
  where (p_user is not null and u.id = p_user)
     or (p_email is not null and lower(u.email) = lower(p_email))
  limit 1;
$$;
revoke all on function public.fn_nfse_conta_auth(text, uuid) from public, anon, authenticated;
grant execute on function public.fn_nfse_conta_auth(text, uuid) to service_role;

-- pendente = convidado por este módulo que ainda não criou a senha (pode receber um link novo).
create or replace function public.fn_nfse_membros(p_empresa uuid)
 returns table (user_id uuid, nome text, email text, eu boolean, pendente boolean,
                pode_emitir boolean, pode_cancelar boolean, pode_tomadores boolean,
                pode_servicos boolean, pode_empresa boolean, pode_usuarios boolean)
 language sql stable security definer set search_path to 'public', 'auth'
as $$
  select m.user_id, u.name, coalesce(u.email, au.email), m.user_id = auth.uid(),
         coalesce(au.encrypted_password, '') = '' and coalesce((au.raw_user_meta_data ->> 'convite_nfse')::boolean, false),
         m.pode_emitir, m.pode_cancelar, m.pode_tomadores, m.pode_servicos, m.pode_empresa, m.pode_usuarios
  from public.nfse_empresa_membros m
  left join public.users u on u.id = m.user_id
  left join auth.users au on au.id = m.user_id
  where m.empresa_id = p_empresa and public.fn_nfse_membro(p_empresa)
  order by m.pode_usuarios desc, u.name;
$$;
