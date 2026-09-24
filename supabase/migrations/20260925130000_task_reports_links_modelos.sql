-- Relatórios de Tarefas (2026-09-25, parte 4):
--   * links de arquivos na nuvem anexados ao relatório (Drive, OneDrive, Dropbox…)
--   * modelos de relatório (salvar um relatório como modelo e criar a partir dele)

-- [{url, title}] — validado na Edge Function task-reports (só http/https).
alter table public.task_reports
  add column if not exists links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array');

-- Modelo pessoal: cópia da explicação, links e itens (título, texto, imagens, campos).
-- As imagens do modelo ficam no bucket task-reports em modelos/<id>/.
create table if not exists public.task_report_templates (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  name text not null check (length(name) between 1 and 200),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_report_templates_owner_idx on public.task_report_templates(created_by);
alter table public.task_report_templates enable row level security;
grant select, insert, update, delete on public.task_report_templates to service_role;
grant select on public.task_report_templates to authenticated;
drop policy if exists task_report_templates_owner_select on public.task_report_templates;
create policy task_report_templates_owner_select on public.task_report_templates
  for select to authenticated using (created_by = (select auth.uid()));
