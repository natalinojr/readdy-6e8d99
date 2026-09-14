-- Canais públicos do WhatsApp (2026-09-14): links wa.me com texto pronto, cada um com um código
-- (ex.: CV-7K2P). Quem manda mensagem com o código cai no atendimento público (edge canal-publico),
-- separado do assistente pessoal: sem sessão do dono, só as ações do canal. 1º propósito: currículos.

create table if not exists public.bot_channels (
  id uuid primary key default gen_random_uuid(),
  purpose text not null default 'curriculos' check (purpose in ('curriculos')),
  name text not null,
  code text not null unique,                    -- vai no texto do link; o roteador procura por ele
  start_text text not null,                     -- texto que já vem digitado no WhatsApp da pessoa
  welcome text,                                 -- 1ª resposta (texto fixo, sem IA)
  company_id uuid references public.hiring_companies(id) on delete set null,
  job_id uuid references public.hiring_jobs(id) on delete set null,
  share_fields text[] not null default '{}',    -- campos da vaga que o atendente pode contar
  extra_info text,                              -- o que mais ele pode contar (texto livre)
  forbidden text,                               -- assuntos proibidos
  notify_owner boolean not null default true,   -- avisa o dono no Telegram a cada currículo
  is_active boolean not null default true,
  is_default boolean not null default false,    -- atende quem escreve SEM código
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists bot_channels_one_default on public.bot_channels (is_default) where is_default;

create table if not exists public.bot_conversations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.bot_channels(id) on delete set null,
  contact_jid text not null,
  contact_phone text,
  contact_name text,
  status text not null default 'aberta' check (status in ('aberta', 'encerrada')),
  is_test boolean not null default false,       -- dono testando pelo próprio número
  candidate_ids uuid[] not null default '{}',
  model_calls integer not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  needs_human boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists bot_conversations_contact on public.bot_conversations (contact_jid, last_message_at desc);
create index if not exists bot_conversations_channel on public.bot_conversations (channel_id, last_message_at desc);

create table if not exists public.bot_messages (
  id bigserial primary key,
  conversation_id uuid not null references public.bot_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  pending boolean not null default false,       -- debounce: mensagem do contato ainda não respondida
  created_at timestamptz not null default now()
);
create index if not exists bot_messages_conv on public.bot_messages (conversation_id, id);

-- Origem do candidato (link de WhatsApp, tela, assistente).
alter table public.hiring_candidates add column if not exists source text;
alter table public.hiring_candidates add column if not exists source_channel_id uuid references public.bot_channels(id) on delete set null;

alter table public.bot_channels enable row level security;
alter table public.bot_conversations enable row level security;
alter table public.bot_messages enable row level security;

drop policy if exists bot_channels_admin on public.bot_channels;
create policy bot_channels_admin on public.bot_channels for all to authenticated
  using (public.is_hiring_admin()) with check (public.is_hiring_admin());
drop policy if exists bot_conversations_admin on public.bot_conversations;
create policy bot_conversations_admin on public.bot_conversations for all to authenticated
  using (public.is_hiring_admin()) with check (public.is_hiring_admin());
drop policy if exists bot_messages_admin on public.bot_messages;
create policy bot_messages_admin on public.bot_messages for select to authenticated
  using (public.is_hiring_admin());

grant select, insert, update, delete on public.bot_channels to authenticated;
grant select, update, delete on public.bot_conversations to authenticated;
grant select on public.bot_messages to authenticated;
grant all on public.bot_channels, public.bot_conversations, public.bot_messages to service_role;
grant usage, select on sequence public.bot_messages_id_seq to service_role;
