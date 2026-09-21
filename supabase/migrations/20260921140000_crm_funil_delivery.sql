-- Funil de CRM do delivery: estagio de cada cliente, regras por estagio e log
-- de envios.
--
-- Desenho:
--   * `crm_customer_stage` e DERIVADA (recalculada por fn_crm_recompute_stages).
--     Nunca editar na mao: a fonte da verdade sao orders + menu_visits.
--   * `crm_rules`: o que oferecer em cada estagio. Nasce DESLIGADA (auto_send
--     false) por decisao do dono — o ERPOS sugere, o envio e um clique humano.
--   * `crm_sends`: o que ja foi enviado pra quem. Serve pro teto de frequencia
--     (nao encher o cliente de mensagem) e pra medir o que converteu.
--
-- Leitura/escrita pela Edge Function crm-funnel (service_role). RLS ligado e
-- sem policy: telefone/CPF de cliente nao vai pro PostgREST.

-- ── Estagios do funil ────────────────────────────────────────────────────────
-- carrinho_abandonado  montou carrinho e nao fechou (precedencia maxima)
-- nunca_comprou        cadastrou o celular e nunca pediu
-- primeira_compra      exatamente 1 pedido
-- recorrente           2 a 5 pedidos, dentro do ritmo dele
-- fiel                 6+ pedidos, dentro do ritmo dele
-- vip                  fiel e no topo de gasto da loja
-- em_risco             sumiu ha mais de 1,5x o proprio ciclo
-- perdido              sem pedir ha mais de 90 dias
do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_stage') then
    create type public.crm_stage as enum (
      'carrinho_abandonado',
      'nunca_comprou',
      'primeira_compra',
      'recorrente',
      'fiel',
      'vip',
      'em_risco',
      'perdido'
    );
  end if;
end $$;

create table if not exists public.crm_customer_stage (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  stage public.crm_stage not null,
  -- desde quando esta NESTE estagio (preservado enquanto o estagio nao muda)
  entered_at timestamptz not null default now(),
  computed_at timestamptz not null default now(),
  orders_count integer not null default 0,
  total_spent numeric(12,2) not null default 0,
  last_order_at timestamptz,
  -- media de dias entre pedidos DESTE cliente (null com menos de 2 pedidos)
  avg_cycle_days numeric(6,1),
  days_since_last integer,
  primary key (tenant_id, customer_id)
);

comment on table public.crm_customer_stage is
  'Estagio de funil por cliente. Tabela DERIVADA: recalculada por fn_crm_recompute_stages a partir de orders + menu_visits.';

create index if not exists idx_crm_stage_tenant_stage
  on public.crm_customer_stage (tenant_id, stage);

-- ── Regras por estagio ───────────────────────────────────────────────────────
create table if not exists public.crm_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stage public.crm_stage not null,
  -- sugerir esta oferta na tela (o dono liga por estagio)
  enabled boolean not null default false,
  -- disparo automatico. Fica false ate existir envio automatico de verdade
  -- (depende de template aprovado na Meta). Ligar isto sozinho nao envia nada.
  auto_send boolean not null default false,
  -- quanto esperar depois de entrar no estagio antes de abordar
  delay_hours integer not null default 24,
  voucher_type text not null default 'percentual'
    check (voucher_type in ('percentual', 'valor', 'nenhum')),
  voucher_value numeric(10,2) not null default 0,
  validade_dias integer not null default 7,
  mensagem text,
  -- nao repetir a mesma regra pro mesmo cliente antes disso
  cooldown_days integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_rules_stage_uk unique (tenant_id, stage)
);

comment on column public.crm_rules.auto_send is
  'Disparo automatico. Nasce false e so deve virar true quando existir envio automatico homologado (template aprovado na Meta).';

-- ── Teto de frequencia por loja ──────────────────────────────────────────────
create table if not exists public.crm_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- no maximo N mensagens de CRM por cliente na janela (nao encher o saco)
  max_msgs_por_semana integer not null default 1,
  -- nunca abordar fora desta faixa (hora local da loja)
  hora_inicio integer not null default 10 check (hora_inicio between 0 and 23),
  hora_fim integer not null default 21 check (hora_fim between 0 and 23),
  -- cupom nunca pode derrubar o pedido abaixo do custo: teto de desconto
  desconto_max_percent numeric(5,2) not null default 25,
  updated_at timestamptz not null default now()
);

-- ── Log de envios ────────────────────────────────────────────────────────────
create table if not exists public.crm_sends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  rule_id uuid references public.crm_rules(id) on delete set null,
  stage public.crm_stage not null,
  channel text not null default 'whatsapp',
  voucher_id uuid references public.vouchers(id) on delete set null,
  message text,
  sent_at timestamptz not null default now(),
  sent_by uuid references auth.users(id) on delete set null,
  -- pedido que veio depois desta mensagem (medida de retorno)
  order_id uuid references public.orders(id) on delete set null,
  converted_at timestamptz
);

create index if not exists idx_crm_sends_tenant_customer
  on public.crm_sends (tenant_id, customer_id, sent_at desc);

create index if not exists idx_crm_sends_tenant_sent
  on public.crm_sends (tenant_id, sent_at desc);

alter table public.crm_customer_stage enable row level security;
alter table public.crm_rules enable row level security;
alter table public.crm_settings enable row level security;
alter table public.crm_sends enable row level security;

grant select, insert, update, delete on public.crm_customer_stage to service_role;
grant select, insert, update, delete on public.crm_rules to service_role;
grant select, insert, update, delete on public.crm_settings to service_role;
grant select, insert, update, delete on public.crm_sends to service_role;
