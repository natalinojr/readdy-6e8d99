-- ═══════════════════════════════════════════════════════════════════════════
-- Módulo de Tarefas — RPCs de leitura (security definer, tenant validado por
-- membership; NÃO usar auth_tenant_id() — quebra p/ admin multi-loja)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function fn_tasks_assert_member(p_tenant_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (
    select 1 from user_tenants
    where user_id = auth.uid() and tenant_id = p_tenant_id
  ) then
    raise exception 'not a member of tenant %', p_tenant_id using errcode = '42501';
  end if;
end $$;

-- ── Listas + status + contagem de tarefas abertas ────────────────────────────

create or replace function fn_get_task_lists(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'color', l.color,
      'icon', l.icon,
      'sort_order', l.sort_order,
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
    from task_lists l
    where l.tenant_id = p_tenant_id and not l.is_archived);
end $$;

-- ── Tarefas (com tags, checklist, valores custom, subtarefas) ────────────────

create or replace function fn_get_tasks(
  p_tenant_id uuid,
  p_list_ids uuid[] default null,
  p_assignee_id uuid default null,
  p_include_done boolean default true,
  p_include_subtasks boolean default true
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'list_id', t.list_id,
      'parent_task_id', t.parent_task_id,
      'title', t.title,
      'status_id', t.status_id,
      'status_category', st.category,
      'priority', t.priority,
      'assignee_id', t.assignee_id,
      'assignee_name', u.name,
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
      )
    ) order by t.sort_order, t.created_at), '[]'::jsonb)
    from tasks t
    left join task_statuses st on st.id = t.status_id
    left join users u on u.id = t.assignee_id
    where t.tenant_id = p_tenant_id
    and not t.is_archived
    and (p_list_ids is null or t.list_id = any(p_list_ids))
    and (p_assignee_id is null or t.assignee_id = p_assignee_id)
    and (p_include_done or st.category is null or st.category not in ('done','cancelled'))
    and (p_include_subtasks or t.parent_task_id is null));
end $$;

-- ── Detalhe de uma tarefa ────────────────────────────────────────────────────

create or replace function fn_get_task_detail(p_tenant_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
  where t.id = p_task_id and t.tenant_id = p_tenant_id;

  if v is null then
    raise exception 'task not found';
  end if;
  return v;
end $$;

-- ── Campos personalizados do tenant (definições) ─────────────────────────────

create or replace function fn_get_task_custom_fields(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'list_id', f.list_id, 'name', f.name,
      'field_type', f.field_type, 'options', f.options,
      'show_on_card', f.show_on_card, 'sort_order', f.sort_order
    ) order by f.sort_order), '[]'::jsonb)
    from task_custom_fields f
    where f.tenant_id = p_tenant_id and not f.is_archived);
end $$;

-- ── Tags do tenant ───────────────────────────────────────────────────────────

create or replace function fn_get_task_tags(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color) order by g.name), '[]'::jsonb)
    from task_tags g where g.tenant_id = p_tenant_id);
end $$;

grant execute on function fn_tasks_assert_member(uuid) to authenticated, service_role;
grant execute on function fn_get_task_lists(uuid) to authenticated, service_role;
grant execute on function fn_get_tasks(uuid, uuid[], uuid, boolean, boolean) to authenticated, service_role;
grant execute on function fn_get_task_detail(uuid, uuid) to authenticated, service_role;
grant execute on function fn_get_task_custom_fields(uuid) to authenticated, service_role;
grant execute on function fn_get_task_tags(uuid) to authenticated, service_role;
