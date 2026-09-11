-- Conciliação Stone × Inter (2026-09-11)
--
-- O repasse da maquininha Stone cai direto no Inter por domicílio bancário
-- (DOMICILIO_CARTAO "Crédito domicílio cartão - ... - Stone"). As linhas da API
-- da Stone (source='stone') são o DETALHE (venda, bandeira, taxa) e o dinheiro
-- está no Inter. Esta migration:
--   1. guarda o vínculo entre as linhas (match_kind / match_group);
--   2. liga/desliga o lançamento das vendas e taxas da Stone no financeiro;
--   3. cria fn_match_stone_inter: casa cada grupo de parcelas da Stone
--      (data de pagamento + antecipado sim/não) com os créditos do Inter do mesmo
--      dia e marca Pix/TED entre contas da própria empresa como transferência.

alter table public.fin_bank_statement_imports
  add column if not exists match_kind text,   -- stone_deposit | stone_detail | internal_transfer
  add column if not exists match_group text;  -- ex.: stone:2026-09-08:antecipado

create index if not exists idx_fbsi_match_group
  on public.fin_bank_statement_imports (tenant_id, match_group)
  where match_group is not null;

alter table public.fin_stone_config
  add column if not exists post_to_ledger boolean not null default false;

comment on column public.fin_stone_config.post_to_ledger is
  'Lança no fin_cash_flow as vendas (origin stone_sale) e as taxas (auto_card_fee) de cada dia liquidado pela Stone. Usar só enquanto as vendas de cartão NÃO forem registradas pelo PDV do ERP, senão a receita conta 2x.';

