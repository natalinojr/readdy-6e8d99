-- Tarefas › Carga: aviso de sobrecarga (2026-09-25).
-- Todo dia às 08h (Brasília) a Edge task-sobrecarga calcula a carga dos
-- próximos 7 dias com a MESMA conta da tela (_shared/carga.ts) e avisa quem
-- passou pra pessoa as tarefas (ou a própria pessoa, se ninguém passou) quando
-- ela tem mais de 110% do tempo disponível. No máximo 1 aviso por semana por
-- destinatário+pessoa.

alter table public.task_notifications drop constraint task_notifications_type_check;
alter table public.task_notifications add constraint task_notifications_type_check
  check (type = any (array['assigned', 'mentioned', 'commented', 'due', 'overload']));

create table if not exists public.task_sobrecarga_avisos (
  semana date not null,
  destinatario uuid not null,
  pessoa uuid not null,
  created_at timestamptz not null default now(),
  primary key (semana, destinatario, pessoa)
);
alter table public.task_sobrecarga_avisos enable row level security;
grant select, insert, update, delete on public.task_sobrecarga_avisos to service_role;

-- Tudo que a Edge precisa numa ida: tarefas abertas com estimativa que caem até
-- p_ate (vencimento já no dia de Brasília), horas por pessoa, folgas e nomes.
create or replace function public.fn_task_sobrecarga_dados(p_ate date)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with tarefas as (
    select t.id, t.title, t.tenant_id, t.list_id, t.created_by, t.assignee_id, t.start_date,
      to_char(t.due_date at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as due_date,
      t.time_estimate_minutes, t.time_plan, st.category as status_category,
      (select coalesce(sum(extract(epoch from (e.ended_at - e.started_at)))::int, 0)
         from task_time_entries e where e.task_id = t.id and e.ended_at is not null) as time_tracked_seconds,
      (select coalesce(jsonb_agg(jsonb_build_object('id', ta.user_id) order by (ta.user_id = t.assignee_id) desc, ta.created_at), '[]'::jsonb)
         from task_assignees ta where ta.task_id = t.id) as assignees
    from tasks t
    left join task_statuses st on st.id = t.status_id
    where not t.is_archived
      and coalesce(t.time_estimate_minutes, 0) > 0
      and t.due_date is not null
      and (st.category is null or st.category not in ('done', 'cancelled'))
      and coalesce(t.start_date, (t.due_date at time zone 'America/Sao_Paulo')::date) <= p_ate
  ),
  pessoas as (
    select distinct x.id::uuid as user_id
    from tarefas t, jsonb_to_recordset(t.assignees) as x(id text)
  )
  select jsonb_build_object(
    'tarefas', coalesce((select jsonb_agg(to_jsonb(t)) from tarefas t), '[]'::jsonb),
    'capacidades', coalesce((select jsonb_object_agg(c.user_id, to_jsonb(c.hours))
       from task_user_capacity c where c.user_id in (select user_id from pessoas)), '{}'::jsonb),
    'ausencias', coalesce((select jsonb_object_agg(a.user_id, a.dias) from (
       select user_id, jsonb_object_agg(to_char(dia, 'YYYY-MM-DD'), horas) as dias
       from task_user_absences
       where user_id in (select user_id from pessoas) and dia between current_date - 1 and p_ate
       group by user_id) a), '{}'::jsonb),
    'nomes', coalesce((select jsonb_object_agg(u.id, u.name) from users u
       where u.id in (select user_id from pessoas)), '{}'::jsonb)
  );
$function$;
revoke all on function public.fn_task_sobrecarga_dados(date) from public, anon, authenticated;
grant execute on function public.fn_task_sobrecarga_dados(date) to service_role;

create or replace function public.fn_task_sobrecarga_tick()
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'vault'
as $function$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'assistente_internal_key';
  if v_key is null then return null; end if;
  return net.http_post(
    url := 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/task-sobrecarga',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $function$;
revoke all on function public.fn_task_sobrecarga_tick() from public, anon, authenticated;

-- 08h de Brasília = 11h UTC, todo dia.
select cron.schedule('task-sobrecarga', '0 11 * * *', 'select public.fn_task_sobrecarga_tick();');
