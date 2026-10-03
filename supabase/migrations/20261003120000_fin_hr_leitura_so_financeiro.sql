-- Financeiro e RH: só quem é do Financeiro lê e ninguém grava direto pela API (2026-10-03).
--
-- ACHADO (estudo do "celular da loja"): as policies <tabela>_select_membership (auth_is_member_of)
-- de 09-12/09-18 — e as antigas tenant_isolation_* / *_auth_uid / *_tenant — só conferem se a
-- pessoa tem QUALQUER vínculo com a loja. Os logins genéricos da loja (Caixa, Cozinha, Tablet do
-- autoatendimento, Supervisão) liam folha, extrato, compras e contas a pagar chamando o PostgREST
-- direto (/rest/v1/hr_payroll?tenant_id=eq.<loja>). Medido em 10-03 na El Patron Paranaguá:
-- Caixa/Cozinha/Tablet1/Supervisão liam 10 linhas de folha, 315 do extrato, 156 compras e 277
-- contas. Pior: as permissivas de escrita (hr_payroll_insert_auth, fin_cash_flow_delete_authenticated,
-- fin_accounts_payable_auth_uid FOR ALL, tenant_isolation_suppliers FOR ALL…) deixavam o qa.caixa
-- alterar fornecedor (chave Pix), conta a pagar, compra e conta bancária e APAGAR o fluxo de caixa
-- (testado numa transação desfeita). As deny_direct_write_* existiam, mas PERMISSIVE com USING false
-- não nega nada (só soma).
--
-- CORREÇÃO (decidida pelo dono em 10-03): policies AS RESTRICTIVE (AND sobre todas as permissivas).
--   * Leitura, em 3 níveis:
--       - Financeiro: dinheiro e pessoas (folha, extrato, contas, compras, Pix, repasses…).
--       - iFood pedidos/produtos/lançamentos: Financeiro + quem cuida de pedido, cardápio ou
--         relatório (ações do chat "Pedido iFood", "Cancelamentos", "Tempos", "Produtos iFood",
--         vendas do iFood no Dashboard/Hoje/Relatórios).
--       - Fornecedores (CNPJ, Pix): Financeiro + quem mexe no Estoque (Estoque › Por Fornecedor).
--     Cadastros só com nomes (categorias de mercadoria, categorias/grupos da DRE, centros de custo,
--     loja do iFood) continuam legíveis pela loja: Estoque › Insumos e o chat (acesso.ts) usam com
--     o login Caixa.
--   * Escrita direta (INSERT/UPDATE/DELETE) negada para authenticated/anon em todas. Toda escrita
--     legítima já passa por Edge Function (service_role, BYPASSRLS) ou função SECURITY DEFINER do
--     postgres (BYPASSRLS). Única escrita direta do front: Trilha › ignorar/esquecer
--     (fin_trilha_ignoradas), liberada só para o Financeiro.
--   * Funções RPC de leitura do Financeiro que só conferiam "é da loja" passam a conferir "é do
--     Financeiro" (Trilha, agenda de recebíveis, repasses iFood, taxas MP, Pix/dinheiro recebidos,
--     DRE de cartões, saldo por conta, freelancers).
--   * fn_regras_auto_all (só o cron, como postgres) deixa de ser chamável pela API.
-- As permissivas antigas ficam (inofensivas sob as RESTRICTIVE); limpeza é outro passo.
-- service_role e postgres têm BYPASSRLS: Edge Functions e cron não mudam.

