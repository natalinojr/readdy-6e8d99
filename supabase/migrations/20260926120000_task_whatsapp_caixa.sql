-- Tarefas: 📌 no grupo do WhatsApp → caixa da pasta da obra (dono, 2026-09-24).
-- Alguém reage 📌 numa mensagem de um grupo ligado a uma pasta de tarefas; a mensagem (texto,
-- áudio transcrito, foto/PDF/áudio salvos no Storage) cai na caixa DA PASTA. Quem pode editar a
-- pasta decide: vira tarefa nova, vira anotação de uma tarefa, ou é descartada. Nada vira tarefa
-- sozinho e não há IA nesse caminho. Escrita só pelas edges (service_role).

-- Grupo do assistente ↔ pasta de tarefas; e leitura de foto/PDF com IA por grupo (grupo de obra
-- tem muita foto: cada leitura custa IA — lá o normal é desligar).
alter table public.asst_groups
  add column if not exists task_list_id uuid references public.task_lists(id) on delete set null,
  add column if not exists read_media boolean not null default true;
comment on column public.asst_groups.task_list_id is 'Pasta de tarefas do grupo: mensagem marcada com 📌 vai para a caixa dessa pasta. Null = 📌 ignorado.';
comment on column public.asst_groups.read_media is 'Ler foto/PDF do grupo com IA (custa). False = só o rótulo; o 📌 continua salvando o arquivo.';

create table if not exists public.task_whatsapp_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.task_lists(id) on delete cascade,
  group_jid text not null,
  group_name text,
  message_id text not null unique,          -- uma mensagem = um item (o 2º 📌 não duplica)
  sender_name text,
  sender_jid text,
  kind text not null default 'text',        -- text | audio | image | document | video | other
  content text,                             -- texto / legenda / transcrição do áudio
  sent_at timestamptz,
  media_path text,                          -- bucket task-attachments, whatsapp/<list_id>/<message_id>.<ext>
  media_mime text,
  media_name text,
  media_size bigint,
  pinned_by_name text,
  pinned_by_jid text,
  pinned_at timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente', 'tarefa', 'anotacao', 'descartado')),
  task_id uuid references public.tasks(id) on delete set null,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists task_whatsapp_items_list_status on public.task_whatsapp_items (list_id, status);
alter table public.task_whatsapp_items enable row level security;
grant select, insert, update, delete on public.task_whatsapp_items to service_role;

-- Quem pode EDITAR a pasta (decide a caixa e recebe o aviso): dono dela ou de uma pasta acima +
-- compartilhamentos com "editar" que valem para ela.
create or replace function public.fn_task_list_editores(p_list_id uuid)
 returns table(user_id uuid)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with recursive sobe as (
    select l.id, l.parent_list_id, l.created_by, 0 as prof from task_lists l where l.id = p_list_id and not l.is_archived
    union all
    select l.id, l.parent_list_id, l.created_by, s.prof + 1
    from task_lists l join sobe s on l.id = s.parent_list_id where s.prof < 50 and not l.is_archived
  )
  select created_by from sobe where created_by is not null
  union
  select e.user_id from fn_task_list_shares_efetivos(p_list_id) e where e.permission = 'edit';
$function$;
revoke all on function public.fn_task_list_editores(uuid) from public, anon, authenticated;
grant execute on function public.fn_task_list_editores(uuid) to service_role;

-- Caixa de uma pasta (só quem pode editar a pasta vê).
create or replace function public.fn_get_task_whatsapp_items(p_list_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(fn_task_list_access(p_list_id, auth.uid()), '') not in ('owner', 'edit') then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'list_id', i.list_id, 'group_name', i.group_name, 'sender_name', i.sender_name,
      'kind', i.kind, 'content', i.content, 'sent_at', i.sent_at,
      'media_mime', i.media_mime, 'media_name', i.media_name, 'has_media', i.media_path is not null,
      'pinned_by_name', i.pinned_by_name, 'pinned_at', i.pinned_at
    ) order by i.sent_at nulls last, i.pinned_at), '[]'::jsonb)
    from task_whatsapp_items i
    where i.list_id = p_list_id and i.status = 'pendente'
  );
end $function$;
revoke all on function public.fn_get_task_whatsapp_items(uuid) from public, anon;
grant execute on function public.fn_get_task_whatsapp_items(uuid) to authenticated, service_role;

-- Quantos pendentes por pasta (as que a pessoa pode editar) — para o aviso na árvore.
create or replace function public.fn_get_task_whatsapp_counts()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(x.list_id, x.n), '{}'::jsonb)
  from (
    select i.list_id, count(*)::int as n
    from task_whatsapp_items i
    join fn_task_lists_acessiveis(auth.uid()) a on a.list_id = i.list_id and a.access in ('owner', 'edit')
    where i.status = 'pendente'
    group by i.list_id
  ) x;
$function$;
revoke all on function public.fn_get_task_whatsapp_counts() from public, anon;
grant execute on function public.fn_get_task_whatsapp_counts() to authenticated, service_role;
