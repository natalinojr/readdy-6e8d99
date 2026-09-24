-- Relatórios de Tarefas (2026-09-25, parte 3):
--   * campos de resposta por item (lista suspensa, caixas de seleção, sim/não, texto, número, data)
--   * relatório ligado a tarefas (e vice-versa)
--   * aviso de resposta nova para toda a equipe da pasta

-- [{id, type, label, options?: [{id, label}]}] — validado na Edge Function task-reports.
alter table public.task_report_items
  add column if not exists fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array');

-- {campo_id: valor} respondido nessa resposta (só o que mudou).
alter table public.task_report_responses
  add column if not exists answers jsonb check (answers is null or jsonb_typeof(answers) = 'object');

create table if not exists public.task_report_tasks (
  report_id uuid not null references public.task_reports(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (report_id, task_id)
);
create index if not exists task_report_tasks_task_idx on public.task_report_tasks(task_id);
alter table public.task_report_tasks enable row level security;
grant select, insert, update, delete on public.task_report_tasks to service_role;
grant select on public.task_report_tasks to authenticated;
drop policy if exists task_report_tasks_select on public.task_report_tasks;
create policy task_report_tasks_select on public.task_report_tasks
  for select to authenticated using (public.fn_task_report_access(report_id, (select auth.uid())) is not null);

-- Quem deve ser avisado de novidade no relatório: quem criou + quem tem acesso à
-- pasta dele (donos da pasta e das pastas-mãe, compartilhamentos nelas).
create or replace function public.fn_task_report_membros(p_report_id uuid)
 returns table(user_id uuid)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with recursive rel as (
    select r.created_by, r.list_id from task_reports r where r.id = p_report_id and r.archived_at is null
  ), sobe as (
    select l.id, l.parent_list_id, l.created_by, 0 as prof
    from task_lists l join rel on l.id = rel.list_id where not l.is_archived
    union all
    select l.id, l.parent_list_id, l.created_by, s.prof + 1
    from task_lists l join sobe s on l.id = s.parent_list_id where s.prof < 50 and not l.is_archived
  )
  select created_by from rel
  union
  select created_by from sobe
  union
  select sh.user_id from task_list_shares sh join sobe on sh.list_id = sobe.id;
$function$;
revoke all on function public.fn_task_report_membros(uuid) from public, anon, authenticated;
grant execute on function public.fn_task_report_membros(uuid) to service_role;
