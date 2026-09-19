-- Guias do mês (DAS/DARF/FGTS, 2026-09-18): o FGTS Digital só tem Pix copia e cola (QR dinâmico da Caixa).
-- Aplicada pelo MCP em 2026-09-18.
alter table public.fin_accounts_payable add column if not exists boleto_pix_copia text;
alter table public.fin_inter_payments add column if not exists pix_copia_e_cola text;
comment on column public.fin_accounts_payable.boleto_pix_copia is 'Pix copia e cola da guia (ex.: FGTS Digital), guardado para o assistente preparar no dia do vencimento';
comment on column public.fin_inter_payments.pix_copia_e_cola is 'Pix pago por copia e cola (destinatário PIX_COPIA_E_COLA no Inter); só de emissores permitidos (guias do governo)';