-- ───────────────────────── Quem é do Financeiro ─────────────────────────
-- "Ser do Financeiro" numa loja = papel admin, manager, financeiro ou accountant naquela loja (todos
-- nascem com abas fin_* em DEFAULT_PERMISSOES, src/hooks/usePermissoes.ts) OU a matriz `permissions`
-- liga alguma chave fin_* para o papel naquela loja. p_chaves amplia para quem tem uma dessas chaves
-- ligada na matriz; Supervisão tem gestao_pedidos por padrão no front (DEFAULT_PERMISSOES), então
-- conta mesmo sem linha na matriz, a não ser que o dono tenha desligado.
create or replace function public.auth_lojas_financeiro(p_chaves text[] default '{}'::text[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select ut.tenant_id
  from public.user_tenants ut
  where ut.user_id = auth.uid()
    and (
      ut.role in ('admin', 'manager', 'financeiro', 'accountant')
      or exists (
        select 1 from public.permissions p
        where p.tenant_id = ut.tenant_id
          and p.role = ut.role
          and p.allowed
          and (p.permission_key like 'fin\_%' or p.permission_key = any (p_chaves))
      )
      or (
        ut.role = 'supervisor' and 'gestao_pedidos' = any (p_chaves)
        and not exists (
          select 1 from public.permissions p
          where p.tenant_id = ut.tenant_id and p.role = ut.role
            and p.permission_key = 'gestao_pedidos' and not p.allowed
        )
      )
    )
$$;

comment on function public.auth_lojas_financeiro(text[]) is
  'Lojas em que o usuário logado é do Financeiro (admin/manager/financeiro/accountant ou chave fin_* na matriz), ampliado por p_chaves. Usada nas policies RESTRICTIVE de fin_*/hr_* (2026-10-03).';

create or replace function public.auth_pode_financeiro(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_tenant in (select public.auth_lojas_financeiro())
$$;

-- Como _assert_tenant_access, mas exige ser do Financeiro (service_role/cron e dono da plataforma passam).
create or replace function public._assert_financeiro(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('service_role', '') then return; end if;
  if auth.uid() is not null and (public.auth_pode_financeiro(p_tenant) or public.is_platform_owner(auth.uid())) then return; end if;
  raise exception 'Sem acesso ao Financeiro desta loja.' using errcode = '42501';
end
$$;

revoke all on function public.auth_lojas_financeiro(text[]) from public;
revoke all on function public.auth_pode_financeiro(uuid) from public;
revoke all on function public._assert_financeiro(uuid) from public;
grant execute on function public.auth_lojas_financeiro(text[]) to authenticated, anon, service_role;
grant execute on function public.auth_pode_financeiro(uuid) to authenticated, anon, service_role;
grant execute on function public._assert_financeiro(uuid) to authenticated, service_role;

-- ───────────────────────── Policies RESTRICTIVE ─────────────────────────
do $$
declare
  t text;
  -- Só o Financeiro lê.
  financeiro text[] := array[
    'fin_accounts_payable', 'fin_anticipations', 'fin_bank_accounts', 'fin_bank_statement_imports',
    'fin_bank_statements', 'fin_bank_transactions', 'fin_budgets', 'fin_card_forecast',
    'fin_card_providers', 'fin_cash_flow', 'fin_ifood_anticipations', 'fin_ifood_cmv_items',
    'fin_ifood_cmv_linhas', 'fin_ifood_events', 'fin_ifood_ondemand', 'fin_ifood_settlements',
    'fin_implementation_columns', 'fin_implementation_costs', 'fin_income_routing',
    'fin_investment_settings', 'fin_item_classifications', 'fin_pix_payments', 'fin_purchase_catalog',
    'fin_purchase_items', 'fin_purchases', 'fin_receivable_installments', 'fin_reconciliation_rules',
    'fin_revenue_settings', 'fin_stone_imports', 'fin_trilha_ignoradas',
    'hr_beneficios', 'hr_employees', 'hr_freelancer_shifts', 'hr_freelancers', 'hr_payroll',
    'hr_payroll_custom_fields', 'hr_prestador_pagamentos', 'hr_prestadores'];
  -- Financeiro + quem cuida de pedido/cardápio/relatório (src/components/feature/assistente/acoes/acesso.ts).
  ifood text[] := array['fin_ifood_sales', 'fin_ifood_menu_sales', 'fin_ifood_entries', 'fin_ifood_imports'];
  chaves_ifood text := quote_literal(array['gestao_pedidos', 'gestao_delivery', 'gestao_dashboard', 'cardapio_editar',
    'relatorio_financeiro', 'rel_geral', 'rel_ifood', 'rel_calendario', 'rel_origem']::text) || '::text[]';
  -- Financeiro + quem mexe no Estoque (Estoque › Por Fornecedor).
  fornecedores text[] := array['fin_suppliers'];
  -- Cadastros só com nomes: leitura continua pela loja; só a escrita fecha.
  cadastros text[] := array['fin_merchandise_categories', 'fin_dre_categories', 'fin_dre_groups',
    'fin_cost_centers', 'fin_ifood_merchants'];
  -- Sem tenant_id: a leitura já passa pela policy de fin_budgets (restrita acima); só a escrita fecha.
  sem_tenant text[] := array['fin_budget_items'];
begin
  foreach t in array financeiro loop
    execute format('drop policy if exists %I on public.%I', 'restrito_ler_' || t, t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated, anon using (tenant_id in (select public.auth_lojas_financeiro()))', 'restrito_ler_' || t, t);
  end loop;
  foreach t in array ifood loop
    execute format('drop policy if exists %I on public.%I', 'restrito_ler_' || t, t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated, anon using (tenant_id in (select public.auth_lojas_financeiro(%s)))', 'restrito_ler_' || t, t, chaves_ifood);
  end loop;
  foreach t in array fornecedores loop
    execute format('drop policy if exists %I on public.%I', 'restrito_ler_' || t, t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated, anon using (tenant_id in (select public.auth_lojas_financeiro(array[''estoque_movimentar''])))', 'restrito_ler_' || t, t);
  end loop;

  foreach t in array financeiro || ifood || fornecedores || cadastros || sem_tenant loop
    execute format('drop policy if exists %I on public.%I', 'restrito_inserir_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'restrito_alterar_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'restrito_apagar_' || t, t);
    if t = 'fin_trilha_ignoradas' then
      -- Trilha › ignorar/esquecer grava direto do front (TrilhaTab.tsx): só o Financeiro.
      execute format('create policy %I on public.%I as restrictive for insert to authenticated, anon with check (tenant_id in (select public.auth_lojas_financeiro()))', 'restrito_inserir_' || t, t);
      execute format('create policy %I on public.%I as restrictive for delete to authenticated, anon using (tenant_id in (select public.auth_lojas_financeiro()))', 'restrito_apagar_' || t, t);
    else
      execute format('create policy %I on public.%I as restrictive for insert to authenticated, anon with check (false)', 'restrito_inserir_' || t, t);
      execute format('create policy %I on public.%I as restrictive for delete to authenticated, anon using (false)', 'restrito_apagar_' || t, t);
    end if;
    execute format('create policy %I on public.%I as restrictive for update to authenticated, anon using (false) with check (false)', 'restrito_alterar_' || t, t);
  end loop;
end $$;

-- ───────────────────────── RPCs de leitura do Financeiro ─────────────────────────
-- Corpo idêntico ao que estava no banco (pg_get_functiondef em 10-03); só a linha da checagem muda.
-- fin_trilha_dados: única mudança = a checagem de acesso (era auth_is_member_of / _assert_tenant_access).
CREATE OR REPLACE FUNCTION public.fin_trilha_dados(p_tenant uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_de date := p_start - 60;
  v_ate date := p_end + 60;
  v_compras uuid[];
  v_contas uuid[];
  v_notas uuid[];
  v_extrato uuid[];
  v_pedidos uuid[];
begin
  if not public.auth_pode_financeiro(p_tenant) then
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
        'itens_estoque', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and i.ingredient_id is not null),
        'itens_sem_entrar', (select count(*) from public.fn_item_memo_links(p.tenant_id, p.id) m
                               join fin_purchase_items i on i.id = m.purchase_item_id
                              where i.stock_skipped_at is null)
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
        'id', b.id, 'bank_account_id', b.bank_account_id, 'transaction_date', b.transaction_date, 'amount', abs(b.amount),
        'description', b.description, 'counterpart_name', b.counterpart_name,
        'status', b.status, 'match_kind', b.match_kind, 'reconciled', coalesce(b.reconciled, false),
        'bill_id', coalesce((b.match_detail->'confirmed'->>'bill_id')::uuid, case when b.match_kind = 'payable' then b.match_ref_id end),
        'juros_bill_id', (b.match_detail->'confirmed'->>'juros_bill_id')::uuid,
        'purchase_id', (b.match_detail->'confirmed'->>'purchase_id')::uuid,
        'source', b.source,
        'match_confidence', b.match_confidence,
        'match_ref_id', b.match_ref_id,
        'sugestao', case
          when b.status <> 'pending' or coalesce(b.reconciled, false) or coalesce(b.match_detail ? 'confirmed', false) then null
          when b.match_kind = 'payable' then
            'Parece a conta a pagar ' || coalesce(nullif(b.match_detail->>'nome', ''), nullif(b.match_detail->>'label', ''), 'em aberto')
            || coalesce(' de ' || public.fn_trilha_brl((b.match_detail->>'valor')::numeric), '')
            || coalesce(' (vence ' || to_char((b.match_detail->>'vencimento')::date, 'DD/MM') || ')', '')
          when b.match_kind = 'inbound_doc' then
            'Parece a nota nº ' || coalesce(nd.numero::text, '?') || ' de ' || coalesce(nd.emitente_nome, b.match_detail->>'nome', '?')
            || coalesce(' (' || public.fn_trilha_brl(coalesce((b.match_detail->>'valor')::numeric, nd.valor_total)) || ')', '')
          when b.match_kind = 'rule' then
            'Regra de lançamento: ' || coalesce(nullif(rr.counterpart_label, ''), nullif(b.match_detail->>'categoria', ''), 'despesa')
            || case when nullif(rr.counterpart_label, '') is not null and nullif(b.match_detail->>'categoria', '') is not null
                    then ' → ' || (b.match_detail->>'categoria') else '' end
          else null
        end
      ))
      from fin_bank_statement_imports b
      left join fiscal_inbound_documents nd
        on b.match_kind = 'inbound_doc' and nd.tenant_id = b.tenant_id
       and nd.id = case when coalesce(b.match_detail->>'doc_id', '') ~ '^[0-9a-fA-F-]{36}$' then (b.match_detail->>'doc_id')::uuid end
      left join fin_reconciliation_rules rr
        on b.match_kind = 'rule' and rr.tenant_id = b.tenant_id and rr.id = b.match_ref_id
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
$function$;

-- fin_agenda_recebiveis: única mudança = a checagem de acesso (era auth_is_member_of / _assert_tenant_access).
CREATE OR REPLACE FUNCTION public.fin_agenda_recebiveis(p_tenant uuid, p_from date, p_to date)
 RETURNS TABLE(data date, origem text, valor numeric, qtd integer, descricao text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_antecipa boolean;
begin
  if not public.auth_pode_financeiro(p_tenant) then return; end if;

  -- Loja com antecipação automática (maioria das parcelas pagas nos últimos 30 dias com taxa de
  -- antecipação): a Stone paga no dia útil seguinte à venda, não na data prevista original.
  select coalesce(avg(case when coalesce((i.stone_installment_info->>'advance_fee')::numeric, 0) > 0 then 1 else 0 end), 0) > 0.5
    into v_antecipa
  from fin_bank_statement_imports i
  where i.tenant_id = p_tenant and i.source = 'stone' and i.raw->>'kind' = 'installment'
    and i.transaction_date >= current_date - 30;

  return query
  with stone as (
    select case when v_antecipa
             then least(f.prevision_date,
                        f.capture_date + case extract(isodow from f.capture_date)::int when 5 then 3 when 6 then 2 else 1 end)
             else f.prevision_date end as d,
           f.net
    from fin_card_forecast f
    where f.tenant_id = p_tenant and f.provider = 'stone' and f.cancelled_at is null
      and f.capture_date >= current_date - 400
      and not exists (
        select 1 from fin_bank_statement_imports i
        where i.tenant_id = f.tenant_id and i.source = 'stone' and i.external_id like f.external_key || '\_%'
      )
  )
  select s.d, 'stone'::text, round(sum(s.net), 2), count(*)::int, 'Cartão Stone a receber'::text
  from stone s where s.d between p_from and p_to group by s.d
  union all
  select r.data_repasse, 'ifood'::text, r.esperado, greatest(r.depositos, 1), 'Repasse iFood previsto'::text
  from public.fin_ifood_repasses(p_tenant, p_from, p_to) r
  where r.esperado > 0 and r.recebido_inter = 0;
end;
$function$;

-- fin_dinheiro_recebidos: única mudança = a checagem de acesso (era auth_is_member_of / _assert_tenant_access).
CREATE OR REPLACE FUNCTION public.fin_dinheiro_recebidos(p_tenant uuid, p_start date, p_end date)
 RETURNS TABLE(id uuid, date date, amount numeric, description text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cf.id, cf.date, cf.amount, cf.description, cf.created_at
  from public.fin_cash_flow cf
  join public.payments pay on pay.id = cf.reference_id
  join public.payment_methods pm on pm.id = pay.payment_method_id
  where public.auth_pode_financeiro(p_tenant)
    and cf.tenant_id = p_tenant
    and pay.tenant_id = p_tenant
    and cf.type = 'income'
    and cf.origin = 'auto_sale'
    and pm.type = 'cash'
    and cf.date between p_start and p_end
  order by cf.date desc
  limit 5000
$function$;

-- fin_ifood_repasses: única mudança = a checagem de acesso (era auth_is_member_of / _assert_tenant_access).
CREATE OR REPLACE FUNCTION public.fin_ifood_repasses(p_tenant uuid, p_from date, p_to date)
 RETURNS TABLE(data_repasse date, esperado numeric, depositos integer, recebido_inter numeric, linhas_inter integer, detalhe jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with acc as (
    select ifood_deposit_account_id as id from public.fn_money_flow(p_tenant)
  ), lin as (
    select e.data_repasse as d, e.merchant_id, e.valor, e.valor_transacao, e.metodo_pagamento, e.impacto_repasse
    from public.fin_ifood_entries e
    where public.auth_pode_financeiro(p_tenant) and e.tenant_id = p_tenant
      and e.data_repasse between p_from and p_to
  ), porloja as (
    select lin.d, lin.merchant_id, sum(lin.valor) filter (where lin.impacto_repasse) as bruto
    from lin group by 1, 2
  ), ant as (
    select p.d, p.merchant_id, coalesce(p.bruto, 0) as bruto,
           case when coalesce(m.anticipation_pct, 0) > 0 then round(coalesce(p.bruto, 0) * m.anticipation_pct / 100, 2) else 0 end as taxa
    from porloja p
    left join public.fin_ifood_merchants m on m.tenant_id = p_tenant and m.merchant_id = p.merchant_id
  ), d as (
    select ant.d, sum(ant.bruto) as bruto, sum(ant.taxa) as taxa from ant group by ant.d
  ), dep as (
    select lin.d, lin.valor_transacao as v, max(lin.metodo_pagamento) as m
    from lin where lin.valor_transacao is not null group by 1, 2
  ), depagg as (
    select dep.d, count(*) as n, jsonb_agg(jsonb_build_object('valor', dep.v, 'metodo', dep.m) order by dep.v) as deps
    from dep group by dep.d
  ), inter as (
    select d.d, sum(i.amount) as tot, count(*) as n,
           jsonb_agg(jsonb_build_object('data', i.transaction_date, 'valor', i.amount, 'descricao', i.description) order by i.transaction_date, i.amount) as lin
    from d
    join acc on acc.id is not null
    join public.fin_bank_statement_imports i
      on i.tenant_id = p_tenant and i.bank_account_id = acc.id and i.source <> 'stone'
     and i.transaction_type = 'credit'
     and i.transaction_date between d.d and d.d + 1
     and (coalesce(i.description, '') || ' ' || coalesce(i.counterpart_name, '')) ilike '%ifood%'
    group by d.d
  )
  select d.d, round(coalesce(d.bruto, 0) - coalesce(d.taxa, 0), 2), coalesce(depagg.n, 0)::int, coalesce(inter.tot, 0), coalesce(inter.n, 0)::int,
         jsonb_build_object('ifood', coalesce(depagg.deps, '[]'::jsonb), 'inter', coalesce(inter.lin, '[]'::jsonb),
                            'bruto', round(coalesce(d.bruto, 0), 2), 'antecipacao', coalesce(d.taxa, 0),
                            'sem_conta', (select acc.id is null from acc))
  from d left join depagg on depagg.d = d.d left join inter on inter.d = d.d
  where coalesce(d.bruto, 0) <> 0
  order by d.d
$function$;

-- fin_mp_taxas: única mudança = a checagem de acesso (era auth_is_member_of / _assert_tenant_access).
CREATE OR REPLACE FUNCTION public.fin_mp_taxas(p_tenant uuid, p_from date, p_to date)
 RETURNS TABLE(produto text, bandeira text, vendas integer, bruto numeric, taxa numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with v as (
    select
      case
        when i.raw->>'payment_type' = 'debit_card' then 'debito'
        when i.raw->>'payment_type' = 'credit_card' and coalesce((i.raw->>'installments')::int, 1) <= 1 then 'credito_vista'
        when i.raw->>'payment_type' = 'credit_card' and (i.raw->>'installments')::int <= 6 then 'credito_2_6'
        when i.raw->>'payment_type' = 'credit_card' then 'credito_7_12'
        when i.raw->>'payment_type' = 'prepaid_card' then 'pre_pago'
        when i.raw->>'payment_type' = 'bank_transfer' or i.raw->>'brand' = 'pix' then 'pix'
        else 'outro'
      end as produto,
      case
        when i.raw->>'brand' = 'pix' then ''
        else regexp_replace(lower(coalesce(i.raw->>'brand', '')), '^deb', '')
      end as bandeira,
      coalesce((i.raw->>'gross')::numeric, 0) as bruto,
      coalesce((i.raw->>'fee')::numeric, 0) as taxa
    from public.fin_bank_statement_imports i
    where public.auth_pode_financeiro(p_tenant)
      and i.tenant_id = p_tenant
      and i.source = 'mercadopago'
      and i.raw->>'kind' = 'release'
      and coalesce((i.raw->>'marketplace')::boolean, false) = false
      and coalesce(i.raw->>'status', 'approved') = 'approved'
      and coalesce(nullif(i.raw->>'approved_date', '')::date, i.transaction_date) between p_from and p_to
  )
  select v.produto, v.bandeira, count(*)::int, round(sum(v.bruto), 2), round(sum(v.taxa), 2)
  from v
  group by v.produto, v.bandeira
  order by v.produto, sum(v.bruto) desc
$function$;

-- fin_pix_recebidos: única mudança = a checagem de acesso (era auth_is_member_of / _assert_tenant_access).
CREATE OR REPLACE FUNCTION public.fin_pix_recebidos(p_tenant uuid, p_start date, p_end date)
 RETURNS TABLE(id uuid, transaction_date date, amount numeric, description text, counterpart_name text, match_kind text, created_at timestamp with time zone, category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.id, i.transaction_date, i.amount, i.description, i.counterpart_name, i.match_kind, i.created_at, i.category
  from public.fin_bank_statement_imports i
  cross join public.fn_money_flow(p_tenant) f
  where public.auth_pode_financeiro(p_tenant)
    and i.tenant_id = p_tenant
    and f.bank_account_id is not null
    and i.bank_account_id = f.bank_account_id
    and i.source <> 'stone'
    and i.transaction_type = 'credit'
    and (i.raw->>'tipoTransacao' = 'PIX'
         or (coalesce(i.raw->>'tipoTransacao', '') = '' and coalesce(i.description, '') ilike '%pix%'))
    and coalesce(i.match_kind, '') not in ('ifood_deposit', 'stone_deposit', 'card_deposit')
    and (coalesce(i.match_kind, '') <> 'internal_transfer' or f.card_pix_mode = 'transfer')
    and coalesce(i.category, '') not in ('Aporte de sócio', 'Estorno / devolução de fornecedor')
    and i.transaction_date between p_start and p_end
  order by i.transaction_date desc
  limit 5000
$function$;

-- fn_dre_competencia_cartoes: única mudança = a checagem de acesso (era auth_is_member_of / _assert_tenant_access).
CREATE OR REPLACE FUNCTION public.fn_dre_competencia_cartoes(p_tenant uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_stone_bruto numeric := 0;
  v_stone_mdr numeric := 0;
  v_stone_ativo boolean;
  v_ifood_receita numeric := 0;
  v_ifood_custo numeric := 0;
begin
  if not public.auth_pode_financeiro(p_tenant) then
    raise exception 'Sem acesso a esta loja' using errcode = '42501';
  end if;

  select exists (select 1 from fin_cash_flow where tenant_id = p_tenant and origin = 'stone_sale') into v_stone_ativo;
  if v_stone_ativo then
    select coalesce(sum(coalesce((raw->>'gross')::numeric, amount)), 0),
           coalesce(sum(coalesce((raw->>'gross')::numeric, amount) - coalesce((raw->>'net')::numeric, amount)
                        - coalesce((raw->>'advance_fee')::numeric, 0)), 0)
      into v_stone_bruto, v_stone_mdr
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'stone' and status <> 'ignored'
       -- cancelamento/chargeback abate a venda (reapresentação devolve) (raw.gross/raw.net negativos, capture_date = data da venda original)
       and ((raw->>'kind' = 'installment' and transaction_type = 'credit') or raw->>'kind' in ('cancellation', 'chargeback', 'chargeback_refund'))
       and (raw->>'capture_date') between p_from::text and p_to::text
       and transaction_date >= p_from;
  end if;

  with e as (
    select lower(coalesce(tipo_lancamento, '')) as t, lower(coalesce(descricao, '')) as d,
           valor as v, impacto_repasse as imp
      from fin_ifood_entries
     where tenant_id = p_tenant
       and (
         (order_created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
          and order_created_at < ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo'))
         or (order_created_at is null and data_apuracao_fim between p_from and p_to)
       )
  ),
  b as (
    select
      case when t like '%entrada%' then v
           when t like '%subs%' then case when d like '%custeada pela loja%' then -v else v end
           when t like '%reten%' then v
           else 0 end as vendas,
      case when t like '%entrada%' and not imp then v else 0 end as loja,
      case when t not like '%entrada%' and t not like '%subs%' and t not like '%reten%' and t like '%cobran%'
                and d ~ '(comiss|transa|mensalidade)' then -v else 0 end as taxas,
      case when t not like '%entrada%' and t like '%subs%' and d like '%custeada pela loja%' then -v
           when t not like '%entrada%' and t not like '%subs%' and t not like '%reten%' and t like '%cobran%'
                and d !~ '(comiss|transa|mensalidade)' then -v
           else 0 end as servicos,
      case when t not like '%entrada%' and t not like '%subs%' and t not like '%reten%' and t not like '%cobran%' then v else 0 end as ajustes
      from e
  )
  select coalesce(sum(vendas - loja), 0), coalesce(sum(taxas + servicos - ajustes), 0)
    into v_ifood_receita, v_ifood_custo
    from b;

  return jsonb_build_object(
    'stone_bruto', round(v_stone_bruto, 2), 'stone_mdr', round(v_stone_mdr, 2),
    'ifood_receita', round(v_ifood_receita, 2), 'ifood_custo', round(v_ifood_custo, 2)
  );
end;
$function$;

-- fn_bank_balance_breakdown: única mudança = a checagem de acesso (era auth_is_member_of / _assert_tenant_access).
CREATE OR REPLACE FUNCTION public.fn_bank_balance_breakdown(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v jsonb;
begin
  select tenant_id into v_tenant from fin_bank_accounts where id = p_account;
  if v_tenant is null then return null; end if;
  perform public._assert_financeiro(v_tenant);
  v := public._fn_bank_position(p_account);
  if v is null then return null; end if;
  return v || jsonb_build_object('erp_sem_extrato_itens', coalesce((
    select jsonb_agg(jsonb_build_object('data', t.transaction_date, 'descricao', t.description, 'tipo', t.type, 'valor', t.amount) order by t.transaction_date desc)
      from (select t.* from fin_bank_transactions t
             where t.bank_account_id = p_account
               and coalesce(t.reference_type, '') <> 'sale'
               and (t.reference_id is null or not (t.reference_id = any(coalesce((
                 select array_agg(distinct x) from (
                   select match_ref_id as x from fin_bank_statement_imports
                    where bank_account_id = p_account and match_ref_id is not null
                      and (status = 'ignored' or coalesce(reconciled, false) or status in ('matched', 'manual'))
                   union all
                   select (m[1])::uuid from fin_bank_statement_imports s,
                          regexp_matches(s.match_detail::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m
                    where s.bank_account_id = p_account and s.match_detail is not null
                      and (s.status = 'ignored' or coalesce(s.reconciled, false) or s.status in ('matched', 'manual'))) q), '{}'))))
               and not exists (select 1 from fin_bank_statement_imports s where s.matched_transaction_id = t.id)
             order by t.transaction_date desc limit 50) t), '[]'::jsonb));
end $function$;

-- _fn_freelancer_pode: única mudança = a checagem de acesso (era auth_is_member_of / _assert_tenant_access).
CREATE OR REPLACE FUNCTION public._fn_freelancer_pode(p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(auth.role(), '') in ('service_role', '') or (auth.uid() is not null and public.auth_pode_financeiro(p_tenant))
$function$;

-- ───────────────────────── Cron fora da API ─────────────────────────
-- Roda só pelo pg_cron (job regras-auto, usuário postgres). Qualquer login conseguia disparar a
-- rodada das regras automáticas de todas as lojas por /rest/v1/rpc/fn_regras_auto_all.
revoke execute on function public.fn_regras_auto_all() from public, anon, authenticated;
