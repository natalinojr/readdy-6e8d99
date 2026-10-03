-- Cartão de crédito pelo app (Mercado Pago, API de Orders) no delivery e no QR universal.
-- A cobrança mora na mesma tabela do Pix online (fin_pix_payments, method = 'credit_card',
-- provider = 'mercadopago', provider_payment_id = id da order "ORD…").

alter table public.fin_pix_payments
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists installments integer,
  add column if not exists provider_status_detail text;

comment on column public.fin_pix_payments.card_brand is 'Cartão online: bandeira (payment_method.id do MP, ex.: visa, master).';
comment on column public.fin_pix_payments.card_last4 is 'Cartão online: 4 últimos dígitos (vem do Card Payment Brick).';
comment on column public.fin_pix_payments.provider_status_detail is 'Último status_detail do provedor (ex.: accredited, cc_rejected_insufficient_amount, pending_challenge).';

-- Liga o cartão pelo app por loja. A venda entra na forma "Cartão de Crédito" da loja (tPag 03,
-- relatórios por tipo), mas com a taxa e o prazo do cartão ONLINE do Mercado Pago, que são
-- diferentes dos da maquininha. Nulo = usa os da forma de pagamento.
alter table public.fin_payment_provider_config
  add column if not exists card_enabled boolean not null default false,
  add column if not exists card_fee_percentage numeric,
  add column if not exists card_days_to_receive integer;

comment on column public.fin_payment_provider_config.card_enabled is 'Mercado Pago online: aceita cartão de crédito pelo app (delivery e QR). Exige public_key.';
comment on column public.fin_payment_provider_config.card_fee_percentage is 'Taxa (%) do cartão de crédito online no MP. Nulo = taxa da forma "Cartão de Crédito".';
comment on column public.fin_payment_provider_config.card_days_to_receive is 'Dias até o MP liberar o dinheiro do cartão online. Nulo = prazo da forma "Cartão de Crédito".';

-- QR universal (fila por senha): false = pede e paga depois (padrão, como sempre foi);
-- true = o pedido só vai pra cozinha depois de pago (pelo app ou no caixa).
alter table public.system_settings
  add column if not exists qr_universal_pay_before boolean not null default false;

comment on column public.system_settings.qr_universal_pay_before is 'QR universal: pedido só vai pra cozinha depois de pago (Pix/cartão pelo app ou no caixa).';

-- Revisão (2026-10-03): o dinheiro do cartão online cai no saldo do Mercado Pago, não na conta da
-- maquininha — a loja aponta qual conta do financeiro representa o MP (nula = não credita banco).
alter table public.fin_payment_provider_config
  add column if not exists card_bank_account_id uuid references public.fin_bank_accounts(id) on delete set null;
comment on column public.fin_payment_provider_config.card_bank_account_id is 'Cartão online D+0: conta do financeiro onde creditar (a do Mercado Pago). Nula = só fluxo de caixa, sem crédito em banco.';

-- Taxa própria do recebível (cartão online a prazo): o receive_installment usa esta antes da taxa da forma.
alter table public.fin_receivable_installments
  add column if not exists fee_percentage numeric;
comment on column public.fin_receivable_installments.fee_percentage is 'Taxa (%) deste recebível quando difere da forma de pagamento (ex.: cartão online do MP). Nula = taxa da forma.';

-- Cartão: o MP deu a palavra final (recusada/cancelada/expirada lá). Até isso, a varredura reconsulta
-- inclusive linha cancelada/expirada só do nosso lado (o MP ainda pode aprovar).
alter table public.fin_pix_payments
  add column if not exists provider_final boolean not null default false;
comment on column public.fin_pix_payments.provider_final is 'Cartão online: o MP já deu status final (failed/canceled/expired/refunded). A varredura online-card-sweep ignora.';

-- Varredura das cobranças de cartão sem resultado (aba fechada no desafio do banco, order em análise,
-- webhook "Order" fora do ar). Só chama a Edge quando existe algo em aberto.
create or replace function public.fn_online_card_sweep()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  v_key text;
  v_anon text;
  v_status int;
  v_body text;
begin
  if not exists (
    select 1 from fin_pix_payments
    where provider = 'mercadopago' and method = 'credit_card' and status in ('pending', 'expired', 'cancelled')
      and created_at > now() - interval '48 hours' and not provider_final
  ) then
    return;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then
    raise warning 'fn_online_card_sweep: segredos do vault ausentes';
    return;
  end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/online-payments',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"sweep_cards"}'
  )::http_request);
  if v_status >= 300 then
    raise warning 'fn_online_card_sweep: HTTP % — %', v_status, left(coalesce(v_body, ''), 300);
  end if;
end;
$$;
revoke all on function public.fn_online_card_sweep() from public, anon, authenticated;

select cron.schedule('online-card-sweep', '*/10 * * * *', 'select public.fn_online_card_sweep();');
