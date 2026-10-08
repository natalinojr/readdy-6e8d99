-- Tela Financeiro › Contas (2026-10-08): uma chamada só com tudo que a tela precisa.
-- As regras de estado (Nota / Chegou / Pago, situação, grupos) ficam no front, puras e testadas
-- (src/lib/contasPainel.ts). Aqui só os FATOS de cada conta, sempre da mesma fonte das outras telas:
-- as contas em aberto vêm de fn_contas_em_aberto (regra única desde 2026-10-07).
create or replace function public.fn_contas_painel(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_inicio date;
  v_out jsonb;
begin
  if p_tenant is null then return null; end if;
  if auth.uid() is not null and p_tenant not in (select public.auth_lojas_financeiro()) then
    raise exception 'sem acesso ao financeiro desta loja' using errcode = '42501';
  end if;

  select coalesce(financeiro_inicio, date '2000-01-01') into v_inicio
    from fin_revenue_settings where tenant_id = p_tenant;
  v_inicio := coalesce(v_inicio, date '2000-01-01');

  with
  ab as (
    select c.*, a.installment_number as parcela, a.installments as parcelas, a.payment_method as forma_conta,
           a.boleto_origem, a.created_at as criada_em, dc.todo_mes as fixa,
           pu.id as compra_id, pu.invoice_number, pu.purchase_date, pu.payment_method as forma_compra,
           coalesce(pu.delivery_confirmed_at, pu.stock_applied_at) as chegou_em,
           case when pu.id is not null then public.fn_compra_espera_chegar(pu.id) else false end as espera_chegar,
           f.numero as nf_numero, (f.emitted_at at time zone 'America/Sao_Paulo')::date as nf_emitida, f.modelo as nf_modelo
      from public.fn_contas_em_aberto(array[p_tenant]) c
      join fin_accounts_payable a on a.id = c.id
      left join fin_dre_categories dc on dc.id = a.dre_category_id
      left join fin_purchases pu on c.origem = 'purchase' and pu.id = c.reference_id
      left join lateral (
        select fd.numero, fd.emitted_at, fd.modelo from fiscal_inbound_documents fd
         where fd.tenant_id = p_tenant
           and ((pu.id is not null and fd.purchase_id = pu.id) or a.id = any (fd.payable_ids))
         order by fd.emitted_at desc limit 1) f on true
  ),
  pg as (
    select a.id, coalesce(nullif(trim(a.supplier), ''), a.description, 'Conta') as nome, a.description as descricao,
           coalesce(a.paid_amount, a.amount) as valor, a.paid_date as pago_em, a.payment_method as forma,
           a.reference_type as origem, dc.todo_mes as fixa,
           pu.invoice_number, coalesce(pu.delivery_confirmed_at, pu.stock_applied_at) as chegou_em,
           f.numero as nf_numero,
           exists (select 1 from fin_bank_statement_imports s
                    where s.tenant_id = p_tenant and s.status in ('matched', 'reconciled')
                      and (s.match_ref_id = a.id or s.match_detail -> 'confirmed' -> 'bill_ids' ? a.id::text)) as banco
      from fin_accounts_payable a
      left join fin_dre_categories dc on dc.id = a.dre_category_id
      left join fin_purchases pu on a.reference_type = 'purchase' and pu.id = a.reference_id
      left join lateral (
        select fd.numero from fiscal_inbound_documents fd
         where fd.tenant_id = p_tenant and ((pu.id is not null and fd.purchase_id = pu.id) or a.id = any (fd.payable_ids))
         limit 1) f on true
     where a.tenant_id = p_tenant and a.status = 'paid'
       and a.paid_date >= v_hoje - 35
       and coalesce(a.reference_type, '') <> 'conciliacao_juros'
  ),
  notas as (
    select fd.id, fd.emitente_nome as nome, fd.numero, fd.emitted_at, fd.valor_total,
           (p.value ->> 'valor')::numeric as valor, (p.value ->> 'vencimento')::date as vencimento,
           p.ordinality as parcela, jsonb_array_length(fd.parcelas) as parcelas
      from fiscal_inbound_documents fd
      cross join lateral jsonb_array_elements(fd.parcelas) with ordinality p
     where fd.tenant_id = p_tenant and fd.status = 'new'
       and coalesce(fd.sefaz_status, 1) <> 2
       and fd.emitted_at::date >= v_inicio
       and jsonb_typeof(fd.parcelas) = 'array' and jsonb_array_length(fd.parcelas) > 0
       and nullif(p.value ->> 'vencimento', '') is not null
  ),
  extrato as (
    select s.id, s.transaction_date::date as data, s.amount as valor, s.description as descricao,
           s.source, s.transaction_type as tipo, s.bank_account_id
      from fin_bank_statement_imports s
     where s.tenant_id = p_tenant and s.status = 'pending'
       and s.transaction_date::date >= v_inicio
       and s.source is distinct from 'stone'   -- linhas 'stone' são o arquivo de vendas da maquininha, não o banco
       and coalesce(s.category, '') not in ('Transferência entre contas')
  ),
  -- vendas por dia (data da venda), últimos ~200 dias:
  -- pdv = o que foi registrado no caixa (todas as formas); adq = cartão das maquininhas (data da venda)
  pdv as (
    select (p.created_at at time zone 'America/Sao_Paulo')::date as d,
           sum(p.amount - coalesce(p.change_amount, 0)) as total,
           sum(p.amount) filter (where pm.type::text in ('credit_card', 'debit_card')) as cartao
      from payments p
      left join payment_methods pm on pm.id = p.payment_method_id
      left join orders o on o.id = p.order_id
     where p.tenant_id = p_tenant and not coalesce(p.is_refunded, false)
       and o.ifood_order_id is null   -- iFood entra pelo repasse exato (fin_ifood_entries), não pela média
       and p.created_at >= (v_hoje - 200)::timestamp
     group by 1
  ),
  adq as (
    select d, sum(bruto) as cartao, sum(bruto - liquido) as taxa from (
      select (s.stone_installment_info ->> 'capture_date')::date as d,
             (s.stone_installment_info ->> 'gross_amount')::numeric * greatest(1, coalesce((s.stone_installment_info ->> 'total_installments')::int, 1)) as bruto,
             (s.stone_installment_info ->> 'net_amount')::numeric * greatest(1, coalesce((s.stone_installment_info ->> 'total_installments')::int, 1)) as liquido
        from fin_bank_statement_imports s
       where s.tenant_id = p_tenant and s.source = 'stone' and s.transaction_type = 'credit'
         and coalesce((s.stone_installment_info ->> 'installment_number')::int, 1) = 1
      union all
      select (s.raw ->> 'approved_date')::date, (s.raw ->> 'gross')::numeric, coalesce((s.raw ->> 'net')::numeric, s.amount)
        from fin_bank_statement_imports s
       where s.tenant_id = p_tenant and s.source = 'mercadopago' and s.transaction_type = 'credit'
         and s.raw ->> 'payment_type' in ('credit_card', 'debit_card', 'prepaid_card')
    ) x where d >= v_hoje - 200 group by d
  ),
  dias as (
    select coalesce(pdv.d, adq.d) as d, pdv.total as pdv_total, pdv.cartao as pdv_cartao,
           adq.cartao as adq_cartao, adq.taxa as adq_taxa
      from pdv full join adq on adq.d = pdv.d
  )
  select jsonb_build_object(
    'hoje', v_hoje,
    'inicio', nullif(v_inicio, date '2000-01-01'),
    'abertas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nome', nome, 'descricao', descricao, 'valor', valor, 'total', total, 'vencimento', vencimento,
        'status', status, 'origem', origem, 'reference_id', reference_id,
        'forma', coalesce(forma_conta, forma_compra), 'tem_boleto', tem_boleto, 'boleto_origem', boleto_origem, 'ja_paga', ja_paga,
        'parcela', parcela, 'parcelas', parcelas, 'fixa', coalesce(fixa, false),
        'compra_id', compra_id, 'nf', coalesce(nf_numero::text, nullif(invoice_number, '')), 'nf_sefaz', nf_numero is not null,
        'nf_emitida', nf_emitida, 'compra_em', purchase_date, 'chegou_em', chegou_em, 'espera_chegar', espera_chegar
      ) order by vencimento) from ab), '[]'::jsonb),
    'pagas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nome', nome, 'descricao', descricao, 'valor', valor, 'pago_em', pago_em, 'forma', forma,
        'origem', origem, 'fixa', coalesce(fixa, false), 'nf', coalesce(nf_numero::text, nullif(invoice_number, '')),
        'chegou_em', chegou_em, 'banco', banco
      ) order by pago_em desc) from pg), '[]'::jsonb),
    'notas_sem_conta', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id || ':' || parcela, 'doc_id', id, 'nome', nome, 'numero', numero, 'emitida', (emitted_at at time zone 'America/Sao_Paulo')::date,
        'valor', valor, 'vencimento', vencimento, 'parcela', parcela, 'parcelas', parcelas
      ) order by vencimento) from notas), '[]'::jsonb),
    'extrato_pendente', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', data, 'valor', valor, 'descricao', descricao, 'source', source, 'tipo', tipo, 'bank_account_id', bank_account_id
      ) order by data) from extrato), '[]'::jsonb),
    'saldos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'nome', b.name, 'saldo', coalesce(b.synced_balance, b.current_balance, 0),
        'atualizado_em', b.synced_balance_at, 'integrado', b.synced_provider is not null
      ) order by b.name) from fin_bank_accounts b where b.tenant_id = p_tenant and b.is_active), '[]'::jsonb),
    'vendas', coalesce((select jsonb_agg(jsonb_build_object(
        'd', d, 'pdv_total', pdv_total, 'pdv_cartao', pdv_cartao, 'adq_cartao', adq_cartao, 'adq_taxa', adq_taxa
      ) order by d) from dias where d is not null), '[]'::jsonb),
    'ifood', coalesce((select jsonb_agg(jsonb_build_object('data', data_repasse, 'valor', valor) order by data_repasse)
        from (select e.data_repasse::date as data_repasse, round(sum(e.valor), 2) as valor
                from fin_ifood_entries e
               where e.tenant_id = p_tenant and e.data_repasse::date > v_hoje
               group by 1) z), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$;

revoke all on function public.fn_contas_painel(uuid) from public, anon;
grant execute on function public.fn_contas_painel(uuid) to authenticated, service_role;
