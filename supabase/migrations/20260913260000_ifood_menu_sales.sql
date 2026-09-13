-- Produtos vendidos no iFood: relatório "Cardápio" do Portal do Parceiro (Relatórios › Cardápio),
-- abas Itens e Complementos, por loja e período. Reimportar o mesmo período/loja substitui.
-- Base do CMV do iFood (quantidade por item × ficha técnica), já que a API Financial não traz itens.
create table if not exists public.fin_ifood_menu_sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  merchant_short text,
  store_name text,
  period_start date not null,
  period_end date not null,
  kind text not null check (kind in ('item', 'complemento')),
  group_name text,
  name text not null,
  visits int,
  orders int,
  conversion numeric,
  quantity numeric,
  promo_quantity numeric,
  promo_orders int,
  total_value numeric,
  file_name text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_ifood_menu_sales_tenant_period on public.fin_ifood_menu_sales (tenant_id, period_start, period_end);
alter table public.fin_ifood_menu_sales enable row level security;
drop policy if exists fin_ifood_menu_sales_select_membership on public.fin_ifood_menu_sales;
create policy fin_ifood_menu_sales_select_membership on public.fin_ifood_menu_sales for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.fin_ifood_menu_sales to authenticated;
grant all on public.fin_ifood_menu_sales to service_role;
