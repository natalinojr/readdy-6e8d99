-- Contratação — agendamento de entrevista pelo assistente (Fase 1: base) — 2026-09-14.
-- Decisões do dono: início AUTOMÁTICO pela etapa "Chamar p/ entrevista"; disponibilidade e
-- entrevistadores configurados POR VAGA (sem configuração completa o assistente não manda nada);
-- os entrevistadores (gestores da vaga) respondem pelo WhatsApp do assistente.

-- Configuração por vaga
create table if not exists public.hiring_job_scheduling (
  job_id uuid primary key references public.hiring_jobs(id) on delete cascade,
  enabled boolean not null default false,
  -- janelas semanais: [{ "dow": 0-6 (0 = domingo), "start": "HH:MM", "end": "HH:MM" }]
  slots jsonb not null default '[]'::jsonb,
  blocked_dates jsonb not null default '[]'::jsonb,      -- ["AAAA-MM-DD"] sem entrevista
  duration_min integer not null default 30 check (duration_min between 5 and 240),
  gap_min integer not null default 0 check (gap_min between 0 and 120),
  per_slot integer not null default 1 check (per_slot between 1 and 20),
  min_notice_hours integer not null default 12 check (min_notice_hours between 0 and 168),
  horizon_days integer not null default 7 check (horizon_days between 1 and 60),
  format text not null default 'presencial',
  location text,
  -- entrevistadores = gestores da vaga: [{ "name": "...", "phone": "5541999999999" }]
  interviewers jsonb not null default '[]'::jsonb,
  candidate_notes text,                                  -- o que dizer ao candidato (documentos, como chegar…)
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hiring_job_scheduling is 'Agendamento de entrevista pelo assistente, por vaga: janelas, duração, local e entrevistadores (gestores que recebem avisos e aprovam exceções pelo WhatsApp).';

-- Andamento da conversa de agendamento (candidato × vaga) — usado pela Fase 2
create table if not exists public.hiring_scheduling_sessions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.hiring_candidates(id) on delete cascade,
  job_id uuid not null references public.hiring_jobs(id) on delete cascade,
  phone text,
  jid text,
  -- pendente | convidado | negociando | aguardando_gestor | agendado | recusou | sem_resposta | cancelado | erro
  status text not null default 'pendente',
  interview_id uuid references public.hiring_interviews(id) on delete set null,
  pending_request jsonb,                                 -- pedido fora da agenda aguardando gestor
  attempts integer not null default 0,
  last_out_at timestamptz,
  last_in_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, job_id)
);
create index if not exists hiring_scheduling_sessions_jid_idx on public.hiring_scheduling_sessions (jid);
create index if not exists hiring_scheduling_sessions_status_idx on public.hiring_scheduling_sessions (status);

alter table public.hiring_job_scheduling enable row level security;
alter table public.hiring_scheduling_sessions enable row level security;
drop policy if exists hiring_job_scheduling_owner on public.hiring_job_scheduling;
create policy hiring_job_scheduling_owner on public.hiring_job_scheduling for all to authenticated using (is_hiring_admin()) with check (is_hiring_admin());
drop policy if exists hiring_scheduling_sessions_owner on public.hiring_scheduling_sessions;
create policy hiring_scheduling_sessions_owner on public.hiring_scheduling_sessions for all to authenticated using (is_hiring_admin()) with check (is_hiring_admin());
grant select, insert, update, delete on public.hiring_job_scheduling, public.hiring_scheduling_sessions to authenticated;
grant all on public.hiring_job_scheduling, public.hiring_scheduling_sessions to service_role;

-- Etapa "Chamar p/ entrevista" (native_kind 'agendar'), logo antes de "Entrevista agendada"
alter table public.hiring_stages drop constraint if exists hiring_stages_native_kind_check;
alter table public.hiring_stages add constraint hiring_stages_native_kind_check
  check (native_kind = any (array['novo', 'agendar', 'entrevista', 'aprovado', 'descartado']));
do $$
declare pos integer;
begin
  if not exists (select 1 from public.hiring_stages where native_kind = 'agendar') then
    select sort_order into pos from public.hiring_stages where native_kind = 'entrevista' limit 1;
    if pos is null then select coalesce(max(sort_order), 0) + 1 into pos from public.hiring_stages; end if;
    update public.hiring_stages set sort_order = sort_order + 1 where sort_order >= pos;
    insert into public.hiring_stages (name, color, sort_order, native_kind) values ('Chamar p/ entrevista', '#f59e0b', pos, 'agendar');
  end if;
end $$;

do $$ begin perform public.fn_asst_reader_refresh(); exception when others then null; end $$;
