-- Tarefas: relatório compartilhável por link (2026-09-25).
--
-- O dono monta um relatório com itens (texto + imagens) e manda o link para
-- pessoas de fora (sem login). Quem abre o link se identifica (nome, contato
-- opcional) e responde item a item; cada resposta fica gravada com hora e autor
-- e nada é apagado — mudar o status de um item ou editar um item também entra
-- na sequência como evento. Escrita só pela Edge Function task-reports
-- (service_role); a leitura também sai por ela (imagens com URL assinada).

create table if not exists public.task_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  created_by uuid not null,
  title text not null check (length(title) between 1 and 200),
  description text,
  share_token text not null unique,
  link_enabled boolean not null default true,
  guests_can_add_items boolean not null default false,
  status text not null default 'open' check (status in ('open', 'closed')),
  owner_seen_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_reports_owner_idx on public.task_reports(created_by) where archived_at is null;

-- Quem entrou pelo link. O token fica só no aparelho da pessoa; aqui vai o hash.
create table if not exists public.task_report_guests (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.task_reports(id) on delete cascade,
  name text not null check (length(name) between 2 and 120),
  contact text check (contact is null or length(contact) <= 160),
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists task_report_guests_report_idx on public.task_report_guests(report_id);

create table if not exists public.task_report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.task_reports(id) on delete cascade,
  position double precision not null default 0,
  title text not null check (length(title) between 1 and 300),
  body text,
  -- [{path, name}] no bucket task-reports
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  status text not null default 'open' check (status in ('open', 'answered', 'resolved')),
  created_by_user uuid,
  created_by_guest uuid references public.task_report_guests(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_report_items_report_idx on public.task_report_items(report_id, position);

-- Sequência de cada item: respostas + eventos (status, edição). Só insere.
create table if not exists public.task_report_responses (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.task_reports(id) on delete cascade,
  item_id uuid not null references public.task_report_items(id) on delete cascade,
  kind text not null default 'reply' check (kind in ('reply', 'status', 'edit')),
  body text,
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  new_status text check (new_status is null or new_status in ('open', 'answered', 'resolved')),
  author_user_id uuid,
  author_guest_id uuid references public.task_report_guests(id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now(),
  check (author_user_id is not null or author_guest_id is not null)
);
create index if not exists task_report_responses_item_idx on public.task_report_responses(item_id, created_at);
create index if not exists task_report_responses_report_idx on public.task_report_responses(report_id, created_at);

alter table public.task_reports enable row level security;
alter table public.task_report_guests enable row level security;
alter table public.task_report_items enable row level security;
alter table public.task_report_responses enable row level security;

grant select, insert, update, delete on public.task_reports, public.task_report_guests,
  public.task_report_items, public.task_report_responses to service_role;
grant select on public.task_reports, public.task_report_guests,
  public.task_report_items, public.task_report_responses to authenticated;

-- Leitura direta só do dono (a tela usa a Edge Function; isto é a rede de segurança).
drop policy if exists task_reports_owner_select on public.task_reports;
create policy task_reports_owner_select on public.task_reports
  for select to authenticated using (created_by = (select auth.uid()));

drop policy if exists task_report_guests_owner_select on public.task_report_guests;
create policy task_report_guests_owner_select on public.task_report_guests
  for select to authenticated using (exists (
    select 1 from public.task_reports r where r.id = report_id and r.created_by = (select auth.uid())));

drop policy if exists task_report_items_owner_select on public.task_report_items;
create policy task_report_items_owner_select on public.task_report_items
  for select to authenticated using (exists (
    select 1 from public.task_reports r where r.id = report_id and r.created_by = (select auth.uid())));

drop policy if exists task_report_responses_owner_select on public.task_report_responses;
create policy task_report_responses_owner_select on public.task_report_responses
  for select to authenticated using (exists (
    select 1 from public.task_reports r where r.id = report_id and r.created_by = (select auth.uid())));

-- Imagens: bucket privado, 10 MB, só imagem. Upload e leitura pela Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-reports', 'task-reports', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
on conflict (id) do nothing;
