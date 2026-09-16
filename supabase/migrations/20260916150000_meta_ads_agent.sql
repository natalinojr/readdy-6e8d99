-- ============================================================================
-- Gestor de tráfego pago (agente IA) — Tráfego Pago › Agente. 2026-09-16.
--
-- Decisões:
--   * Uma configuração por loja (meta_agent_settings): metas, limites de
--     orçamento (teto diário e mensal), modo (sugerir × autônomo), destino
--     (WhatsApp / link do delivery), página do Facebook e contexto da loja.
--   * Cada rodada do agente (cron diário ou botão "Rodar agora") vira uma
--     linha em meta_agent_runs com o resumo, o retrato dos números e o custo
--     da IA. As decisões viram meta_agent_actions: no modo "sugerir" ficam
--     'sugerida' até o dono aprovar; no modo "autônomo" as ações seguras são
--     executadas na hora (pausar/reativar/ajustar orçamento dentro dos limites,
--     criar campanha só se `autonomia_criar` estiver ligado).
--   * Escrita SOMENTE pelo service_role (Edge Function meta-ads-agent), como o
--     resto das integrações. O app só LÊ as tabelas da própria loja.
--   * O token da Meta continua em meta_ad_connections e nunca sai da edge.
-- ============================================================================

create table if not exists public.meta_agent_settings (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  enabled              boolean not null default false,
  -- 'sugerir' = toda ação espera aprovação; 'autonomo' = ações seguras executam sozinhas.
  mode                 text not null default 'sugerir' check (mode in ('sugerir', 'autonomo')),
  -- No modo autônomo, também pode CRIAR campanha/anúncio novo sem aprovação.
  autonomia_criar      boolean not null default false,
  -- Objetivo principal: 'whatsapp' (mensagens), 'trafego' (cliques no link do delivery), 'vendas' (pixel/compras).
  objetivo             text not null default 'whatsapp' check (objetivo in ('whatsapp', 'trafego', 'vendas')),
  -- Limites de dinheiro (R$). daily = soma dos orçamentos diários ativos; monthly = gasto acumulado no mês.
  daily_budget_cap     numeric(12,2) not null default 30,
  monthly_budget_cap   numeric(12,2) not null default 900,
  -- Metas: custo por resultado (R$) e ROAS mínimo (vendas ÷ gasto) para julgar anúncio.
  target_cpr           numeric(12,2),
  target_roas          numeric(8,2) default 2,
  max_frequency        numeric(6,2) not null default 3,
  -- Destino dos anúncios
  page_id              text,
  page_name            text,
  whatsapp_number      text,
  destination_url      text,
  -- Segmentação padrão para campanhas novas
  radius_km            numeric(6,2),
  age_min              int not null default 18,
  age_max              int not null default 65,
  -- Contexto livre da loja para a IA (diferenciais, tom de voz, pratos que quer empurrar, o que evitar).
  store_context        text,
  -- Horas locais (0-23) em que faz sentido anunciar (ex.: almoço/jantar). Vazio = dia todo.
  active_hours         int[] not null default '{}',
  last_run_at          timestamptz,
  autopilot_since      timestamptz,
  updated_by_user_id   uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.meta_agent_settings is 'Configuração do gestor de tráfego (IA) por loja: metas, tetos, modo e destino dos anúncios.';

create table if not exists public.meta_agent_runs (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  trigger              text not null default 'manual' check (trigger in ('manual', 'cron', 'assistente')),
  status               text not null default 'running' check (status in ('running', 'done', 'error', 'skipped')),
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  -- Resumo em português para o dono (o que viu, o que fez, o que recomenda).
  summary              text,
  -- Saúde geral 0-100 e alertas curtos
  health_score         int,
  alerts               jsonb not null default '[]'::jsonb,
  -- Retrato dos números usados na decisão (7d / 30d, conta, ERPOS)
  snapshot             jsonb,
  model                text,
  usage                jsonb,
  error                text,
  actions_total        int not null default 0,
  actions_executed     int not null default 0
);
comment on table public.meta_agent_runs is 'Rodadas do gestor de tráfego (IA): resumo, saúde, alertas, retrato dos dados e custo.';
create index if not exists meta_agent_runs_tenant_idx on public.meta_agent_runs (tenant_id, started_at desc);

create table if not exists public.meta_agent_actions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  run_id               uuid references public.meta_agent_runs(id) on delete set null,
  -- pause | resume | set_budget | create_campaign | rotate_creative | alert | note
  kind                 text not null,
  level                text check (level in ('account', 'campaign', 'adset', 'ad')),
  target_id            text,
  target_name          text,
  -- Parâmetros da ação (ex.: {daily_budget: 25} ou o rascunho completo da campanha nova)
  params               jsonb not null default '{}'::jsonb,
  reason               text,
  -- Impacto esperado, em texto curto, para o dono decidir
  expected_impact      text,
  -- sugerida (aguarda dono) | aprovada | executada | rejeitada | falhou | expirada
  status               text not null default 'sugerida' check (status in ('sugerida', 'aprovada', 'executada', 'rejeitada', 'falhou', 'expirada')),
  auto                 boolean not null default false,
  risk                 text not null default 'baixo' check (risk in ('baixo', 'medio', 'alto')),
  decided_by_user_id   uuid,
  decided_by_name      text,
  decided_at           timestamptz,
  executed_at          timestamptz,
  result               jsonb,
  error                text,
  created_at           timestamptz not null default now()
);
comment on table public.meta_agent_actions is 'Decisões do gestor de tráfego (IA): sugestões pendentes, aprovadas, executadas e falhas, com motivo e resultado.';
create index if not exists meta_agent_actions_tenant_idx on public.meta_agent_actions (tenant_id, created_at desc);
create index if not exists meta_agent_actions_pending_idx on public.meta_agent_actions (tenant_id, status) where status = 'sugerida';

