-- Token OAuth do Inter guardado no banco (provider = 'inter_pix'): reaproveitado entre
-- instâncias da edge pix-payment, em vez de pedir token novo (com handshake mTLS) a cada
-- cold start. Na linha inter_pix, `access_token` guarda esse token; na mercadopago continua
-- sendo o token de produção do MP.
alter table fin_payment_provider_config
  add column if not exists token_expires_at timestamptz;
