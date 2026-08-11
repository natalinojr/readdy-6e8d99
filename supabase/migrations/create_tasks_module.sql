-- ═══════════════════════════════════════════════════════════════════════════
-- Módulo de Gestão de Tarefas — Fase 1 (ver PLANO-MODULO-TAREFAS.md)
-- Tabelas, RLS por membership, grants service_role, seeds de status, broadcast
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tabelas ──────────────────────────────────────────────────────────────────

create table if not exists task_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  icon text,
  sort_order numeric not null default 0,
  is_archived boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists task_statuses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  list_id uuid not null references task_lists(id) on delete cascade,
  name text not null,
  color text not null default '#94a3b8',
  category text not null default 'todo'
    check (category in ('backlog','todo','in_progress','done','cancelled')),
  sort_order numeric not null default 0
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  list_id uuid not null references task_lists(id) on delete cascade,
  parent_task_id uuid references tasks(id) on delete cascade,
  title text not null,
  description text,
  status_id uuid references task_statuses(id) on delete set null,
  priority smallint not null default 0 check (priority between 0 and 4),
  assignee_id uuid,
  start_date date,
  due_date timestamptz,
  due_has_time boolean not null default false,
  sort_order numeric not null default 0,
  recurrence jsonb,
  completed_at timestamptz,
  is_archived boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_watchers (
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null,
  primary key (task_id, user_id)
);

create table if not exists task_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  unique (tenant_id, name)
);

create table if not exists task_tag_links (
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  tag_id uuid not null references task_tags(id) on delete cascade,
  primary key (task_id, tag_id)
);

create table if not exists task_custom_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  list_id uuid references task_lists(id) on delete cascade, -- null = global do tenant
  name text not null,
  field_type text not null check (field_type in
    ('text','textarea','number','currency','date','checkbox','dropdown','labels','user','rating','url','phone')),
  options jsonb not null default '[]'::jsonb, -- dropdown/labels: [{id,label,color}]
  show_on_card boolean not null default false,
  sort_order numeric not null default 0,
  is_archived boolean not null default false
);

create table if not exists task_field_values (
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  field_id uuid not null references task_custom_fields(id) on delete cascade,
  value jsonb,
  primary key (task_id, field_id)
);

create table if not exists task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  sort_order numeric not null default 0
);

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists task_activity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- ── Índices ──────────────────────────────────────────────────────────────────

create index if not exists idx_task_lists_tenant on task_lists(tenant_id) where not is_archived;
create index if not exists idx_task_statuses_list on task_statuses(list_id);
create index if not exists idx_tasks_tenant_list on tasks(tenant_id, list_id) where not is_archived;
create index if not exists idx_tasks_assignee on tasks(tenant_id, assignee_id) where not is_archived;
create index if not exists idx_tasks_due on tasks(tenant_id, due_date) where due_date is not null and not is_archived;
create index if not exists idx_tasks_parent on tasks(parent_task_id) where parent_task_id is not null;
create index if not exists idx_task_field_values_task on task_field_values(task_id);
create index if not exists idx_task_checklist_task on task_checklist_items(task_id);
create index if not exists idx_task_comments_task on task_comments(task_id);
create index if not exists idx_task_activity_task on task_activity(task_id, created_at desc);
create index if not exists idx_task_custom_fields_tenant on task_custom_fields(tenant_id) where not is_archived;

-- ── RLS: leitura por membership (evita pegadinha do auth_tenant_id em multi-loja)

do $$
declare t text;
begin
  foreach t in array array['task_lists','task_statuses','tasks','task_watchers','task_tags',
    'task_tag_links','task_custom_fields','task_field_values','task_checklist_items',
    'task_comments','task_activity']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy %I on %I for select to authenticated
      using (tenant_id in (select tenant_id from user_tenants where user_id = (select auth.uid())))
    $p$, t || '_select_member', t);
    -- Escritas apenas via Edge Function task-write (service_role) — sem policies de write.
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- ── Trigger: updated_at em tasks ─────────────────────────────────────────────

create or replace function fn_tasks_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_tasks_updated_at on tasks;
create trigger trg_tasks_updated_at before update on tasks
for each row execute function fn_tasks_set_updated_at();

-- ── Trigger: seed de status padrão ao criar lista ────────────────────────────

create or replace function fn_task_list_seed_statuses()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into task_statuses (tenant_id, list_id, name, color, category, sort_order) values
    (new.tenant_id, new.id, 'A fazer',      '#94a3b8', 'todo',        1),
    (new.tenant_id, new.id, 'Em andamento', '#3b82f6', 'in_progress', 2),
    (new.tenant_id, new.id, 'Concluído',    '#22c55e', 'done',        3);
  return new;
end $$;

drop trigger if exists trg_task_list_seed_statuses on task_lists;
create trigger trg_task_list_seed_statuses after insert on task_lists
for each row execute function fn_task_list_seed_statuses();

-- ── Trigger: broadcast realtime (padrão orders-ping) ─────────────────────────

create or replace function fn_tasks_realtime_ping()
returns trigger language plpgsql security definer
set search_path to 'public', 'realtime' as $$
declare
  v_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
  v_id uuid := coalesce(new.id, old.id);
begin
  begin
    perform realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'id', v_id),
      'task_change',
      'tasks-ping:' || v_tenant::text,
      false
    );
  exception when others then
    null; -- broadcast nunca pode bloquear a escrita
  end;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_tasks_ping on tasks;
create trigger trg_tasks_ping after insert or update or delete on tasks
for each row execute function fn_tasks_realtime_ping();
