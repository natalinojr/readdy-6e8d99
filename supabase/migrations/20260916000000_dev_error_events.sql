-- Fila de erros do ERPOS (Fase 0.2 de ORQUESTRACAO-AGENTES.md, 2026-09-16).
-- Um lugar só para tudo que quebra: erro de render/JS no front, Edge Function que respondeu
-- 4xx/5xx (visto do cliente), impressão que falhou, NFC-e com erro. Dedup por fingerprint:
-- a mesma falha vira 1 linha com count/first_seen/last_seen. Só service_role lê e escreve
-- (RLS ligada sem policy); o front manda pela Edge `client-errors`; agentes/assistente leem por SQL.

create table if not exists public.dev_error_events (
  id            uuid primary key default gen_random_uuid(),
  fingerprint   text not null unique,
  source        text not null check (source in ('front','edge','print','fiscal','cron','sw','other')),
  severity      text not null default 'error' check (severity in ('error','warning')),
  tenant_id     uuid,
  user_id       uuid,
  route         text,
  fn            text,                       -- Edge Function / job / componente
  message       text not null,
  stack         text,
  context       jsonb not null default '{}'::jsonb,
  user_agent    text,
  app_build     text,                       -- hash do bundle (index-XXXX.js) para saber a versão
  count         integer not null default 1,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  status        text not null default 'open' check (status in ('open','triaged','fixed','ignored')),
  ticket        text,                       -- tarefa/PR/observação do Triador
  updated_at    timestamptz not null default now()
);
create index if not exists dev_error_events_open_idx on public.dev_error_events (status, last_seen desc);
create index if not exists dev_error_events_tenant_idx on public.dev_error_events (tenant_id, last_seen desc);

alter table public.dev_error_events enable row level security;
revoke all on public.dev_error_events from anon, authenticated;
grant select, insert, update, delete on public.dev_error_events to service_role;

-- Registro com dedup. p = {source, message, stack?, route?, fn?, tenant_id?, user_id?, context?, user_agent?, app_build?, severity?, fingerprint?}
create or replace function public.fn_dev_error_report(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp   text;
  v_id   uuid;
  v_msg  text := left(coalesce(p->>'message', 'sem mensagem'), 2000);
  v_top  text;
begin
  -- fingerprint = fonte + função/rota + mensagem sem números/uuids + 1ª linha útil do stack
  v_top := split_part(coalesce(p->>'stack', ''), E'\n', 2);
  v_fp := coalesce(
    p->>'fingerprint',
    md5(
      coalesce(p->>'source','other') || '|' ||
      coalesce(p->>'fn', p->>'route', '') || '|' ||
      regexp_replace(regexp_replace(v_msg, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'gi'), '\d+', '#', 'g') || '|' ||
      regexp_replace(v_top, '\?[^:)]*', '', 'g')   -- tira querystring/hash de chunk
    )
  );

  insert into public.dev_error_events as e
    (fingerprint, source, severity, tenant_id, user_id, route, fn, message, stack, context, user_agent, app_build)
  values (
    v_fp,
    coalesce(p->>'source','other'),
    coalesce(p->>'severity','error'),
    nullif(p->>'tenant_id','')::uuid,
    nullif(p->>'user_id','')::uuid,
    left(p->>'route', 300),
    left(p->>'fn', 200),
    v_msg,
    left(p->>'stack', 8000),
    coalesce(p->'context', '{}'::jsonb),
    left(p->>'user_agent', 400),
    left(p->>'app_build', 80)
  )
  on conflict (fingerprint) do update set
    count      = e.count + 1,
    last_seen  = now(),
    -- reabre se voltou a acontecer depois de "corrigido"
    status     = case when e.status = 'fixed' then 'open' else e.status end,
    tenant_id  = coalesce(excluded.tenant_id, e.tenant_id),
    user_id    = coalesce(excluded.user_id, e.user_id),
    route      = coalesce(excluded.route, e.route),
    stack      = coalesce(excluded.stack, e.stack),
    context    = e.context || excluded.context,
    app_build  = coalesce(excluded.app_build, e.app_build),
    updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.fn_dev_error_report(jsonb) from public, anon, authenticated;
grant execute on function public.fn_dev_error_report(jsonb) to service_role;

-- Coleta do que já fica no banco: impressão falhada e NFC-e com erro (últimos 20 min, com folga).
create or replace function public.fn_dev_error_collect()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  r record;
begin
  for r in
    select tenant_id, impressora_nome, impressora_ip, last_error, count(*) as c, max(updated_at) as t
    from public.print_queue
    where status = 'failed' and updated_at > now() - interval '20 minutes'
    group by 1,2,3,4
  loop
    perform public.fn_dev_error_report(jsonb_build_object(
      'source','print', 'fn', coalesce(r.impressora_nome, r.impressora_ip, 'impressora'),
      'tenant_id', r.tenant_id, 'message', coalesce(r.last_error, 'print_queue failed'),
      'context', jsonb_build_object('impressora_ip', r.impressora_ip, 'jobs', r.c, 'ultimo', r.t)
    ));
    n := n + 1;
  end loop;

  for r in
    select tenant_id, error_message, source_type, count(*) as c, max(updated_at) as t
    from public.fiscal_documents
    where status in ('error','rejected') and updated_at > now() - interval '20 minutes'
    group by 1,2,3
  loop
    perform public.fn_dev_error_report(jsonb_build_object(
      'source','fiscal', 'fn', 'fiscal-write', 'tenant_id', r.tenant_id,
      'message', coalesce(r.error_message, 'NFC-e com erro'),
      'context', jsonb_build_object('source_type', r.source_type, 'notas', r.c, 'ultimo', r.t)
    ));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.fn_dev_error_collect() from public, anon, authenticated;

select cron.unschedule('dev-error-collect') where exists (select 1 from cron.job where jobname = 'dev-error-collect');
select cron.schedule('dev-error-collect', '*/15 * * * *', $$select public.fn_dev_error_collect();$$);

-- Resumo para o Triador / assistente: o que está aberto, mais frequente primeiro.
create or replace view public.dev_error_summary as
  select id, source, fn, route, left(message, 160) as message, count, first_seen, last_seen, status, tenant_id, app_build
  from public.dev_error_events
  where status in ('open','triaged')
  order by last_seen desc, count desc;
revoke all on public.dev_error_summary from anon, authenticated;
grant select on public.dev_error_summary to service_role;
