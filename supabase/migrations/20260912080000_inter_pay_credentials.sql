-- Credencial PRÓPRIA de pagamento no Inter (2026-09-12): o dono criou uma integração
-- nova só com os escopos de pagamento. Fica ao lado da credencial do extrato, na mesma
-- linha de fin_inter_config (só a service_role lê: RLS sem policies). A edge inter-bank
-- usa esta primeiro para pagar (pay_source = 'pagamento') e cai nas outras se faltar.
alter table public.fin_inter_config add column if not exists pay_client_id text;
alter table public.fin_inter_config add column if not exists pay_client_secret text;
alter table public.fin_inter_config add column if not exists pay_cert_pem text;
alter table public.fin_inter_config add column if not exists pay_key_pem text;
alter table public.fin_inter_config add column if not exists pay_conta_corrente text;
alter table public.fin_inter_config add column if not exists pay_credentials_at timestamptz;
