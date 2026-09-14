-- Vários tablets na loja: mapa { user_id do tablet: terminal_id MP Point }. Os tablets entram com
-- usuário próprio (perfil 'tablet'), não por kiosk_tokens. Sem entrada = maquininha padrão (terminal_id).
ALTER TABLE public.fin_payment_provider_config ADD COLUMN IF NOT EXISTS tablet_terminals jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.fin_payment_provider_config.tablet_terminals IS 'mp_point: { user_id do tablet: terminal_id }; sem entrada = terminal_id padrão';
