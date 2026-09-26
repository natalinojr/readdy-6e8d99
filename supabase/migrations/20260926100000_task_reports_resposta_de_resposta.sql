-- Relatórios de Tarefas: responder uma resposta específica (2026-09-26).
-- Um nível só: parent_id aponta sempre para uma resposta "de primeiro nível" do mesmo item
-- (a Edge Function task-reports achata resposta de resposta e confere o item).
alter table public.task_report_responses
  add column if not exists parent_id uuid references public.task_report_responses(id) on delete cascade;
create index if not exists task_report_responses_parent_idx
  on public.task_report_responses(parent_id) where parent_id is not null;
