-- Contratação — status das conversas de agendamento (painel "Agendamentos"), 2026-09-14.
-- Recibo do WhatsApp da última mensagem enviada ao candidato (entregue / lida) e confirmação de
-- presença (pedida na véspera e, se ainda faltar, na manhã do dia).
alter table public.hiring_scheduling_sessions
  add column if not exists last_out_msg_id text,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists confirm_requested_at timestamptz,
  add column if not exists confirmed_at timestamptz;
create index if not exists hiring_scheduling_sessions_msg_idx on public.hiring_scheduling_sessions (last_out_msg_id);
