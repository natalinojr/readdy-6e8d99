-- Leitura de cupom/notinha por foto (Financeiro › Compras › Nova Compra) — aplicada via MCP em 2026-09-11.
-- Memoriza o vínculo que o usuário confirmou para cada linha da notinha:
-- fornecedor (CNPJ ou nome normalizado) + descrição normalizada → insumo / apresentação / categorias.
-- Na próxima leitura a Edge purchase-receipt-scan aplica o vínculo memorizado antes da sugestão da IA.
-- Escrita só pela Edge (service role); leitura para membros da loja.
create table if not exists public.purchase_receipt_item_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_key text not null default '',
  description_key text not null,
  raw_description text,
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  catalog_id uuid references public.fin_purchase_catalog(id) on delete cascade,
  merchandise_category_id uuid references public.fin_merchandise_categories(id) on delete set null,
  dre_category_id uuid references public.fin_dre_categories(id) on delete set null,
  unit_label text,
  pack_count numeric check (pack_count is null or pack_count > 0),
  pack_size numeric check (pack_size is null or pack_size > 0),
  times_used integer not null default 1,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, supplier_key, description_key)
);
create index if not exists purchase_receipt_item_links_desc_idx on public.purchase_receipt_item_links (tenant_id, description_key);
alter table public.purchase_receipt_item_links enable row level security;
create policy deny_direct_write_purchase_receipt_item_links on public.purchase_receipt_item_links for all to authenticated using (false) with check (false);
create policy purchase_receipt_item_links_select_auth on public.purchase_receipt_item_links for select to authenticated
  using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()));
create policy service_role_bypass_purchase_receipt_item_links on public.purchase_receipt_item_links for all to service_role using (true) with check (true);
grant select on public.purchase_receipt_item_links to authenticated;
grant select, insert, update, delete on public.purchase_receipt_item_links to service_role;
comment on table public.purchase_receipt_item_links is 'Vínculo linha de cupom/notinha lida por foto (fornecedor + descrição normalizada) → insumo/apresentação/categoria, memorizado quando o usuário confirma a compra';
