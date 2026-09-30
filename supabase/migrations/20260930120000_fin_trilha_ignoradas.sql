-- Trilha: tarefa ignorada ("ignorar e esquecer") — some da lista, mas fica guardada para rever
-- e voltar (2026-09-30). Chave = TarefaTrilha.key (`<grupo>:<caso>`), estável entre meses.
create table if not exists public.fin_trilha_ignoradas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tarefa_key text not null,
  grupo text,
  titulo text,
  valor numeric(14,2),
  mes text,               -- mês da Trilha em que foi ignorada (AAAA-MM)
  motivo text,
  ignored_by uuid default auth.uid(),
  ignored_by_name text,
  ignored_at timestamptz not null default now(),
  unique (tenant_id, tarefa_key)
);
alter table public.fin_trilha_ignoradas enable row level security;
drop policy if exists fin_trilha_ignoradas_select on public.fin_trilha_ignoradas;
drop policy if exists fin_trilha_ignoradas_insert on public.fin_trilha_ignoradas;
drop policy if exists fin_trilha_ignoradas_delete on public.fin_trilha_ignoradas;
create policy fin_trilha_ignoradas_select on public.fin_trilha_ignoradas for select to authenticated using (public.auth_is_member_of(tenant_id));
create policy fin_trilha_ignoradas_insert on public.fin_trilha_ignoradas for insert to authenticated with check (public.auth_is_member_of(tenant_id));
create policy fin_trilha_ignoradas_delete on public.fin_trilha_ignoradas for delete to authenticated using (public.auth_is_member_of(tenant_id));
grant select, insert, delete on public.fin_trilha_ignoradas to authenticated;
grant all on public.fin_trilha_ignoradas to service_role;
