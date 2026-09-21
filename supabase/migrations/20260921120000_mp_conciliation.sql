-- Conector de conciliação do Mercado Pago (2026-09-21)
--
-- A loja de Paranaguá passou a usar a maquininha do Mercado Pago (mesma conta MP do
-- autoatendimento, provider `mp_point` em fin_payment_provider_config — o token não é
-- duplicado aqui). Duas fontes, cada uma com um papel:
--
--   • VENDAS — GET /v1/payments/search: uma linha por venda aprovada, com taxa real
--     (fee_details), líquido (net_received_amount), bandeira, parcelas, data de liberação
--     (money_release_date) e o nosso external_reference. Alimenta o financeiro:
--     origin `stone_sale` (nome histórico = "venda no cartão da maquininha") e
--     `auto_card_fee` (taxa), agrupadas por dia de liberação — igual ao conector da Stone,
--     então DRE, Receitas e Visão Geral já leem sem mudança nenhuma.
--
--   • EXTRATO DA CONTA MP — Relatório de Liberações (released money): uma linha por
--     movimento liberado (venda, estorno, contracargo, disputa e SAQUE). Vira
--     fin_bank_statement_imports com source='mercadopago' na conta "Mercado Pago" da loja.
--     É o que permite casar o saque com o crédito que entrou no banco principal.
--
-- Diferença essencial em relação à Stone: a Stone repassa todo dia, o Mercado Pago acumula
-- saldo e o dono saca quando quer. Por isso o casamento aqui é 1 saque × 1 crédito no banco
-- (fn_match_card_deposits, ramo novo), e não grupo-do-dia × crédito-do-dia.

create table if not exists public.fin_mp_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- conta "Mercado Pago" da loja: é nela que o extrato do MP é gravado
  bank_account_id uuid references public.fin_bank_accounts(id) on delete set null,
  -- de qual linha de fin_payment_provider_config sai o access_token (mesma conta do MP)
  token_provider text not null default 'mp_point' check (token_provider in ('mp_point', 'mercadopago')),
  is_active boolean not null default true,
  auto_sync boolean not null default true,
  post_to_ledger boolean not null default false,
  -- Relatório de Liberações: prefixo do arquivo programado no MP (identifica os nossos)
  release_report boolean not null default false,
  release_prefix text,
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fin_mp_config enable row level security;
revoke all on public.fin_mp_config from anon, authenticated;
grant all on public.fin_mp_config to service_role;

-- Resumo por dia das VENDAS (payments/search), espelho de fin_stone_imports.
create table if not exists public.fin_mp_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reference_date date not null,
  status text not null check (status in ('success', 'error')),
  payments_count integer,
  sales_gross numeric(14,2),
  fees_total numeric(14,2),
  net_total numeric(14,2),
  refunds_total numeric(14,2),
  error_message text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, reference_date)
);

alter table public.fin_mp_imports enable row level security;
revoke all on public.fin_mp_imports from anon, authenticated;
grant all on public.fin_mp_imports to service_role;

-- Arquivos do Relatório de Liberações já baixados (o MP mantém os arquivos na conta;
-- guardamos o nome para não reimportar e para mostrar o histórico).
create table if not exists public.fin_mp_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  file_name text not null,
  generated_at timestamptz,
  begin_date date,
  end_date date,
  status text not null default 'pending' check (status in ('pending', 'success', 'error')),
  rows_count integer,
  inserted_count integer,
  error_message text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, file_name)
);

alter table public.fin_mp_reports enable row level security;
revoke all on public.fin_mp_reports from anon, authenticated;
grant all on public.fin_mp_reports to service_role;

-- Linha do extrato aponta para o arquivo/dia que a trouxe (paralelo a stone_import_id).
alter table public.fin_bank_statement_imports
  add column if not exists provider_import_id uuid;

create index if not exists fin_bank_statement_imports_provider_import_idx
  on public.fin_bank_statement_imports (tenant_id, provider_import_id)
  where provider_import_id is not null;

comment on table public.fin_mp_config is 'Conciliação do Mercado Pago por loja. O access_token vem de fin_payment_provider_config (token_provider), não é copiado aqui.';
comment on column public.fin_mp_config.post_to_ledger is 'Lançar vendas (stone_sale) e taxas (auto_card_fee) no fin_cash_flow.';

