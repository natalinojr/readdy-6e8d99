-- Gestor de tráfego (IA): rodada real passa a Claude Opus 5.5 (padrão da função, 2026-09-28).
-- Opus 5 e Sonnet 5 continuam aceitos (configs/rodadas antigas).
alter table public.meta_agent_settings drop constraint if exists meta_agent_settings_model_check;
alter table public.meta_agent_settings add constraint meta_agent_settings_model_check
  check (model is null or model in ('claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-4-5'));
alter table public.meta_agent_settings drop constraint if exists meta_agent_settings_shadow_model_check;
alter table public.meta_agent_settings add constraint meta_agent_settings_shadow_model_check
  check (shadow_model is null or shadow_model in ('claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-4-5'));
update public.meta_agent_settings set model = 'claude-opus-5-5' where model = 'claude-opus-5';
