-- Tarefas × OneDrive: aceita conta pessoal (Microsoft 365 Family) além da Business.
-- 'pessoal' = endpoint consumers, só OneDrive; 'empresa' = organizations, OneDrive + SharePoint.
alter table public.ms_graph_connections
  add column if not exists account_kind text not null default 'empresa'
  check (account_kind in ('pessoal', 'empresa'));
