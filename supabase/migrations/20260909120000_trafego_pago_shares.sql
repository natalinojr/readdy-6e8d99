-- ============================================================================
-- Links públicos (somente leitura) do relatório de Tráfego Pago.
--
-- Decisões (2026-09-09):
--   * O TOKEN define a LOJA e o PERÍODO, no banco. Nada disso vem do navegador:
--     se viesse (ex.: ?tenant_id=...), bastaria trocar o id na URL para ver os
--     números de outra loja. A Edge Function IGNORA tenant_id/date_preset/
--     time_range do body quando recebe um share_token.
--   * Somente leitura: o link não expõe nenhuma ação de escrita, e o
--     access_token da Meta continua sem sair da Edge Function.
--   * O cruzamento com pedidos do ERPOS (faturamento real da loja) é opt-in por
--     link (include_erpos_orders), desligado por padrão — é dado interno que
--     não deveria vazar num link que circula por fora sem escolha explícita.
--   * Escrita só pelo service_role (Edge Function meta-connect), como o resto
--     do sistema. O app só LÊ a lista de links da própria loja.
-- ============================================================================

create table if not exists public.trafego_pago_shares (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  token                text not null unique,
  label                text,
  -- Período congelado no momento em que o link foi gerado: preset OU intervalo.
  date_preset          text,
  range_since          date,
  range_until          date,
  include_erpos_orders boolean not null default false,
  created_by_user_id   uuid,
  created_by_name      text,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz,
  revoked_at           timestamptz,
  view_count           integer not null default 0,
  last_viewed_at       timestamptz
);

comment on table public.trafego_pago_shares is
  'Links públicos somente-leitura do relatório de Tráfego Pago. O token define loja e período; nada vem do navegador.';

create index if not exists trafego_pago_shares_tenant_idx
  on public.trafego_pago_shares (tenant_id, created_at desc);

-- ─── Grants e RLS ───────────────────────────────────────────────────────────
-- Lembrete (pegadinha já registrada no mapa): o bypass de RLS do service_role
-- NÃO substitui o GRANT de tabela.
grant select on public.trafego_pago_shares to authenticated;
grant select, insert, update, delete on public.trafego_pago_shares to service_role;

alter table public.trafego_pago_shares enable row level security;

drop policy if exists trafego_pago_shares_select_auth on public.trafego_pago_shares;
create policy trafego_pago_shares_select_auth on public.trafego_pago_shares
  for select to authenticated
  using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()));

drop policy if exists deny_direct_write_trafego_pago_shares on public.trafego_pago_shares;
create policy deny_direct_write_trafego_pago_shares on public.trafego_pago_shares
  for all to authenticated using (false) with check (false);

drop policy if exists service_role_bypass_trafego_pago_shares on public.trafego_pago_shares;
create policy service_role_bypass_trafego_pago_shares on public.trafego_pago_shares
  for all to service_role using (true) with check (true);
