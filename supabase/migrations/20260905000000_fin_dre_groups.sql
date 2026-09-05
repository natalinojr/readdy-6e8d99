-- Grupos do DRE por loja.
-- Antes os grupos customizados viviam em localStorage (chave dre_custom_groups_<tenant>):
-- ficavam presos a um navegador, invisíveis para o resto da loja, e a DRE aberta em
-- outra máquina mostrava a chave crua no lugar do rótulo.
-- Escrita só pela Edge Function financial-write (service_role), igual às outras fin_*.

create table if not exists public.fin_dre_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  label text not null,
  icon text not null default 'ri-folder-line',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create index if not exists idx_fin_dre_groups_tenant on public.fin_dre_groups(tenant_id);

alter table public.fin_dre_groups enable row level security;

drop policy if exists fin_dre_groups_select_auth on public.fin_dre_groups;
create policy fin_dre_groups_select_auth on public.fin_dre_groups
  for select to authenticated
  using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()));

drop policy if exists deny_direct_write_fin_dre_groups on public.fin_dre_groups;
create policy deny_direct_write_fin_dre_groups on public.fin_dre_groups
  for all to authenticated using (false) with check (false);

drop policy if exists service_role_bypass_fin_dre_groups on public.fin_dre_groups;
create policy service_role_bypass_fin_dre_groups on public.fin_dre_groups
  for all to service_role using (true) with check (true);

grant select on public.fin_dre_groups to authenticated;
grant select, insert, update, delete on public.fin_dre_groups to service_role;
