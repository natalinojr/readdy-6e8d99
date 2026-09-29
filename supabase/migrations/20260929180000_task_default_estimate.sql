-- Tarefas: tempo estimado padrão por pessoa (2026-09-29, pedido do dono).
-- Tarefa sem tempo estimado passa a valer o padrão do responsável principal
-- (lista, totais, Carga). Mora junto das horas de trabalho da pessoa.
-- Quem só define o padrão ganha a linha com as horas padrão (seg–sex 8h).

alter table public.task_user_capacity
  alter column hours set default array[0,8,8,8,8,8,0]::numeric[];

alter table public.task_user_capacity
  add column if not exists default_estimate_minutes integer
  check (default_estimate_minutes is null or (default_estimate_minutes > 0 and default_estimate_minutes <= 14400));

-- Mesma regra de leitura das horas: a própria pessoa ou quem divide alguma loja com ela.
create or replace function public.fn_get_task_default_estimates(p_user_ids uuid[])
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(c.user_id, c.default_estimate_minutes), '{}'::jsonb)
  from task_user_capacity c
  where c.user_id = any(p_user_ids)
    and c.default_estimate_minutes is not null
    and (
      c.user_id = auth.uid()
      or exists (
        select 1 from user_tenants eu
        join user_tenants ele on ele.tenant_id = eu.tenant_id
        where eu.user_id = auth.uid() and ele.user_id = c.user_id
      )
    );
$function$;

revoke all on function public.fn_get_task_default_estimates(uuid[]) from public, anon;
grant execute on function public.fn_get_task_default_estimates(uuid[]) to authenticated;
