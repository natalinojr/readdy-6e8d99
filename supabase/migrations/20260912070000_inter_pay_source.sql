-- Pagamento pelo Inter pode usar outra credencial da mesma conta (2026-09-12):
-- a integração do extrato (fin_inter_config) ou a do Pix do tablet
-- (fin_payment_provider_config provider='inter_pix'). A edge inter-bank tenta as
-- duas e guarda aqui qual tem os escopos de pagamento: 'extrato' | 'inter_pix'.
alter table public.fin_inter_config add column if not exists pay_source text;
