-- Trilha das despesas (2026-09-29): Financeiro › Trilha.
-- O dono precisava abrir 6 abas para saber se uma despesa estava certa (a nota virou compra?
-- a compra virou conta? a conta foi paga? o pagamento apareceu no extrato? entrou no estoque?).
-- Esta função devolve, numa chamada só, as peças da corrente de um período; quem monta a trilha
-- de cada caso é o front (src/lib/trilhaDespesas.ts, com teste).
--
-- Por que RPC e não select direto: fin_bank_statement_imports não tem GRANT para authenticated
-- (de propósito), e leitura direta quebra para admin de várias lojas (auth_tenant_id = última
-- membership). security definer + auth_is_member_of(p_tenant), igual a fin_pix_recebidos.
--
-- Janela: pega tudo de p_start−60d até p_end+60d e fecha UM nível de vínculo (compra da conta,
-- contas da compra, nota da compra, extrato da conta), para a corrente não chegar quebrada na
-- borda do período. O front filtra os casos pela data do caso.
create or replace function public.fin_trilha_dados(p_tenant uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_de date := p_start - 60;
  v_ate date := p_end + 60;
  v_compras uuid[];
  v_contas uuid[];
  v_notas uuid[];
  v_extrato uuid[];
  v_pedidos uuid[];
begin
  if not public.auth_is_member_of(p_tenant) then
    raise exception 'sem acesso a esta loja' using errcode = '42501';
  end if;

  -- 1) base pela janela
  select coalesce(array_agg(id), '{}') into v_compras from fin_purchases
   where tenant_id = p_tenant and purchase_date between v_de and v_ate;
  select coalesce(array_agg(id), '{}') into v_contas from fin_accounts_payable
   where tenant_id = p_tenant and coalesce(status, '') <> 'cancelled'
     and (due_date between v_de and v_ate or paid_date between v_de and v_ate
          or (created_at at time zone 'America/Sao_Paulo')::date between v_de and v_ate);
  select coalesce(array_agg(id), '{}') into v_notas from fiscal_inbound_documents
   where tenant_id = p_tenant and (emitted_at at time zone 'America/Sao_Paulo')::date between v_de and v_ate;
  select coalesce(array_agg(id), '{}') into v_extrato from fin_bank_statement_imports
   where tenant_id = p_tenant and transaction_type = 'debit' and transaction_date between v_de and v_ate;
  select coalesce(array_agg(id), '{}') into v_pedidos from fin_payment_requests
   where tenant_id = p_tenant and (created_at at time zone 'America/Sao_Paulo')::date between v_de and v_ate;

  -- 2) um nível de vínculo para fora da janela
  v_compras := v_compras
    || coalesce((select array_agg(distinct reference_id) from fin_accounts_payable
                 where id = any(v_contas) and reference_type = 'purchase' and reference_id is not null), '{}')
    || coalesce((select array_agg(distinct purchase_id) from fiscal_inbound_documents
                 where id = any(v_notas) and purchase_id is not null), '{}')
    || coalesce((select array_agg(distinct purchase_id) from fin_payment_requests
                 where id = any(v_pedidos) and purchase_id is not null), '{}')
    || coalesce((select array_agg(distinct (match_detail->'confirmed'->>'purchase_id')::uuid) from fin_bank_statement_imports
                 where id = any(v_extrato) and match_detail->'confirmed'->>'purchase_id' is not null), '{}');
  v_contas := v_contas
    || coalesce((select array_agg(id) from fin_accounts_payable
                 where tenant_id = p_tenant and coalesce(status, '') <> 'cancelled'
                   and reference_type = 'purchase' and reference_id = any(v_compras)), '{}')
    || coalesce((select array_agg(distinct x) from fiscal_inbound_documents d, unnest(d.payable_ids) x
                 where d.id = any(v_notas)), '{}')
    || coalesce((select array_agg(distinct bill_id) from fin_payment_requests
                 where id = any(v_pedidos) and bill_id is not null), '{}')
    || coalesce((select array_agg(distinct coalesce((match_detail->'confirmed'->>'bill_id')::uuid, case when match_kind = 'payable' then match_ref_id end))
                 from fin_bank_statement_imports
                 where id = any(v_extrato)
                   and coalesce((match_detail->'confirmed'->>'bill_id')::uuid, case when match_kind = 'payable' then match_ref_id end) is not null), '{}');
  v_pedidos := v_pedidos
    || coalesce((select array_agg(distinct reference_id) from fin_accounts_payable
                 where id = any(v_contas) and reference_type = 'pedido_pagamento' and reference_id is not null), '{}');
  v_notas := v_notas
    || coalesce((select array_agg(distinct reference_id) from fin_accounts_payable
                 where id = any(v_contas) and reference_type = 'nfe_entrada' and reference_id is not null), '{}')
    || coalesce((select array_agg(id) from fiscal_inbound_documents
                 where tenant_id = p_tenant and purchase_id = any(v_compras)), '{}');
  v_extrato := v_extrato
    || coalesce((select array_agg(id) from fin_bank_statement_imports
                 where tenant_id = p_tenant and transaction_type = 'debit'
                   and (match_ref_id = any(v_contas)
                        or (match_detail->'confirmed'->>'bill_id')::uuid = any(v_contas))), '{}');

  return jsonb_build_object(
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'supplier', p.supplier, 'invoice_number', p.invoice_number,
        'total_amount', p.total_amount, 'payment_method', p.payment_method,
        'payment_status', p.payment_status, 'purchase_date', p.purchase_date,
        'delivery_confirmed_at', p.delivery_confirmed_at, 'stock_applied_at', p.stock_applied_at,
        'is_bonus', coalesce(p.is_bonus, false), 'created_at', p.created_at,
        'itens', (select count(*) from fin_purchase_items i where i.purchase_id = p.id),
        'itens_estoque', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and i.ingredient_id is not null)
      ))
      from fin_purchases p
      where p.tenant_id = p_tenant and p.id = any(v_compras)), '[]'::jsonb),
    'contas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'description', a.description, 'supplier', a.supplier, 'category', a.category,
        'dre_category_id', a.dre_category_id, 'amount', a.amount, 'paid_amount', a.paid_amount,
        'due_date', a.due_date, 'paid_date', a.paid_date, 'status', a.status,
        'installments', a.installments, 'installment_number', a.installment_number,
        'parent_id', a.parent_id, 'reference_id', a.reference_id, 'reference_type', a.reference_type,
        'payment_method', a.payment_method, 'competence_month', a.competence_month, 'created_at', a.created_at
      ))
      from fin_accounts_payable a
      where a.tenant_id = p_tenant and a.id = any(v_contas) and coalesce(a.status, '') <> 'cancelled'), '[]'::jsonb),
    'notas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'numero', d.numero, 'serie', d.serie, 'modelo', d.modelo,
        'emitente_nome', d.emitente_nome, 'valor_total', d.valor_total, 'emitted_at', d.emitted_at,
        'status', d.status, 'import_type', d.import_type, 'purchase_id', d.purchase_id,
        'payable_ids', coalesce(to_jsonb(d.payable_ids), '[]'::jsonb), 'auto_imported', coalesce(d.auto_imported, false)
      ))
      from fiscal_inbound_documents d
      where d.tenant_id = p_tenant and d.id = any(v_notas)), '[]'::jsonb),
    'extrato', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'transaction_date', b.transaction_date, 'amount', abs(b.amount),
        'description', b.description, 'counterpart_name', b.counterpart_name,
        'status', b.status, 'match_kind', b.match_kind, 'reconciled', coalesce(b.reconciled, false),
        'bill_id', coalesce((b.match_detail->'confirmed'->>'bill_id')::uuid, case when b.match_kind = 'payable' then b.match_ref_id end),
        'juros_bill_id', (b.match_detail->'confirmed'->>'juros_bill_id')::uuid,
        'purchase_id', (b.match_detail->'confirmed'->>'purchase_id')::uuid,
        'source', b.source
      ))
      from fin_bank_statement_imports b
      where b.tenant_id = p_tenant and b.id = any(v_extrato)), '[]'::jsonb),
    'caixa', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'date', c.date, 'amount', c.amount, 'reference_id', c.reference_id))
      from fin_cash_flow c
      where c.tenant_id = p_tenant and c.origin = 'auto_purchase' and c.reference_id = any(v_compras)), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'tipo', r.tipo, 'status', r.status, 'descricao', r.descricao, 'valor', r.valor,
        'favorecido_nome', r.favorecido_nome, 'purchase_id', r.purchase_id, 'bill_id', r.bill_id,
        'data_gasto', r.data_gasto, 'created_at', r.created_at, 'solicitado_por_nome', r.solicitado_por_nome
      ))
      from fin_payment_requests r
      where r.tenant_id = p_tenant and r.id = any(v_pedidos)), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.fin_trilha_dados(uuid, date, date) from public, anon;
grant execute on function public.fin_trilha_dados(uuid, date, date) to authenticated, service_role;
