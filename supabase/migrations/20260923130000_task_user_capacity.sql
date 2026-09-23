-- Tarefas › Carga: horas de trabalho por dia de cada pessoa (2026-09-23).
-- Antes ficavam no localStorage de quem configurava; agora valem pra todos
-- que abrem a Carga. Uma linha por pessoa (vale em qualquer loja: tarefas são
-- por pessoa, não por loja). hours[1] = domingo … hours[7] = sábado.
-- Escrita só pelo task-write (service_role); leitura pelo RPC abaixo, que só
-- devolve quem divide alguma loja com quem pergunta.

create table if not exists public.task_user_capacity (
  user_id uuid primary key,
  hours numeric[] not null check (
    array_length(hours, 1) = 7
    and 0 <= all(hours) and 24 >= all(hours)
  ),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.task_user_capacity enable row level security;
grant select, insert, update, delete on public.task_user_capacity to service_role;

create or replace function public.fn_get_task_capacities(p_user_ids uuid[])
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(c.user_id, to_jsonb(c.hours)), '{}'::jsonb)
  from task_user_capacity c
  where c.user_id = any(p_user_ids)
    and (
      c.user_id = auth.uid()
      or exists (
        select 1 from user_tenants eu
        join user_tenants ele on ele.tenant_id = eu.tenant_id
        where eu.user_id = auth.uid() and ele.user_id = c.user_id
      )
    );
$function$;

revoke all on function public.fn_get_task_capacities(uuid[]) from public, anon;
grant execute on function public.fn_get_task_capacities(uuid[]) to authenticated;
