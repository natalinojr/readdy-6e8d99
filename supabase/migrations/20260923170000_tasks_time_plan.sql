-- Tarefas: horas planejadas por dia numa tarefa de vários dias (2026-09-23).
-- time_plan = {"dias": {"2026-09-24": 120, ...}} (minutos por dia). null = automático
-- (a Carga espalha a estimativa entre início e prazo pela capacidade do dia).
-- Com plano, a Carga usa exatamente os minutos de cada dia e a estimativa é a soma.

alter table public.tasks
  add column if not exists time_plan jsonb
    check (time_plan is null or (jsonb_typeof(time_plan) = 'object' and jsonb_typeof(time_plan -> 'dias') = 'object'));

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
    and (t.assignee_id = auth.uid() or t.list_id in (select list_id from acessiveis))
    and (p_list_ids is null or t.list_id = any(p_list_ids))
    and (p_assignee_id is null or t.assignee_id = p_assignee_id)
    and (p_include_done or st.category is null or st.category not in ('done','cancelled'))
    and (p_include_subtasks or t.parent_task_id is null));
end $function$;
