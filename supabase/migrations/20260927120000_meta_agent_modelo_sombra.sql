-- ============================================================================
-- Gestor de tráfego (IA): modelo configurável por loja + rodada "sombra". 2026-09-27.
--
-- Fase 0 do PLANO-TRAFEGO-PAGO-AGENTES.md: antes de trocar Opus → Sonnet na rodada
-- diária, rodar o modelo candidato em paralelo ("sombra") sobre o MESMO payload, sem
-- executar nada, e comparar decisões, nota de saúde e custo por 1–2 semanas.
--
--   * meta_agent_settings.model        — modelo da rodada real (null = padrão da função).
--   * meta_agent_settings.shadow_model — modelo que roda em sombra (null = desligado).
--   * meta_agent_runs.trigger ganha 'sombra'; shadow_of aponta para a rodada real.
--     A rodada sombra grava resumo/saúde/uso/ações propostas no snapshot e NUNCA
--     insere em meta_agent_actions nem chama a Meta.
-- ============================================================================

alter table public.meta_agent_settings
  add column if not exists model        text,
  add column if not exists shadow_model text;

alter table public.meta_agent_settings drop constraint if exists meta_agent_settings_model_check;
alter table public.meta_agent_settings add constraint meta_agent_settings_model_check
  check (model is null or model in ('claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'));
alter table public.meta_agent_settings drop constraint if exists meta_agent_settings_shadow_model_check;
alter table public.meta_agent_settings add constraint meta_agent_settings_shadow_model_check
  check (shadow_model is null or shadow_model in ('claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'));

comment on column public.meta_agent_settings.model is 'Modelo Claude da rodada real (null = padrão da Edge Function).';
comment on column public.meta_agent_settings.shadow_model is 'Modelo que roda em "sombra" (só compara, não executa). null = desligado.';

alter table public.meta_agent_runs drop constraint if exists meta_agent_runs_trigger_check;
alter table public.meta_agent_runs add constraint meta_agent_runs_trigger_check
  check (trigger in ('manual', 'cron', 'assistente', 'sombra'));

alter table public.meta_agent_runs
  add column if not exists shadow_of uuid references public.meta_agent_runs(id) on delete cascade;
comment on column public.meta_agent_runs.shadow_of is 'Rodada real que esta rodada sombra espelhou (só quando trigger = sombra).';
create index if not exists meta_agent_runs_shadow_of_idx on public.meta_agent_runs (shadow_of) where shadow_of is not null;
