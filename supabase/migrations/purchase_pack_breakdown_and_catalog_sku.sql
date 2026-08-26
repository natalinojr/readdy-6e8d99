-- =============================================================
-- Embalagem desdobrada + catálogo como "apresentação" de compra
-- (aplicada em produção em 2026-08-26 via função temporária — o MCP
-- do Supabase estava fora; arquivo mantido como registro no repo)
--
-- Problema: dois fornecedores vendem o mesmo insumo em embalagens
-- diferentes (cx 12×1,5kg vs cx 6×1kg). O campo único "kg por cx"
-- obrigava conta de cabeça, e o catálogo não apontava para insumo.
-- =============================================================

-- FK tenant-safe para ingredients (mesmo padrão de fin_suppliers)
alter table public.ingredients
  drop constraint if exists ingredients_id_tenant_uk;
alter table public.ingredients
  add constraint ingredients_id_tenant_uk unique (id, tenant_id);

-- Desdobramento da embalagem na linha da compra.
-- units_per_package continua sendo a VERDADE para estoque/custo
-- (= pack_count × pack_size quando ambos presentes).
alter table public.fin_purchase_items
  add column if not exists pack_count numeric,
  add column if not exists pack_size  numeric;

comment on column public.fin_purchase_items.pack_count is
  'Unidades dentro da embalagem de compra (ex.: 12 potes por caixa).';
comment on column public.fin_purchase_items.pack_size is
  'Conteúdo de CADA unidade, na unidade de ESTOQUE do insumo (ex.: 1.5 kg por pote). units_per_package = pack_count × pack_size.';

-- Catálogo vira apresentação/SKU por fornecedor: aponta para o insumo
-- e carrega a embalagem completa. Escolher a apresentação na compra
-- preenche fornecedor, conversão e vínculo de estoque de uma vez.
alter table public.fin_purchase_catalog
  add column if not exists ingredient_id uuid,
  add column if not exists purchase_unit text,
  add column if not exists pack_count numeric,
  add column if not exists pack_size  numeric;

alter table public.fin_purchase_catalog
  drop constraint if exists fin_purchase_catalog_ingredient_fk;
alter table public.fin_purchase_catalog
  add constraint fin_purchase_catalog_ingredient_fk
  foreign key (ingredient_id, tenant_id)
  references public.ingredients (id, tenant_id)
  on delete set null;

create index if not exists fin_purchase_catalog_ingredient_idx
  on public.fin_purchase_catalog (ingredient_id);

comment on column public.fin_purchase_catalog.ingredient_id is
  'Insumo que esta apresentação abastece. Várias apresentações (fornecedores/embalagens) podem apontar para o MESMO insumo.';
comment on column public.fin_purchase_catalog.purchase_unit is
  'Unidade de compra da apresentação (cx, fardo, pacote...).';
