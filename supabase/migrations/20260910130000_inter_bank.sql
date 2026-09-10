-- ── Banco Inter (API Banking) ───────────────────────────────────────────────
-- Conciliação bancária automática: a Edge Function `inter-bank` puxa o extrato e o
-- saldo da conta PJ do Inter (OAuth2 + mTLS) e grava as linhas em
-- fin_bank_statement_imports (mesma tabela do OFX/Stone), tentando conciliar com
-- fin_bank_transactions / fin_cash_flow. O saldo real vai para
-- fin_bank_accounts.synced_balance (usado pela projeção de caixa como saldo inicial).
--
-- Segredos (client_secret, certificado e chave privada) ficam nesta tabela, que só o
-- service_role lê (RLS ligado sem policies). O front nunca recebe esses campos.

create table if not exists public.fin_inter_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bank_account_id uuid references public.fin_bank_accounts(id) on delete set null,
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  client_id text not null,
  client_secret text not null,
  cert_pem text not null,
  key_pem text not null,
  conta_corrente text,                 -- header x-conta-corrente (opcional; conta única não precisa)
  is_active boolean not null default true,
  auto_sync boolean not null default true,
  sync_from date not null default (current_date - 30),
  last_sync_at timestamptz,
  last_sync_error text,
  last_balance numeric,
  last_balance_at timestamptz,
  last_balance_raw jsonb,
  access_token text,                   -- cache do token OAuth (1 h)
  token_expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);
alter table public.fin_inter_config enable row level security;
revoke all on public.fin_inter_config from anon, authenticated;
grant all on public.fin_inter_config to service_role;

-- Saldo real vindo do banco (separado do current_balance, que é o razão interno do ERP)
alter table public.fin_bank_accounts add column if not exists synced_balance numeric;
alter table public.fin_bank_accounts add column if not exists synced_balance_at timestamptz;
alter table public.fin_bank_accounts add column if not exists synced_provider text;

-- Origem da linha do extrato (file = OFX/CSV, stone, inter)
alter table public.fin_bank_statement_imports add column if not exists source text not null default 'file';
alter table public.fin_bank_statement_imports add column if not exists raw jsonb;
create index if not exists idx_stmt_imports_tenant_date on public.fin_bank_statement_imports (tenant_id, transaction_date);

-- ── Cron: sincroniza todas as lojas com Inter ativo (usa os mesmos segredos do
-- cron fiscal no Vault: fiscal_internal_key + supabase_anon_key) ──
create or replace function public.fn_inter_bank_sync_all()
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_key text; v_anon text; v_status int; v_body text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault (rode fiscal-inbound › setup_cron)'; end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/inter-bank',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"sync_all"}'
  )::http_request);
  return v_status::text || ' ' || left(coalesce(v_body, ''), 300);
end;
$$;
revoke all on function public.fn_inter_bank_sync_all() from public, anon, authenticated;

-- De hora em hora, das 06h às 23h (Brasília = UTC-3 → 9..23 e 0..2 UTC)
select cron.unschedule(jobid) from cron.job where jobname = 'inter-bank-sync';
select cron.schedule('inter-bank-sync', '10 0-2,9-23 * * *', $$select public.fn_inter_bank_sync_all();$$);
