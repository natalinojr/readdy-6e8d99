-- Tarefas: subpasta FORA do compartilhamento (dono, 2026-09-24).
-- Compartilhar uma pasta vale para toda a subárvore; agora o dono marca subpastas que não entram.
-- Regra: a subpasta marcada (e tudo abaixo dela) deixa de HERDAR os compartilhamentos das pastas de
-- cima. Compartilhamento feito direto nela (ou numa subpasta dela) continua valendo. O dono (quem
-- criou a pasta ou uma acima) sempre vê tudo. Escrita só pelo task-write (service_role).

create table if not exists public.task_list_share_exclusions (
  list_id uuid primary key references public.task_lists(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
alter table public.task_list_share_exclusions enable row level security;
grant select, insert, update, delete on public.task_list_share_exclusions to service_role;

-- Compartilhamentos que VALEM para uma pasta: os dela + os das pastas de cima, subindo só até a
-- primeira pasta fora do compartilhamento (ela conta, as de cima dela não).
create or replace function public.fn_task_list_shares_efetivos(p_list_id uuid)
 returns table(share_id uuid, user_id uuid, permission text, from_list_id uuid, from_list_name text, prof int)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with recursive sobe as (
    select l.id, l.parent_list_id, l.name, 0 as prof,
           exists (select 1 from task_list_share_exclusions e where e.list_id = l.id) as fora
    from task_lists l where l.id = p_list_id and not l.is_archived
    union all
    select l.id, l.parent_list_id, l.name, s.prof + 1,
           exists (select 1 from task_list_share_exclusions e where e.list_id = l.id)
    from task_lists l join sobe s on l.id = s.parent_list_id
    where s.prof < 50 and not s.fora and not l.is_archived
  )
  select sh.id, sh.user_id, sh.permission, sobe.id, sobe.name, sobe.prof
  from task_list_shares sh join sobe on sobe.id = sh.list_id;
$function$;

-- Pastas que a pessoa enxerga: a descida de um compartilhamento para na subpasta fora dele
-- (a descida do dono, nível 3, não para).
create or replace function public.fn_task_lists_acessiveis(p_user_id uuid)
 returns table(list_id uuid, access text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with recursive raizes as (
    select l.id, 3 as nivel from task_lists l where l.created_by = p_user_id and not l.is_archived
    union all
    select s.list_id, case s.permission when 'edit' then 2 else 1 end
    from task_list_shares s join task_lists l on l.id = s.list_id
    where s.user_id = p_user_id and not l.is_archived
  ), arvore as (
    select id, nivel, 0 as prof from raizes
    union all
    select l.id, a.nivel, a.prof + 1 from task_lists l join arvore a on l.parent_list_id = a.id
    where not l.is_archived and a.prof < 50
      and (a.nivel = 3 or not exists (select 1 from task_list_share_exclusions e where e.list_id = l.id))
  )
  select id, case max(nivel) when 3 then 'owner' when 2 then 'edit' else 'view' end
  from arvore group by id;
$function$;

-- Acesso a UMA pasta: dono = criou ela ou uma acima (sem limite); compartilhado = só os que valem.
create or replace function public.fn_task_list_access(p_list_id uuid, p_user_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with recursive sobe as (
    select l.id, l.parent_list_id, l.created_by, 0 as prof from task_lists l where l.id = p_list_id and not l.is_archived
    union all
    select l.id, l.parent_list_id, l.created_by, s.prof + 1
    from task_lists l join sobe s on l.id = s.parent_list_id where s.prof < 50 and not l.is_archived
  )
  select case
    when exists (select 1 from sobe where created_by = p_user_id) then 'owner'
    when exists (select 1 from fn_task_list_shares_efetivos(p_list_id) e where e.user_id = p_user_id and e.permission = 'edit') then 'edit'
    when exists (select 1 from fn_task_list_shares_efetivos(p_list_id) e where e.user_id = p_user_id) then 'view'
  end;
$function$;

-- Quem tem acesso (janela Compartilhar): só os compartilhamentos que valem para esta pasta.
create or replace function public.fn_get_task_list_shares(p_list_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if fn_task_list_access(p_list_id, auth.uid()) is null then
    raise exception 'sem acesso a esta pasta' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.share_id, 'user_id', e.user_id, 'name', u.name, 'email', u.email, 'badge_number', u.badge_number,
      'permission', e.permission, 'created_at', sh.created_at,
      'inherited_from', case when e.from_list_id = p_list_id then null else e.from_list_name end
    ) order by e.prof, u.name), '[]'::jsonb)
    from fn_task_list_shares_efetivos(p_list_id) e
    join task_list_shares sh on sh.id = e.share_id
    left join users u on u.id = e.user_id
  );
end $function$;

-- Lista de pastas: + share_excluded (fora do compartilhamento) e shared_count (quantas pessoas
-- têm acesso a ela por compartilhamento, direto ou herdado) — o símbolo na árvore sai daqui.
create or replace function public.fn_get_task_lists(p_tenant_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform fn_tasks_assert_member(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'color', l.color,
      'icon', l.icon,
      'sort_order', l.sort_order,
      'parent_list_id', l.parent_list_id,
      'access', ac.access,
      'owner_id', l.created_by,
      'owner_name', ow.name,
      'share_count', (select count(*) from task_list_shares s where s.list_id = l.id),
      'shared_count', (select count(distinct e.user_id) from fn_task_list_shares_efetivos(l.id) e),
      'share_excluded', exists (select 1 from task_list_share_exclusions x where x.list_id = l.id),
      'statuses', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'name', s.name, 'color', s.color,
          'category', s.category, 'sort_order', s.sort_order
        ) order by s.sort_order), '[]'::jsonb)
        from task_statuses s where s.list_id = l.id
      ),
      'open_count', (
        select count(*) from tasks t
        join task_statuses st on st.id = t.status_id
        where t.list_id = l.id and not t.is_archived
          and t.parent_task_id is null
          and st.category not in ('done','cancelled')
      )
    ) order by l.sort_order, l.created_at), '[]'::jsonb)
    from fn_task_lists_acessiveis(auth.uid()) ac
    join task_lists l on l.id = ac.list_id
    left join users ow on ow.id = l.created_by);
end $function$;

-- Membros do relatório da pasta: donos de cima + compartilhamentos que valem para ela.
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
  select e.user_id from rel, fn_task_list_shares_efetivos(rel.list_id) e;
$function$;

revoke all on function public.fn_task_list_shares_efetivos(uuid) from public, anon, authenticated;
grant execute on function public.fn_task_list_shares_efetivos(uuid) to service_role;
