-- Agendamento da IA (2026-09-15, pedido do dono):
--  1) Bloqueio de FAIXA de horário numa data (blocked_slots), além do dia inteiro (blocked_dates).
--     [{"date":"AAAA-MM-DD","start":"HH:MM","end":"HH:MM"}]
--  2) Horário ocupado = qualquer entrevista 'agendada' que SE SOBREPÕE ao horário (antes: só o minuto
--     exato), da vaga OU da mesma loja. Entrevista marcada na mão pela Agenda não grava job_id, só a
--     loja, e antes não bloqueava nada.

alter table public.hiring_job_scheduling
  add column if not exists blocked_slots jsonb not null default '[]'::jsonb;

create or replace function public.fn_hiring_free_slots(p_job uuid, p_limit integer default 8, p_from timestamp with time zone default now())
returns table(starts_at timestamp with time zone)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  c public.hiring_job_scheduling;
  v_company uuid;
  d date;
  s jsonb;
  t timestamptz;
  te timestamptz;
  fim timestamptz;
  hoje date := (p_from at time zone 'America/Sao_Paulo')::date;
  n integer := 0;
  usados integer;
  bloqueado boolean;
begin
  select * into c from public.hiring_job_scheduling where job_id = p_job and enabled;
  if not found then return; end if;
  select company_id into v_company from public.hiring_jobs where id = p_job;
  for d in select g::date from generate_series(hoje, hoje + c.horizon_days, interval '1 day') g loop
    if c.blocked_dates ? to_char(d, 'YYYY-MM-DD') then continue; end if;
    for s in select value from jsonb_array_elements(c.slots) order by value->>'start' loop
      if coalesce((s->>'dow')::int, -1) <> extract(dow from d)::int then continue; end if;
      t := (d + (s->>'start')::time) at time zone 'America/Sao_Paulo';
      te := (d + (s->>'end')::time) at time zone 'America/Sao_Paulo';
      while t + make_interval(mins => c.duration_min) <= te loop
        fim := t + make_interval(mins => c.duration_min);
        if t >= p_from + make_interval(hours => c.min_notice_hours) then
          -- faixa bloqueada nesta data que encosta no horário
          select exists (
            select 1 from jsonb_array_elements(coalesce(c.blocked_slots, '[]'::jsonb)) x
             where x->>'date' = to_char(d, 'YYYY-MM-DD')
               and t < ((d + (x->>'end')::time) at time zone 'America/Sao_Paulo')
               and fim > ((d + (x->>'start')::time) at time zone 'America/Sao_Paulo')
          ) into bloqueado;
          if not bloqueado then
            select count(*) into usados from public.hiring_interviews i
             where i.status = 'agendada'
               and (i.job_id = p_job or (v_company is not null and i.company_id = v_company))
               and i.scheduled_at < fim
               and i.scheduled_at + make_interval(mins => coalesce(i.duration_min, c.duration_min)) > t;
            if usados < c.per_slot then
              starts_at := t; return next;
              n := n + 1;
              if n >= p_limit then return; end if;
            end if;
          end if;
        end if;
        t := t + make_interval(mins => c.duration_min + c.gap_min);
      end loop;
    end loop;
  end loop;
end $function$;
