-- Tarefas › Linha do tempo, 2026-10-02.
-- Views salvas na aba nova gravam view_type = 'linha'. Mantém o 'gantt' do
-- Cronograma (migração 20261002120000, sessão paralela) — quem reaplicar uma das
-- duas precisa levar os dois valores.
alter table public.task_views drop constraint if exists task_views_view_type_check;
alter table public.task_views add constraint task_views_view_type_check
  check (view_type = any (array['lista', 'kanban', 'calendario', 'minhas', 'carga', 'gantt', 'linha']));
