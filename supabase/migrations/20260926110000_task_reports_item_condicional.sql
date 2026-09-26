-- Relatórios de Tarefas: item condicional (2026-09-26).
-- show_if = {item_id, field_id, values[]}: o item só aparece para quem responde pelo link se o campo
-- `field_id` (de escolha/caixas/sim-não) do item `item_id` tiver uma das respostas `values`.
-- Validado na Edge Function task-reports (mesmo relatório, sem ciclo). Item/campo apagado = condição ignorada.
alter table public.task_report_items
  add column if not exists show_if jsonb check (show_if is null or jsonb_typeof(show_if) = 'object');
