-- Relatórios de Tarefas: links de arquivos na nuvem também em cada item e em cada resposta (2026-09-25).
-- [{url, title}] — validado na Edge Function task-reports (só http/https), igual a task_reports.links.
alter table public.task_report_items
  add column if not exists links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array');
alter table public.task_report_responses
  add column if not exists links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array');
