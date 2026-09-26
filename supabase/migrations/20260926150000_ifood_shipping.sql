-- iFood Entregas (módulo Shipping, "Sob Demanda" p/ pedidos fora da plataforma) — 2026-09-26.
-- Segundo app do iFood ("ERPOS PDV", categoria PDV: Shipping + Events + Merchant + Catalog + Review +
-- Analytics). Credenciais e tokens separados do app financeiro (fin_ifood_*): cada app tem o próprio
-- Client ID/Secret e cada loja autoriza cada app no Portal do Parceiro.
--
-- Fluxo: Gestor de Entregas › "Chamar iFood" → cotação (deliveryAvailabilities) → registra o pedido no
-- iFood (shipping/v1.0/merchants/{id}/orders) → o polling de eventos (a cada 30 s, exigido na
-- homologação) atualiza o status, o código de entrega e o pedido do ERPOS (saiu/entregue).

-- ── Credenciais do app (1 por loja do ERPOS) ─────────────────────────────────
create table if not exists public.ifood_pdv_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  client_id text,
  client_secret text,
  app_type text not null default 'distributed',   -- 'centralized' = app de teste "C" (client_credentials)
  homologation_mode boolean not null default false,
  homologation_until timestamptz,   -- polling contínuo da homologação desliga sozinho (24 h)
  user_code text,
  auth_verifier_secret text,
  verification_url text,
  user_code_expires_at timestamptz,
  -- Loja do iFood que despacha as entregas desta loja do ERPOS (uma autorização pode listar várias).
  shipping_merchant_id text,
  shipping_merchant_name text,
  shipping_enabled boolean not null default false,
  -- Tempo de preparo padrão (min) — o iFood aloca o entregador depois disso.
  default_prep_min int not null default 15,
  last_poll_at timestamptz,
  last_poll_error text,
  poll_fail_count int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ifood_pdv_config enable row level security;
revoke all on public.ifood_pdv_config from anon, authenticated;
grant all on public.ifood_pdv_config to service_role;

