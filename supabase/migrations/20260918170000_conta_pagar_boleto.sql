-- Boleto guardado na conta a pagar (2026-09-18, pedido do dono).
--
-- Antes a linha digitável só existia no pagamento preparado (fin_inter_payments), então não dava
-- para saber se uma conta "tem boleto" nem pagar no dia do vencimento sem pedir o boleto de novo.
-- O dono encaminha o boleto ao WhatsApp do assistente; o assistente (brain › guardar_boleto) lê,
-- acha ou cria a conta e guarda aqui. A rotina do dia (assistente-cron) prepara o pagamento das
-- contas que vencem hoje a partir destes campos.
alter table public.fin_accounts_payable
  add column if not exists boleto_digitavel text,
  add column if not exists boleto_barcode text,
  add column if not exists boleto_recebido_em timestamptz,
  add column if not exists boleto_origem text;

comment on column public.fin_accounts_payable.boleto_digitavel is
  'Linha digitável do boleto desta conta (só números). Preenchida pelo assistente quando o dono encaminha o boleto.';
comment on column public.fin_accounts_payable.boleto_origem is
  'De onde veio o boleto: whatsapp | telegram | app | tela.';
