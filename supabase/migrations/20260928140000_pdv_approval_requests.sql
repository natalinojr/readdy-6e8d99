-- ── Aprovações do PDV no banco (cancelamento, desconto, problema de item) ────
-- Até aqui o AprovacoesContext guardava as solicitações só na memória do aparelho
-- de quem pediu: o caixa pedia "Solicitar aprovação ao gerente" e o admin/gerente
-- em outro aparelho nunca via nada. Agora a solicitação vira linha por loja; quem
-- decide é admin/gerente/supervisão da loja (RPC), e um broadcast mínimo avisa os
-- aparelhos da loja para refazer a leitura (mesmo padrão do orders-ping).
-- A ação em si (cancelar o pedido, aplicar o desconto) continua no aparelho de
-- quem pediu, que está esperando na tela "Aguardando aprovação".

create table if not exists public.pdv_approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tipo text not null check (tipo in ('problema_item', 'desconto', 'cancelamento')),
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'rejeitado', 'cancelado')),
  urgente boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  requested_by uuid not null default auth.uid(),
  requested_by_name text,
  resolved_by uuid,
  resolved_by_name text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pdv_approval_requests_tenant_created_idx
  on public.pdv_approval_requests (tenant_id, created_at desc);

alter table public.pdv_approval_requests enable row level security;
revoke all on public.pdv_approval_requests from anon, authenticated;
grant select, insert on public.pdv_approval_requests to authenticated;
grant select, insert, update, delete on public.pdv_approval_requests to service_role;

drop policy if exists pdv_approval_requests_select on public.pdv_approval_requests;
create policy pdv_approval_requests_select on public.pdv_approval_requests
  for select to authenticated
  using (exists (
    select 1 from public.user_tenants ut
    where ut.user_id = auth.uid() and ut.tenant_id = pdv_approval_requests.tenant_id
  ));

-- Qualquer membro da loja pede; nasce sempre pendente, em nome de quem está logado.
drop policy if exists pdv_approval_requests_insert on public.pdv_approval_requests;
create policy pdv_approval_requests_insert on public.pdv_approval_requests
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'pendente'
    and resolved_by is null
    and resolved_at is null
    and exists (
      select 1 from public.user_tenants ut
      where ut.user_id = auth.uid() and ut.tenant_id = pdv_approval_requests.tenant_id
    )
  );

-- Sem policy de UPDATE: decidir/cancelar só pelas RPCs abaixo.

-- Decidir: admin, gerente ou supervisão da loja; só enquanto pendente.
create or replace function public.fn_pdv_approval_decide(
  p_id uuid,
  p_aprovar boolean,
  p_nome text default null
) returns public.pdv_approval_requests
language plpgsql security definer
set search_path to 'public' as $$
declare
  v_row public.pdv_approval_requests;
begin
  select * into v_row from public.pdv_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Solicitação não encontrada';
  end if;
  if not exists (
    select 1 from public.user_tenants ut
    where ut.user_id = auth.uid()
      and ut.tenant_id = v_row.tenant_id
      and ut.role::text in ('admin', 'manager', 'supervisor')
  ) then
    raise exception 'Só admin, gerente ou supervisão da loja pode decidir esta solicitação';
  end if;
  if v_row.status <> 'pendente' then
    raise exception 'Essa solicitação já foi resolvida (%)', v_row.status;
  end if;

  update public.pdv_approval_requests
     set status = case when p_aprovar then 'aprovado' else 'rejeitado' end,
         resolved_by = auth.uid(),
         resolved_by_name = nullif(trim(coalesce(p_nome, '')), ''),
         resolved_at = now()
   where id = p_id
  returning * into v_row;
  return v_row;
end $$;

-- Cancelar: quem pediu desiste antes da resposta.
create or replace function public.fn_pdv_approval_cancel(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'public' as $$
begin
  update public.pdv_approval_requests
     set status = 'cancelado', resolved_at = now()
   where id = p_id
     and requested_by = auth.uid()
     and status = 'pendente';
end $$;

revoke all on function public.fn_pdv_approval_decide(uuid, boolean, text) from public, anon;
revoke all on function public.fn_pdv_approval_cancel(uuid) from public, anon;
grant execute on function public.fn_pdv_approval_decide(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.fn_pdv_approval_cancel(uuid) to authenticated, service_role;

-- Broadcast por loja: payload mínimo, o front refaz a leitura autenticada.
-- Nunca bloqueia a escrita.
create or replace function public.fn_pdv_approval_realtime_ping()
returns trigger language plpgsql security definer
set search_path to 'public', 'realtime' as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', new.id, 'status', new.status),
      'approval_change',
      'approvals-ping:' || new.tenant_id::text,
      false
    );
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_pdv_approval_ping on public.pdv_approval_requests;
create trigger trg_pdv_approval_ping
  after insert or update on public.pdv_approval_requests
  for each row execute function public.fn_pdv_approval_realtime_ping();
