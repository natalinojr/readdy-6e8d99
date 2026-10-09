-- Tarefas: mural da pasta (Visão geral da pasta-mãe), 2026-10-09.
--
-- Notas, links e arquivos que ficam na pasta para acesso rápido. Vê quem tem
-- acesso à pasta (fn_task_list_access); cria/edita/exclui quem é dono ou pode
-- editar. Escrita e leitura pela Edge Function task-mural (service_role); os
-- arquivos ficam no bucket privado task-mural e saem por URL assinada.

create table if not exists public.task_list_mural (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.task_lists(id) on delete cascade,
  kind text not null check (kind in ('note', 'link', 'file')),
  title text check (title is null or length(title) <= 200),
  body text check (body is null or length(body) <= 20000),
  url text check (url is null or length(url) <= 2000),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  -- Arquivo: caminho no bucket task-mural (<list_id>/<uuid>.<ext>) + nome original.
  file_path text,
  file_name text check (file_name is null or length(file_name) <= 200),
  file_mime text,
  file_size bigint,
  pinned boolean not null default false,
  -- Ordem no mural (fracionária: mover não reescreve os outros). Fixados vêm antes.
  position double precision not null default 0,
  created_by uuid not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'link' or url is not null),
  check (kind <> 'file' or file_path is not null)
);
create index if not exists task_list_mural_list_idx on public.task_list_mural(list_id, pinned desc, position);

alter table public.task_list_mural enable row level security;
grant select, insert, update, delete on public.task_list_mural to service_role;
grant select on public.task_list_mural to authenticated;

-- Leitura direta só do dono da pasta, como task_lists/tasks (a tela usa a Edge; isto é a rede
-- de segurança). fn_task_list_access não é executável por authenticated — não serve em policy.
drop policy if exists task_list_mural_select on public.task_list_mural;
create policy task_list_mural_select on public.task_list_mural
  for select to authenticated using (exists (
    select 1 from public.task_lists l where l.id = list_id and l.created_by = (select auth.uid())));

-- Arquivos: bucket privado, 20 MB, qualquer tipo (foto, PDF, planilha…). Upload e leitura pela Edge.
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-mural', 'task-mural', false, 20971520)
on conflict (id) do nothing;
