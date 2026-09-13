-- iFood: demais APIs do módulo Financial (exigidas na homologação) — 2026-09-13.
-- Sales, Financial Events, Settlements, Anticipations e Reconciliation On-Demand.
-- Tudo gravado pela edge ifood-financial (service_role); a aba iFood lê por membership.

alter table public.fin_ifood_config add column if not exists homologation_mode boolean not null default false;

-- Vendas (pedidos) — GET /sales
create table if not exists public.fin_ifood_sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  merchant_id text not null,
  sale_id text not null,
  short_id text,
  sale_created_at timestamptz,
  type text,
  category text,
  sales_channel text,
  current_status text,
  gross_bag numeric,
  delivery_fee numeric,
  service_fee numeric,
  benefits_total numeric,
  sale_balance numeric,
  payment_methods jsonb,
  billing_entries jsonb,
  raw jsonb,
  synced_at timestamptz not null default now(),
  unique (tenant_id, sale_id)
);
create index if not exists idx_ifood_sales_tenant_date on public.fin_ifood_sales (tenant_id, sale_created_at);

-- Eventos financeiros — GET /financial-events
create table if not exists public.fin_ifood_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  merchant_id text not null,
  event_key text not null,
  name text,
  description text,
  product text,
  trigger text,
  event_at timestamptz,
  competence text,
  period_begin date,
  period_end date,
  reference_type text,
  reference_id text,
  reference_date date,
  has_transfer_impact boolean,
  amount numeric,
  base_value numeric,
  fee_percentage numeric,
  expected_settlement date,
  payment_method text,
  payment_brand text,
  payment_liability text,
  raw jsonb,
  synced_at timestamptz not null default now(),
  unique (tenant_id, event_key)
);
create index if not exists idx_ifood_events_tenant_date on public.fin_ifood_events (tenant_id, event_at);

-- Liquidações (repasses, boletos, registro de recebíveis) — GET /settlements
create table if not exists public.fin_ifood_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  merchant_id text not null,
  item_key text not null,
  item_id text,
  type text,
  product text,
  amount numeric,
  status text,
  transaction_id text,
  payment_date date,
  calc_begin date,
  calc_end date,
  account_details jsonb,
  raw jsonb,
  synced_at timestamptz not null default now(),
  unique (tenant_id, item_key)
);
create index if not exists idx_ifood_settlements_tenant_date on public.fin_ifood_settlements (tenant_id, payment_date);

-- Antecipações — GET /anticipations
create table if not exists public.fin_ifood_anticipations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  merchant_id text not null,
  item_key text not null,
  type text,
  original_amount numeric,
  fee_percentage numeric,
  fee_amount numeric,
  anticipated_amount numeric,
  status text,
  original_date date,
  anticipated_date date,
  calc_begin date,
  calc_end date,
  account_details jsonb,
  raw jsonb,
  synced_at timestamptz not null default now(),
  unique (tenant_id, item_key)
);

-- Relatório de conciliação sob demanda — POST/GET /reconciliation/on-demand
create table if not exists public.fin_ifood_ondemand (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  merchant_id text not null,
  competence text not null,
  request_id text not null,
  status text not null default 'REQUESTED',
  file_path text,
  error_message text,
  imported_at timestamptz,
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, request_id)
);

do $$
declare t text;
begin
  foreach t in array array['fin_ifood_sales', 'fin_ifood_events', 'fin_ifood_settlements', 'fin_ifood_anticipations', 'fin_ifood_ondemand'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_membership', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.auth_is_member_of(tenant_id))', t || '_select_membership', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
