-- Conversas de TAREFAS (dono, 2026-09-24): quem só tem o módulo Tarefas (sem loja) também conversa
-- no chat — com quem divide pasta ou tarefa com ele. A conversa fica SEM loja (tenant_id nulo) e é
-- uma por par de pessoas; as conversas por loja continuam iguais (unique tenant_id + direct_key).

alter table public.chat_threads alter column tenant_id drop not null;
-- unique (tenant_id, direct_key) não pega nulo: índice próprio para as conversas de Tarefas.
create unique index if not exists chat_threads_tarefas_direct_key_idx
  on public.chat_threads (direct_key) where tenant_id is null;

-- Pessoas que dividem pasta ou tarefa comigo:
--   · pastas que eu acesso (minhas + compartilhadas comigo, fn_task_lists_acessiveis): quem criou,
--     com quem estão compartilhadas e quem compartilhou;
--   · tarefas que criei ou em que sou responsável: quem criou e os responsáveis.
-- Só pessoas ativas, sem mim. Chamado pela Edge chat-equipe (service role).
create or replace function public.fn_chat_colegas_tarefas(p_user uuid)
 returns table(user_id uuid)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with pastas as (
    select list_id from fn_task_lists_acessiveis(p_user)
  ), minhas_tarefas as (
    select t.id, t.created_by from tasks t
    where not t.is_archived
      and (t.created_by = p_user or t.assignee_id = p_user
           or exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = p_user))
  ), gente as (
    select l.created_by as uid from task_lists l join pastas p on p.list_id = l.id
    union select s.user_id from task_list_shares s join pastas p on p.list_id = s.list_id
    union select s.invited_by from task_list_shares s join pastas p on p.list_id = s.list_id
    union select created_by from minhas_tarefas
    union select ta.user_id from task_assignees ta join minhas_tarefas mt on mt.id = ta.task_id
  )
  select distinct u.id
  from gente g join users u on u.id = g.uid
  where u.id <> p_user and u.deleted_at is null and coalesce(u.is_active, true);
$function$;

revoke all on function public.fn_chat_colegas_tarefas(uuid) from public, anon, authenticated;
grant execute on function public.fn_chat_colegas_tarefas(uuid) to service_role;
