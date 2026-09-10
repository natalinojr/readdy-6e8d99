-- ── Pix do autoatendimento pelo Banco Inter (API Pix, mTLS) ─────────────────
-- Credenciais na mesma tabela do Mercado Pago, com provider = 'inter_pix'.
-- A integração de EXTRATO do Inter (Financeiro › Conciliação, edge inter-bank,
-- tabela fin_inter_config) é OUTRA integração no Internet Banking — separadas de
-- propósito: cada uma só com o próprio escopo (Pix × extrato).
-- Tabela sem policies: só o service_role (edge pix-payment) lê/escreve.
alter table fin_payment_provider_config
  add column if not exists client_id text,
  add column if not exists client_secret text,
  add column if not exists cert_pem text,
  add column if not exists key_pem text,
  add column if not exists pix_key text,
  add column if not exists environment text not null default 'production',
  add column if not exists conta_corrente text,
  add column if not exists cert_expires_at timestamptz;
