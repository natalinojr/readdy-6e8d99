-- Tarefas: compartilhar pasta (e toda a subárvore) com outras pessoas (2026-09-23).
--
-- Antes: pasta = só de quem criou; tarefa = visível pra quem criou ou pro
-- responsável. Agora a pasta pode ser compartilhada com permissão:
--   view  → vê pastas/tarefas da subárvore e comenta
--   edit  → também cria/edita tarefas e subpastas
--   owner → quem criou a pasta ou qualquer ancestral (compartilha, mexe em
--           status/campos, exclui) — calculado, não fica na tabela.
-- Escrita só pelo task-write (service_role); leitura pelas RPCs abaixo.

create table if not exists public.task_list_shares (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.task_lists(id) on delete cascade,
  user_id uuid not null,
  permission text not null check (permission in ('view', 'edit')),
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  unique (list_id, user_id)
);
create index if not exists task_list_shares_user_idx on public.task_list_shares(user_id);

alter table public.task_list_shares enable row level security;
grant select, insert, update, delete on public.task_list_shares to service_role;

-- Pastas que a pessoa enxerga e com qual acesso (o maior, se vier por mais de um caminho).
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
    select id, nivel from raizes
    union all
    select l.id, a.nivel from task_lists l join arvore a on l.parent_list_id = a.id where not l.is_archived
  )
  select id, case max(nivel) when 3 then 'owner' when 2 then 'edit' else 'view' end
  from arvore group by id;
$function$;

-- Acesso a UMA pasta (sobe pelos ancestrais). null = sem acesso.
create or replace function public.fn_task_list_access(p_list_id uuid, p_user_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with recursive sobe as (
    select l.id, l.parent_list_id, l.created_by, 0 as prof from task_lists l where l.id = p_list_id
    union all
    select l.id, l.parent_list_id, l.created_by, s.prof + 1
    from task_lists l join sobe s on l.id = s.parent_list_id where s.prof < 50
  )
  select case
    when exists (select 1 from sobe where created_by = p_user_id) then 'owner'
    when exists (select 1 from task_list_shares sh join sobe on sh.list_id = sobe.id where sh.user_id = p_user_id and sh.permission = 'edit') then 'edit'
    when exists (select 1 from task_list_shares sh join sobe on sh.list_id = sobe.id where sh.user_id = p_user_id) then 'view'
  end;
$function$;

revoke all on function public.fn_task_lists_acessiveis(uuid) from public, anon, authenticated;
revoke all on function public.fn_task_list_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_task_lists_acessiveis(uuid) to service_role;
grant execute on function public.fn_task_list_access(uuid, uuid) to service_role;

-- ── Leituras passam a considerar as pastas compartilhadas ──

create or replace function public.fn_get_task_lists(p_tenant_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'color', l.color,
      'icon', l.icon,
      'sort_order', l.sort_order,
      'parent_list_id', l.parent_list_id,
      'access', ac.access,
      'owner_id', l.created_by,
      'owner_name', ow.name,
      'share_count', (select count(*) from task_list_shares s where s.list_id = l.id),
      'statuses', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'name', s.name, 'color', s.color,
          'category', s.category, 'sort_order', s.sort_order
        ) order by s.sort_order), '[]'::jsonb)
        from task_statuses s where s.list_id = l.id
      ),
      'open_count', (
        select count(*) from tasks t
        join task_statuses st on st.id = t.status_id
        where t.list_id = l.id and not t.is_archived
          and t.parent_task_id is null
          and st.category not in ('done','cancelled')
      )
    ) order by l.sort_order, l.created_at), '[]'::jsonb)
    from fn_task_lists_acessiveis(auth.uid()) ac
    join task_lists l on l.id = ac.list_id
    left join users ow on ow.id = l.created_by);
end $function$;

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
    and (t.created_by = auth.uid() or t.assignee_id = auth.uid() or t.list_id in (select list_id from acessiveis))
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
    and (t.created_by = auth.uid() or t.assignee_id = auth.uid()
         or fn_task_list_access(t.list_id, auth.uid()) is not null);

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
          and (t2.created_by = auth.uid() or t2.assignee_id = auth.uid()
               or fn_task_list_access(t2.list_id, auth.uid()) is not null)
      ));
end $function$;

-- Campos personalizados: os meus + os das pastas compartilhadas comigo.
create or replace function public.fn_get_task_custom_fields(p_tenant_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'list_id', f.list_id, 'name', f.name,
      'field_type', f.field_type, 'options', f.options,
      'show_on_card', f.show_on_card, 'sort_order', f.sort_order
    ) order by f.sort_order), '[]'::jsonb)
    from task_custom_fields f
    where not f.is_archived
      and (f.created_by = auth.uid()
           or f.list_id in (select list_id from fn_task_lists_acessiveis(auth.uid()))));
end $function$;

-- Quem tem acesso a uma pasta (pra tela de compartilhar). Qualquer um com acesso vê a lista.
create or replace function public.fn_get_task_list_shares(p_list_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if fn_task_list_access(p_list_id, auth.uid()) is null then
    raise exception 'sem acesso a esta pasta' using errcode = '42501';
  end if;
  return (
    with recursive sobe as (
      select l.id, l.parent_list_id, l.name, 0 as prof from task_lists l where l.id = p_list_id
      union all
      select l.id, l.parent_list_id, l.name, s.prof + 1 from task_lists l join sobe s on l.id = s.parent_list_id where s.prof < 50
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', sh.id, 'user_id', sh.user_id, 'name', u.name, 'email', u.email, 'badge_number', u.badge_number,
      'permission', sh.permission, 'created_at', sh.created_at,
      -- herdado = compartilhado numa pasta acima (só dá pra mudar lá)
      'inherited_from', case when sh.list_id = p_list_id then null else sobe.name end
    ) order by sobe.prof, u.name), '[]'::jsonb)
    from task_list_shares sh
    join sobe on sobe.id = sh.list_id
    left join users u on u.id = sh.user_id
  );
end $function$;

revoke all on function public.fn_get_task_list_shares(uuid) from public, anon;
grant execute on function public.fn_get_task_list_shares(uuid) to authenticated;
