-- Assistente pessoal do dono (WhatsApp + Claude). Projeto PESSOAL: nenhuma tela
-- do ERPOS enxerga estas tabelas. RLS ligada sem policies = só a service role
-- (usada pelas Edge Functions assistente-*) lê e escreve. Ver assistente/README.md.
-- Aplicado via MCP em 2026-09-11 (migrações assistente_pessoal_tables e
-- assistente_cron_tick); este arquivo é a cópia versionada.

create table if not exists asst_messages (
  id bigserial primary key,
  channel text not null default 'test',          -- 'test' | 'whatsapp' | 'cron'
  chat_id text not null default 'owner',         -- JID do WhatsApp ou 'owner'
  role text not null check (role in ('user','assistant')),
  content text not null,
  tool_calls jsonb,
  usage jsonb,
  created_at timestamptz not null default now()
);
create index if not exists asst_messages_chat_idx on asst_messages (chat_id, created_at desc);

create table if not exists asst_memories (
  id bigserial primary key,
  content text not null,
  source text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists asst_reminders (
  id bigserial primary key,
  text text not null,
  due_at timestamptz not null,
  chat_id text not null default 'owner',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists asst_reminders_due_idx on asst_reminders (due_at) where sent_at is null;

create table if not exists asst_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table asst_messages enable row level security;
alter table asst_memories enable row level security;
alter table asst_reminders enable row level security;
alter table asst_settings enable row level security;

grant all on asst_messages, asst_memories, asst_reminders, asst_settings to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into asst_settings (key, value) values
  ('owner_user_id', '"ecefdcca-02a7-4030-8f45-6298550b8d86"'),
  ('default_tenant_id', '"7049e90e-c453-4268-b2dd-d074a7386612"'),
  ('allowed_chat_ids', '[]'),
  ('owner_chat_id', 'null'),
  ('morning_brief', '{"enabled": true, "time": "07:30"}'),
  ('last_brief_date', 'null')
on conflict (key) do nothing;

-- Tick de 1 minuto (lembretes + resumo da manhã) → edge assistente-cron.
-- A chave fica no Vault (secret 'assistente_internal_key' = ASSISTENTE_INTERNAL_KEY
-- das edges), criada à parte: vault.create_secret('<chave>', 'assistente_internal_key').
create extension if not exists pg_net with schema extensions;

create or replace function public.fn_assistente_tick()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'assistente_internal_key';
  if v_key is null then return null; end if;
  return net.http_post(
    url := 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/assistente-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public.fn_assistente_tick() from public, anon, authenticated;

select cron.unschedule('assistente-tick') where exists (select 1 from cron.job where jobname = 'assistente-tick');
select cron.schedule('assistente-tick', '* * * * *', 'select public.fn_assistente_tick();');
