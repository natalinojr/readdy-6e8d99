-- iFood: várias lojas do iFood por loja do ERPOS (2026-09-25).
-- Cada código gerado/autorizado no Portal do Parceiro vira uma linha em fin_ifood_auths (token próprio,
-- lista das lojas que ele enxerga). fin_ifood_merchants.api_sync marca quais lojas do iFood esta loja
-- do ERPOS busca pela API. Uma loja do iFood só pode ser buscada por UMA loja do ERPOS (índice único),
-- senão as vendas/repasses entrariam em dobro no financeiro consolidado.

create table if not exists public.fin_ifood_auths (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  merchant_ids text[] not null default '{}',
  authorized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fin_ifood_auths_tenant_idx on public.fin_ifood_auths (tenant_id, authorized_at desc);
alter table public.fin_ifood_auths enable row level security;
revoke all on public.fin_ifood_auths from anon, authenticated;
grant all on public.fin_ifood_auths to service_role;

alter table public.fin_ifood_merchants add column if not exists api_sync boolean not null default false;
alter table public.fin_ifood_merchants add column if not exists last_sync_at timestamptz;
alter table public.fin_ifood_merchants add column if not exists last_sync_error text;
create unique index if not exists fin_ifood_merchants_api_sync_uniq on public.fin_ifood_merchants (merchant_id) where api_sync;

-- Autorização que já existe (Paranaguá) passa para a tabela nova.
insert into public.fin_ifood_auths (tenant_id, access_token, refresh_token, token_expires_at, merchant_ids, authorized_at)
select c.tenant_id, c.access_token, c.refresh_token, c.token_expires_at, array[c.merchant_id], coalesce(c.authorized_at, now())
from public.fin_ifood_config c
where c.refresh_token is not null and c.merchant_id is not null
  and not exists (select 1 from public.fin_ifood_auths a where a.tenant_id = c.tenant_id);

insert into public.fin_ifood_merchants (tenant_id, merchant_id, name, api_sync)
select c.tenant_id, c.merchant_id, c.merchant_name, true
from public.fin_ifood_config c
where c.merchant_id is not null and (c.refresh_token is not null or (c.app_type = 'centralized' and c.authorized_at is not null))
on conflict (tenant_id, merchant_id) do update set api_sync = true;

update public.fin_ifood_config set access_token = null, refresh_token = null, token_expires_at = null
where app_type = 'distributed' and refresh_token is not null;

-- As chaves (hash) de eventos/antecipações passam a incluir a loja do iFood (duas lojas com a mesma
-- mensalidade no mesmo período colidiam). Linhas vindas da API são rebuscadas na próxima sincronização.
delete from public.fin_ifood_events where synced_at >= '2026-09-25';
delete from public.fin_ifood_anticipations where synced_at >= '2026-09-25';
delete from public.fin_ifood_settlements where synced_at >= '2026-09-25' and item_id is null;
