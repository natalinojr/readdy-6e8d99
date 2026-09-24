-- Tarefas: quem pode ser escolhido como responsável (2026-09-24).
-- Antes a tela usava fn_get_users_list, que só responde a ADMIN da loja ativa —
-- gerente/funcionário via a lista vazia (só a si mesmo), e quem tem Tarefas sem
-- loja (Admin Master) nunca aparecia pra ninguém. Aqui: quem tem o módulo
-- Tarefas + quem divide alguma loja comigo — o mesmo que o task-write aceita
-- como responsável (fn_task_responsavel_valido). Só nome e id.
create or replace function public.fn_get_task_pessoas()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not (
    fn_user_tem_tarefas(auth.uid()) or exists (select 1 from user_tenants where user_id = auth.uid())
  ) then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.name) order by u.name), '[]'::jsonb)
    from users u
    where u.deleted_at is null
      and coalesce(u.is_active, true)
      and (
        fn_user_tem_tarefas(u.id)
        or exists (
          select 1 from user_tenants eu join user_tenants ele on ele.tenant_id = eu.tenant_id
          where eu.user_id = auth.uid() and ele.user_id = u.id
        )
      )
  );
end $function$;
revoke all on function public.fn_get_task_pessoas() from public, anon;
grant execute on function public.fn_get_task_pessoas() to authenticated;
