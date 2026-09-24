-- Tarefas: relatório dentro de uma pasta — quem divide a pasta vê o relatório (2026-09-25).
--
-- Acesso ao relatório:
--   creator → quem criou (tudo)
--   owner   → dono da pasta (ou de pasta-mãe): tudo, menos trocar a pasta
--   edit    → pasta compartilhada com "pode editar": itens, link, encerrar
--   view    → pasta compartilhada com "só ver": lê e responde
-- A regra da pasta é a mesma de fn_task_list_access (vale para a subárvore).

alter table public.task_reports
  add column if not exists list_id uuid references public.task_lists(id) on delete set null;
create index if not exists task_reports_list_idx on public.task_reports(list_id) where archived_at is null;

-- "Visto" por pessoa: com várias pessoas no relatório, o contador de novidades é de cada uma.
create table if not exists public.task_report_seen (
  report_id uuid not null references public.task_reports(id) on delete cascade,
  user_id uuid not null,
  seen_at timestamptz not null default now(),
  primary key (report_id, user_id)
);
alter table public.task_report_seen enable row level security;
grant select, insert, update, delete on public.task_report_seen to service_role;

insert into public.task_report_seen (report_id, user_id, seen_at)
select id, created_by, owner_seen_at from public.task_reports where owner_seen_at is not null
on conflict do nothing;

create or replace function public.fn_task_report_access(p_report_id uuid, p_user_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select case
    when r.created_by = p_user_id then 'creator'
    when r.list_id is not null then public.fn_task_list_access(r.list_id, p_user_id)
  end
  from task_reports r
  where r.id = p_report_id and r.archived_at is null;
$function$;

create or replace function public.fn_task_reports_acessiveis(p_user_id uuid)
 returns table(report_id uuid, access text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select r.id, 'creator' from task_reports r
  where r.created_by = p_user_id and r.archived_at is null
  union all
  select r.id, a.access
  from task_reports r join public.fn_task_lists_acessiveis(p_user_id) a on a.list_id = r.list_id
  where r.created_by <> p_user_id and r.archived_at is null;
$function$;

revoke all on function public.fn_task_report_access(uuid, uuid) from public, anon;
revoke all on function public.fn_task_reports_acessiveis(uuid) from public, anon;
grant execute on function public.fn_task_report_access(uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_task_reports_acessiveis(uuid) to authenticated, service_role;

-- Leitura direta (rede de segurança; a tela usa a Edge Function): quem tem acesso.
drop policy if exists task_reports_owner_select on public.task_reports;
create policy task_reports_owner_select on public.task_reports
  for select to authenticated using (public.fn_task_report_access(id, (select auth.uid())) is not null);

drop policy if exists task_report_guests_owner_select on public.task_report_guests;
create policy task_report_guests_owner_select on public.task_report_guests
  for select to authenticated using (public.fn_task_report_access(report_id, (select auth.uid())) is not null);

drop policy if exists task_report_items_owner_select on public.task_report_items;
create policy task_report_items_owner_select on public.task_report_items
  for select to authenticated using (public.fn_task_report_access(report_id, (select auth.uid())) is not null);

drop policy if exists task_report_responses_owner_select on public.task_report_responses;
create policy task_report_responses_owner_select on public.task_report_responses
  for select to authenticated using (public.fn_task_report_access(report_id, (select auth.uid())) is not null);
