-- Tarefas sem loja (2026-09-23): quem tem o módulo Tarefas liberado no Admin
-- Master (fn_user_tem_tarefas) usa Tarefas mesmo sem estar em nenhuma loja.
--
-- Tarefas já é por PESSOA: leitura e escrita vêm de created_by / responsável /
-- pasta compartilhada (fn_task_lists_acessiveis), nunca do tenant_id. A loja
-- só sobrava como trava (fn_tasks_assert_member) e como coluna NOT NULL.
-- Registros de quem não tem loja ficam com tenant_id nulo.

alter table public.tasks                    alter column tenant_id drop not null;
alter table public.task_lists               alter column tenant_id drop not null;
alter table public.task_statuses            alter column tenant_id drop not null;
alter table public.task_activity            alter column tenant_id drop not null;
alter table public.task_attachments         alter column tenant_id drop not null;
alter table public.task_checklist_items     alter column tenant_id drop not null;
alter table public.task_checklist_templates alter column tenant_id drop not null;
alter table public.task_comments            alter column tenant_id drop not null;
alter table public.task_custom_fields       alter column tenant_id drop not null;
alter table public.task_field_values        alter column tenant_id drop not null;
alter table public.task_notifications       alter column tenant_id drop not null;
alter table public.task_tag_links           alter column tenant_id drop not null;
alter table public.task_tags                alter column tenant_id drop not null;
alter table public.task_time_entries        alter column tenant_id drop not null;
alter table public.task_views               alter column tenant_id drop not null;
alter table public.task_watchers            alter column tenant_id drop not null;

-- p_tenant_id nulo = "sem loja": vale para quem tem o módulo Tarefas.
create or replace function public.fn_tasks_assert_member(p_tenant_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_tenant_id is null then
    if not fn_user_tem_tarefas(auth.uid()) then
      raise exception 'sem acesso ao módulo Tarefas' using errcode = '42501';
    end if;
    return;
  end if;
  if not exists (
    select 1 from user_tenants
    where user_id = auth.uid() and tenant_id = p_tenant_id
  ) then
    raise exception 'not a member of tenant %', p_tenant_id using errcode = '42501';
  end if;
end $function$;

-- Notificação é da pessoa: a loja não entra (quem recebe pode não ter loja, ou
-- ser de outra loja que a de quem compartilhou a pasta).
drop policy if exists task_notifications_select_own on public.task_notifications;
create policy task_notifications_select_own on public.task_notifications
  for select to authenticated using (user_id = (select auth.uid()));
