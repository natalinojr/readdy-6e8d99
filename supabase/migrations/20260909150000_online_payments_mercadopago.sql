-- ── Pagamento online (Pix dinâmico via Mercado Pago) ─────────────────────────
-- Cliente paga a conta da mesa no próprio celular (mesa-qr). A confirmação vem
-- do webhook do provedor; nada é marcado pago pela vontade do cliente.

-- 1. Credenciais do provedor, por loja. SEM policies: só o service_role (Edge
--    Function `online-payments`) lê/escreve — o token nunca chega ao front.
create table if not exists fin_payment_provider_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null default 'mercadopago',
  access_token text,
  public_key text,
  webhook_secret text,
  is_active boolean not null default false,
  account_id text,
  account_label text,
  last_test_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);
alter table fin_payment_provider_config enable row level security;
revoke all on fin_payment_provider_config from anon, authenticated;
grant select, insert, update, delete on fin_payment_provider_config to service_role;

-- 2. fin_pix_payments passa a registrar cobranças de provedor (além do Pix estático)
alter table fin_pix_payments
  add column if not exists provider text not null default 'static',
  add column if not exists provider_payment_id text,
  add column if not exists table_session_id uuid references table_sessions(id) on delete set null,
  add column if not exists participant_id uuid references table_session_participants(id) on delete set null,
  add column if not exists scope text,
  add column if not exists allocation jsonb,          -- [{order_id, amount}]
  add column if not exists qr_code_base64 text,
  add column if not exists ticket_url text,
  add column if not exists payment_ids uuid[],
  add column if not exists settled_at timestamptz,
  add column if not exists raw_provider jsonb,
  add column if not exists error text;

create unique index if not exists fin_pix_payments_provider_payment_uidx
  on fin_pix_payments (provider, provider_payment_id) where provider_payment_id is not null;
create index if not exists fin_pix_payments_table_session_idx
  on fin_pix_payments (table_session_id) where table_session_id is not null;

-- 3. Broadcast por cobrança (o celular do cliente escuta `pix-payment:<id>`),
--    mesmo padrão do orders-ping: público, payload mínimo, nunca bloqueia a escrita.
create or replace function fn_pix_payment_realtime_ping()
returns trigger language plpgsql security definer
set search_path to 'public', 'realtime' as $$
begin
  if new.status is distinct from old.status then
    begin
      perform realtime.send(
        jsonb_build_object('id', new.id, 'status', new.status),
        'pix_change',
        'pix-payment:' || new.id::text,
        false
      );
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_pix_payment_ping on fin_pix_payments;
create trigger trg_pix_payment_ping after update on fin_pix_payments
for each row execute function fn_pix_payment_realtime_ping();

-- 4. A Edge lê participantes com service_role (validação participant_id + access_token)
grant select, insert, update, delete on table_session_participants to service_role;

-- 5. Status 'failed' (provedor recusou a criação da cobrança) — antes o CHECK derrubava o update em silêncio
alter table fin_pix_payments drop constraint if exists fin_pix_payments_status_check;
alter table fin_pix_payments add constraint fin_pix_payments_status_check
  check (status = any (array['pending','confirmed','expired','cancelled','failed']));
