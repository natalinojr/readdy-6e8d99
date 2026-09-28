-- Gestor de tráfego (IA): aceita Claude Sonnet 5.5 (2026-09-28). claude-sonnet-5 continua
-- aceito (configs/rodadas antigas); a sombra das lojas passa do Sonnet 5 para o 5.5.
alter table public.meta_agent_settings drop constraint if exists meta_agent_settings_model_check;
alter table public.meta_agent_settings add constraint meta_agent_settings_model_check
  check (model is null or model in ('claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-4-5'));
alter table public.meta_agent_settings drop constraint if exists meta_agent_settings_shadow_model_check;
alter table public.meta_agent_settings add constraint meta_agent_settings_shadow_model_check
  check (shadow_model is null or shadow_model in ('claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-4-5'));
update public.meta_agent_settings set shadow_model = 'claude-sonnet-5-5' where shadow_model = 'claude-sonnet-5';
update public.meta_agent_settings set model = 'claude-sonnet-5-5' where model = 'claude-sonnet-5';
