-- Funil do iFood, etapas 3/4 (2026-09-27, IFOOD-PEDIDOS-FUNIL.md): o pedido do iFood vira pedido do ERPOS e cada
-- mudança de status volta ao iFood por uma fila (outbox) enviada pela edge ifood-shipping no polling de 30 s.

-- Configuração por loja: modo 'funnel' + aceite automático (padrão) ou manual + NFC-e (etapa 5, desligada).
alter table public.ifood_pdv_config drop constraint if exists ifood_pdv_config_order_mode_chk;
alter table public.ifood_pdv_config add constraint ifood_pdv_config_order_mode_chk check (order_mode in ('read_only', 'operate', 'funnel'));
alter table public.ifood_pdv_config add column if not exists order_auto_confirm boolean not null default true;
alter table public.ifood_pdv_config add column if not exists order_emit_nfce boolean not null default false;

-- Por que o pedido ainda não entrou no ERPOS (ex.: sem caixa aberto) — a edge tenta de novo a cada polling.
alter table public.ifood_orders add column if not exists funnel_error text;
alter table public.ifood_orders add column if not exists funnel_at timestamptz;

-- Fila de avisos ao iFood. Um aviso por pedido e ação (dedup pelo unique).
create table if not exists public.ifood_order_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  ifood_order_id text not null,
  op text not null check (op in ('start', 'ready', 'dispatch')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (ifood_order_id, op)
);
create index if not exists ifood_order_outbox_pending_idx on public.ifood_order_outbox (tenant_id, created_at) where status = 'pending';
alter table public.ifood_order_outbox enable row level security;
drop policy if exists ifood_order_outbox_select_membership on public.ifood_order_outbox;
create policy ifood_order_outbox_select_membership on public.ifood_order_outbox for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.ifood_order_outbox from anon, authenticated;
grant select on public.ifood_order_outbox to authenticated;
grant all on public.ifood_order_outbox to service_role;

-- Gatilho: pedido do iFood (orders.ifood_order_id) mudou de status no ERPOS → aviso na fila.
--   preparing (1º item começou na cozinha) → startPreparation; ready (tudo pronto) → readyToPickup;
--   saiu com o motoboy da loja (out_for_delivery_at, plataforma 'propria') → dispatch.
create or replace function public.fn_ifood_outbox_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ifood_order_id is null or new.is_draft or new.status = 'cancelled' then return new; end if;
  if new.status is distinct from old.status and new.status::text in ('preparing', 'ready') then
    insert into ifood_order_outbox (tenant_id, order_id, ifood_order_id, op) values (new.tenant_id, new.id, new.ifood_order_id, 'start')
      on conflict (ifood_order_id, op) do nothing;
  end if;
  if new.status is distinct from old.status and new.status::text in ('ready', 'delivered') then
    insert into ifood_order_outbox (tenant_id, order_id, ifood_order_id, op) values (new.tenant_id, new.id, new.ifood_order_id, 'ready')
      on conflict (ifood_order_id, op) do nothing;
  end if;
  if new.out_for_delivery_at is not null and old.out_for_delivery_at is null and new.delivery_platform = 'propria' then
    insert into ifood_order_outbox (tenant_id, order_id, ifood_order_id, op) values (new.tenant_id, new.id, new.ifood_order_id, 'ready')
      on conflict (ifood_order_id, op) do nothing;
    insert into ifood_order_outbox (tenant_id, order_id, ifood_order_id, op) values (new.tenant_id, new.id, new.ifood_order_id, 'dispatch')
      on conflict (ifood_order_id, op) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_ifood_outbox on public.orders;
create trigger trg_ifood_outbox after update of status, out_for_delivery_at on public.orders
  for each row when (new.ifood_order_id is not null) execute function public.fn_ifood_outbox_trg();

-- Trava: pedido do iFood não é cancelado direto no ERPOS (o iFood pode recusar). Cancela-se pela tela Pedidos iFood
-- (pedido de cancelamento com o motivo do iFood); o ERPOS cancela quando o iFood confirmar — pela função abaixo.
create or replace function public.fn_ifood_block_cancel_trg()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.ifood_order_id is not null
     and coalesce(current_setting('erpos.ifood_cancel', true), '') <> '1' then
    raise exception 'Pedido do iFood: cancele em Gestor de Entregas › Pedidos iFood (o iFood precisa aceitar o cancelamento).';
  end if;
  return new;
end $$;
drop trigger if exists trg_ifood_block_cancel on public.orders;
create trigger trg_ifood_block_cancel before update of status on public.orders
  for each row when (new.ifood_order_id is not null) execute function public.fn_ifood_block_cancel_trg();

-- Cancelamento confirmado pelo iFood → cancela o pedido do ERPOS (itens pendentes também). Só service_role.
create or replace function public.fn_ifood_cancel_erpos_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('erpos.ifood_cancel', '1', true);
  update orders set status = 'cancelled', cancel_reason = left(coalesce(p_reason, 'Cancelado no iFood'), 250),
         cancelled_at = now(), updated_at = now()
   where id = p_order_id and status <> 'cancelled';
  update order_items set status = 'cancelled' where order_id = p_order_id and status::text in ('new', 'preparing', 'ready');
  update ifood_order_outbox set status = 'skipped', last_error = 'pedido cancelado' where order_id = p_order_id and status = 'pending';
end $$;
revoke all on function public.fn_ifood_cancel_erpos_order(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_ifood_cancel_erpos_order(uuid, text) to service_role;

-- Só entram no funil pedidos criados depois que a loja ligou o modo (os anteriores já foram atendidos pelo tablet).
alter table public.ifood_pdv_config add column if not exists funnel_since timestamptz;
