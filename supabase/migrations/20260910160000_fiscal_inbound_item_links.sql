-- Vínculo item de NF-e de entrada → insumo do estoque (aplicada via MCP em 2026-09-10).
-- Memorizado por fornecedor (CNPJ) + código do produto dele (cProd); EAN como reserva.
-- Escrita só pela Edge fiscal-inbound (service role); leitura para membros da loja.
create table if not exists public.fiscal_inbound_item_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_cnpj text not null,
  supplier_code text not null,
  ean text,
  description text,
  unit_label text,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  units_per_package numeric not null default 1 check (units_per_package > 0),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, supplier_cnpj, supplier_code)
);
create index if not exists fiscal_inbound_item_links_ean_idx on public.fiscal_inbound_item_links (tenant_id, supplier_cnpj, ean) where ean is not null;
alter table public.fiscal_inbound_item_links enable row level security;
create policy deny_direct_write_fiscal_inbound_item_links on public.fiscal_inbound_item_links for all to authenticated using (false) with check (false);
create policy fiscal_inbound_item_links_select_auth on public.fiscal_inbound_item_links for select to authenticated
  using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()));
create policy service_role_bypass_fiscal_inbound_item_links on public.fiscal_inbound_item_links for all to service_role using (true) with check (true);
grant select on public.fiscal_inbound_item_links to authenticated;
grant select, insert, update, delete on public.fiscal_inbound_item_links to service_role;
comment on table public.fiscal_inbound_item_links is 'Vínculo item de NF-e de entrada (fornecedor CNPJ + cProd) → insumo do estoque, memorizado na importação da nota como compra';
