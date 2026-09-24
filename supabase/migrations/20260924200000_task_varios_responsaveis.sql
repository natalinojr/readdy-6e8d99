-- Tarefas: mais de um responsável por tarefa (2026-09-24).
-- task_assignees guarda TODOS os responsáveis. tasks.assignee_id continua sendo
-- o responsável PRINCIPAL (o primeiro) — assistente, ações rápidas, modelos e
-- tudo que só entende um responsável seguem funcionando. Um gatilho garante que
-- o principal sempre está na lista (quem grava só assignee_id, como antes, não
-- precisa saber da tabela nova). Quem enxerga/edita: qualquer responsável.
-- Avisos de vencimento vão pra todos os responsáveis.

create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null,
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists task_assignees_user_idx on public.task_assignees(user_id);
alter table public.task_assignees enable row level security;
grant select, insert, update, delete on public.task_assignees to service_role;

-- Quem já era responsável vira o primeiro da lista.
insert into public.task_assignees (task_id, user_id, added_by, created_at)
select t.id, t.assignee_id, t.created_by, t.created_at from public.tasks t
where t.assignee_id is not null
on conflict do nothing;

create or replace function public.fn_task_assignee_principal_na_lista()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.assignee_id is not null then
    insert into task_assignees (task_id, user_id, added_by)
    values (new.id, new.assignee_id, coalesce(auth.uid(), new.created_by))
    on conflict do nothing;
  end if;
  return new;
end $function$;

drop trigger if exists trg_task_assignee_principal on public.tasks;
create trigger trg_task_assignee_principal
  after insert or update of assignee_id on public.tasks
  for each row execute function public.fn_task_assignee_principal_na_lista();

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
      'assignees', (
        select coalesce(jsonb_agg(jsonb_build_object('id', ta.user_id, 'name', ua.name)
                        order by (ta.user_id = t.assignee_id) desc, ta.created_at), '[]'::jsonb)
        from task_assignees ta left join users ua on ua.id = ta.user_id
        where ta.task_id = t.id
      ),
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
      'time_plan', t.time_plan,
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
    and (t.assignee_id = auth.uid() or exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = auth.uid()) or t.list_id in (select list_id from acessiveis))
    and (p_list_ids is null or t.list_id = any(p_list_ids))
    and (p_assignee_id is null or t.assignee_id = p_assignee_id
         or exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = p_assignee_id))
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
    'assignees', (
        select coalesce(jsonb_agg(jsonb_build_object('id', ta.user_id, 'name', ua.name)
                        order by (ta.user_id = t.assignee_id) desc, ta.created_at), '[]'::jsonb)
        from task_assignees ta left join users ua on ua.id = ta.user_id
        where ta.task_id = t.id
      ),
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
    and (t.assignee_id = auth.uid() or exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = auth.uid())
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
          and (t2.assignee_id = auth.uid()
               or exists (select 1 from task_assignees ta where ta.task_id = t2.id and ta.user_id = auth.uid())
               or fn_task_list_access(t2.list_id, auth.uid()) is not null)
      ));
end $function$;

create or replace function public.fn_task_lembretes_da_vez()
 returns table(task_id uuid, user_id uuid, minutos_antes integer, title text, due_date timestamptz,
               due_has_time boolean, list_name text, tenant_id uuid, vibrar boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  return query
  with destinatarios as (
    -- Todos os responsáveis; sem nenhum, quem criou.
    select t.id as task_id, x.user_id, x.sem_resp,
           t.title, t.due_date, t.due_has_time, l.name as list_name, t.tenant_id
    from tasks t
    join task_statuses st on st.id = t.status_id
    left join task_lists l on l.id = t.list_id
    cross join lateral (
      select ta.user_id, false as sem_resp from task_assignees ta where ta.task_id = t.id
      union all
      select t.created_by, true
      where t.created_by is not null and not exists (select 1 from task_assignees ta2 where ta2.task_id = t.id)
    ) x
    where not t.is_archived
      and t.due_date is not null
      and st.category not in ('done', 'cancelled')
      and t.due_date > now() - interval '2 days'
      and t.due_date < now() + interval '8 days'
  ), com_prefs as (
    select d.*,
           coalesce(p.ativo, true) as ativo,
           coalesce(p.lembretes, '{60,0}') as lembretes,
           coalesce(p.hora_dia_todo, '08:00'::time) as hora_dia_todo,
           coalesce(p.vibrar, true) as vibrar,
           coalesce(p.incluir_criadas_sem_resp, true) as incluir_sem_resp
    from destinatarios d
    left join task_notification_prefs p on p.user_id = d.user_id
  ), momentos as (
    select c.*, m as minutos,
           (case when c.due_has_time then c.due_date
                 else ((c.due_date at time zone 'America/Sao_Paulo')::date + c.hora_dia_todo) at time zone 'America/Sao_Paulo'
            end) - make_interval(mins => m) as momento
    from com_prefs c, unnest(c.lembretes) m
    where c.ativo and (not c.sem_resp or c.incluir_sem_resp)
  ), da_vez as (
    select * from momentos
    where momento <= now() and momento > now() - interval '30 minutes'
  ), registrados as (
    insert into task_lembretes_enviados (task_id, user_id, minutos_antes, due_date)
    select v.task_id, v.user_id, v.minutos, v.due_date from da_vez v
    on conflict do nothing
    returning task_lembretes_enviados.task_id, task_lembretes_enviados.user_id,
              task_lembretes_enviados.minutos_antes, task_lembretes_enviados.due_date
  )
  select r.task_id, r.user_id, r.minutos_antes, v.title, v.due_date, v.due_has_time, v.list_name, v.tenant_id, v.vibrar
  from registrados r
  join da_vez v on v.task_id = r.task_id and v.user_id = r.user_id and v.minutos = r.minutos_antes and v.due_date = r.due_date;
end $function$;
