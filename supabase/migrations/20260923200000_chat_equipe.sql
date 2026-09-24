-- Conversas entre pessoas da mesma loja, dentro do chat do ERPOS (dono, 2026-09-23).
-- Por enquanto só conversa de duas pessoas ("direct"); a tabela de participantes já deixa espaço
-- para grupo depois. Gravação só pela Edge chat-equipe (service role): ela confere que as duas
-- pessoas são da loja, grava e manda o aviso no celular. O front LÊ direto (RLS por participante,
-- nunca por auth_tenant_id — admin com várias lojas quebraria) e recebe as novas pelo Realtime.

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null default 'direct' check (kind in ('direct')),
  -- 'direct': os dois user_id em ordem, separados por ':' — UMA conversa por par de pessoas, mesmo
  -- que as duas trabalhem em mais de uma loja juntas (tenant_id = loja onde a conversa começou).
  direct_key text unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists public.chat_participants (
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null,
  last_read_id bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index if not exists chat_participants_user_idx on public.chat_participants (user_id);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null,
  body text not null check (char_length(body) between 1 and 4000),
  -- Id gerado no aparelho: reenvio por falha de rede não duplica a mensagem.
  client_id uuid,
  created_at timestamptz not null default now(),
  unique (thread_id, client_id)
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, id desc);

create or replace function public.fn_chat_participa(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_participants where thread_id = p_thread and user_id = auth.uid());
$$;
revoke execute on function public.fn_chat_participa(uuid) from public, anon;
grant execute on function public.fn_chat_participa(uuid) to authenticated;

alter table public.chat_threads enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_threads_select on public.chat_threads;
create policy chat_threads_select on public.chat_threads for select to authenticated
  using (public.fn_chat_participa(id));
drop policy if exists chat_participants_select on public.chat_participants;
create policy chat_participants_select on public.chat_participants for select to authenticated
  using (public.fn_chat_participa(thread_id));
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated
  using (public.fn_chat_participa(thread_id));

revoke all on public.chat_threads, public.chat_participants, public.chat_messages from anon;
grant select on public.chat_threads, public.chat_participants, public.chat_messages to authenticated;
grant all on public.chat_threads, public.chat_participants, public.chat_messages to service_role;

-- Mensagem nova chega na hora em quem está com o chat aberto.
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;
