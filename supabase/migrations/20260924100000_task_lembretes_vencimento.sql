-- Tarefas: aviso quando a tarefa vai vencer (2026-09-24).
-- Cada pessoa escolhe QUANDO (minutos antes; tarefa sem horário usa um horário
-- do dia) e COMO (push no celular, com ou sem vibração). A cada minuto o
-- pg_cron chama a edge task-lembretes, que pega os avisos da vez com
-- fn_task_lembretes_da_vez() (que já os registra em task_lembretes_enviados —
-- nunca repete; se o vencimento muda, a chave muda e o aviso vale de novo).

create table if not exists public.task_notification_prefs (
  user_id uuid primary key,
  ativo boolean not null default true,
  -- minutos antes do vencimento (0 = na hora). Tarefa sem horário: conta a
  -- partir de `hora_dia_todo` do dia do vencimento.
  lembretes integer[] not null default '{60,0}'
    check (array_length(lembretes, 1) is null or (array_length(lembretes, 1) <= 8 and 0 <= all(lembretes) and 10080 >= all(lembretes))),
  hora_dia_todo time not null default '08:00',
  vibrar boolean not null default true,
  -- também tarefas que EU criei e estão sem responsável
  incluir_criadas_sem_resp boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.task_notification_prefs enable row level security;
grant select, insert, update, delete on public.task_notification_prefs to service_role;

create table if not exists public.task_lembretes_enviados (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null,
  minutos_antes integer not null,
  due_date timestamptz not null,
  enviado_em timestamptz not null default now(),
  primary key (task_id, user_id, minutos_antes, due_date)
);
alter table public.task_lembretes_enviados enable row level security;
grant select, insert, update, delete on public.task_lembretes_enviados to service_role;

-- Tipo novo de notificação no app: 'due' (vencimento).
alter table public.task_notifications drop constraint task_notifications_type_check;
alter table public.task_notifications add constraint task_notifications_type_check
  check (type = any (array['assigned', 'mentioned', 'commented', 'due']));

-- Minhas preferências (sem linha = padrão).
create or replace function public.fn_get_task_notification_prefs()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select jsonb_build_object('ativo', p.ativo, 'lembretes', to_jsonb(p.lembretes), 'hora_dia_todo', to_char(p.hora_dia_todo, 'HH24:MI'),
            'vibrar', p.vibrar, 'incluir_criadas_sem_resp', p.incluir_criadas_sem_resp, 'salvo', true)
     from task_notification_prefs p where p.user_id = auth.uid()),
    jsonb_build_object('ativo', true, 'lembretes', '[60,0]'::jsonb, 'hora_dia_todo', '08:00', 'vibrar', true,
                       'incluir_criadas_sem_resp', true, 'salvo', false)
  );
$function$;
revoke all on function public.fn_get_task_notification_prefs() from public, anon;
grant execute on function public.fn_get_task_notification_prefs() to authenticated;

-- Avisos que chegaram na hora (até 30 min de atraso; mais que isso não manda
-- aviso velho). Registra e devolve numa tacada só — duas execuções ao mesmo
-- tempo não mandam o mesmo aviso duas vezes (on conflict do nothing).
create or replace function public.fn_task_lembretes_da_vez()
 returns table(task_id uuid, user_id uuid, minutos_antes integer, title text, due_date timestamptz,
               due_has_time boolean, list_name text, tenant_id uuid, vibrar boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  return query
  with destinatarios as (
    select t.id as task_id,
           coalesce(t.assignee_id, t.created_by) as user_id,
           t.assignee_id is null as sem_resp,
           t.title, t.due_date, t.due_has_time, l.name as list_name, t.tenant_id
    from tasks t
    join task_statuses st on st.id = t.status_id
    left join task_lists l on l.id = t.list_id
    where not t.is_archived
      and t.due_date is not null
      and st.category not in ('done', 'cancelled')
      and t.due_date > now() - interval '2 days'
      and t.due_date < now() + interval '8 days'
      and coalesce(t.assignee_id, t.created_by) is not null
  ), com_prefs as (
    select d.*,
           coalesce(p.ativo, true) as ativo,
           coalesce(p.lembretes, '{60,0}') as lembretes,
           coalesce(p.hora_dia_todo, '08:00'::time) as hora_dia_todo,
           coalesce(p.vibrar, true) as vibrar,
           coalesce(p.incluir_criadas_sem_resp, true) as incluir_sem_resp
    from destinatarios d
    left join task_notification_prefs p on p.user_id = d.user_id
  ), momentos as (
    select c.*, m as minutos,
           (case when c.due_has_time then c.due_date
                 else ((c.due_date at time zone 'America/Sao_Paulo')::date + c.hora_dia_todo) at time zone 'America/Sao_Paulo'
            end) - make_interval(mins => m) as momento
    from com_prefs c, unnest(c.lembretes) m
    where c.ativo and (not c.sem_resp or c.incluir_sem_resp)
  ), da_vez as (
    select * from momentos
    where momento <= now() and momento > now() - interval '30 minutes'
  ), registrados as (
    insert into task_lembretes_enviados (task_id, user_id, minutos_antes, due_date)
    select v.task_id, v.user_id, v.minutos, v.due_date from da_vez v
    on conflict do nothing
    returning task_lembretes_enviados.task_id, task_lembretes_enviados.user_id,
              task_lembretes_enviados.minutos_antes, task_lembretes_enviados.due_date
  )
  select r.task_id, r.user_id, r.minutos_antes, v.title, v.due_date, v.due_has_time, v.list_name, v.tenant_id, v.vibrar
  from registrados r
  join da_vez v on v.task_id = r.task_id and v.user_id = r.user_id and v.minutos = r.minutos_antes and v.due_date = r.due_date;
end $function$;
revoke all on function public.fn_task_lembretes_da_vez() from public, anon, authenticated;
grant execute on function public.fn_task_lembretes_da_vez() to service_role;

-- Tique: chama a edge com a chave interna (mesmo padrão do assistente-tick).
create or replace function public.fn_task_lembretes_tick()
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'vault'
as $function$
declare v_key text;
begin
  -- Nada vencendo por perto: nem chama a edge.
  if not exists (
    select 1 from tasks t where not t.is_archived and t.due_date between now() - interval '1 day' and now() + interval '8 days'
  ) then return null; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'assistente_internal_key';
  if v_key is null then return null; end if;
  return net.http_post(
    url := 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/task-lembretes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $function$;
revoke all on function public.fn_task_lembretes_tick() from public, anon, authenticated;

-- A cada minuto (os avisos têm precisão de ~1 min).
select cron.schedule('task-lembretes', '* * * * *', 'select public.fn_task_lembretes_tick();');
