-- Entrevista excluída (ou cancelada) pela tela encerra a sessão de agendamento da IA.
-- Antes, a FK interview_id (ON DELETE SET NULL) só zerava o vínculo e a sessão ficava "agendado"
-- para sempre: o hiring-scheduler continuava pegando as mensagens do candidato (visto em 2026-09-15).
-- BEFORE DELETE porque o SET NULL da FK roda antes de qualquer AFTER trigger nosso.
-- O cancelamento feito pelo próprio scheduler (cancelInterview) grava 'negociando' logo depois e prevalece.

create or replace function public.hiring_interview_encerra_sessao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' or (new.status = 'cancelada' and old.status is distinct from 'cancelada') then
    update public.hiring_scheduling_sessions
       set status = 'cancelado', confirmed_at = null, confirm_requested_at = null, updated_at = now()
     where interview_id = old.id and status = 'agendado';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_hiring_interview_encerra_sessao_del on public.hiring_interviews;
create trigger trg_hiring_interview_encerra_sessao_del
  before delete on public.hiring_interviews
  for each row execute function public.hiring_interview_encerra_sessao();

drop trigger if exists trg_hiring_interview_encerra_sessao_upd on public.hiring_interviews;
create trigger trg_hiring_interview_encerra_sessao_upd
  after update of status on public.hiring_interviews
  for each row execute function public.hiring_interview_encerra_sessao();

-- Sessões já presas: "agendado" sem entrevista não existe no fluxo normal.
update public.hiring_scheduling_sessions
   set status = 'cancelado', confirmed_at = null, confirm_requested_at = null, updated_at = now()
 where status = 'agendado' and interview_id is null;
