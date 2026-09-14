-- Autoatendimento: formas de pagamento escolhidas pela loja (null = todas as ativas)
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS self_service_payment_methods jsonb;
COMMENT ON COLUMN public.system_settings.self_service_payment_methods IS 'Autoatendimento: ids de payment_methods exibidos no tablet; null = todas as ativas';

-- Maquininha (Mercado Pago Point) de cada tablet; null = usa a da loja (fin_payment_provider_config.terminal_id)
ALTER TABLE public.kiosk_tokens ADD COLUMN IF NOT EXISTS point_terminal_id text;
COMMENT ON COLUMN public.kiosk_tokens.point_terminal_id IS 'Terminal MP Point deste tablet; null = maquininha padrão da loja';
