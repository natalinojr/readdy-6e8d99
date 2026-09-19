-- Sangria do PDV ligada ao Financeiro (dono, 2026-09-18/19).
-- Fluxo: a loja posta a foto do cupom pago em DINHEIRO no grupo → o assistente lança a compra (CMV,
-- estoque) paga em dinheiro → fn_sangria_da_compra deixa uma SANGRIA PREVISTA para o caixa da loja →
-- no PDV o operador só confirma. Caixa não fecha com sangria prevista sem confirmar.
-- Sem foto: o operador faz a sangria "Fornecedor" à mão (vira pendência "sangria sem cupom"); quando
-- o cupom chega depois (sem limite de dias), a função acha a sangria de mesmo valor e LIGA a compra a ela (não cria outra).
-- Anti-dupla contagem: a compra paga já lança fin_cash_flow 'auto_purchase'; a sangria ligada a ela não
-- lança (ou tem o 'auto_sangria' apagado ao ser ligada).

alter table public.cash_movements add column if not exists category text;          -- retirada_socio | fornecedor | freelancer | troco | outro
alter table public.cash_movements add column if not exists purchase_id uuid references public.fin_purchases(id) on delete set null;
alter table public.cash_movements add column if not exists previsao_id uuid;
alter table public.cash_movements add column if not exists needs_receipt boolean not null default false;
create index if not exists cash_movements_purchase_idx on public.cash_movements (purchase_id) where purchase_id is not null;

create table if not exists public.cash_sangrias_previstas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  kind text not null default 'fornecedor',
  supplier text,
  description text,
  purchase_id uuid references public.fin_purchases(id) on delete set null,
  source text,
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'nao_saiu', 'cancelada')),
  cash_movement_id uuid references public.cash_movements(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  notes text
);
create index if not exists cash_sangrias_previstas_pend_idx on public.cash_sangrias_previstas (tenant_id) where status = 'pendente';
create unique index if not exists cash_sangrias_previstas_purchase_uq on public.cash_sangrias_previstas (purchase_id) where purchase_id is not null and status <> 'cancelada';
alter table public.cash_sangrias_previstas enable row level security;
drop policy if exists cash_sangrias_previstas_select on public.cash_sangrias_previstas;
create policy cash_sangrias_previstas_select on public.cash_sangrias_previstas for select to authenticated using (auth_is_member_of(tenant_id));
grant select on public.cash_sangrias_previstas to authenticated;
grant all on public.cash_sangrias_previstas to service_role;

