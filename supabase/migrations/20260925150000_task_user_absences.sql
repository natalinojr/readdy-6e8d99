-- Tarefas › Carga: folgas e ausências num dia específico (2026-09-25).
-- As horas por dia da semana (task_user_capacity) não cobrem férias, atestado ou
-- uma folga numa quarta qualquer. Uma linha por pessoa+dia: `horas` = quanto a
-- pessoa trabalha nesse dia (0 = não trabalha; 4 = meio período).
-- Escrita só pelo task-write (service_role); leitura pelo RPC, com a mesma
-- visibilidade das horas (a própria pessoa ou quem divide alguma loja com ela).

create table if not exists public.task_user_absences (
  user_id uuid not null,
  dia date not null,
  horas numeric not null default 0 check (horas >= 0 and horas <= 24),
  motivo text check (motivo is null or char_length(motivo) <= 80),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, dia)
);

alter table public.task_user_absences enable row level security;
grant select, insert, update, delete on public.task_user_absences to service_role;

-- { "<user_id>": { "2026-09-25": { "horas": 0, "motivo": "Férias" }, ... } }
create or replace function public.fn_get_task_absences(p_user_ids uuid[], p_de date, p_ate date)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(x.user_id, x.dias), '{}'::jsonb)
  from (
    select a.user_id,
      jsonb_object_agg(to_char(a.dia, 'YYYY-MM-DD'), jsonb_build_object('horas', a.horas, 'motivo', a.motivo)) as dias
    from task_user_absences a
    where a.user_id = any(p_user_ids)
      and a.dia between p_de and p_ate
      and (
        a.user_id = auth.uid()
        or exists (
          select 1 from user_tenants eu
          join user_tenants ele on ele.tenant_id = eu.tenant_id
          where eu.user_id = auth.uid() and ele.user_id = a.user_id
        )
      )
    group by a.user_id
  ) x;
$function$;

revoke all on function public.fn_get_task_absences(uuid[], date, date) from public, anon;
grant execute on function public.fn_get_task_absences(uuid[], date, date) to authenticated;
