-- ═══════════════════════════════════════════════════════════════════════════
-- Módulo de Tarefas — pastas aninhadas + escopo 100% por usuário (sem loja)
-- Aplicado direto via mcp__supabase__apply_migration (db push falha neste
-- repo — ver feedback_migracoes_sem_mcp na memória). Este arquivo é o
-- registro/fonte de verdade do que já está no ar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Pastas (antes "listas") podem ter pai — profundidade ilimitada ──────────
alter table task_lists add column if not exists parent_list_id uuid references task_lists(id) on delete set null;
create index if not exists idx_task_lists_parent on task_lists(parent_list_id) where parent_list_id is not null;

-- ── Tags e campos personalizados também viram do usuário, não da loja ───────
alter table task_tags add column if not exists created_by uuid;
alter table task_custom_fields add column if not exists created_by uuid;

-- Backfill do pouco dado existente: campo de lista herda o dono da lista.
update task_custom_fields f
set created_by = l.created_by
from task_lists l
where f.list_id = l.id and f.created_by is null;

-- ═══ RLS: tira o filtro de tenant, mantém só dono/responsável ═══════════════

drop policy if exists task_lists_select_member on task_lists;
create policy task_lists_select_member on task_lists for select to authenticated
using (created_by = (select auth.uid()));

drop policy if exists tasks_select_member on tasks;
create policy tasks_select_member on tasks for select to authenticated
using (created_by = (select auth.uid()) or assignee_id = (select auth.uid()));

drop policy if exists task_statuses_select_member on task_statuses;
create policy task_statuses_select_member on task_statuses for select to authenticated
using (list_id in (select id from task_lists where created_by = (select auth.uid())));

do $$
declare t text;
begin
  foreach t in array array['task_watchers','task_tag_links','task_field_values',
    'task_checklist_items','task_comments','task_activity','task_attachments']
  loop
    execute format('drop policy if exists %I on %I', t || '_select_member', t);
    execute format($p$
      create policy %I on %I for select to authenticated
      using (
        task_id in (
          select id from tasks
          where created_by = (select auth.uid()) or assignee_id = (select auth.uid())
        )
      )
    $p$, t || '_select_member', t);
  end loop;
end $$;

-- Tags/campos/templates: eram do tenant inteiro, agora são do usuário que criou.
drop policy if exists task_tags_select_member on task_tags;
create policy task_tags_select_member on task_tags for select to authenticated
using (created_by = (select auth.uid()));

drop policy if exists task_custom_fields_select_member on task_custom_fields;
create policy task_custom_fields_select_member on task_custom_fields for select to authenticated
using (created_by = (select auth.uid()));

drop policy if exists task_checklist_templates_select_member on task_checklist_templates;
create policy task_checklist_templates_select_member on task_checklist_templates for select to authenticated
using (created_by = (select auth.uid()));

-- task_views (Fase 4): views salvas também ficam só do usuário (sem "compartilhada com a loja").
drop policy if exists task_views_select_visible on task_views;
create policy task_views_select_visible on task_views for select to authenticated
using (created_by = (select auth.uid()));

-- ═══ RPCs: removem o filtro por tenant, mantêm só o dono/responsável ═══════

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
      'parent_list_id', l.parent_list_id,
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
    where not l.is_archived
      and l.created_by = auth.uid());
end $$;

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
end $$;

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
  where t.id = p_task_id
    and (t.created_by = auth.uid() or t.assignee_id = auth.uid());

  if v is null then
    raise exception 'task not found';
  end if;
  return v;
end $$;

create or replace function fn_get_task_attachments(p_tenant_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
          and (t2.created_by = auth.uid() or t2.assignee_id = auth.uid())
      ));
end $$;

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
    where f.created_by = auth.uid() and not f.is_archived);
end $$;

create or replace function fn_get_task_tags(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color) order by g.name), '[]'::jsonb)
    from task_tags g where g.created_by = auth.uid());
end $$;

create or replace function fn_get_task_checklist_templates(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', tpl.id, 'name', tpl.name, 'items', tpl.items
    ) order by tpl.name), '[]'::jsonb)
    from task_checklist_templates tpl
    where tpl.created_by = auth.uid());
end $$;

create or replace function fn_get_task_notifications(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id,
      'type', n.type,
      'task_id', n.task_id,
      'task_title', t.title,
      'actor_id', n.actor_id,
      'actor_name', u.name,
      'payload', n.payload,
      'is_read', n.is_read,
      'created_at', n.created_at
    ) order by n.created_at desc), '[]'::jsonb)
    from (
      select * from task_notifications
      where user_id = auth.uid()
      order by created_at desc limit 50
    ) n
    left join tasks t on t.id = n.task_id
    left join users u on u.id = n.actor_id);
end $$;

create or replace function fn_get_task_views(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'list_id', v.list_id, 'user_id', v.user_id, 'name', v.name,
      'view_type', v.view_type, 'group_by', v.group_by, 'filters', v.filters,
      'is_shared', false
    ) order by v.sort_order, v.created_at), '[]'::jsonb)
    from task_views v
    where v.created_by = auth.uid());
end $$;