create or replace function public.fn_match_stone_inter(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  g record;
  v_key text;
  v_groups int := 0;
  v_inter int := 0;
  v_stone int := 0;
  v_transfers int := 0;
  v_n int;
begin
  for g in
    with st as (
      select transaction_date as d,
             coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0 as adv,
             count(*) as n,
             sum(amount) as liq,
             sum(coalesce((stone_installment_info->>'gross_amount')::numeric, amount)) as bruto,
             sum(coalesce((stone_installment_info->>'fee_amount')::numeric, 0)) as taxa,
             sum(coalesce((stone_installment_info->>'advance_fee')::numeric, 0)) as antecip
        from fin_bank_statement_imports
       where tenant_id = p_tenant and source = 'stone' and raw->>'kind' = 'installment'
         and transaction_type = 'credit' and status <> 'ignored'
         and transaction_date between p_from and p_to
       group by 1, 2
    ),
    it as (
      select transaction_date as d,
             description ilike '%antecipa%' as adv,
             count(*) as n,
             sum(amount) as valor,
             array_agg(id) as ids
        from fin_bank_statement_imports
       where tenant_id = p_tenant and source = 'inter'
         and raw->>'tipoTransacao' = 'DOMICILIO_CARTAO' and description ilike '%stone%'
         and transaction_type = 'credit' and status <> 'ignored' and not coalesce(reconciled, false)
         and (match_group is null or match_group like 'stone:%')
         and transaction_date between p_from and p_to
       group by 1, 2
    )
    select st.d, st.adv, st.n, st.liq, st.bruto, st.taxa, st.antecip, it.valor, it.ids, it.n as n_inter
      from st join it on it.d = st.d and it.adv = st.adv
     -- o Inter quebra por bandeira: 1 a 2 centavos de arredondamento por linha
     where abs(it.valor - st.liq) <= greatest(0.05, 0.02 * it.n)
  loop
    v_key := 'stone:' || g.d || ':' || case when g.adv then 'antecipado' else 'normal' end;

    update fin_bank_statement_imports
       set status = 'matched', match_kind = 'stone_deposit', match_group = v_key,
           matched_at = coalesce(matched_at, now()),
           category = coalesce(category, 'Repasse Stone'),
           notes = format('Repasse Stone de %s (%s): %s venda(s), bruto R$ %s, taxas R$ %s%s. A Stone liquidou R$ %s no dia.',
                          to_char(g.d, 'DD/MM'),
                          case when g.adv then 'antecipado' else 'sem antecipação' end,
                          g.n,
                          replace(to_char(g.bruto, 'FM999999990.00'), '.', ','),
                          replace(to_char(g.taxa, 'FM999999990.00'), '.', ','),
                          case when g.antecip > 0 then ' (antecipação R$ ' || replace(to_char(g.antecip, 'FM999999990.00'), '.', ',') || ')' else '' end,
                          replace(to_char(g.liq, 'FM999999990.00'), '.', ','))
     where id = any(g.ids);
    get diagnostics v_n = row_count;
    v_inter := v_inter + v_n;

    update fin_bank_statement_imports
       set status = 'matched', match_kind = 'stone_detail', match_group = v_key,
           matched_at = coalesce(matched_at, now()),
           notes = format('Depositado no Banco Inter em %s (repasse %s).', to_char(g.d, 'DD/MM'),
                          case when g.adv then 'antecipado' else 'sem antecipação' end)
     where tenant_id = p_tenant and source = 'stone' and raw->>'kind' = 'installment'
       and transaction_type = 'credit' and status <> 'ignored'
       and transaction_date = g.d
       and (coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0) = g.adv;
    get diagnostics v_n = row_count;
    v_stone := v_stone + v_n;
    v_groups := v_groups + 1;
  end loop;

  -- Pix/TED entre contas da PRÓPRIA empresa (ex.: Conta Stone → Inter): não é receita nem despesa.
  -- O CNPJ próprio é o pagador dos débitos do Inter (e tenants.cnpj, se preenchido).
  with own as (
    select distinct regexp_replace(raw->'detalhes'->>'cpfCnpjPagador', '\D', '', 'g') as doc
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'inter' and transaction_type = 'debit'
       and raw->>'tipoTransacao' = 'PIX' and coalesce(raw->'detalhes'->>'cpfCnpjPagador', '') <> ''
    union
    select regexp_replace(cnpj, '\D', '', 'g') from tenants where id = p_tenant and coalesce(cnpj, '') <> ''
  )
  update fin_bank_statement_imports i
     set status = 'matched', match_kind = 'internal_transfer', matched_at = coalesce(i.matched_at, now()),
         category = coalesce(i.category, 'Transferência entre contas'),
         notes = case when i.transaction_type = 'credit'
                      then 'Transferência entre contas da própria empresa' ||
                           coalesce(' (vinda de ' || nullif(i.raw->'detalhes'->>'nomeEmpresaPagador', '') || ')', '') ||
                           '. Não é receita.'
                      else 'Transferência para outra conta da própria empresa' ||
                           coalesce(' (' || nullif(i.raw->'detalhes'->>'nomeEmpresaRecebedor', '') || ')', '') ||
                           '. Não é despesa.' end
   where i.tenant_id = p_tenant and i.source = 'inter'
     and i.raw->>'tipoTransacao' in ('PIX', 'TRANSFERENCIA')
     and i.status = 'pending' and not coalesce(i.reconciled, false) and i.match_kind is null
     and i.transaction_date between p_from and p_to
     and (
       (i.transaction_type = 'credit' and regexp_replace(coalesce(i.raw->'detalhes'->>'cpfCnpjPagador', ''), '\D', '', 'g') in (select doc from own))
       or
       (i.transaction_type = 'debit' and regexp_replace(coalesce(i.raw->'detalhes'->>'cpfCnpjRecebedor', ''), '\D', '', 'g') in (select doc from own))
     );
  get diagnostics v_transfers = row_count;

  return jsonb_build_object('groups', v_groups, 'inter_rows', v_inter, 'stone_rows', v_stone, 'transfers', v_transfers);
end;
$$;

revoke all on function public.fn_match_stone_inter(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_match_stone_inter(uuid, date, date) to service_role;
