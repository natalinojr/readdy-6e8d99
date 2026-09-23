-- Compartilhar pasta — ajustes da revisão de segurança (2026-09-23).
-- 1. Visibilidade da tarefa passa a vir da PASTA (ou de ser o responsável).
--    Antes "created_by = eu" também valia: quem tinha "editar", criava tarefa
--    na pasta de outro e depois perdia o compartilhamento continuava vendo e
--    editando essas tarefas. Toda tarefa que eu criei numa pasta minha continua
--    visível, porque a pasta é minha (fn_task_lists_acessiveis devolve owner).
-- 2. Pasta arquivada não dá mais acesso por compartilhamento (nem por ancestral).
-- 3. Trava de profundidade também na descida da árvore.
-- 4. Busca de pessoa pra compartilhar num lugar só: e-mail EXATO (sem curinga
--    do ilike) ou matrícula, só entre quem divide loja com quem compartilha.

create or replace function public.fn_task_lists_acessiveis(p_user_id uuid)
 returns table(list_id uuid, access text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with recursive raizes as (
    select l.id, 3 as nivel from task_lists l where l.created_by = p_user_id and not l.is_archived
    union all
    select s.list_id, case s.permission when 'edit' then 2 else 1 end
    from task_list_shares s join task_lists l on l.id = s.list_id
    where s.user_id = p_user_id and not l.is_archived
  ), arvore as (
    select id, nivel, 0 as prof from raizes
    union all
    select l.id, a.nivel, a.prof + 1 from task_lists l join arvore a on l.parent_list_id = a.id
    where not l.is_archived and a.prof < 50
  )
  select id, case max(nivel) when 3 then 'owner' when 2 then 'edit' else 'view' end
  from arvore group by id;
$function$;

create or replace function public.fn_task_list_access(p_list_id uuid, p_user_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with recursive sobe as (
    select l.id, l.parent_list_id, l.created_by, 0 as prof from task_lists l where l.id = p_list_id and not l.is_archived
    union all
    select l.id, l.parent_list_id, l.created_by, s.prof + 1
    from task_lists l join sobe s on l.id = s.parent_list_id where s.prof < 50 and not l.is_archived
  )
  select case
    when exists (select 1 from sobe where created_by = p_user_id) then 'owner'
    when exists (select 1 from task_list_shares sh join sobe on sh.list_id = sobe.id where sh.user_id = p_user_id and sh.permission = 'edit') then 'edit'
    when exists (select 1 from task_list_shares sh join sobe on sh.list_id = sobe.id where sh.user_id = p_user_id) then 'view'
  end;
$function$;

-- Pessoa pra compartilhar: e-mail exato (case-insensitive) ou matrícula, entre colegas de loja.
create or replace function public.fn_task_share_lookup(p_requester uuid, p_termo text)
 returns table(id uuid, name text, email text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select distinct u.id, u.name, u.email
  from users u
  join user_tenants ele on ele.user_id = u.id
  join user_tenants eu on eu.tenant_id = ele.tenant_id and eu.user_id = p_requester
  where u.deleted_at is null
    and case when position('@' in p_termo) > 0
             then lower(u.email) = lower(trim(p_termo))
             else u.badge_number = trim(p_termo) end;
$function$;

-- Duas pessoas dividem alguma loja? (valida responsável de tarefa)
create or replace function public.fn_users_dividem_loja(p_a uuid, p_b uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select p_a = p_b or exists (
    select 1 from user_tenants x join user_tenants y on y.tenant_id = x.tenant_id
    where x.user_id = p_a and y.user_id = p_b
  );
$function$;

revoke all on function public.fn_task_share_lookup(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_users_dividem_loja(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_task_share_lookup(uuid, text) to service_role;
grant execute on function public.fn_users_dividem_loja(uuid, uuid) to service_role;


-- Leituras: tarefa visível pelo acesso à pasta ou por ser o responsável.

create or replace function public.fn_get_tasks(p_tenant_id uuid, p_list_ids uuid[] default null::uuid[], p_assignee_id uuid default null::uuid, p_include_done boolean default true, p_include_subtasks boolean default true)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    with acessiveis as (select list_id from fn_task_lists_acessiveis(auth.uid()))
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'list_id', t.list_id,
      'list_name', l.name,
      'list_color', l.color,
      'parent_task_id', t.parent_task_id,
      'title', t.title,
      'status_id', t.status_id,
      'status_category', st.category,
      'priority', t.priority,
      'assignee_id', t.assignee_id,
      'assignee_name', u.name,
      'created_by', t.created_by,
      'start_date', t.start_date,
      'due_date', t.due_date,
      'due_has_time', t.due_has_time,
      'sort_order', t.sort_order,
      'recurrence', t.recurrence,
      'completed_at', t.completed_at,
      'created_at', t.created_at,
      'tags', (
        select coalesce(jsonb_agg(jsonb_build_object('id', tg.id, 'name', tg.name, 'color', tg.color)), '[]'::jsonb)
        from task_tag_links tl join task_tags tg on tg.id = tl.tag_id
        where tl.task_id = t.id
      ),
      'checklist_total', (select count(*) from task_checklist_items c where c.task_id = t.id),
      'checklist_done', (select count(*) from task_checklist_items c where c.task_id = t.id and c.is_done),
      'subtask_total', (select count(*) from tasks s where s.parent_task_id = t.id and not s.is_archived),
      'comment_count', (select count(*) from task_comments c where c.task_id = t.id),
      'field_values', (
        select coalesce(jsonb_object_agg(fv.field_id, fv.value), '{}'::jsonb)
        from task_field_values fv where fv.task_id = t.id
      ),
      'time_estimate_minutes', t.time_estimate_minutes,
      'time_tracked_seconds', (
        select coalesce(sum(extract(epoch from (e.ended_at - e.started_at)))::int, 0)
        from task_time_entries e where e.task_id = t.id and e.ended_at is not null
      ),
      'timer_started_at', (
        select e.started_at from task_time_entries e
        where e.task_id = t.id and e.ended_at is null and e.user_id = auth.uid()
        limit 1
      )
    ) order by t.sort_order, t.created_at), '[]'::jsonb)
    from tasks t
    left join task_statuses st on st.id = t.status_id
    left join users u on u.id = t.assignee_id
    left join task_lists l on l.id = t.list_id
    where not t.is_archived
    and (t.assignee_id = auth.uid() or t.list_id in (select list_id from acessiveis))
    and (p_list_ids is null or t.list_id = any(p_list_ids))
    and (p_assignee_id is null or t.assignee_id = p_assignee_id)
    and (p_include_done or st.category is null or st.category not in ('done','cancelled'))
    and (p_include_subtasks or t.parent_task_id is null));
end $function$;

create or replace function public.fn_get_task_detail(p_tenant_id uuid, p_task_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb;
begin
  perform fn_tasks_assert_member(p_tenant_id);
  select jsonb_build_object(
    'id', t.id,
    'list_id', t.list_id,
    'parent_task_id', t.parent_task_id,
    'title', t.title,
    'description', t.description,
    'status_id', t.status_id,
    'priority', t.priority,
    'assignee_id', t.assignee_id,
    'assignee_name', u.name,
    'start_date', t.start_date,
    'due_date', t.due_date,
    'due_has_time', t.due_has_time,
    'recurrence', t.recurrence,
    'completed_at', t.completed_at,
    'created_at', t.created_at,
    'created_by', t.created_by,
    'created_by_name', cu.name,
    'tags', (
      select coalesce(jsonb_agg(jsonb_build_object('id', tg.id, 'name', tg.name, 'color', tg.color)), '[]'::jsonb)
      from task_tag_links tl join task_tags tg on tg.id = tl.tag_id
      where tl.task_id = t.id
    ),
    'checklist', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'is_done', c.is_done, 'sort_order', c.sort_order
      ) order by c.sort_order), '[]'::jsonb)
      from task_checklist_items c where c.task_id = t.id
    ),
    'comments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cm.id, 'user_id', cm.user_id, 'user_name', cmu.name,
        'body', cm.body, 'created_at', cm.created_at
      ) order by cm.created_at), '[]'::jsonb)
      from task_comments cm left join users cmu on cmu.id = cm.user_id
      where cm.task_id = t.id
    ),
    'activity', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'user_name', au.name,
        'action', a.action, 'payload', a.payload, 'created_at', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from (
        select * from task_activity where task_id = t.id
        order by created_at desc limit 50
      ) a left join users au on au.id = a.user_id
    ),
    'subtasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'status_id', s.status_id,
        'status_category', sst.category, 'assignee_id', s.assignee_id,
        'due_date', s.due_date, 'priority', s.priority
      ) order by s.sort_order, s.created_at), '[]'::jsonb)
      from tasks s left join task_statuses sst on sst.id = s.status_id
      where s.parent_task_id = t.id and not s.is_archived
    ),
    'field_values', (
      select coalesce(jsonb_object_agg(fv.field_id, fv.value), '{}'::jsonb)
      from task_field_values fv where fv.task_id = t.id
    )
  ) into v
  from tasks t
  left join users u on u.id = t.assignee_id
  left join users cu on cu.id = t.created_by
  where t.id = p_task_id
    and (t.assignee_id = auth.uid() or fn_task_list_access(t.list_id, auth.uid()) is not null);

  if v is null then
    raise exception 'task not found';
  end if;
  return v;
end $function$;

create or replace function public.fn_get_task_attachments(p_tenant_id uuid, p_task_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'file_name', a.file_name, 'file_path', a.file_path,
      'mime_type', a.mime_type, 'size_bytes', a.size_bytes,
      'uploaded_by', a.uploaded_by, 'uploaded_by_name', u.name,
      'created_at', a.created_at
    ) order by a.created_at), '[]'::jsonb)
    from task_attachments a
    left join users u on u.id = a.uploaded_by
    where a.task_id = p_task_id
      and exists (
        select 1 from tasks t2 where t2.id = p_task_id
          and (t2.assignee_id = auth.uid() or fn_task_list_access(t2.list_id, auth.uid()) is not null)
      ));
end $function$;
