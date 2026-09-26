-- Atendimento de CLIENTES da loja pelo WhatsApp (2026-09-26): o assistente responde quem entra em
-- contato, mostra o cardápio/delivery da loja e tenta fechar a venda (sempre pelo link do delivery,
-- que é quem calcula taxa, valida estoque e grava o pedido). Edge: atendimento-loja.
--
-- Dois jeitos de o cliente chegar (os dois pela API oficial, webhook whatsapp-cloud):
--   • número COMPARTILHADO (asst_settings.wa_public): link wa.me com o código da loja (PD-XXXX) no
--     texto pronto. A conversa segue na loja por até 3 dias sem o código.
--   • número PRÓPRIO da loja ligado à Cloud API (phone_id): tudo o que chega nele é da loja.

create table if not exists public.wa_loja_bots (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  is_active boolean not null default false,
  code text not null unique check (code ~ '^PD-[A-Z0-9]{4}$'),
  phone_id text unique,                          -- número próprio na Cloud API (opcional)
  waba_id text,
  start_text text,                               -- texto pronto do link wa.me (leva o código)
  welcome text,                                  -- 1ª resposta de quem chega pelo link; {nome} {loja} {link}
  extra_info text,                               -- o que mais o atendente pode contar (pagamento, estacionamento…)
  forbidden text,                                -- assuntos proibidos
  voucher_code text,                             -- cupom que ele pode oferecer para fechar a venda (opcional)
  upsell boolean not null default true,          -- sugerir acompanhamento/bebida/sobremesa
  notify_owner boolean not null default true,    -- avisa o dono no Telegram quando pede atendente
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wa_loja_conversas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_phone text not null,                   -- como veio do WhatsApp (55…)
  phone_key text not null,                       -- DDD + 8 dígitos (wa_phone_key), sem 55 e sem o 9
  contact_name text,
  via text not null default 'compartilhado' check (via in ('compartilhado', 'proprio')),
  status text not null default 'aberta' check (status in ('aberta', 'encerrada')),
  is_test boolean not null default false,        -- dono testando pelo próprio número
  needs_human boolean not null default false,
  bot_paused_until timestamptz,                  -- equipe assumiu: o robô não responde até aqui
  link_sent_at timestamptz,                      -- mandou o link do delivery (funil)
  model_calls integer not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists wa_loja_conversas_contato on public.wa_loja_conversas (phone_key, last_message_at desc);
create index if not exists wa_loja_conversas_loja on public.wa_loja_conversas (tenant_id, last_message_at desc);

create table if not exists public.wa_loja_mensagens (
  id bigserial primary key,
  conversa_id uuid not null references public.wa_loja_conversas(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'staff')),
  content text not null,
  pending boolean not null default false,        -- debounce: mensagem do cliente ainda não respondida
  created_at timestamptz not null default now()
);
create index if not exists wa_loja_mensagens_conv on public.wa_loja_mensagens (conversa_id, id);

alter table public.wa_loja_bots enable row level security;
alter table public.wa_loja_conversas enable row level security;
alter table public.wa_loja_mensagens enable row level security;

-- Tela: só admin da loja. Envio de mensagem pela equipe passa pela edge (precisa do WhatsApp).
drop policy if exists wa_loja_bots_admin on public.wa_loja_bots;
create policy wa_loja_bots_admin on public.wa_loja_bots for all to authenticated
  using (public.fn_is_tenant_admin(tenant_id)) with check (public.fn_is_tenant_admin(tenant_id));
drop policy if exists wa_loja_conversas_admin_sel on public.wa_loja_conversas;
create policy wa_loja_conversas_admin_sel on public.wa_loja_conversas for select to authenticated
  using (public.fn_is_tenant_admin(tenant_id));
drop policy if exists wa_loja_conversas_admin_upd on public.wa_loja_conversas;
create policy wa_loja_conversas_admin_upd on public.wa_loja_conversas for update to authenticated
  using (public.fn_is_tenant_admin(tenant_id)) with check (public.fn_is_tenant_admin(tenant_id));
drop policy if exists wa_loja_mensagens_admin_sel on public.wa_loja_mensagens;
create policy wa_loja_mensagens_admin_sel on public.wa_loja_mensagens for select to authenticated
  using (exists (select 1 from public.wa_loja_conversas c where c.id = conversa_id and public.fn_is_tenant_admin(c.tenant_id)));

grant select, insert, update, delete on public.wa_loja_bots to authenticated;
grant select, update on public.wa_loja_conversas to authenticated;
grant select on public.wa_loja_mensagens to authenticated;
grant all on public.wa_loja_bots, public.wa_loja_conversas, public.wa_loja_mensagens to service_role;
grant usage, select on sequence public.wa_loja_mensagens_id_seq to service_role;
