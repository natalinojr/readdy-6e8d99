-- ═══════════════════════════════════════════════════════════════════════════
-- Fornecedor pré-pago (2026-09-26, pedido do dono — caso Facebook/Meta Ads)
--
-- A loja põe crédito no fornecedor por Pix (recarga) e, no começo do mês seguinte, recebe a NFS-e
-- do que foi CONSUMIDO no mês anterior (dCompet = último dia do mês de consumo). Uma coisa não é a
-- soma da outra, então "nota do mês" (1 nota ↔ N pagamentos) nunca fecha.
--
-- Modelo:
--   • recarga (Pix no extrato ao CNPJ do fornecedor)  → sai do CAIXA (fin_cash_flow origin
--     'prepaid_topup', que o DRE não lê) e soma no crédito; a linha do extrato fica conciliada
--     (match_kind 'prepaid_topup'). Nada no DRE.
--   • nota (consumo)  → despesa no DRE na data de competência da nota, já quitada "com o crédito":
--     conta a pagar paga SEM conta bancária e SEM fin_cash_flow (o dinheiro já saiu na recarga).
--     Feita pela edge conciliacao-pagamentos (prepaid_consume), que reaproveita o import_bill.
--   • saldo = saldo inicial + recargas − consumos ± acertos.
-- Só a edge (service_role) lê e grava estas tabelas.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.fin_prepaid_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^\d{14}$'),   -- casa pela raiz (8 primeiros dígitos)
  name text not null,
  dre_category_id uuid not null references public.fin_dre_categories(id),
  cost_center_id uuid,
  start_date date not null,                         -- recargas a partir desta data
  opening_balance numeric(12,2) not null default 0, -- crédito que já existia em start_date
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, cnpj)
);

create table if not exists public.fin_prepaid_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_id uuid not null references public.fin_prepaid_suppliers(id) on delete cascade,
  kind text not null check (kind in ('topup', 'consumption', 'adjust')),
  amount numeric(12,2) not null,   -- com sinal: recarga +, consumo −, acerto ±
  date date not null,
  statement_id uuid unique references public.fin_bank_statement_imports(id) on delete set null,
  document_id uuid unique references public.fiscal_inbound_documents(id) on delete set null,
  bill_id uuid,
  cash_flow_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'topup' and amount > 0) or (kind = 'consumption' and amount < 0) or (kind = 'adjust' and amount <> 0))
);
-- Nota lançada "com o crédito": settlement = 'prepaid' (Desfazer e o lançamento automático olham isso)
alter table public.fiscal_inbound_documents drop constraint if exists fiscal_inbound_documents_settlement_check;
alter table public.fiscal_inbound_documents add constraint fiscal_inbound_documents_settlement_check
  check (settlement is null or settlement in ('monthly', 'prepaid'));

create index if not exists fin_prepaid_moves_supplier_idx on public.fin_prepaid_moves (supplier_id, date desc);

alter table public.fin_prepaid_suppliers enable row level security;
alter table public.fin_prepaid_moves enable row level security;
revoke all on public.fin_prepaid_suppliers from anon, authenticated;
revoke all on public.fin_prepaid_moves from anon, authenticated;
grant all on public.fin_prepaid_suppliers to service_role;
grant all on public.fin_prepaid_moves to service_role;

-- Recargas: Pix/transferência/boleto pendente do Inter ao CNPJ (raiz) de um fornecedor pré-pago ativo,
-- desde start_date. Linha desfeita na Conciliação leva match_detail.prepaid_skip e não volta.
create or replace function public.fn_prepaid_apply_topups(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_cf uuid;
  v_move uuid;
  n integer := 0;
begin
  for r in
    select i.id, i.transaction_date, i.amount, i.category, i.match_kind, s.id as supplier_id, s.name, s.cost_center_id
      from fin_prepaid_suppliers s
      join fin_bank_statement_imports i
        on i.tenant_id = s.tenant_id
       and i.source = 'inter' and i.transaction_type = 'debit'
       and i.status = 'pending' and not coalesce(i.reconciled, false)
       and i.transaction_date >= s.start_date
       and left(regexp_replace(coalesce(i.counterpart_doc, ''), '\D', '', 'g'), 8) = left(s.cnpj, 8)
       and length(regexp_replace(coalesce(i.counterpart_doc, ''), '\D', '', 'g')) = 14
       and coalesce((i.match_detail->>'prepaid_skip')::boolean, false) = false
     where s.tenant_id = p_tenant and s.is_active
     order by i.transaction_date
     for update of i skip locked
  loop
    insert into fin_cash_flow (tenant_id, type, amount, description, category, cost_center_id, origin, reference_id, date, notes)
    values (p_tenant, 'expense', abs(r.amount), 'Recarga de crédito: ' || r.name, 'Crédito pré-pago', r.cost_center_id,
            'prepaid_topup', r.id, r.transaction_date, 'Crédito no fornecedor: vira despesa quando chega a nota do consumo')
    returning id into v_cf;
    insert into fin_prepaid_moves (tenant_id, supplier_id, kind, amount, date, statement_id, cash_flow_id)
    values (p_tenant, r.supplier_id, 'topup', abs(r.amount), r.transaction_date, r.id, v_cf)
    returning id into v_move;
    update fin_bank_statement_imports
       set status = 'matched', reconciled = true, reconciled_at = now(), matched_at = now(),
           match_kind = 'prepaid_topup', match_ref_id = v_move, match_confidence = 'exato',
           category = 'Crédito pré-pago',
           match_detail = jsonb_build_object(
             'label', 'Recarga de crédito: ' || r.name, 'valor', abs(r.amount), 'supplier_id', r.supplier_id,
             'prev_match_kind', case when r.match_kind in ('rule') then null else r.match_kind end,
             'prev_category', r.category,
             'confirmed', jsonb_build_object('created', 'prepaid_topup', 'move_id', v_move, 'cash_flow_id', v_cf,
                                             'pay_amount', abs(r.amount), 'at', now()))
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.fn_prepaid_apply_topups(uuid) from public, anon, authenticated;
grant execute on function public.fn_prepaid_apply_topups(uuid) to service_role;

comment on table public.fin_prepaid_suppliers is 'Fornecedor pré-pago (recarga por Pix, nota mensal do consumo). Edge conciliacao-pagamentos › prepaid_*';
comment on table public.fin_prepaid_moves is 'Extrato do crédito no fornecedor pré-pago: topup (+), consumption (−, nota lançada), adjust (±)';