-- Uma linha por autorização (código digitado no Portal do Parceiro), com o token dela.
create table if not exists public.ifood_pdv_auths (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  merchants jsonb not null default '[]',      -- [{ id, name }]
  authorized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ifood_pdv_auths_tenant_idx on public.ifood_pdv_auths (tenant_id, authorized_at desc);
alter table public.ifood_pdv_auths enable row level security;
revoke all on public.ifood_pdv_auths from anon, authenticated;
grant all on public.ifood_pdv_auths to service_role;

-- ── Entregas pedidas ao iFood ────────────────────────────────────────────────
create table if not exists public.ifood_shipping_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  merchant_id text not null,
  ifood_order_id text unique,
  quote_id text,
  quote jsonb,
  -- Custo cobrado pelo iFood (quote.netValue) e taxa cobrada do cliente (merchantFee).
  ifood_fee numeric(12,2),
  merchant_fee numeric(12,2),
  -- requested → allocated → going_to_origin → arrived_origin → in_transit → concluded
  -- (ou failed / cancel_requested / cancelled)
  status text not null default 'requested',
  last_event text,
  tracking_url text,
  drop_code text,          -- código que o entregador pede ao cliente (4 últimos dígitos do telefone)
  pickup_code text,        -- código de coleta (loja confere antes de entregar ao entregador)
  safe_score text,
  driver jsonb,            -- { name, phone, vehicle, ... } quando o evento traz
  address jsonb,           -- endereço enviado
  payment jsonb,           -- pagamento enviado (null = já pago online)
  prep_min int,
  address_change jsonb,    -- pedido de troca de endereço pendente (metadata do evento)
  address_change_deadline timestamptz,
  cancel_reason text,
  error text,
  -- Resposta incerta do iFood (5xx/queda) ou sem notícia: pode haver entregador a caminho.
  uncertain boolean not null default false,
  timeline jsonb not null default '{}',       -- { EVENTO: iso } 1ª vez de cada evento
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ifood_shipping_orders_order_idx on public.ifood_shipping_orders (order_id, created_at desc);
create index if not exists ifood_shipping_orders_active_idx on public.ifood_shipping_orders (tenant_id)
  where status not in ('concluded', 'cancelled', 'failed');
-- Um pedido do ERPOS só pode ter UMA entrega iFood ativa por vez.
create unique index if not exists ifood_shipping_orders_one_active on public.ifood_shipping_orders (order_id)
  where status not in ('concluded', 'cancelled', 'failed');
alter table public.ifood_shipping_orders enable row level security;
drop policy if exists ifood_shipping_orders_select_membership on public.ifood_shipping_orders;
create policy ifood_shipping_orders_select_membership on public.ifood_shipping_orders
  for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.ifood_shipping_orders from anon;
grant select on public.ifood_shipping_orders to authenticated;
grant all on public.ifood_shipping_orders to service_role;

-- ── Eventos recebidos (dedup pelo id do evento + log de 30 dias exigido na homologação) ──
create table if not exists public.ifood_pdv_events (
  event_id text primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  merchant_id text,
  ifood_order_id text,
  code text,
  full_code text,
  sales_channel text,
  metadata jsonb,
  event_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  acked_at timestamptz,
  error text
);
create index if not exists ifood_pdv_events_order_idx on public.ifood_pdv_events (ifood_order_id, event_at);
create index if not exists ifood_pdv_events_received_idx on public.ifood_pdv_events (received_at);
alter table public.ifood_pdv_events enable row level security;
revoke all on public.ifood_pdv_events from anon, authenticated;
grant all on public.ifood_pdv_events to service_role;

-- ── Polling a cada 30 s — só chama a Edge quando há o que acompanhar ──────────
-- Consulta barata (índice parcial de entregas ativas) antes do http: sem entrega iFood em andamento
-- e fora do modo homologação, o job não faz nada. A chamada é assíncrona (pg_net): o job não segura
-- conexão do banco enquanto a Edge conversa com o iFood.
create extension if not exists pg_net with schema extensions;

create or replace function public.fn_ifood_shipping_poll()
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_key text; v_anon text;
begin
  -- Entrega "ativa" sem notícia há 6 h: encerra (o polling já não olha; sem isto o pedido fica travado).
  -- (só escreve quando há o que encerrar: 1 leitura barata por tick, nenhuma escrita no caso comum)
  if exists (select 1 from public.ifood_shipping_orders
              where status not in ('concluded', 'cancelled', 'failed') and updated_at < now() - interval '6 hours') then
    update public.ifood_shipping_orders
       set status = 'failed', uncertain = true, updated_at = now(),
           error = 'Sem notícia do iFood há mais de 6 h — confira no Gestor de Pedidos do iFood.'
     where status not in ('concluded', 'cancelled', 'failed') and updated_at < now() - interval '6 hours';
  end if;
  if not exists (
    select 1 from public.ifood_pdv_config c
     where c.shipping_enabled and c.client_id is not null
       and ((c.homologation_mode and c.homologation_until > now())
            or exists (select 1 from public.ifood_shipping_orders s
                        where s.tenant_id = c.tenant_id and s.status not in ('concluded', 'cancelled', 'failed')
                          and s.updated_at > now() - interval '6 hours'))
  ) then
    return 'nada a acompanhar';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault'; end if;
  perform net.http_post(
    url := 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/ifood-shipping',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key,
                                  'apikey', v_anon, 'Authorization', 'Bearer ' || v_anon),
    body := '{"action":"poll_all"}'::jsonb,
    timeout_milliseconds := 25000
  );
  return 'chamado';
end;
$$;
revoke all on function public.fn_ifood_shipping_poll() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ifood-shipping-poll';
select cron.schedule('ifood-shipping-poll', '30 seconds', $$select public.fn_ifood_shipping_poll();$$);

-- Primeiro job abaixo de 1 min do projeto: 2.880 linhas/dia em cron.job_run_details. Limpa o histórico
-- de TODOS os jobs com mais de 3 dias (ninguém lê além disso; o disco/IO do plano é o gargalo).
select cron.unschedule(jobid) from cron.job where jobname = 'cron-historico-limpeza';
select cron.schedule('cron-historico-limpeza', '17 6 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
