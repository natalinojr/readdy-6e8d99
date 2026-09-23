-- Tarefas › Modelos de estrutura de pastas (2026-09-23).
-- Um modelo guarda a cópia completa de uma pasta (subpastas, status, campos,
-- tarefas…) em `content`; `options` diz o que entra ao aplicar (e é editável
-- sem regravar). Formato e lógica: supabase/functions/_shared/modelo-estrutura.ts.
-- Modelo é da PESSOA (created_by), como as pastas — tenant_id é só a loja ativa
-- quando foi criado. Escrita só pelo task-write (service_role).
-- Versões: regravar a partir de uma pasta (ou restaurar) guarda o conteúdo
-- anterior em task_structure_template_versions (últimas 10 por modelo).

create table if not exists public.task_structure_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  created_by uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  content jsonb not null,
  options jsonb not null default '{}'::jsonb,
  source_list_id uuid references public.task_lists(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_structure_templates_owner_idx on public.task_structure_templates (created_by);

create table if not exists public.task_structure_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.task_structure_templates(id) on delete cascade,
  version integer not null,
  name text not null,
  content jsonb not null,
  options jsonb not null default '{}'::jsonb,
  source_list_id uuid,
  saved_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists task_structure_template_versions_tpl_idx
  on public.task_structure_template_versions (template_id, version desc);

alter table public.task_structure_templates enable row level security;
alter table public.task_structure_template_versions enable row level security;
grant select, insert, update, delete on public.task_structure_templates to service_role;
grant select, insert, update, delete on public.task_structure_template_versions to service_role;

-- Leitura: só os modelos de quem pergunta, com as versões guardadas (sem o conteúdo delas).
create or replace function public.fn_get_task_structure_templates()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'description', t.description,
    'content', t.content,
    'options', t.options,
    'source_list_id', t.source_list_id,
    'source_list_name', (select l.name from task_lists l
                          where l.id = t.source_list_id and not l.is_archived and l.created_by = auth.uid()),
    'version', t.version,
    'created_at', t.created_at,
    'updated_at', t.updated_at,
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'version', v.version, 'name', v.name, 'created_at', v.created_at
      ) order by v.version desc), '[]'::jsonb)
      from task_structure_template_versions v where v.template_id = t.id
    )
  ) order by lower(t.name)), '[]'::jsonb)
  from task_structure_templates t
  where t.created_by = auth.uid();
$function$;

revoke all on function public.fn_get_task_structure_templates() from public, anon;
grant execute on function public.fn_get_task_structure_templates() to authenticated;