-- ── Saque do Mercado Pago × crédito no banco ─────────────────────────────────
-- Função própria (não um ramo de fn_match_card_deposits) porque o modelo é outro: a Stone
-- repassa todo dia e o casamento é grupo-do-dia × crédito-do-dia; o Mercado Pago acumula
-- saldo e o dono saca quando quer, então é 1 SAQUE × 1 crédito, pelo valor exato.
-- Chamada pela Edge `mp-conciliation` a cada importação/sync, como a Stone chama
-- fn_match_stone_inter. As liberações (vendas) já saem marcadas da importação: o extrato do
-- MP é a verdade do provedor, não tem contraparte para conciliar.
create or replace function public.fn_match_mp_payouts(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  f record;
  g record;
  v_conta text;
  v_key text;
  v_pairs int := 0;
  v_rows int := 0;
  v_n int;
begin
  select * into f from public.fn_money_flow(p_tenant);
  if f.card_provider is distinct from 'mercadopago' or f.card_deposit_account_id is null or f.card_deposit_match is null then
    return jsonb_build_object('skipped', true, 'card_provider', f.card_provider);
  end if;
  select name into v_conta from public.fin_bank_accounts where id = f.card_deposit_account_id;

  for g in
    select mp.id as mp_id, mp.transaction_date as d, mp.amount as valor,
           c.id as dep_id, c.transaction_date as d_banco
      from fin_bank_statement_imports mp
      join lateral (
        select c.id, c.transaction_date
          from fin_bank_statement_imports c
         where c.tenant_id = p_tenant and c.bank_account_id = f.card_deposit_account_id
           and coalesce(c.source, '') <> 'mercadopago'
           and position(lower(f.card_deposit_match) in lower(coalesce(c.description, ''))) > 0
           and c.transaction_type = 'credit' and c.status = 'pending'
           and not coalesce(c.reconciled, false) and c.match_group is null
           and abs(c.amount - mp.amount) <= 0.02
           and c.transaction_date between mp.transaction_date - 1 and mp.transaction_date + 5
         order by abs(c.transaction_date - mp.transaction_date), c.id
         limit 1
      ) c on true
     where mp.tenant_id = p_tenant and mp.source = 'mercadopago' and mp.raw->>'kind' = 'payout'
       and mp.transaction_type = 'debit' and mp.status = 'pending' and mp.match_group is null
       and mp.transaction_date between p_from and p_to
     order by mp.transaction_date, mp.id
  loop
    -- dois saques de valor igual podem escolher o mesmo crédito: o que perder fica pendente
    -- e casa na próxima rodada (o sync roda todo dia e ao abrir a Conciliação).
    if exists (select 1 from fin_bank_statement_imports
                where id in (g.mp_id, g.dep_id) and (status <> 'pending' or match_group is not null)) then
      continue;
    end if;

    v_key := 'mp:' || g.mp_id;

    update fin_bank_statement_imports
       set status = 'matched', match_kind = 'card_deposit', match_group = v_key,
           matched_at = coalesce(matched_at, now()),
           category = coalesce(category, 'Repasse Mercado Pago'),
           notes = format('Saque do Mercado Pago pedido em %s (R$ %s).', to_char(g.d, 'DD/MM'),
                          replace(to_char(g.valor, 'FM999999990.00'), '.', ','))
     where id = g.dep_id;
    get diagnostics v_n = row_count;
    v_rows := v_rows + v_n;

    update fin_bank_statement_imports
       set status = 'matched', match_kind = 'card_payout', match_group = v_key,
           matched_at = coalesce(matched_at, now()),
           notes = format('Recebido em %s em %s.', coalesce(v_conta, 'outra conta'), to_char(g.d_banco, 'DD/MM'))
     where id = g.mp_id;
    get diagnostics v_n = row_count;
    v_rows := v_rows + v_n;
    v_pairs := v_pairs + 1;
  end loop;

  return jsonb_build_object('pairs', v_pairs, 'rows', v_rows, 'card_provider', f.card_provider);
end;
$function$;

revoke all on function public.fn_match_mp_payouts(uuid, date, date) from anon, authenticated;
grant execute on function public.fn_match_mp_payouts(uuid, date, date) to service_role;

-- ── Cron diário ──────────────────────────────────────────────────────────────
-- 07h00 Inter, 07h15 Stone, 07h20 Mercado Pago (Brasília = UTC-3). O MP roda depois do
-- Inter para já casar o saque com o crédito do dia.
create or replace function public.fn_mp_sync_all()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text;
  v_anon text;
  v_status int;
  v_body text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then
    raise warning 'fn_mp_sync_all: segredos do vault ausentes';
    return;
  end if;
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/mp-conciliation',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"sync_all"}'
  )::http_request);
  if v_status >= 300 then
    raise warning 'fn_mp_sync_all: HTTP % — %', v_status, left(coalesce(v_body, ''), 300);
  end if;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'mp-sync';
select cron.schedule('mp-sync', '20 10 * * *', $$select public.fn_mp_sync_all();$$);
