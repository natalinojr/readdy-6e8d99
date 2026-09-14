-- Contratação — agendamento de entrevista pelo assistente, Fase 2 (conversa + reserva) — 2026-09-14.
-- hiring_interviews.job_id: conta a capacidade de cada horário por vaga.
-- fn_hiring_free_slots: horários livres de uma vaga (janelas semanais, duração+intervalo, antecedência,
--   datas bloqueadas, capacidade por horário), no fuso de São Paulo.
-- fn_hiring_book: reserva atômica (lock por vaga) → entrevista 'agendada', sessão 'agendado' e candidato
--   na etapa "Entrevista agendada". p_force = aceito pelo gestor fora da agenda.

alter table public.hiring_interviews add column if not exists job_id uuid references public.hiring_jobs(id) on delete set null;
create index if not exists hiring_interviews_job_idx on public.hiring_interviews (job_id, scheduled_at);

alter table public.hiring_scheduling_sessions
  add column if not exists offered jsonb,
  add column if not exists code text,
  add column if not exists history jsonb not null default '[]'::jsonb,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists followup_sent_at timestamptz;

create or replace function public.fn_hiring_free_slots(p_job uuid, p_limit integer default 8, p_from timestamptz default now())
returns table (starts_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  c public.hiring_job_scheduling;
  d date;
  s jsonb;
  t timestamptz;
  te timestamptz;
  hoje date := (p_from at time zone 'America/Sao_Paulo')::date;
  n integer := 0;
  usados integer;
begin
  select * into c from public.hiring_job_scheduling where job_id = p_job and enabled;
  if not found then return; end if;
  for d in select g::date from generate_series(hoje, hoje + c.horizon_days, interval '1 day') g loop
    if c.blocked_dates ? to_char(d, 'YYYY-MM-DD') then continue; end if;
    for s in select value from jsonb_array_elements(c.slots) order by value->>'start' loop
      if coalesce((s->>'dow')::int, -1) <> extract(dow from d)::int then continue; end if;
      t := (d + (s->>'start')::time) at time zone 'America/Sao_Paulo';
      te := (d + (s->>'end')::time) at time zone 'America/Sao_Paulo';
      while t + make_interval(mins => c.duration_min) <= te loop
        if t >= p_from + make_interval(hours => c.min_notice_hours) then
          select count(*) into usados from public.hiring_interviews i
           where i.job_id = p_job and i.status = 'agendada' and i.scheduled_at = t;
          if usados < c.per_slot then
            starts_at := t; return next;
            n := n + 1;
            if n >= p_limit then return; end if;
          end if;
        end if;
        t := t + make_interval(mins => c.duration_min + c.gap_min);
      end loop;
    end loop;
  end loop;
end $$;

create or replace function public.fn_hiring_book(p_session uuid, p_start timestamptz, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
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
  -- Remarcação: a entrevista anterior desta conversa é cancelada
  if s.interview_id is not null then
    update public.hiring_interviews set status = 'cancelada', updated_at = now() where id = s.interview_id and status = 'agendada';
  end if;
  select string_agg(x->>'name', ', ') into nomes from jsonb_array_elements(c.interviewers) x where coalesce(x->>'name', '') <> '';
  insert into public.hiring_interviews (candidate_id, company_id, job_id, scheduled_at, duration_min, format, location, interviewer, status, notes, created_by)
  values (s.candidate_id, j.company_id, s.job_id, p_start, c.duration_min,
          case when c.format in ('presencial', 'telefone', 'video') then c.format else 'presencial' end,
          c.location, nomes, 'agendada', 'Agendada pelo assistente (WhatsApp)', null)
  returning id into iv;
  update public.hiring_scheduling_sessions
     set status = 'agendado', interview_id = iv, pending_request = null, offered = null, reminder_sent_at = null, updated_at = now()
   where id = s.id;
  select id into ent from public.hiring_stages where native_kind = 'entrevista' limit 1;
  if ent is not null then update public.hiring_candidates set stage_id = ent where id = s.candidate_id; end if;
  return jsonb_build_object('ok', true, 'interview_id', iv, 'starts_at', p_start);
end $$;

revoke execute on function public.fn_hiring_book(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.fn_hiring_book(uuid, timestamptz, boolean) to service_role;
revoke execute on function public.fn_hiring_free_slots(uuid, integer, timestamptz) from public, anon;
grant execute on function public.fn_hiring_free_slots(uuid, integer, timestamptz) to authenticated, service_role;
