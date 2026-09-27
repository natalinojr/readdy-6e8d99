-- 2026-09-27: Delivery Fase 3 — "Montar saída" no Gestor de Entregas (sempre sugestão; o gestor confirma).
-- Cada saída confirmada guarda o que o sistema SUGERIU e o que o gestor FEZ (pedidos, ordem, motoboy), para medir
-- quanto a sugestão acerta. A saída amarra os pedidos ao motoboy (orders.motoboy_driver_id) e dá a ordem das paradas
-- + o link do Maps para o portal do motoboy.

create table if not exists public.delivery_saidas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  driver_id     uuid not null references public.delivery_drivers(id) on delete restrict,
  pedidos       uuid[] not null,                -- ordem das paradas escolhida pelo gestor
  maps_url      text,
  km_estimado   numeric(10,2),
  min_estimado  int,
  sugerido      jsonb not null,                 -- { driver_id, pedidos[], km, min } como o sistema sugeriu
  seguiu_sugestao boolean not null,             -- mesmos pedidos, mesma ordem e mesmo motoboy
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists delivery_saidas_tenant_idx on public.delivery_saidas (tenant_id, created_at desc);
create index if not exists delivery_saidas_driver_idx on public.delivery_saidas (driver_id, created_at desc);

alter table public.delivery_saidas enable row level security;
drop policy if exists delivery_saidas_select on public.delivery_saidas;
create policy delivery_saidas_select on public.delivery_saidas
  for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.delivery_saidas from anon, authenticated;
grant select on public.delivery_saidas to authenticated;
grant all on public.delivery_saidas to service_role;
