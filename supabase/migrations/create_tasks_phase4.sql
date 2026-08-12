-- ═══════════════════════════════════════════════════════════════════════════
-- Módulo de Tarefas — Fase 4: notificações, views salvas, anexos e templates
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Notificações por usuário ─────────────────────────────────────────────────
-- O NotificacoesContext do app é em memória e por PERFIL; para avisar uma pessoa
-- específica (o responsável, o mencionado) a notificação precisa ser persistida.
create table if not exists task_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null,                    -- destinatário
  task_id uuid not null references tasks(id) on delete cascade,
  type text not null check (type in ('assigned','mentioned','commented')),
  actor_id uuid,                            -- quem causou
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_notif_user
  on task_notifications(tenant_id, user_id, is_read, created_at desc);

-- ── Views salvas ─────────────────────────────────────────────────────────────
create table if not exists task_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  list_id uuid references task_lists(id) on delete cascade, -- null = vale p/ qualquer lista
  user_id uuid,                             -- null = compartilhada com a equipe
  name text not null,
  view_type text not null default 'lista'
    check (view_type in ('lista','kanban','calendario','minhas')),
  group_by text not null default 'status',
  filters jsonb not null default '{}'::jsonb,
  sort_order numeric not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_views_tenant on task_views(tenant_id, list_id);

-- ── Anexos (bucket privado; URL assinada sob demanda) ────────────────────────
create table if not exists task_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  file_name text not null,
  file_path text not null,                  -- caminho dentro do bucket task-attachments
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_attachments_task on task_attachments(task_id);

-- ── Templates de checklist ───────────────────────────────────────────────────
create table if not exists task_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  items jsonb not null default '[]'::jsonb, -- ["Conferir caixa", "Ligar fritadeira", ...]
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ── RLS + grants ─────────────────────────────────────────────────────────────

-- Tabelas visíveis a qualquer membro do tenant
do $$
declare t text;
begin
  foreach t in array array['task_attachments','task_checklist_templates']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy %I on %I for select to authenticated
      using (tenant_id in (select tenant_id from user_tenants where user_id = (select auth.uid())))
    $p$, t || '_select_member', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- Notificações: cada um vê apenas as suas
alter table task_notifications enable row level security;
create policy task_notifications_select_own on task_notifications
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and tenant_id in (select tenant_id from user_tenants where user_id = (select auth.uid()))
  );
grant select on task_notifications to authenticated;
grant all on task_notifications to service_role;

-- Views salvas: as compartilhadas (user_id null) + as minhas
alter table task_views enable row level security;
create policy task_views_select_visible on task_views
  for select to authenticated
  using (
    tenant_id in (select tenant_id from user_tenants where user_id = (select auth.uid()))
    and (user_id is null or user_id = (select auth.uid()))
  );
grant select on task_views to authenticated;
grant all on task_views to service_role;

-- ── Broadcast de notificação para o destinatário ─────────────────────────────
create or replace function fn_task_notification_ping()
returns trigger language plpgsql security definer
set search_path to 'public', 'realtime' as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', new.id, 'type', new.type, 'task_id', new.task_id),
      'task_notification',
      'task-notify:' || new.user_id::text,
      false
    );
  exception when others then
    null; -- o broadcast nunca pode bloquear a escrita
  end;
  return new;
end $$;

drop trigger if exists trg_task_notification_ping on task_notifications;
create trigger trg_task_notification_ping after insert on task_notifications
for each row execute function fn_task_notification_ping();

-- ── RPCs de leitura ──────────────────────────────────────────────────────────

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
      where tenant_id = p_tenant_id and user_id = auth.uid()
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
      'is_shared', v.user_id is null
    ) order by v.sort_order, v.created_at), '[]'::jsonb)
    from task_views v
    where v.tenant_id = p_tenant_id
      and (v.user_id is null or v.user_id = auth.uid()));
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
    where tpl.tenant_id = p_tenant_id);
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
    where a.tenant_id = p_tenant_id and a.task_id = p_task_id);
end $$;

grant execute on function fn_get_task_notifications(uuid) to authenticated, service_role;
grant execute on function fn_get_task_views(uuid) to authenticated, service_role;
grant execute on function fn_get_task_checklist_templates(uuid) to authenticated, service_role;
grant execute on function fn_get_task_attachments(uuid, uuid) to authenticated, service_role;
