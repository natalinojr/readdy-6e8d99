-- Lançar despesa/compra a partir de um pagamento do extrato (2026-09-14).
-- 1. reference_type: 'conciliacao_extrato' (conta criada a partir do extrato) e 'conciliacao_juros'.
--    PEGADINHA corrigida: a confirmação de vínculo já criava a conta de juros/multa com
--    'conciliacao_juros', que o check recusava — o insert falhava em silêncio (só WARN no log) e os
--    juros pagos a mais nunca entravam na DRE.
-- 2. Alerta 'notas_de_compra_do_extrato': nota de entrada ainda não lançada, do mesmo CNPJ (raiz) e
--    mesmo valor de uma compra lançada pelo extrato sem nota, emitida perto do pagamento. Evita lançar
--    a mesma compra duas vezes quando a nota chega depois.

alter table public.fin_accounts_payable drop constraint if exists fin_accounts_payable_reference_type_check;
alter table public.fin_accounts_payable add constraint fin_accounts_payable_reference_type_check
  check (reference_type = any (array['purchase', 'manual', 'recurring', 'hr_payroll', 'nfe_entrada', 'conciliacao_juros', 'conciliacao_extrato']));

create or replace function public.fn_conciliacao_alertas(p_tenant uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with own as (
    select distinct regexp_replace(raw->'detalhes'->>'cpfCnpjPagador', '\D', '', 'g') as doc
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'inter' and transaction_type = 'debit'
       and coalesce(raw->'detalhes'->>'cpfCnpjPagador', '') <> ''
  ),
  inicio as (
    select min(transaction_date) as d from fin_bank_statement_imports
     where tenant_id = p_tenant and transaction_type = 'debit' and source <> 'stone'
  ),
  vencidas as (
    select b.description as label, round(b.amount - coalesce(b.paid_amount, 0), 2) as valor, b.due_date as data
      from fin_accounts_payable b
     where b.tenant_id = p_tenant and b.status in ('pending', 'overdue', 'partial')
       and b.due_date < current_date and b.amount - coalesce(b.paid_amount, 0) > 0.005
  ),
  notas_vencidas as (
    select 'NF ' || coalesce(d.numero::text, '?') || ' — ' || coalesce(d.emitente_nome, '') as label,
           (p->>'valor')::numeric as valor, left(p->>'vencimento', 10)::date as data
      from fiscal_inbound_documents d
      cross join lateral jsonb_array_elements(coalesce(d.parcelas, '[]'::jsonb)) p
     where d.tenant_id = p_tenant and d.status = 'new' and coalesce(d.sefaz_status, 1) <> 2
       and coalesce(p->>'vencimento', '') ~ '^\d{4}-\d{2}-\d{2}'
       and left(p->>'vencimento', 10)::date < current_date - 2
       and left(p->>'vencimento', 10)::date >= current_date - 60
       and left(p->>'vencimento', 10)::date >= coalesce((select d from inicio), current_date)
       and not exists (select 1 from fin_bank_statement_imports i
                        where i.tenant_id = p_tenant and i.match_detail->>'doc_id' = d.id::text)
  ),
  juros as (
    select coalesce(counterpart_name, description) as label, (match_detail->>'juros')::numeric as valor, transaction_date as data
      from fin_bank_statement_imports
     where tenant_id = p_tenant and transaction_type = 'debit'
       and coalesce((match_detail->>'juros')::numeric, 0) > 0
       and transaction_date >= date_trunc('month', current_date)::date
  ),
  sem_nota as (
    select coalesce(i.counterpart_name, i.description) as label, i.amount as valor, i.transaction_date as data
      from fin_bank_statement_imports i
     where i.tenant_id = p_tenant and i.source = 'inter' and i.transaction_type = 'debit'
       and i.status = 'pending' and i.match_kind is null and i.category is null
       and length(coalesce(i.counterpart_doc, '')) = 14
       and i.counterpart_doc not in (select doc from own)
       and i.transaction_date >= current_date - 60
       and not exists (select 1 from fiscal_inbound_documents d
                        where d.tenant_id = p_tenant
                          and left(regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g'), 8) = left(i.counterpart_doc, 8)
                          and d.emitted_at::date >= i.transaction_date - 120)
  ),
  dup as (
    select coalesce(a.counterpart_name, a.description) as label, a.amount as valor, b.transaction_date as data
      from fin_bank_statement_imports a
      join fin_bank_statement_imports b
        on b.tenant_id = a.tenant_id and b.id > a.id and b.transaction_type = 'debit'
       and b.amount = a.amount and b.status <> 'ignored'
       and abs(b.transaction_date - a.transaction_date) <= 3
       and (
         (a.raw->>'tipoTransacao' = 'PAGAMENTO' and b.raw->>'tipoTransacao' = 'PAGAMENTO'
          and coalesce(a.raw->'detalhes'->>'codBarras', '') <> ''
          and a.raw->'detalhes'->>'codBarras' = b.raw->'detalhes'->>'codBarras')
         or (length(coalesce(a.counterpart_doc, '')) = 14 and a.counterpart_doc = b.counterpart_doc)
       )
     where a.tenant_id = p_tenant and a.transaction_type = 'debit' and a.status <> 'ignored'
       and a.source = 'inter' and a.transaction_date >= current_date - 60
  ),
  canceladas as (
    select 'NF ' || coalesce(d.numero::text, '?') || ' — ' || coalesce(d.emitente_nome, '') as label, d.valor_total as valor, d.emitted_at::date as data
      from fiscal_inbound_documents d
     where d.tenant_id = p_tenant and d.status = 'imported' and d.sefaz_status = 2
  ),
  compra_extrato as (
    select 'NF ' || coalesce(d.numero::text, '?') || ' — ' || coalesce(d.emitente_nome, '') as label, d.valor_total as valor, d.emitted_at::date as data
      from fiscal_inbound_documents d
     where d.tenant_id = p_tenant and d.status = 'new' and coalesce(d.sefaz_status, 1) <> 2
       and exists (select 1 from fin_bank_statement_imports i
                    where i.tenant_id = p_tenant and i.match_detail->>'created' = 'compra'
                      and length(regexp_replace(coalesce(i.counterpart_doc, ''), '\D', '', 'g')) = 14
                      and left(regexp_replace(coalesce(i.counterpart_doc, ''), '\D', '', 'g'), 8)
                        = left(regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g'), 8)
                      and abs(i.amount - d.valor_total) <= 0.05
                      and d.emitted_at::date between i.transaction_date - 15 and i.transaction_date + 5)
  )
  select jsonb_build_object(
    'contas_vencidas', (select jsonb_build_object('count', (select count(*) from vencidas), 'total', (select coalesce(sum(valor), 0) from vencidas),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data), '[]')) from (select * from vencidas order by data limit 10) v),
    'notas_vencidas', (select jsonb_build_object('count', (select count(*) from notas_vencidas), 'total', (select coalesce(sum(valor), 0) from notas_vencidas),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data), '[]')) from (select * from notas_vencidas order by data limit 10) v),
    'juros_mes', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(valor), 0),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data), '[]')) from juros v),
    'pagamentos_sem_nota', (select jsonb_build_object('count', (select count(*) from sem_nota), 'total', (select coalesce(sum(valor), 0) from sem_nota),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data desc), '[]')) from (select * from sem_nota order by data desc limit 10) v),
    'duplicidades', (select jsonb_build_object('count', (select count(*) from dup), 'total', (select coalesce(sum(valor), 0) from dup),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data desc), '[]')) from (select * from dup order by data desc limit 10) v),
    'notas_canceladas_lancadas', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(valor), 0),
                          'itens', coalesce(jsonb_agg(to_jsonb(v)), '[]')) from canceladas v),
    'notas_de_compra_do_extrato', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(valor), 0),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data desc), '[]')) from compra_extrato v)
  )
$function$;
