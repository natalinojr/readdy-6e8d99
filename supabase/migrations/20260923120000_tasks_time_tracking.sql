-- Tarefas: tempo estimado + cronômetro (2026-09-23)
-- Estimativa em minutos na própria tarefa; cada início/parada do cronômetro
-- vira uma linha em task_time_entries (ended_at null = rodando). Um cronômetro
-- rodando por pessoa (índice único parcial). Escrita só pelo task-write
-- (service_role); leitura só pelo fn_get_tasks (security definer).

alter table public.tasks
  add column if not exists time_estimate_minutes integer
    check (time_estimate_minutes is null or time_estimate_minutes >= 0);

create table if not exists public.task_time_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists task_time_entries_task_idx on public.task_time_entries(task_id);
create unique index if not exists task_time_entries_um_rodando_por_pessoa
  on public.task_time_entries(user_id) where ended_at is null;

alter table public.task_time_entries enable row level security;
grant select, insert, update, delete on public.task_time_entries to service_role;

create or replace function public.fn_get_tasks(p_tenant_id uuid, p_list_ids uuid[] default null::uuid[], p_assignee_id uuid default null::uuid, p_include_done boolean default true, p_include_subtasks boolean default true)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
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
      -- Só os trechos já encerrados (de qualquer pessoa); o trecho rodando
      -- vem à parte pra tela contar ao vivo.
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
    and (t.created_by = auth.uid() or t.assignee_id = auth.uid())
    and (p_list_ids is null or t.list_id = any(p_list_ids))
    and (p_assignee_id is null or t.assignee_id = p_assignee_id)
    and (p_include_done or st.category is null or st.category not in ('done','cancelled'))
    and (p_include_subtasks or t.parent_task_id is null));
end $function$;

-- Visão "Carga de trabalho" pode ser salva como view.
alter table public.task_views drop constraint task_views_view_type_check;
alter table public.task_views add constraint task_views_view_type_check
  check (view_type = any (array['lista','kanban','calendario','minhas','carga']));