-- Compra paga em dinheiro → liga a uma sangria já feita (mesmo valor, sem limite de dias) ou cria a prevista.
create or replace function public.fn_sangria_da_compra(p_purchase uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p record; m record; v_prev uuid;
begin
  select id, tenant_id, supplier, total_amount, payment_status, payment_method into p from fin_purchases where id = p_purchase;
  if p.id is null then raise exception 'Compra não encontrada'; end if;
  if coalesce(p.payment_status, '') <> 'paid' or coalesce(p.payment_method, '') !~* 'dinheiro' then
    return jsonb_build_object('ok', false, 'motivo', 'a compra não está lançada como paga em dinheiro');
  end if;
  select id into m from cash_movements where purchase_id = p.id limit 1;
  if m.id is not null then return jsonb_build_object('ok', true, 'acao', 'ja_ligada', 'cash_movement_id', m.id); end if;
  select id into v_prev from cash_sangrias_previstas where purchase_id = p.id and status <> 'cancelada' limit 1;
  if v_prev is not null then return jsonb_build_object('ok', true, 'acao', 'ja_prevista', 'prevista_id', v_prev); end if;

  select cm.id, cm.created_at, cm.reason into m from cash_movements cm
   where cm.tenant_id = p.tenant_id and cm.type = 'out' and cm.purchase_id is null
     and (cm.category = 'fornecedor' or (cm.category is null and cm.reason ilike 'Fornecedor%'))
     and abs(cm.amount - p.total_amount) <= 0.01
   order by (case when p.supplier is not null and cm.reason ilike '%' || split_part(p.supplier, ' ', 1) || '%' then 0 else 1 end), cm.created_at desc
   limit 1;
  if m.id is not null then
    update cash_movements set purchase_id = p.id, needs_receipt = false, category = coalesce(category, 'fornecedor'), updated_at = now() where id = m.id;
    delete from fin_cash_flow where origin = 'auto_sangria' and reference_id = m.id;
    update pendencias set status = 'resolvida', resolvida_em = now(), motivo = 'cupom lido e ligado à sangria', updated_at = now()
     where kind = 'sangria_sem_cupom' and ref = m.id::text and status in ('aberta', 'vista');
    return jsonb_build_object('ok', true, 'acao', 'ligada_a_sangria', 'cash_movement_id', m.id, 'quando', m.created_at);
  end if;

  insert into cash_sangrias_previstas (tenant_id, amount, supplier, description, purchase_id, source)
  values (p.tenant_id, p.total_amount, p.supplier, 'Compra ' || coalesce(p.supplier, '') || ' paga em dinheiro', p.id, 'assistente')
  returning id into v_prev;
  return jsonb_build_object('ok', true, 'acao', 'prevista_criada', 'prevista_id', v_prev);
end $$;
revoke all on function public.fn_sangria_da_compra(uuid) from public, anon, authenticated;
grant execute on function public.fn_sangria_da_compra(uuid) to service_role;

-- Fechamento: bloqueado com sangria prevista sem confirmar na loja.
CREATE OR REPLACE FUNCTION public.fn_close_cash_register_v2(p_cash_register_id uuid, p_closing_value numeric, p_closing_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_opening_value numeric;
  v_total_cash_payments numeric;
  v_total_deposits numeric;
  v_total_withdrawals numeric;
  v_expected numeric;
  v_difference numeric;
  v_previstas int;
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of((SELECT cr.tenant_id FROM public.cash_registers cr WHERE cr.id = p_cash_register_id))) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  -- 2026-09-19: sangria prevista (compra paga em dinheiro lançada pelo cupom) precisa ser confirmada antes.
  SELECT count(*) INTO v_previstas FROM public.cash_sangrias_previstas s
   WHERE s.status = 'pendente' AND s.tenant_id = (SELECT cr.tenant_id FROM public.cash_registers cr WHERE cr.id = p_cash_register_id);
  IF v_previstas > 0 THEN
    RAISE EXCEPTION 'Há % sangria(s) aguardando confirmação. Abra Sangria e confirme antes de fechar o caixa.', v_previstas USING ERRCODE = 'P0001';
  END IF;

  -- Busca dados do caixa
  SELECT opening_value
  INTO v_opening_value
  FROM cash_registers
  WHERE id = p_cash_register_id;

  -- Total recebido em dinheiro (cash) NESTE CAIXA específico
  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_total_cash_payments
  FROM payments p
  JOIN payment_methods pm ON pm.id = p.payment_method_id
  WHERE p.cash_register_id = p_cash_register_id
    AND pm.type = 'cash'
    AND NOT p.is_refunded;

  -- Total de suprimentos (depósitos) no caixa
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_deposits
  FROM cash_movements
  WHERE cash_register_id = p_cash_register_id AND type = 'in';

  -- Total de sangrias (retiradas) do caixa
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_withdrawals
  FROM cash_movements
  WHERE cash_register_id = p_cash_register_id AND type = 'out';

  -- Valor esperado = fundo inicial + recebimentos em dinheiro + suprimentos - sangrias
  v_expected := COALESCE(v_opening_value, 0) + v_total_cash_payments + v_total_deposits - v_total_withdrawals;

  -- Diferença = contado - esperado (positivo = sobra, negativo = falta)
  v_difference := p_closing_value - v_expected;

  UPDATE cash_registers
  SET
    closing_value_actual   = p_closing_value,
    closing_value_expected = v_expected,
    closing_difference     = v_difference,
    closing_notes          = p_closing_notes,
    closed_at              = now(),
    status                 = 'closed'
  WHERE id = p_cash_register_id;
END;
$function$;
-- 2026-09-19 (migração sangria_da_compra_sem_limite_dias, pelo MCP): o dono pediu sem limite de dias — já refletido acima.
