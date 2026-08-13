-- ═══════════════════════════════════════════════════════════════════════════
-- Módulo de Tarefas — escopo por usuário (não mais por loja inteira)
-- Cada um só vê as próprias listas/tarefas; se for marcado como responsável
-- numa tarefa de outra pessoa, essa tarefa aparece em "Tarefas Compartilhadas".
-- Aplicado direto via mcp__supabase__apply_migration (db push falha neste
-- repo — ver feedback_migracoes_sem_mcp na memória). Este arquivo é o
-- registro/fonte de verdade do que já está no ar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── task_lists: só o dono vê ─────────────────────────────────────────────────
drop policy if exists task_lists_select_member on task_lists;
create policy task_lists_select_member on task_lists for select to authenticated
using (
  tenant_id in (select tenant_id from user_tenants where user_id = (select auth.uid()))
  and created_by = (select auth.uid())
);

-- ── tasks: dono da tarefa OU responsável (é assim que uma tarefa "compartilha") ──
drop policy if exists tasks_select_member on tasks;
create policy tasks_select_member on tasks for select to authenticated
using (
  tenant_id in (select tenant_id from user_tenants where user_id = (select auth.uid()))
  and (created_by = (select auth.uid()) or assignee_id = (select auth.uid()))
);

-- ── task_statuses: segue a visibilidade da lista ─────────────────────────────
drop policy if exists task_statuses_select_member on task_statuses;
create policy task_statuses_select_member on task_statuses for select to authenticated
using (
  tenant_id in (select tenant_id from user_tenants where user_id = (select auth.uid()))
  and list_id in (select id from task_lists where created_by = (select auth.uid()))
);

-- ── tabelas ligadas a task_id: seguem a visibilidade da tarefa ───────────────
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
        tenant_id in (select tenant_id from user_tenants where user_id = (select auth.uid()))
        and task_id in (
          select id from tasks
          where created_by = (select auth.uid()) or assignee_id = (select auth.uid())
        )
      )
    $p$, t || '_select_member', t);
  end loop;
end $$;

-- ── RPC: listas — só as que eu criei ──────────────────────────────────────────
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
    where l.tenant_id = p_tenant_id and not l.is_archived
      and l.created_by = auth.uid());
end $$;

-- ── RPC: tarefas — minhas (dono da lista) + as em que sou responsável ────────
-- Inclui list_name/list_color/created_by para o front montar "Compartilhadas"
-- sem precisar de uma segunda consulta (a lista de outra pessoa não é visível
-- por fn_get_task_lists, então a tarefa precisa carregar esses dados junto).
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
    where t.tenant_id = p_tenant_id
    and not t.is_archived
    and (t.created_by = auth.uid() or t.assignee_id = auth.uid())
    and (p_list_ids is null or t.list_id = any(p_list_ids))
    and (p_assignee_id is null or t.assignee_id = p_assignee_id)
    and (p_include_done or st.category is null or st.category not in ('done','cancelled'))
    and (p_include_subtasks or t.parent_task_id is null));
end $$;

-- ── RPC: detalhe de tarefa — só dono ou responsável ──────────────────────────
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
  where t.id = p_task_id and t.tenant_id = p_tenant_id
    and (t.created_by = auth.uid() or t.assignee_id = auth.uid());

  if v is null then
    raise exception 'task not found';
  end if;
  return v;
end $$;

-- ── RPC: anexos — só se a tarefa for visível pra mim ─────────────────────────
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
    where a.tenant_id = p_tenant_id and a.task_id = p_task_id
      and exists (
        select 1 from tasks t2 where t2.id = p_task_id
          and (t2.created_by = auth.uid() or t2.assignee_id = auth.uid())
      ));
end $$;
