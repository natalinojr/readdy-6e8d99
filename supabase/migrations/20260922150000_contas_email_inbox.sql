-- Caixa de boletos por e-mail (2026-09-22)
-- Pedido do dono: um e-mail da loja que o sistema olha e vai cadastrando as contas a pagar.
-- O buraco que isso fecha: nota fiscal já entra pela SEFAZ, extrato pelo Inter, venda pela
-- maquininha — o boleto que chega por e-mail era o único que só existia na caixa de alguém
-- (descoberto quando um condomínio de R$ 2.181,55 venceu sem estar no sistema).
--
-- Gmail lido pela API do Google (somente leitura), com OAuth do próprio dono: sem domínio
-- próprio, sem provedor de e-mail no meio. O refresh_token fica aqui e NUNCA vai ao front.
create table if not exists public.fin_mail_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  provider text not null default 'gmail' check (provider in ('gmail')),
  email_address text,
  client_id text,
  client_secret text,
  refresh_token text,
  -- filtro do Gmail para não varrer a caixa inteira (padrão: com anexo, últimos 30 dias)
  query text not null default 'has:attachment newer_than:30d',
  is_active boolean not null default false,
  auto_sync boolean not null default true,
  last_check_at timestamptz,
  last_error text,
  connected_by uuid,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fin_mail_config enable row level security;
revoke all on public.fin_mail_config from anon, authenticated;
grant all on public.fin_mail_config to service_role;

-- Uma linha por e-mail visto. Serve para três coisas: não reprocessar, mostrar o histórico
-- ("por que essa conta apareceu?") e deixar visível o que ficou parado esperando o dono.
create table if not exists public.fin_mail_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id text not null,
  thread_id text,
  from_email text,
  from_name text,
  subject text,
  received_at timestamptz,
  -- pending = visto, ainda não tratado; bill = virou conta; pendencia = esperando o dono;
  -- ignored = não era boleto; error = falhou ao ler
  status text not null default 'pending'
    check (status in ('pending', 'bill', 'pendencia', 'ignored', 'error')),
  reason text,
  bill_id uuid references public.fin_accounts_payable(id) on delete set null,
  supplier_id uuid references public.fin_suppliers(id) on delete set null,
  boleto_digitavel text,
  amount numeric(14,2),
  due_date date,
  attachments integer,
  raw jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, message_id)
);

alter table public.fin_mail_messages enable row level security;
revoke all on public.fin_mail_messages from anon, authenticated;
grant all on public.fin_mail_messages to service_role;

create index if not exists fin_mail_messages_status_idx
  on public.fin_mail_messages (tenant_id, status, received_at desc);

-- Mesmo boleto reenviado (ou encaminhado duas vezes) não pode virar duas contas. A linha
-- digitável é única por boleto, então é ela que segura a duplicidade — inclusive contra os
-- boletos que já entram hoje pelo WhatsApp e pelas guias.
create unique index if not exists fin_accounts_payable_digitavel_uidx
  on public.fin_accounts_payable (tenant_id, boleto_digitavel)
  where boleto_digitavel is not null and status <> 'cancelled';

comment on table public.fin_mail_config is 'Caixa de e-mail que o sistema lê para lançar contas a pagar. Credenciais só pelo service_role.';
comment on column public.fin_mail_config.refresh_token is 'OAuth do Google (gmail.readonly). Nunca volta ao front.';
