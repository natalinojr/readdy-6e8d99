-- Nome das lojas iFood do tenant (o relatório de conciliação só traz loja_id/loja_id_curto).
-- Preenchido pela API (lista de merchants na autorização) ou digitado na aba iFood.
create table if not exists public.fin_ifood_merchants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  merchant_id text not null,
  merchant_short text,
  name text,
  updated_at timestamptz not null default now(),
  unique (tenant_id, merchant_id)
);
alter table public.fin_ifood_merchants enable row level security;
drop policy if exists fin_ifood_merchants_select_membership on public.fin_ifood_merchants;
create policy fin_ifood_merchants_select_membership on public.fin_ifood_merchants for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.fin_ifood_merchants to authenticated;
grant all on public.fin_ifood_merchants to service_role;

insert into public.fin_ifood_merchants (tenant_id, merchant_id, merchant_short, name)
select distinct i.tenant_id, i.merchant_id, i.merchant_short, null::text from public.fin_ifood_imports i where i.merchant_id <> ''
on conflict (tenant_id, merchant_id) do nothing;

-- Paranaguá: nome visto no Portal do Parceiro (merchant 3189551).
update public.fin_ifood_merchants set name = 'El Patrón - Burritos e Nachos', updated_at = now()
 where merchant_id = '33d5eb7c-77d9-419d-a664-f1ebb046910f' and name is null;
