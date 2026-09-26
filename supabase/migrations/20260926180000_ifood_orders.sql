-- iFood Pedidos (módulo Order do app "ERPOS PDV") — 2026-09-26.
-- Objetivo do dono: trazer AUTOMATICAMENTE os itens de cada pedido do iFood (CMV por pedido, estoque).
-- Modo padrão = SÓ LEITURA: a loja continua aceitando/despachando no Gestor de Pedidos do iFood; o ERPOS
-- só recebe os eventos e grava o pedido completo. Modo "operar" (confirmar/preparo/pronto/despachar/
-- cancelar pelo ERPOS) existe para a homologação automática do iFood — ligar só na loja de teste.
-- Eventos chegam pelo mesmo polling do iFood Entrega (events:polling, a cada 30 s).

alter table public.ifood_pdv_config add column if not exists order_enabled boolean not null default false;
alter table public.ifood_pdv_config add column if not exists order_mode text not null default 'read_only';
alter table public.ifood_pdv_config drop constraint if exists ifood_pdv_config_order_mode_chk;
alter table public.ifood_pdv_config add constraint ifood_pdv_config_order_mode_chk check (order_mode in ('read_only', 'operate'));
-- Lojas do iFood cujos pedidos esta loja do ERPOS lê (uma loja do ERPOS pode ter várias no iFood).
alter table public.ifood_pdv_config add column if not exists order_merchant_ids text[] not null default '{}';

create table if not exists public.ifood_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  merchant_id text not null,
  ifood_order_id text not null unique,
  display_id text,
  -- placed → confirmed → preparing → ready → dispatched → concluded (ou cancelled)
  status text not null default 'placed',
  order_type text,            -- DELIVERY / TAKEOUT / DINE_IN
  order_timing text,          -- IMMEDIATE / SCHEDULED
  sales_channel text,
  delivered_by text,          -- IFOOD / MERCHANT
  is_test boolean not null default false,
  ordered_at timestamptz,     -- createdAt do iFood
  customer_name text,
  customer_document text,     -- CPF/CNPJ para a nota (só quando o cliente informou)
  customer_orders_count int,
  pickup_code text,
  delivery_observations text,
  address jsonb,
  total jsonb,                -- { subTotal, deliveryFee, benefits, additionalFees, orderAmount }
  payments jsonb,             -- { prepaid, pending, methods[] } (bandeira, troco)
  benefits jsonb,             -- cupons + quem paga (IFOOD/MERCHANT/…)
  extra_info text,
  schedule jsonb,
  dispute jsonb,              -- Plataforma de negociação (HANDSHAKE_DISPUTE)
  cancel_reason text,
  cancel_requested boolean not null default false,
  last_event text,
  timeline jsonb not null default '{}',
  raw jsonb,                  -- detalhe completo (GET /orders/{id}) — referência
  details_at timestamptz,
  concluded_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ifood_orders_tenant_ordered_idx on public.ifood_orders (tenant_id, ordered_at desc);
alter table public.ifood_orders enable row level security;
drop policy if exists ifood_orders_select_membership on public.ifood_orders;
create policy ifood_orders_select_membership on public.ifood_orders for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.ifood_orders from anon;
grant select on public.ifood_orders to authenticated;
grant all on public.ifood_orders to service_role;

-- Itens do pedido (um por linha do iFood; complementos em `options`, como vieram).
create table if not exists public.ifood_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_row_id uuid not null references public.ifood_orders(id) on delete cascade,
  idx int,
  catalog_item_id text,       -- id do item no catálogo do iFood (estável — base do vínculo com o cardápio/ficha)
  unique_id text,
  external_code text,
  name text not null,
  quantity numeric not null default 1,
  unit text,
  unit_price numeric,
  options_price numeric,
  total_price numeric,
  observations text,
  options jsonb not null default '[]'
);
create index if not exists ifood_order_items_order_idx on public.ifood_order_items (order_row_id);
create index if not exists ifood_order_items_tenant_item_idx on public.ifood_order_items (tenant_id, catalog_item_id);
alter table public.ifood_order_items enable row level security;
drop policy if exists ifood_order_items_select_membership on public.ifood_order_items;
create policy ifood_order_items_select_membership on public.ifood_order_items for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.ifood_order_items from anon;
grant select on public.ifood_order_items to authenticated;
grant all on public.ifood_order_items to service_role;

-- Polling: com pedidos ligados, roda sempre (os pedidos do iFood chegam a qualquer hora do expediente).
create or replace function public.fn_ifood_shipping_poll()
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_key text; v_anon text;
begin
  -- Entrega "ativa" sem notícia há 6 h: encerra (só escreve quando há o que encerrar).
  if exists (select 1 from public.ifood_shipping_orders
              where status not in ('concluded', 'cancelled', 'failed') and updated_at < now() - interval '6 hours') then
    update public.ifood_shipping_orders
       set status = 'failed', uncertain = true, updated_at = now(),
           error = 'Sem notícia do iFood há mais de 6 h — confira no Gestor de Pedidos do iFood.'
     where status not in ('concluded', 'cancelled', 'failed') and updated_at < now() - interval '6 hours';
  end if;
  if not exists (
    select 1 from public.ifood_pdv_config c
     -- (sem filtro de client_id: com o app do sistema a credencial vem dos secrets da edge)
     where ((c.order_enabled and cardinality(c.order_merchant_ids) > 0)
            or (c.shipping_enabled and (
                  (c.homologation_mode and c.homologation_until > now())
                  or exists (select 1 from public.ifood_shipping_orders s
                              where s.tenant_id = c.tenant_id and s.status not in ('concluded', 'cancelled', 'failed')
                                and s.updated_at > now() - interval '6 hours'))))
  ) then
    return 'nada a acompanhar';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault'; end if;
  perform net.http_post(
    url := 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/ifood-shipping',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key,
                                  'apikey', v_anon, 'Authorization', 'Bearer ' || v_anon),
    body := '{"action":"poll_all"}'::jsonb,
    timeout_milliseconds := 25000
  );
  return 'chamado';
end;
$$;
revoke all on function public.fn_ifood_shipping_poll() from public, anon, authenticated;
