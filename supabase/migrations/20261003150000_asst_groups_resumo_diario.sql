-- Grupos do WhatsApp do assistente (dono, 2026-10-03): ao entrar num grupo o assistente pergunta ao
-- dono, no WhatsApp, a pasta de Tarefas do grupo e se ele quer o resumo diário; tudo também na tela
-- Assistente › Grupos.
--   daily_summary   — manda o resumo do dia do grupo (assistente-cron, horário em asst_settings.group_summary.time)
--   summary_sent_on — dia (horário de Brasília) do último resumo; trava contra repetir no mesmo dia
--   config_asked_at — quando o dono foi perguntado (ou configurou na tela); nulo = ainda não
alter table public.asst_groups
  add column if not exists daily_summary boolean not null default false,
  add column if not exists summary_sent_on date,
  add column if not exists config_asked_at timestamptz;

-- Grupos que já existiam foram configurados na tela: não recebem a pergunta no WhatsApp.
update public.asst_groups set config_asked_at = coalesce(config_asked_at, now());
