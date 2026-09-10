-- ── Stone Conciliação v2 ─────────────────────────────────────────────────────
-- A edge `stone-conciliation` foi reescrita (loja via user_tenants, parser do layout 2.2,
-- parcelas liquidadas + eventos + chargebacks como linhas de extrato).

alter table public.fin_stone_config add column if not exists auto_sync boolean not null default true;
alter table public.fin_stone_config add column if not exists last_sync_error text;
alter table public.fin_stone_config add column if not exists endpoint text;   -- URL da Stone que funcionou por último
create unique index if not exists fin_stone_config_tenant_key on public.fin_stone_config (tenant_id);

-- A chave da Stone fica aqui: só a Edge (service_role) lê.
alter table public.fin_stone_config enable row level security;
revoke all on public.fin_stone_config from anon, authenticated;
grant all on public.fin_stone_config to service_role;

alter table public.fin_stone_imports add column if not exists error_message text;
alter table public.fin_stone_imports add column if not exists sales_count integer;
alter table public.fin_stone_imports add column if not exists sales_gross numeric;
alter table public.fin_stone_imports add column if not exists payments_total numeric;
create unique index if not exists fin_stone_imports_tenant_date_key on public.fin_stone_imports (tenant_id, reference_date);
grant all on public.fin_stone_imports to service_role;

-- Sem cron: a conciliação atualiza quando o usuário abre a tela ou clica em atualizar.
