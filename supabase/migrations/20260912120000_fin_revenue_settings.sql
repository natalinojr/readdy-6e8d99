-- Fontes dos "recebidos" (Financeiro › Receitas), por loja (2026-09-12).
-- Cada loja escolhe o que conta como receita recebida:
--   orders = pedidos lançados no sistema (entregues e pagos)
--   stone  = vendas em cartão liquidadas pela Stone (fin_cash_flow origin stone_sale)
--   manual = lançamentos manuais de receita
-- Sem linha = comportamento antigo (orders + manual).
-- El Patron Paranaguá: só Stone — o que conta é o dinheiro que entrou na conta,
-- não o que foi lançado no PDV (lá o cartão nem passa pelo ERP).
-- Escrita só pela Edge Function financial-write (service_role); leitura por vínculo real.
create table if not exists public.fin_revenue_settings (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,
  sources    text[] not null default array['orders', 'manual'],
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint fin_revenue_settings_sources_chk
    check (cardinality(sources) >= 1 and sources <@ array['orders', 'stone', 'manual'])
);

alter table public.fin_revenue_settings enable row level security;

drop policy if exists fin_revenue_settings_select_membership on public.fin_revenue_settings;
create policy fin_revenue_settings_select_membership on public.fin_revenue_settings
  for select to authenticated using (public.auth_is_member_of(tenant_id));

grant select on public.fin_revenue_settings to authenticated;
grant select, insert, update, delete on public.fin_revenue_settings to service_role;

insert into public.fin_revenue_settings (tenant_id, sources)
select id, array['stone'] from public.tenants where name = 'El Patron Paranaguá'
on conflict (tenant_id) do update set sources = excluded.sources, updated_at = now();
