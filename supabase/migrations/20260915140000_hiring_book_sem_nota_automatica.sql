-- Entrevista marcada pela IA não escreve mais "Agendada pelo assistente (WhatsApp)" nas considerações:
-- o campo é do entrevistador (pedido do dono, 2026-09-15). A origem continua visível na sessão de
-- agendamento (hiring_scheduling_sessions.interview_id). Resto da função igual à fase 2.

create or replace function public.fn_hiring_book(p_session uuid, p_start timestamp with time zone, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.hiring_scheduling_sessions;
  c public.hiring_job_scheduling;
  j public.hiring_jobs;
  iv uuid;
  livre boolean;
  ent uuid;
  nomes text;
begin
  select * into s from public.hiring_scheduling_sessions where id = p_session for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'sessão não encontrada'); end if;
  perform pg_advisory_xact_lock(hashtext(s.job_id::text));
  select * into c from public.hiring_job_scheduling where job_id = s.job_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'vaga sem configuração de agendamento'); end if;
  select * into j from public.hiring_jobs where id = s.job_id;
  if not p_force then
    select exists (select 1 from public.fn_hiring_free_slots(s.job_id, 1000, now()) f where f.starts_at = p_start) into livre;
    if not livre then return jsonb_build_object('ok', false, 'error', 'horario_indisponivel'); end if;
  end if;
  if s.interview_id is not null then
    update public.hiring_interviews set status = 'cancelada', updated_at = now() where id = s.interview_id and status = 'agendada';
  end if;
  select string_agg(x->>'name', ', ') into nomes from jsonb_array_elements(c.interviewers) x where coalesce(x->>'name', '') <> '';
  insert into public.hiring_interviews (candidate_id, company_id, job_id, scheduled_at, duration_min, format, location, interviewer, status, notes, created_by)
  values (s.candidate_id, j.company_id, s.job_id, p_start, c.duration_min,
          case when c.format in ('presencial', 'telefone', 'video') then c.format else 'presencial' end,
          c.location, nomes, 'agendada', null, null)
  returning id into iv;
  update public.hiring_scheduling_sessions
     set status = 'agendado', interview_id = iv, pending_request = null, offered = null, reminder_sent_at = null, updated_at = now()
   where id = s.id;
  select id into ent from public.hiring_stages where native_kind = 'entrevista' limit 1;
  if ent is not null then update public.hiring_candidates set stage_id = ent where id = s.candidate_id; end if;
  return jsonb_build_object('ok', true, 'interview_id', iv, 'starts_at', p_start);
end $function$;

-- Entrevistas já marcadas com o texto automático: limpa só quando a nota é exatamente ele.
update public.hiring_interviews set notes = null where notes = 'Agendada pelo assistente (WhatsApp)';
