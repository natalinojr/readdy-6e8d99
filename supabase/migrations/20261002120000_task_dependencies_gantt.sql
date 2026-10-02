-- Tarefas › Cronograma (Gantt), 2026-10-02.
-- Ligação entre tarefas: a SEGUINTE só começa depois que a ANTERIOR termina
-- (finish-to-start, o único tipo — é o que gente que não é gerente de projeto
-- entende). Escrita só pelo task-write (service_role: add_dependency /
-- remove_dependency, que checam acesso e recusam ciclo); leitura pelo RPC,
-- só das ligações em que eu enxergo as DUAS tarefas.

create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  -- Loja da tarefa seguinte; só serve pro aviso em tempo real (tasks-ping).
  tenant_id uuid references public.tenants(id) on delete cascade,
  predecessor_id uuid not null references public.tasks(id) on delete cascade,
  successor_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint task_dependencies_distintas check (predecessor_id <> successor_id),
  constraint task_dependencies_unica unique (predecessor_id, successor_id)
);
create index if not exists task_dependencies_successor_idx on public.task_dependencies (successor_id);

alter table public.task_dependencies enable row level security;
grant select, insert, update, delete on public.task_dependencies to service_role;

-- Mesma campainha das tarefas: a tela dos outros recarrega quando uma ligação muda.
drop trigger if exists trg_task_dependencies_ping on public.task_dependencies;
create trigger trg_task_dependencies_ping after insert or update or delete on public.task_dependencies
  for each row execute function public.fn_tasks_realtime_ping();

-- [{ "predecessor_id": "...", "successor_id": "..." }, ...]
create or replace function public.fn_get_task_dependencies(p_tenant_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    with acessiveis as materialized (select list_id from fn_task_lists_acessiveis(auth.uid()))
    select coalesce(jsonb_agg(jsonb_build_object(
      'predecessor_id', d.predecessor_id,
      'successor_id', d.successor_id
    ) order by d.created_at), '[]'::jsonb)
    from task_dependencies d
    join tasks a on a.id = d.predecessor_id and not a.is_archived
    join tasks b on b.id = d.successor_id and not b.is_archived
    -- Mesma regra do fn_get_tasks: responsável ou acesso à pasta.
    where (a.assignee_id = auth.uid()
           or exists (select 1 from task_assignees ta where ta.task_id = a.id and ta.user_id = auth.uid())
           or a.list_id in (select list_id from acessiveis))
      and (b.assignee_id = auth.uid()
           or exists (select 1 from task_assignees ta where ta.task_id = b.id and ta.user_id = auth.uid())
           or b.list_id in (select list_id from acessiveis))
  );
end $function$;

revoke all on function public.fn_get_task_dependencies(uuid) from public, anon;
grant execute on function public.fn_get_task_dependencies(uuid) to authenticated;

-- Visão salva do tipo Cronograma ('linha' = aba Linha do tempo, feita em paralelo por outra sessão).
alter table public.task_views drop constraint if exists task_views_view_type_check;
alter table public.task_views add constraint task_views_view_type_check
  check (view_type = any (array['lista', 'kanban', 'calendario', 'minhas', 'carga', 'gantt', 'linha']));
