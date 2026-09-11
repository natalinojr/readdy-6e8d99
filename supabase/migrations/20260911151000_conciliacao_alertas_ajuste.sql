-- Ajuste dos alertas da conciliação (2026-09-11), depois de rodar com os dados reais:
--   • duplicidade: Pix para a mesma PESSOA com o mesmo valor é pagamento diário de freela/motoboy,
--     não erro. Só alerta o MESMO boleto (mesmo código de barras) pago duas vezes ou Pix/TED para
--     a mesma EMPRESA (CNPJ) com o mesmo valor em até 3 dias;
--   • notas vencidas: só a partir do primeiro débito do extrato. Antes disso o sistema não tem
--     como saber se a parcela foi paga (as 39 notas de julho eram desse período).

create or replace function public.fn_conciliacao_alertas(p_tenant uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
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
                          'itens', coalesce(jsonb_agg(to_jsonb(v)), '[]')) from canceladas v)
  )
$$;

revoke all on function public.fn_conciliacao_alertas(uuid) from public, anon, authenticated;
grant execute on function public.fn_conciliacao_alertas(uuid) to service_role;