-- ─── Grants e RLS (lembrete: bypass de RLS do service_role NÃO substitui o GRANT) ──
grant select on public.meta_agent_settings, public.meta_agent_runs, public.meta_agent_actions to authenticated;
grant select, insert, update, delete on public.meta_agent_settings, public.meta_agent_runs, public.meta_agent_actions to service_role;

alter table public.meta_agent_settings enable row level security;
alter table public.meta_agent_runs enable row level security;
alter table public.meta_agent_actions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['meta_agent_settings', 'meta_agent_runs', 'meta_agent_actions'] loop
    execute format('drop policy if exists %I_select_auth on public.%I', t, t);
    execute format(
      'create policy %I_select_auth on public.%I for select to authenticated using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()))',
      t, t);
    execute format('drop policy if exists deny_direct_write_%I on public.%I', t, t);
    execute format('create policy deny_direct_write_%I on public.%I for all to authenticated using (false) with check (false)', t, t);
    execute format('drop policy if exists service_role_bypass_%I on public.%I', t, t);
    execute format('create policy service_role_bypass_%I on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ─── Cron diário: 08h30 Brasília (11h30 UTC). Roda em todas as lojas com o agente ligado. ──
-- Mesmos segredos do cron fiscal no Vault (fiscal_internal_key + supabase_anon_key).
create or replace function public.fn_meta_agent_run_all()
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_key text; v_anon text; v_status int; v_body text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault (rode fiscal-inbound › setup_cron)'; end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '290000');
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/meta-ads-agent',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"run_all"}'
  )::http_request);
  return v_status::text || ' ' || left(coalesce(v_body, ''), 300);
end;
$$;
revoke all on function public.fn_meta_agent_run_all() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'meta-agent-daily';
select cron.schedule('meta-agent-daily', '30 11 * * *', $$select public.fn_meta_agent_run_all();$$);
