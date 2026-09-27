-- 2026-09-27: app "ERPOS Entregas" — o motoboy liga uma loja no app com um CÓDIGO gerado no ERPOS
-- (Config. do Delivery › Entregadores › "Código para o app"). Uso único, vale 24 h. Um motoboy pode ter várias lojas
-- no mesmo app (um código por loja). Gerar: delivery-write › gerar_codigo_motoboy (admin da loja).
-- Usar: motoboy-signal › vincular_codigo (público: código + nome + celular) — acha/cria o entregador pelo celular.

create table if not exists public.delivery_driver_codes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  driver_id   uuid references public.delivery_drivers(id) on delete set null
);
-- código ativo não repete (usado/expirado pode repetir no futuro)
create unique index if not exists delivery_driver_codes_code_uq on public.delivery_driver_codes (code) where used_at is null;
create index if not exists delivery_driver_codes_tenant_idx on public.delivery_driver_codes (tenant_id, created_at desc);

alter table public.delivery_driver_codes enable row level security;
drop policy if exists delivery_driver_codes_select on public.delivery_driver_codes;
create policy delivery_driver_codes_select on public.delivery_driver_codes
  for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.delivery_driver_codes from anon, authenticated;
grant select on public.delivery_driver_codes to authenticated;
grant all on public.delivery_driver_codes to service_role;
