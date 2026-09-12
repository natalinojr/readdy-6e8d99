-- ── Pagamentos pelo Banco Inter via assistente (2026-09-12) ─────────────────
-- Boleto e Pix saem da conta do Inter pela edge `inter-bank` (ações internas:
-- prepare_payment / execute_payment / payment_status / cancel_payment). Só o
-- assistente chama (x-internal-key), depois do botão "Pagar" + PIN no Telegram;
-- o Inter ainda exige aprovação no app (Gestão de Aprovações).

-- Token OAuth dos escopos de pagamento fica separado do token de extrato
alter table public.fin_inter_config add column if not exists pay_access_token text;
alter table public.fin_inter_config add column if not exists pay_token_expires_at timestamptz;
-- Travas (valores padrão combinados com o dono)
alter table public.fin_inter_config add column if not exists pay_limit_tx numeric not null default 5000;
alter table public.fin_inter_config add column if not exists pay_limit_day numeric not null default 10000;

-- Pix só para fornecedor cadastrado: CNPJ ou chave Pix do cadastro
alter table public.fin_suppliers add column if not exists pix_key text;

create table if not exists public.fin_inter_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('boleto', 'pix')),
  -- draft → awaiting_pin → sending → sent | pending_approval | approved | scheduled → paid
  -- (ou cancelled / rejected / failed / expired)
  status text not null default 'draft',
  amount numeric not null,
  face_value numeric,
  due_date date,
  barcode text,
  digitavel text,
  bank_code text,
  boleto_kind text,
  pix_key text,
  pix_key_kind text,
  supplier_id uuid,
  beneficiary_name text,
  beneficiary_doc text,
  description text,
  bill_id uuid references public.fin_accounts_payable(id) on delete set null,
  idempotency_key uuid not null default gen_random_uuid(),
  inter_code text,
  inter_status text,
  response jsonb,
  error text,
  requested_by uuid,
  channel text,
  chat_id text,
  tg_message_id bigint,
  pin_requested_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_inter_payments_tenant on public.fin_inter_payments (tenant_id, created_at desc);
create index if not exists idx_inter_payments_chat on public.fin_inter_payments (chat_id, status);
alter table public.fin_inter_payments enable row level security;
revoke all on public.fin_inter_payments from anon, authenticated;
grant all on public.fin_inter_payments to service_role;

-- O assistente (papel asst_reader) passa a enxergar a tabela nova já, sem esperar o refresh das 04:00
do $$ begin
  perform public.fn_asst_reader_refresh();
exception when others then null;
end $$;
