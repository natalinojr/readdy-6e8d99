-- Compartilhar pasta: pode receber QUALQUER pessoa com acesso ao módulo
-- Tarefas, não só quem divide loja (decisão do dono, 2026-09-23 — Tarefas é
-- por pessoa, liberado no Admin Master). Mesma regra do fn_my_modules:
-- dono (e-mail), user_module_access 'tarefas' ou papel tasks_only.

create or replace function public.fn_user_tem_tarefas(p_user_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from users u where u.id = p_user_id and lower(coalesce(u.email, '')) = 'natalinojr.engel@gmail.com')
      or exists (select 1 from user_module_access m where m.user_id = p_user_id and m.module = 'tarefas')
      or exists (select 1 from user_tenants t where t.user_id = p_user_id and t.role = 'tasks_only');
$function$;

-- Busca pra compartilhar: e-mail exato (sem curinga) ou matrícula, entre quem tem Tarefas.
create or replace function public.fn_task_share_lookup(p_requester uuid, p_termo text)
 returns table(id uuid, name text, email text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select u.id, u.name, u.email
  from users u
  where u.deleted_at is null
    and fn_user_tem_tarefas(u.id)
    and case when position('@' in p_termo) > 0
             then lower(u.email) = lower(trim(p_termo))
             else u.badge_number = trim(p_termo) end;
$function$;

-- Responsável de tarefa: divide loja com o dono da pasta OU tem acesso a Tarefas
-- (quem recebeu uma pasta compartilhada pode ser de outra loja).
create or replace function public.fn_task_responsavel_valido(p_dono uuid, p_responsavel uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select fn_users_dividem_loja(p_dono, p_responsavel) or fn_user_tem_tarefas(p_responsavel);
$function$;

revoke all on function public.fn_user_tem_tarefas(uuid) from public, anon, authenticated;
revoke all on function public.fn_task_share_lookup(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_task_responsavel_valido(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_user_tem_tarefas(uuid) to service_role;
grant execute on function public.fn_task_share_lookup(uuid, text) to service_role;
grant execute on function public.fn_task_responsavel_valido(uuid, uuid) to service_role;
