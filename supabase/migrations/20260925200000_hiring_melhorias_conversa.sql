-- Melhorias da conversa com candidatos (leitura das conversas reais de 15–23/09, pedido do dono 2026-09-25).
--  • feedback_message: retorno opcional, por vaga, para quem ficou "NA" (não adequado) na entrevista.
--    Em branco = ninguém recebe nada (como era antes).
--  • feedback_sent_at: retorno já enviado (ou pedido pelo modelo, fora da janela de 24 h).
--  • unconfirmed_alert_at: equipe já avisada de que o candidato não confirmou presença.

alter table public.hiring_job_scheduling
  add column if not exists feedback_message text;

alter table public.hiring_scheduling_sessions
  add column if not exists feedback_sent_at timestamptz,
  add column if not exists unconfirmed_alert_at timestamptz;
